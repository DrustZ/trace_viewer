/**
 * Normalized trace model — the contract shared by the server, the web app,
 * the connectors, and the generator. Everything renders from these types.
 */

export type Role = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

/**
 * Harmony-style output channels. Only meaningful on assistant messages:
 * `analysis` = chain-of-thought, `commentary` = tool-call carrier, `final` = user-facing answer.
 * Absent channel is treated as `final`.
 */
export type Channel = 'analysis' | 'commentary' | 'final'

export type Split = 'train' | 'test'

export type TraceStatus = 'completed' | 'failed' | 'executing'

export interface TokenLogprob {
  token: string
  /** Natural log probability, <= 0. */
  logprob: number
  /** Vocabulary token id (stable per token string). Optional: imported formats may lack it. */
  id?: number
  /** Inference top-k alternatives at this position (usually only sampled for low-confidence tokens). */
  topk?: Array<{ token: string; logprob: number; id?: number }>
}

export interface ToolCall {
  id: string
  /** e.g. 'bash' | 'str_replace_editor' | 'run_tests' | 'search' */
  name: string
  /**
   * The arguments exactly as the model emitted them. Malformed JSON is a
   * first-class debugging artifact — never repaired or dropped at parse time.
   */
  arguments: string
  /** Present only when `arguments` parsed as JSON. */
  parsedArguments?: unknown
  /** Present only when `arguments` failed to parse. */
  parseError?: string
}

export interface ToolResult {
  toolCallId: string
  isError: boolean
  /** Wall-clock cost of the tool/sandbox execution (timeline view). */
  durationMs?: number
}

export interface Message {
  /** Unique within the trace, assigned by finalizeTrace when missing ("m-<idx>"). */
  id: string
  role: Role
  channel?: Channel
  content: string
  /** Set on assistant messages that invoke tools (usually channel 'commentary'). */
  toolCalls?: ToolCall[]
  /** Set on role 'tool' messages. */
  toolResult?: ToolResult
  /** Optional per-token logprobs for model-generated content. */
  tokens?: TokenLogprob[]
  /** ISO 8601 with millisecond precision. Absent ⇒ timeline falls back to sequence order. */
  timestamp?: string
  /** Time spent producing this message (generation or tool execution). */
  durationMs?: number
  /** 1-based assistant step this message belongs to; assigned by finalizeTrace. */
  stepIndex?: number
  /** Per-message reward, when a grader scores individual steps. */
  score?: number
  /** LLM-as-judge explanation attached to this message. */
  judgeOutput?: string
  metadata?: Record<string, unknown>
}

export interface ModelConfig {
  name: string
  contextWindow?: number
  temperature?: number
  topP?: number
}

export interface TraceStats {
  /** null ⇒ ungraded (still executing / grader never ran). UI shows "—", aggregates skip it. */
  score: number | null
  hasError: boolean
  truncated: boolean
  model?: ModelConfig
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  totalTokens: number
  /** Number of assistant steps (contiguous assistant message blocks). */
  turns: number
  toolUses: number
  /** Tool results produced by sandbox-class tools (see SANDBOX_TOOLS). */
  sandboxExecutions: number
  /** thinkingTokens / outputTokens, in [0, 1]. 0 when outputTokens is 0. */
  thinkingPortion: number
  durationMs?: number
}

export interface TraceMeta {
  traceId: string
  /** The task identity. Same instance across checkpoints — the Evolution join key. */
  instanceId: string
  /** Dataset/component name, e.g. 'swe/swebench-verified-mini'. Imports default to 'imported/<format>'. */
  component: string
  status: TraceStatus
  /** ISO 8601. Connectors fall back to file mtime or import time when the source lacks one. */
  timestamp: string
  /** Training checkpoint that produced this rollout. Imports default to 0. */
  checkpointStep: number
  split: Split
  /** Source file path or URL — where the raw trace lives. */
  dataLocation?: string
  /** Connector id that produced this trace: 'native' | 'harmony' | 'openai-chat' | ... */
  sourceFormat: string
  /** Grader breakdown, e.g. { tests_passed: 3, tests_total: 5 }. */
  rewardDetails?: Record<string, number>
  /** Unrecognized source fields are preserved here, never dropped. */
  extra?: Record<string, unknown>
}

export interface Trace {
  meta: TraceMeta
  stats: TraceStats
  messages: Message[]
  /** Non-fatal parse/normalization issues, surfaced in the UI. */
  warnings?: string[]
}

/** List/table payload — everything but the messages. */
export interface TraceSummary {
  meta: TraceMeta
  stats: TraceStats
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface ComponentAggregate {
  component: string
  split: Split
  count: number
  completed: number
  failed: number
  executing: number
  /** null when no trace in the group has a score. */
  avgScore: number | null
  /** Fraction of scored traces with score > 0; null when nothing is scored. */
  successRate: number | null
  truncatedRate: number
  avgTurns: number
  avgToolUses: number
  avgDurationMs: number | null
  avgOutputTokens: number
  avgThinkingTokens: number
  totalTokens: number
  /** Per-step averages for the table sparkline. */
  scoreByStep: Array<{ step: number; avgScore: number; count: number }>
}

export interface RewardCurvePoint {
  step: number
  avgScore: number
  count: number
}

export interface RewardCurves {
  train: RewardCurvePoint[]
  test: RewardCurvePoint[]
}

export interface EvolutionSeries {
  instanceId: string
  component: string
  points: Array<{
    step: number
    /** null when no rollout at this step is scored. */
    avgScore: number | null
    rollouts: TraceSummary[]
  }>
}

export interface StatTiles {
  total: number
  completed: number
  failed: number
  executing: number
  avgScore: number | null
  avgTurns: number
  avgDurationMs: number | null
}
