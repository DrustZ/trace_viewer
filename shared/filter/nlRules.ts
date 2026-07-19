import type { FilterCondition, FilterOp, FilterSet } from './types'

/**
 * Deterministic natural-language fallback for the AI filter: a lowercase rule
 * table over English (plus a few Chinese synonyms). Recognized clauses are
 * consumed from the query so leftover tokens can fuzzy-match components.
 */

const WORD_OPS: Record<string, FilterOp> = {
  above: 'gt',
  over: 'gt',
  'greater than': 'gt',
  'more than': 'gt',
  'at least': 'gte',
  below: 'lt',
  under: 'lt',
  'less than': 'lt',
  'at most': 'lte',
}

const OP_SYMBOLS: Record<string, string> = {
  eq: '=',
  neq: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
}

const SYMBOL_OPS: Record<string, FilterOp> = {
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
  '=': 'eq',
  '==': 'eq',
}

// Rule vocabulary and filler words that must never fuzzy-match a component.
const STOPWORDS = new Set([
  'all',
  'and',
  'any',
  'are',
  'checkpoint',
  'error',
  'errors',
  'failed',
  'fewer',
  'filter',
  'find',
  'for',
  'from',
  'get',
  'give',
  'has',
  'have',
  'least',
  'less',
  'list',
  'long',
  'more',
  'most',
  'not',
  'only',
  'passed',
  'passing',
  'reward',
  'rewards',
  'rollout',
  'rollouts',
  'run',
  'runs',
  'score',
  'scores',
  'show',
  'slow',
  'split',
  'status',
  'step',
  'steps',
  'task',
  'tasks',
  'test',
  'tests',
  'than',
  'that',
  'the',
  'them',
  'this',
  'those',
  'token',
  'tokens',
  'trace',
  'traces',
  'train',
  'training',
  'truncated',
  'turn',
  'turns',
  'was',
  'were',
  'where',
  'which',
  'with',
  'wrong',
  'zero',
])

export function parseNlQuery(
  query: string,
  ctx: { components: string[] },
): { filter: FilterSet; explanation: string } {
  const conditions: FilterCondition[] = []
  const parts: string[] = []
  let rest = ` ${query.toLowerCase()} `

  const add = (key: string, op: FilterOp, value: string | number | boolean, note?: string) => {
    conditions.push({ key, op, value })
    parts.push(`${key} ${OP_SYMBOLS[op] ?? op} ${value}${note ? ` (${note})` : ''}`)
  }

  const consume = (re: RegExp, onMatch: (m: RegExpExecArray) => void): void => {
    const m = re.exec(rest)
    if (!m) return
    onMatch(m)
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`
  }

  // Score / reward comparisons — symbolic, worded, Chinese, zero/wrong.
  consume(/(?:score|reward)s?\s*(<=|>=|==|=|<|>)\s*(\d+(?:\.\d+)?)/, (m) => {
    add('score', SYMBOL_OPS[m[1]], Number(m[2]))
  })
  consume(
    /(?:score|reward)s?\s+(?:of\s+|is\s+)?(above|over|greater\s+than|more\s+than|at\s+least|below|under|less\s+than|at\s+most)\s+(\d+(?:\.\d+)?)/,
    (m) => {
      add('score', WORD_OPS[m[1].replace(/\s+/g, ' ')], Number(m[2]))
    },
  )
  consume(/分数\s*(低于|小于|不到|高于|大于|超过|至少)\s*(\d+(?:\.\d+)?)/, (m) => {
    const op: FilterOp =
      m[1] === '高于' || m[1] === '大于' || m[1] === '超过' ? 'gt' : m[1] === '至少' ? 'gte' : 'lt'
    add('score', op, Number(m[2]))
  })
  consume(/zero[\s-]score|score\s+of\s+zero|\bwrong\b/, () => {
    add('score', 'eq', 0)
  })

  // Token volume.
  consume(/(?:over|above|more\s+than)\s+(\d+)(k?)\s*tokens?/, (m) => {
    add('totalTokens', 'gt', Number(m[1]) * (m[2] ? 1000 : 1))
  })
  consume(/(?:under|below|less\s+than|fewer\s+than)\s+(\d+)(k?)\s*tokens?/, (m) => {
    add('totalTokens', 'lt', Number(m[1]) * (m[2] ? 1000 : 1))
  })

  // Turn count.
  consume(/(?:more\s+than|over|above)\s+(\d+)\s+turns?/, (m) => {
    add('turns', 'gt', Number(m[1]))
  })
  consume(/(?:less\s+than|fewer\s+than|under)\s+(\d+)\s+turns?/, (m) => {
    add('turns', 'lt', Number(m[1]))
  })
  consume(/at\s+least\s+(\d+)\s+turns?/, (m) => {
    add('turns', 'gte', Number(m[1]))
  })
  consume(/\blong\b/, () => {
    add('turns', 'gte', 10, 'long')
  })

  // Checkpoint step — directional forms first so 'step N' doesn't shadow them.
  consume(/(?:after|past)\s+(?:step|checkpoint)\s*(\d+)/, (m) => {
    add('step', 'gt', Number(m[1]))
  })
  consume(/before\s+(?:step|checkpoint)\s*(\d+)/, (m) => {
    add('step', 'lt', Number(m[1]))
  })
  consume(/(?:at\s+)?(?:step|checkpoint)\s*(\d+)/, (m) => {
    add('step', 'eq', Number(m[1]))
  })

  // Outcome and state words.
  consume(/\btruncated\b|截断/, () => {
    add('truncated', 'eq', true)
  })
  consume(/\berror(?:s|ed)?\b|报错/, () => {
    add('hasError', 'eq', true)
  })
  consume(/\bexecuting\b|\brunning\b|\bin[\s-]progress\b/, () => {
    add('status', 'eq', 'executing')
  })
  consume(/\bfail(?:ed|ing|ures?|s)?\b|失败/, () => {
    add('status', 'eq', 'failed')
  })
  consume(/\bsuccess(?:ful(?:ly)?|es)?\b|\bpass(?:ed|ing)\b|\bsolved\b/, () => {
    add('score', 'gt', 0, 'successful')
  })

  // Split.
  consume(/\btrain(?:ing)?\b|训练/, () => {
    add('split', 'eq', 'train')
  })
  consume(/\btests?\b|测试/, () => {
    add('split', 'eq', 'test')
  })

  // Speed.
  consume(/\bslow(?:er|est)?\b/, () => {
    add('durationMs', 'gt', 60000, 'slow')
  })

  // Component fuzzy match on the leftover tokens.
  const componentsLower = ctx.components.map((c) => c.toLowerCase())
  for (const rawToken of rest.split(/\s+/)) {
    const token = rawToken.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    if (token.length < 3 || !/[a-z]/.test(token) || STOPWORDS.has(token)) continue
    const matches = ctx.components.filter((_, i) => componentsLower[i].includes(token))
    if (matches.length === 1) {
      add('component', 'eq', matches[0])
      break
    }
    if (matches.length > 1) {
      conditions.push({ key: 'component', op: 'contains', value: token })
      parts.push(`component contains "${token}"`)
      break
    }
  }

  const explanation =
    parts.length > 0
      ? `Filtering: ${parts.join(', ')}`
      : `No filters recognized in "${query}"; showing all traces`
  return { filter: { conditions }, explanation }
}
