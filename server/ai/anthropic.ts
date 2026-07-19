import Anthropic from '@anthropic-ai/sdk'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'
import { FILTER_KEY_MAP, FILTER_KEYS } from '../../shared/filter/keys'
import { parseNlQuery } from '../../shared/filter/nlRules'
import type { FilterCondition, FilterSet, FilterValue } from '../../shared/filter/types'

/**
 * LLM-backed natural-language → FilterSet translation with a deterministic
 * rules fallback (shared/filter/nlRules). Never throws: any LLM/validation
 * failure degrades to the rules parser so /api/ai-filter always answers.
 */

const REQUEST_TIMEOUT_MS = 8000
const MAX_TOKENS = 1000
const TOOL_NAME = 'emit_filter'

export interface NlFilterContext {
  components: string[]
  steps: number[]
}

export interface NlFilterResult {
  filter: FilterSet
  source: 'llm' | 'rules'
  explanation: string
}

/** Minimal client surface used here — a seam so tests can inject a fake. */
export interface EmitFilterClient {
  messages: {
    create(
      params: MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{ content: unknown }>
  }
}

const FILTER_OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'in'] as const
const KEY_IDS = FILTER_KEYS.map((k) => k.id)

const emitFilterSchema = z.object({
  conditions: z.array(
    z.object({
      key: z.enum(KEY_IDS as [string, ...string[]]),
      op: z.enum(FILTER_OPS),
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.union([z.string(), z.number()])),
      ]),
    }),
  ),
  explanation: z.string(),
})

const EMIT_FILTER_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: KEY_IDS },
          op: { type: 'string', enum: [...FILTER_OPS] },
          value: {
            oneOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
            ],
          },
        },
        required: ['key', 'op', 'value'],
      },
    },
    explanation: { type: 'string' },
  },
  required: ['conditions', 'explanation'],
}

const FEW_SHOT_EXAMPLES = `Examples:
Query: "failed swebench runs with more than 20 turns"
-> {"conditions":[{"key":"status","op":"eq","value":"failed"},{"key":"component","op":"contains","value":"swebench"},{"key":"turns","op":"gt","value":20}],"explanation":"Failed traces from swebench components with more than 20 turns"}
Query: "truncated traces over 100k tokens"
-> {"conditions":[{"key":"truncated","op":"eq","value":true},{"key":"totalTokens","op":"gt","value":100000}],"explanation":"Truncated traces with more than 100,000 total tokens"}
Query: "zero-score test rollouts at step 800"
-> {"conditions":[{"key":"score","op":"eq","value":0},{"key":"split","op":"eq","value":"test"},{"key":"step","op":"eq","value":800}],"explanation":"Test-split traces that scored 0 at checkpoint step 800"}`

function buildSystemPrompt(ctx: NlFilterContext): string {
  const keyLines = FILTER_KEYS.map((k) => `- ${k.id} (${k.type}): ${k.description}`).join('\n')
  const steps = ctx.steps.length
    ? `${Math.min(...ctx.steps)}..${Math.max(...ctx.steps)} (${ctx.steps.join(', ')})`
    : 'none'
  return `You translate a natural-language query about RL training traces into filter conditions by calling the ${TOOL_NAME} tool.

Filter keys (use ONLY these ids):
${keyLines}

Valid ops by key type: number -> eq, neq, lt, lte, gt, gte; string -> eq, neq, contains; boolean -> eq; enum -> eq, neq, in.

Available components: ${ctx.components.join(', ') || 'none'}
Available checkpoint steps: ${steps}

${FEW_SHOT_EXAMPLES}

Rules: use only the listed key ids and ops valid for that key's type. Emit numbers as JSON numbers and booleans as JSON booleans. Component values should match the available components (use 'contains' for partial matches). Conditions are ANDed together; use 'in' with an array for OR within one key. If nothing in the query maps to a filter, emit an empty conditions array.`
}

let singleton: EmitFilterClient | null = null

function getClient(): EmitFilterClient {
  if (!singleton) singleton = new Anthropic()
  return singleton
}

function findToolInput(content: unknown): unknown {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const rec = block as Record<string, unknown>
    if (rec.type === 'tool_use' && rec.name === TOOL_NAME) return rec.input
  }
  return undefined
}

/** Soft type coercion: numeric strings become numbers on number keys, etc. Numbers stay numbers. */
function coerceValue(key: string, value: FilterValue): FilterValue {
  if (Array.isArray(value)) return value
  const def = FILTER_KEY_MAP.get(key)
  if (def?.type === 'number' && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  if (def?.type === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return value
}

export async function nlToFilter(
  query: string,
  ctx: NlFilterContext,
  client?: EmitFilterClient,
): Promise<NlFilterResult> {
  const fallback = (): NlFilterResult => {
    const { filter, explanation } = parseNlQuery(query, ctx)
    return { filter, source: 'rules', explanation }
  }

  if (!process.env.ANTHROPIC_API_KEY) return fallback()

  try {
    const response = await (client ?? getClient()).messages.create(
      {
        model: process.env.AI_FILTER_MODEL ?? 'claude-sonnet-5',
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(ctx),
        messages: [{ role: 'user', content: query }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Emit the filter conditions matching the user query.',
            input_schema: EMIT_FILTER_INPUT_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )

    const parsed = emitFilterSchema.safeParse(findToolInput(response.content))
    if (!parsed.success) return fallback()
    if (parsed.data.conditions.length === 0 && query.trim() !== '') return fallback()

    const conditions: FilterCondition[] = parsed.data.conditions.map((c) => ({
      key: c.key,
      op: c.op,
      value: coerceValue(c.key, c.value),
    }))
    return { filter: { conditions }, source: 'llm', explanation: parsed.data.explanation }
  } catch {
    return fallback()
  }
}
