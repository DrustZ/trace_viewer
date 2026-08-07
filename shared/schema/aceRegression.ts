const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_VALUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_SNAPSHOT_BYTES = 256 * 1024
const MAX_LIST_ITEMS = 128

const LANGUAGES = new Set(['en', 'es', 'ko'])
const ID_KNOWLEDGE = new Set(['exact', 'partial', 'invents'])
const PERSISTENCE = new Set(['accepts_refusal', 'pushes_back', 'demands_human'])
const STYLE_TAGS = new Set(['terse', 'typos', 'chatty', 'frustrated'])
const TOOL_NAMES = new Set([
  'get_order_details',
  'check_valid_remediations',
  'cancel_order',
  'issue_refund',
  'issue_refund_as_human',
  'escalate_to_human',
  'get_store_info',
  'get_customer_orders',
])
const OUTCOMES = new Set(['refund', 'cancel', 'escalate', 'refusal', 'info'])
const REWARD_BASES = new Set([
  'ACTIONS',
  'FORBIDDEN',
  'OUTCOME',
  'WORLD_DIFF',
  'REQUIRED_INFO',
  'WRITE_SAFETY',
])
const EFFECTS = new Set(['refund', 'cancel', 'status_change'])
const DELTA_FIELDS = new Set(['refunded_total', 'status', 'payment.status'])

export interface AceRegressionScenarioCard {
  issue: string
  language: 'en' | 'es' | 'ko'
  id_knowledge: 'exact' | 'partial' | 'invents'
  patience: number
  persistence: 'accepts_refusal' | 'pushes_back' | 'demands_human'
  style: Array<'terse' | 'typos' | 'chatty' | 'frustrated'>
  order_id: string
  goal: string
  adversarial?: boolean
}

/**
 * A caller-completed Scenario is accepted only for production evidence which
 * lacks a trace-bound snapshot. Optional grading fields retain their JSON
 * shape so ACE's canonical Scenario parser remains the final authority.
 */
export interface AceRegressionScenarioSnapshot {
  scenario_id: string
  suite: string
  card: AceRegressionScenarioCard
  expected_actions: Array<{ name: string; args_subset?: Record<string, unknown> }>
  forbidden_actions: string[]
  expected_outcome: 'refund' | 'cancel' | 'escalate' | 'refusal' | 'info'
  reward_basis: string[]
  journey_id?: string | null
  journey_step?: number
  authorized_effects?: Array<Record<string, unknown>>
  required_info?: Array<Record<string, unknown>>
  expected_state_delta?: Array<Record<string, unknown>>
  must_precede?: unknown[][]
  consent_required?: boolean
  promise_check?: boolean
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`${path} has unknown field(s): ${unknown.join(', ')}`)
}

function text(
  value: unknown,
  path: string,
  options: { max?: number; pattern?: RegExp; values?: Set<string> } = {},
): string {
  const max = options.max ?? 256
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new Error(`${path} must be a non-empty string of at most ${max} characters`)
  }
  if (options.pattern && !options.pattern.test(value)) {
    throw new Error(`${path} contains unsupported characters`)
  }
  if (options.values && !options.values.has(value)) {
    throw new Error(`${path} must be one of ${[...options.values].join(', ')}`)
  }
  return value
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${path} must be an integer between ${min} and ${max}`)
  }
  return Number(value)
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${path} must be an array with at most ${MAX_LIST_ITEMS} items`)
  }
  return value
}

function uniqueStrings(value: unknown, path: string, values: Set<string>): string[] {
  const result = list(value, path).map((item, index) => text(item, `${path}[${index}]`, { values }))
  if (new Set(result).size !== result.length) throw new Error(`${path} must not contain duplicates`)
  return result
}

function jsonRecord(value: unknown, path: string): Record<string, unknown> {
  const result = record(value, path)
  const visit = (candidate: unknown, candidatePath: string, depth: number): void => {
    if (depth > 8) throw new Error(`${candidatePath} is nested too deeply`)
    if (candidate === null || ['string', 'number', 'boolean'].includes(typeof candidate)) {
      if (typeof candidate === 'number' && !Number.isFinite(candidate)) {
        throw new Error(`${candidatePath} must contain finite JSON values`)
      }
      return
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_LIST_ITEMS) throw new Error(`${candidatePath} is too large`)
      candidate.forEach((item, index) => {
        visit(item, `${candidatePath}[${index}]`, depth + 1)
      })
      return
    }
    const candidateRecord = record(candidate, candidatePath)
    if (Object.keys(candidateRecord).length > MAX_LIST_ITEMS) {
      throw new Error(`${candidatePath} has too many fields`)
    }
    for (const [key, item] of Object.entries(candidateRecord)) {
      if (key.length > 128 || [...key].some((character) => character.charCodeAt(0) < 32)) {
        throw new Error(`${candidatePath} has an invalid field name`)
      }
      visit(item, `${candidatePath}.${key}`, depth + 1)
    }
  }
  visit(result, path, 0)
  return result
}

function optionalBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

/** Parse and clone an untrusted production-derived Scenario definition. */
export function parseAceRegressionScenarioSnapshot(value: unknown): AceRegressionScenarioSnapshot {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('scenarioSnapshot must be serializable JSON')
  }
  if (serialized.length > MAX_SNAPSHOT_BYTES) {
    throw new Error(`scenarioSnapshot may contain at most ${MAX_SNAPSHOT_BYTES} JSON bytes`)
  }

  const source = record(value, 'scenarioSnapshot')
  rejectUnknown(
    source,
    [
      'scenario_id',
      'suite',
      'card',
      'expected_actions',
      'forbidden_actions',
      'expected_outcome',
      'reward_basis',
      'journey_id',
      'journey_step',
      'authorized_effects',
      'required_info',
      'expected_state_delta',
      'must_precede',
      'consent_required',
      'promise_check',
    ],
    'scenarioSnapshot',
  )
  const cardSource = record(source.card, 'scenarioSnapshot.card')
  rejectUnknown(
    cardSource,
    [
      'issue',
      'language',
      'id_knowledge',
      'patience',
      'persistence',
      'style',
      'order_id',
      'goal',
      'adversarial',
    ],
    'scenarioSnapshot.card',
  )
  const style = uniqueStrings(cardSource.style, 'scenarioSnapshot.card.style', STYLE_TAGS) as Array<
    'terse' | 'typos' | 'chatty' | 'frustrated'
  >
  const card: AceRegressionScenarioCard = {
    issue: text(cardSource.issue, 'scenarioSnapshot.card.issue', {
      max: 128,
      pattern: SAFE_VALUE_ID,
    }),
    language: text(cardSource.language, 'scenarioSnapshot.card.language', {
      values: LANGUAGES,
    }) as AceRegressionScenarioCard['language'],
    id_knowledge: text(cardSource.id_knowledge, 'scenarioSnapshot.card.id_knowledge', {
      values: ID_KNOWLEDGE,
    }) as AceRegressionScenarioCard['id_knowledge'],
    patience: integer(cardSource.patience, 'scenarioSnapshot.card.patience', 1, 100),
    persistence: text(cardSource.persistence, 'scenarioSnapshot.card.persistence', {
      values: PERSISTENCE,
    }) as AceRegressionScenarioCard['persistence'],
    style,
    order_id: text(cardSource.order_id, 'scenarioSnapshot.card.order_id', {
      max: 128,
      pattern: SAFE_VALUE_ID,
    }),
    goal: text(cardSource.goal, 'scenarioSnapshot.card.goal', { max: 4096 }),
    ...(cardSource.adversarial !== undefined
      ? {
          adversarial: optionalBoolean(cardSource.adversarial, 'scenarioSnapshot.card.adversarial'),
        }
      : {}),
  }

  const expectedActions = list(source.expected_actions, 'scenarioSnapshot.expected_actions').map(
    (item, index) => {
      const action = record(item, `scenarioSnapshot.expected_actions[${index}]`)
      rejectUnknown(action, ['name', 'args_subset'], `scenarioSnapshot.expected_actions[${index}]`)
      return {
        name: text(action.name, `scenarioSnapshot.expected_actions[${index}].name`, {
          values: TOOL_NAMES,
        }),
        ...(action.args_subset !== undefined
          ? {
              args_subset: jsonRecord(
                action.args_subset,
                `scenarioSnapshot.expected_actions[${index}].args_subset`,
              ),
            }
          : {}),
      }
    },
  )

  const result: AceRegressionScenarioSnapshot = {
    scenario_id: text(source.scenario_id, 'scenarioSnapshot.scenario_id', {
      pattern: SAFE_ID,
    }),
    suite: text(source.suite, 'scenarioSnapshot.suite', { pattern: SAFE_ID }),
    card,
    expected_actions: expectedActions,
    forbidden_actions: uniqueStrings(
      source.forbidden_actions,
      'scenarioSnapshot.forbidden_actions',
      TOOL_NAMES,
    ),
    expected_outcome: text(source.expected_outcome, 'scenarioSnapshot.expected_outcome', {
      values: OUTCOMES,
    }) as AceRegressionScenarioSnapshot['expected_outcome'],
    reward_basis: uniqueStrings(source.reward_basis, 'scenarioSnapshot.reward_basis', REWARD_BASES),
  }
  if (result.reward_basis.length === 0) {
    throw new Error('scenarioSnapshot.reward_basis must include at least one grading basis')
  }
  if (source.journey_id !== undefined) {
    result.journey_id =
      source.journey_id === null
        ? null
        : text(source.journey_id, 'scenarioSnapshot.journey_id', { pattern: SAFE_ID })
  }
  if (source.journey_step !== undefined) {
    result.journey_step = integer(source.journey_step, 'scenarioSnapshot.journey_step', 0, 10_000)
  }

  if (source.authorized_effects !== undefined) {
    result.authorized_effects = list(
      source.authorized_effects,
      'scenarioSnapshot.authorized_effects',
    ).map((item, index) => {
      const effect = record(item, `scenarioSnapshot.authorized_effects[${index}]`)
      rejectUnknown(
        effect,
        ['order_id', 'effects', 'refund_cap'],
        `scenarioSnapshot.authorized_effects[${index}]`,
      )
      return {
        order_id: text(effect.order_id, `scenarioSnapshot.authorized_effects[${index}].order_id`, {
          pattern: SAFE_VALUE_ID,
        }),
        effects: uniqueStrings(
          effect.effects,
          `scenarioSnapshot.authorized_effects[${index}].effects`,
          EFFECTS,
        ),
        ...(effect.refund_cap !== undefined
          ? {
              refund_cap: integer(
                effect.refund_cap,
                `scenarioSnapshot.authorized_effects[${index}].refund_cap`,
                0,
                Number.MAX_SAFE_INTEGER,
              ),
            }
          : {}),
      }
    })
  }
  if (source.required_info !== undefined) {
    result.required_info = list(source.required_info, 'scenarioSnapshot.required_info').map(
      (item, index) => {
        const atom = record(item, `scenarioSnapshot.required_info[${index}]`)
        rejectUnknown(atom, ['kind', 'value'], `scenarioSnapshot.required_info[${index}]`)
        const kind = text(atom.kind, `scenarioSnapshot.required_info[${index}].kind`, {
          values: new Set(['money', 'text']),
        })
        if (
          (kind === 'money' && (!Number.isSafeInteger(atom.value) || Number(atom.value) < 0)) ||
          (kind === 'text' && (typeof atom.value !== 'string' || atom.value.length > 4096))
        ) {
          throw new Error(`scenarioSnapshot.required_info[${index}].value is invalid for ${kind}`)
        }
        return { kind, value: atom.value }
      },
    )
  }
  if (source.expected_state_delta !== undefined) {
    result.expected_state_delta = list(
      source.expected_state_delta,
      'scenarioSnapshot.expected_state_delta',
    ).map((item, index) => {
      const delta = record(item, `scenarioSnapshot.expected_state_delta[${index}]`)
      rejectUnknown(
        delta,
        ['order_id', 'field', 'to'],
        `scenarioSnapshot.expected_state_delta[${index}]`,
      )
      const field = text(delta.field, `scenarioSnapshot.expected_state_delta[${index}].field`, {
        values: DELTA_FIELDS,
      })
      if (field === 'refunded_total' && (!Number.isSafeInteger(delta.to) || Number(delta.to) < 0)) {
        throw new Error(
          `scenarioSnapshot.expected_state_delta[${index}].to must be non-negative cents`,
        )
      }
      if (field !== 'refunded_total' && (typeof delta.to !== 'string' || delta.to.length > 256)) {
        throw new Error(`scenarioSnapshot.expected_state_delta[${index}].to must be a string`)
      }
      return {
        order_id: text(delta.order_id, `scenarioSnapshot.expected_state_delta[${index}].order_id`, {
          pattern: SAFE_VALUE_ID,
        }),
        field,
        to: delta.to,
      }
    })
  }
  if (source.must_precede !== undefined) {
    result.must_precede = list(source.must_precede, 'scenarioSnapshot.must_precede').map(
      (item, index) => {
        if (!Array.isArray(item) || (item.length !== 2 && item.length !== 3)) {
          throw new Error(`scenarioSnapshot.must_precede[${index}] must contain 2 or 3 items`)
        }
        const pair: unknown[] = [
          text(item[0], `scenarioSnapshot.must_precede[${index}][0]`, { values: TOOL_NAMES }),
          text(item[1], `scenarioSnapshot.must_precede[${index}][1]`, { values: TOOL_NAMES }),
        ]
        if (item.length === 3) {
          pair.push(jsonRecord(item[2], `scenarioSnapshot.must_precede[${index}][2]`))
        }
        return pair
      },
    )
  }
  if (source.consent_required !== undefined) {
    result.consent_required = optionalBoolean(
      source.consent_required,
      'scenarioSnapshot.consent_required',
    )
  }
  if (source.promise_check !== undefined) {
    result.promise_check = optionalBoolean(source.promise_check, 'scenarioSnapshot.promise_check')
  }
  return result
}
