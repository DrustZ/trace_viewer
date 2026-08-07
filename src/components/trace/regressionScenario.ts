import {
  type AceRegressionScenarioSnapshot,
  parseAceRegressionScenarioSnapshot,
} from '@shared/schema/aceRegression'
import type { Message, Trace } from '@shared/schema/types'

/**
 * Production-evidence → runnable regression scenario seeding, shared by the
 * trace Rerun tab and the Playground. Builds an editable draft from evidence
 * only; missing ground truth stays visibly blank.
 */

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Messages with their chronological/raw indices, ordered chronologically. */
export function chronologicalMessages(messages: readonly Message[]) {
  return messages
    .map((message, position) => ({
      message,
      position,
      chronologicalIndex: message.chronologicalIndex ?? position,
      rawIndex: message.rawIndex ?? position,
    }))
    .sort(
      (left, right) =>
        left.chronologicalIndex - right.chronologicalIndex || left.position - right.position,
    )
}

const ACE_TOOL_NAMES = new Set([
  'get_order_details',
  'check_valid_remediations',
  'cancel_order',
  'issue_refund',
  'issue_refund_as_human',
  'escalate_to_human',
  'get_store_info',
  'get_customer_orders',
])

function safeScenarioValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
  return /^[a-z0-9]/.test(normalized) ? normalized : fallback
}

function safeScenarioId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
  return /^[a-z0-9]/.test(normalized) ? normalized : 'production-regression'
}

function productionLanguage(value: unknown): 'en' | 'es' | 'ko' {
  if (typeof value !== 'string') return 'en'
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ko' || normalized.startsWith('kor')) return 'ko'
  if (normalized === 'es' || normalized.startsWith('spa')) return 'es'
  return 'en'
}

function firstOrderId(trace: Trace): string {
  const extra = record(trace.meta.extra)
  for (const candidate of [extra.order_id, extra.orderId]) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
      return candidate
    }
  }
  for (const entry of trace.evaluation?.ledger ?? []) {
    const args = record(entry.args)
    const candidate = args.order_id ?? args.orderId
    if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
      return candidate
    }
  }
  for (const message of trace.messages) {
    for (const call of message.toolCalls ?? []) {
      let args = record(call.parsedArguments)
      if (Object.keys(args).length === 0) {
        try {
          args = record(JSON.parse(call.arguments))
        } catch {
          args = {}
        }
      }
      const candidate = args.order_id ?? args.orderId
      if (typeof candidate === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) {
        return candidate
      }
    }
  }
  const transcript = trace.messages.map((message) => message.content).join(' ')
  return transcript.match(/\border[_ -]?\d+\b/i)?.[0]?.replace(/[ -]/g, '_') ?? ''
}

function productionExpectedOutcome(
  issue: string,
): AceRegressionScenarioSnapshot['expected_outcome'] {
  if (issue.includes('cancel')) return 'cancel'
  if (issue.includes('refund') || issue.includes('damaged') || issue.includes('missing')) {
    return 'refund'
  }
  if (issue.includes('escalat') || issue.includes('human')) return 'escalate'
  return 'info'
}

/** Build an editable draft from evidence only; missing ground truth stays visibly blank. */
export function productionRegressionScenarioSeed(trace: Trace): AceRegressionScenarioSnapshot {
  const extra = record(trace.meta.extra)
  const issue = safeScenarioValue(extra.issue ?? extra.issue_type, 'other')
  const orderId = firstOrderId(trace)
  const userTurns = chronologicalMessages(trace.messages)
    .map(({ message }) => message)
    .filter((message) => message.role === 'user')
  const firstUser = userTurns[0]?.content.trim()
  const observedTools = [
    ...new Set(
      trace.messages
        .flatMap((message) => message.toolCalls ?? [])
        .map((call) => call.name)
        .filter((name) => ACE_TOOL_NAMES.has(name)),
    ),
  ]
  const expectedActions = observedTools.map((name) => ({
    name,
    ...(orderId && name !== 'escalate_to_human' && name !== 'get_customer_orders'
      ? { args_subset: { order_id: orderId } }
      : {}),
  }))
  const userTranscript = userTurns.map((message) => message.content).join(' ')
  return {
    scenario_id: safeScenarioId(`production-${trace.meta.sourceTraceId ?? trace.meta.traceId}`),
    suite: 'regression',
    card: {
      issue,
      language: productionLanguage(extra.language),
      id_knowledge: orderId && userTranscript.includes(orderId) ? 'exact' : 'partial',
      patience: Math.max(4, Math.min(100, userTurns.length + 2)),
      persistence: 'accepts_refusal',
      style: [],
      order_id: orderId,
      goal: (firstUser || 'Reproduce and investigate this production support request.').slice(
        0,
        4096,
      ),
    },
    expected_actions: expectedActions,
    forbidden_actions: [],
    expected_outcome: productionExpectedOutcome(issue),
    reward_basis: expectedActions.length > 0 ? ['ACTIONS', 'OUTCOME'] : ['OUTCOME'],
  }
}

export type RegressionScenarioDraftValidation =
  | { ok: true; scenario: AceRegressionScenarioSnapshot }
  | { ok: false; error: string }

export function validateRegressionScenarioDraft(text: string): RegressionScenarioDraftValidation {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: `Scenario JSON is invalid: ${error instanceof Error ? error.message : 'parse failed'}`,
    }
  }
  try {
    return { ok: true, scenario: parseAceRegressionScenarioSnapshot(value) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Scenario is invalid' }
  }
}
