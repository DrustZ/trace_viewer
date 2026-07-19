/**
 * Per-message token inspector plus the Rendered | Raw | Tokens view tabs that
 * replace the old global logprob toggle. Recorded tokens color by confidence
 * (p ≥ 80% high / ≥ 50% med / else low); messages without token data fall back
 * to client-side BPE segmentation (all chips N/A, probability UI disabled).
 */
import type { Message, TokenLogprob } from '@shared/schema/types'
import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { CONFIDENCE_CHIP_CLASSES, CONFIDENCE_LABELS, type Confidence } from './logprobColor'
import { chipParts, confidence80, TOKEN_RENDER_CAP, visualizeWhitespace } from './TokenLogprobText'
import { bpeTokens } from './tokenize'

export type MessageViewTab = 'rendered' | 'raw' | 'tokens'

// Per-message tab choices keyed by message id. Module-level so the choice survives
// virtualization recycling (same pattern as the Rich/Raw store in MarkdownContent).
// Persists for the browser session only.
const viewTabs = new Map<string, MessageViewTab>()

/** Test hook: reset the session store. */
export function clearViewTabs(): void {
  viewTabs.clear()
}

/** Tab state for one message, backed by the module-level session store. */
export function useMessageViewTab(id: string) {
  const [tab, setTabState] = useState<MessageViewTab>(() => viewTabs.get(id) ?? 'rendered')
  const setTab = (next: MessageViewTab) => {
    viewTabs.set(id, next)
    setTabState(next)
  }
  return [tab, setTab] as const
}

/** Segmented pill switching one message between Rendered / Raw / Tokens. */
export function ViewTabs({
  tab,
  onChange,
  tokenCount,
}: {
  tab: MessageViewTab
  onChange: (tab: MessageViewTab) => void
  /** Recorded token count shown in the Tokens label; omitted for BPE-fallback messages. */
  tokenCount?: number
}) {
  const segment = (value: MessageViewTab, label: string) => (
    <button
      type="button"
      data-testid={`tab-${value}`}
      aria-pressed={tab === value}
      onClick={() => onChange(value)}
      className={`px-1.5 py-px text-[10px] font-medium transition-colors ${
        tab === value
          ? 'bg-slate-200 text-slate-700'
          : 'bg-white text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full border border-slate-200">
      {segment('rendered', 'Rendered')}
      {segment('raw', 'Raw')}
      {segment('tokens', tokenCount === undefined ? 'Tokens' : `Tokens (${tokenCount})`)}
    </span>
  )
}

/**
 * Header line for one message/content piece: coverage chip when recorded tokens
 * exist, harmony termination marker for assistant pieces, then the view tabs.
 */
export function MessageViewHeader({
  message,
  tab,
  onChange,
  termination,
  className,
}: {
  message: Message
  tab: MessageViewTab
  onChange: (tab: MessageViewTab) => void
  /** Harmony semantics: 'return' on the assistant final piece, 'end' on other assistant pieces. */
  termination?: 'return' | 'end'
  className?: string
}) {
  const recorded = message.tokens !== undefined && message.tokens.length > 0
  return (
    <div className={`flex items-center justify-end gap-1.5 ${className ?? ''}`}>
      {recorded && (
        <span
          data-testid="tokens-coverage-chip"
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] text-slate-500"
          title="Recorded per-token logprobs cover this message"
        >
          {message.tokens?.length} tokens · 100% pr
        </span>
      )}
      {termination && (
        <span
          data-testid="termination-chip"
          className="rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] text-slate-500"
          title={`Harmony termination marker: <|${termination}|>`}
        >
          {termination}
        </span>
      )}
      <ViewTabs
        tab={tab}
        onChange={onChange}
        tokenCount={recorded ? message.tokens?.length : undefined}
      />
    </div>
  )
}

/** Raw view: the FULL message object pretty-printed, not just its text content. */
const RAW_JSON_CAP = 200_000

export function RawMessageJson({ message }: { message: Message }) {
  const json = useMemo(() => JSON.stringify(message, null, 2), [message])
  const truncated = json.length > RAW_JSON_CAP
  return (
    <div className="px-1.5 py-1" data-testid="raw-message-json">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100">
        {truncated ? json.slice(0, RAW_JSON_CAP) : json}
      </pre>
      {truncated && (
        <p className="mt-1 text-xs text-slate-400 italic">
          (truncated view — {json.length.toLocaleString()} chars)
        </p>
      )}
    </div>
  )
}

const LEGEND: ReadonlyArray<{ confidence: Confidence; label: string }> = [
  { confidence: 'high', label: 'High ≥80%' },
  { confidence: 'med', label: 'Med 50–79%' },
  { confidence: 'low', label: 'Low <50%' },
  { confidence: 'na', label: 'N/A' },
]

/** Chip body text: whitespace-visible when `ws` is on, chipParts-trimmed otherwise. */
export function chipDisplay(token: string, ws: boolean): string {
  if (ws) return token.replace(/ /g, '·').replace(/\n/g, '↵').replace(/\t/g, '→')
  const { body, newlines } = chipParts(token)
  if (body.length > 0) return body
  return newlines > 0 ? '↵'.repeat(newlines) : visualizeWhitespace(token)
}

function InspectorToggle({
  label,
  pressed,
  onClick,
  disabled = false,
  title,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  disabled?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      data-testid={`inspector-toggle-${title}`}
      onClick={onClick}
      className={`h-5 rounded border px-1.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed
          ? 'border-slate-700 bg-slate-800 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xs text-slate-700 ${mono ? 'break-all font-mono' : 'tabular-nums'}`}>
        {value}
      </p>
    </div>
  )
}

/** Inline detail card for the selected token (no popover — the row grows in place). */
function TokenDetail({
  token,
  index,
  synthetic,
  showTopk,
}: {
  token: TokenLogprob
  index: number
  synthetic: boolean
  showTopk: boolean
}) {
  const confidence = synthetic ? 'na' : confidence80(token.logprob)
  const p = Math.exp(token.logprob)
  return (
    <div
      className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
      data-testid="token-detail"
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <DetailField label="Selected token" value={visualizeWhitespace(token.token)} mono />
        <DetailField label="Index" value={String(index)} />
        <DetailField label="Token id" value={token.id === undefined ? '—' : String(token.id)} />
        <DetailField label="Confidence" value={CONFIDENCE_LABELS[confidence]} />
        <DetailField label="Probability" value={synthetic ? '—' : p.toFixed(4)} />
        <DetailField label="Logprob" value={synthetic ? '—' : token.logprob.toFixed(4)} />
        <DetailField label="Raw token" value={JSON.stringify(token.token)} mono />
      </div>
      {showTopk && (token.topk === undefined || token.topk.length === 0) && (
        <div
          className="mt-2 border-t border-slate-200 pt-1.5 text-[10px] text-slate-400"
          data-testid="token-detail-topk-empty"
        >
          No top-k alternatives recorded for this token — inference only logs them for
          lower-confidence tokens. Pick a token with a ⋯ marker.
        </div>
      )}
      {showTopk && token.topk !== undefined && token.topk.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-1.5" data-testid="token-detail-topk">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
            Top alternatives
          </p>
          <div className="flex flex-wrap gap-1">
            {token.topk.map((alt) => {
              const chosen = alt.token === token.token && alt.logprob === token.logprob
              return (
                <span
                  key={`${alt.token}:${alt.logprob}`}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    chosen
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {visualizeWhitespace(alt.token)} · {alt.logprob.toFixed(3)} ·{' '}
                  {(Math.exp(alt.logprob) * 100).toFixed(1)}%
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The Tokens tab body: stats bar + display toggles, confidence legend, clickable
 * token chips (single selection), and an inline detail panel for the selection.
 * Falls back to synthetic BPE segmentation when the message has no recorded tokens.
 */
export function TokenInspector({ message, className }: { message: Message; className?: string }) {
  const real = message.tokens !== undefined && message.tokens.length > 0 ? message.tokens : null
  // Content-less commentary messages carry their model output in the tool-call
  // arguments, so the fallback segments those instead.
  const fallbackText =
    message.content || (message.toolCalls?.map((c) => c.arguments).join('\n') ?? '')
  const synthetic = useMemo(
    () => (real !== null ? [] : bpeTokens(fallbackText)),
    [real, fallbackText],
  )
  const tokens = real ?? synthetic
  const isSynthetic = real === null

  const [selected, setSelected] = useState<number | null>(null)
  // Local per-inspector display toggles. Defaults: Probs on, others off.
  const [showTopk, setShowTopk] = useState(false)
  const [showProbs, setShowProbs] = useState(true)
  const [showIndex, setShowIndex] = useState(false)
  const [showWs, setShowWs] = useState(false)

  // A new token list invalidates the selection (render-phase reset).
  const [prevTokens, setPrevTokens] = useState(tokens)
  if (prevTokens !== tokens) {
    setPrevTokens(tokens)
    setSelected(null)
  }

  const onChipClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(e.currentTarget.dataset.ti)
    if (Number.isNaN(index)) return
    setSelected((prev) => (prev === index ? null : index))
  }, [])

  const stats = useMemo(() => {
    const chars = tokens.reduce((n, t) => n + t.token.length, 0)
    if (isSynthetic || tokens.length === 0) return { chars, avgP: undefined, minP: undefined }
    let sum = 0
    let min = Number.POSITIVE_INFINITY
    for (const t of tokens) {
      const p = Math.exp(t.logprob)
      sum += p
      if (p < min) min = p
    }
    return { chars, avgP: (sum / tokens.length) * 100, minP: min * 100 }
  }, [tokens, isSynthetic])

  const chips = useMemo(() => {
    const shown = tokens.length > TOKEN_RENDER_CAP ? tokens.slice(0, TOKEN_RENDER_CAP) : tokens
    const out: ReactElement[] = []
    let offset = 0
    shown.forEach((t, i) => {
      const confidence = isSynthetic ? 'na' : confidence80(t.logprob)
      out.push(
        <button
          key={offset}
          type="button"
          data-ti={i}
          data-testid="inspector-token"
          onClick={onChipClick}
          title={visualizeWhitespace(t.token)}
          className={`inline-flex cursor-pointer items-start whitespace-pre rounded border px-1 text-left font-mono text-xs leading-5 hover:ring-1 hover:ring-slate-400 ${
            CONFIDENCE_CHIP_CLASSES[confidence]
          } ${selected === i ? 'ring-2 ring-violet-500' : ''}`}
        >
          {showIndex && <span className="-mt-0.5 mr-0.5 text-[8px] text-slate-400">#{i}</span>}
          {chipDisplay(t.token, showWs)}
          {showProbs && !isSynthetic && (
            <span className="-mt-0.5 ml-0.5 text-[8px] text-slate-500">
              {(Math.exp(t.logprob) * 100).toFixed(0)}%
            </span>
          )}
          {showTopk && t.topk !== undefined && t.topk.length > 0 && (
            <span
              className="-mt-0.5 ml-0.5 text-[8px] text-violet-500"
              title="has top-k alternatives"
            >
              ⋯
            </span>
          )}
        </button>,
      )
      offset += t.token.length + 1
    })
    return { spans: out, overflow: tokens.length - shown.length }
  }, [tokens, isSynthetic, selected, showIndex, showProbs, showWs, showTopk, onChipClick])

  const active = selected === null ? undefined : tokens[selected]

  return (
    <div
      className={className}
      data-testid="token-inspector"
      data-source={isSynthetic ? 'bpe' : 'recorded'}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="tabular-nums">
          {tokens.length} tokens · {stats.chars} chars
        </span>
        <span
          data-testid="token-source-badge"
          className={`rounded border px-1 text-[10px] font-medium ${
            isSynthetic
              ? 'border-slate-300 bg-slate-100 text-slate-500'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700'
          }`}
        >
          {isSynthetic ? 'BPE (synthetic)' : 'recorded'}
        </span>
        {stats.avgP !== undefined && stats.minP !== undefined && (
          <span className="tabular-nums" data-testid="token-prob-stats">
            {stats.avgP.toFixed(1)}% avg · {stats.minP.toFixed(1)}% min
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <InspectorToggle
            label="Top-K"
            title="topk"
            pressed={showTopk}
            onClick={() => setShowTopk((v) => !v)}
          />
          <InspectorToggle
            label="Probs"
            title="probs"
            pressed={showProbs && !isSynthetic}
            disabled={isSynthetic}
            onClick={() => setShowProbs((v) => !v)}
          />
          <InspectorToggle
            label="#"
            title="index"
            pressed={showIndex}
            onClick={() => setShowIndex((v) => !v)}
          />
          <InspectorToggle
            label="↵"
            title="whitespace"
            pressed={showWs}
            onClick={() => setShowWs((v) => !v)}
          />
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {LEGEND.map(({ confidence, label }) => (
          <span
            key={confidence}
            className={`rounded border px-1 text-[10px] ${CONFIDENCE_CHIP_CLASSES[confidence]}`}
          >
            {label}
          </span>
        ))}
      </div>
      {tokens.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400 italic">
          no token data — content is empty or exceeds the BPE fallback limit
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-[3px]" data-testid="token-chips">
          {chips.spans}
          {chips.overflow > 0 && (
            <span className="self-center text-[10px] text-slate-400">
              +{chips.overflow} more tokens
            </span>
          )}
        </div>
      )}
      {active !== undefined && selected !== null ? (
        <TokenDetail token={active} index={selected} synthetic={isSynthetic} showTopk={showTopk} />
      ) : (
        tokens.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400 italic" data-testid="token-detail-empty">
            click a token to inspect
          </p>
        )
      )}
    </div>
  )
}
