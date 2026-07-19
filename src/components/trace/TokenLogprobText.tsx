import type { TokenLogprob } from '@shared/schema/types'
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CONFIDENCE_CHIP_CLASSES,
  CONFIDENCE_LABELS,
  type Confidence,
  confidenceOf,
  TOKEN_CYCLE_CLASSES,
} from './logprobColor'

/**
 * Token-inspector confidence thresholds: p ≥ 0.8 high, p ≥ 0.5 med, else low.
 * Missing logprob (synthetic BPE tokens) → 'na'. Lives alongside confidenceOf
 * (0.7/0.3 buckets) which the legacy probs view keeps using.
 */
export function confidence80(logprob: number | undefined): Confidence {
  if (logprob === undefined) return 'na'
  const p = Math.exp(logprob)
  if (p >= 0.8) return 'high'
  if (p >= 0.5) return 'med'
  return 'low'
}

/** Past this many tokens the remainder renders as plain text (a span per token gets slow). */
export const TOKEN_RENDER_CAP = 1500

/** Make whitespace visible in the popover's quoted token: space → ·, newline → ⏎, tab → →. */
export function visualizeWhitespace(s: string): string {
  return s.replace(/ /g, '·').replace(/\n/g, '⏎').replace(/\t/g, '→')
}

/**
 * Split a token for chip display: leading spaces are trimmed, tabs become →,
 * and trailing newlines split off into a separate 'na' chip rendered as ↵.
 * A token of only spaces falls back to visible middots so it stays clickable.
 */
export function chipParts(token: string): { body: string; newlines: number } {
  const m = /\n+$/.exec(token)
  const newlines = m ? m[0].length : 0
  const body = token
    .slice(0, token.length - newlines)
    .replace(/^ +/, '')
    .replace(/\t/g, '→')
    .replace(/\n/g, '↵')
  if (body === '' && newlines === 0 && token.length > 0) {
    return { body: visualizeWhitespace(token), newlines: 0 }
  }
  return { body, newlines }
}

/** Hover tooltip in 'probs' mode: quoted token, logprob, probability. */
export function probsTitle(t: TokenLogprob): string {
  const p = Math.exp(t.logprob) * 100
  return `${JSON.stringify(t.token)} · ${t.logprob.toFixed(3)} · ${p.toFixed(1)}%`
}

/** Hover tooltip in 'tokens' mode: token plus its vocabulary id when known. */
export function tokensTitle(t: TokenLogprob): string {
  return t.id === undefined ? t.token : `${t.token} · id ${t.id}`
}

interface PopoverState {
  /** Index into `tokens` of the clicked token. */
  index: number
  /** Position relative to the component's relative wrapper. */
  top: number
  left: number
  /** Render above the token (translateY(-100%)) when the viewport bottom is too close. */
  flip: boolean
}

const POPOVER_WIDTH = 232
/** Rough max popover height used to decide whether to flip above the token. */
const POPOVER_EST_HEIGHT = 240

function PopoverRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span
        className={`text-right text-slate-700 ${mono ? 'break-all font-mono' : 'tabular-nums'}`}
      >
        {value}
      </span>
    </div>
  )
}

export function TokenLogprobText({
  tokens,
  mode,
  className,
}: {
  tokens: TokenLogprob[]
  mode: 'tokens' | 'probs'
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  // A new token list or view mode invalidates the anchor position (render-phase reset).
  const [prevInputs, setPrevInputs] = useState({ tokens, mode })
  if (prevInputs.tokens !== tokens || prevInputs.mode !== mode) {
    setPrevInputs({ tokens, mode })
    setPopover(null)
  }

  const onTokenClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget
    const index = Number(el.dataset.ti)
    const wrap = wrapRef.current
    if (wrap === null || Number.isNaN(index)) return
    const rect = el.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const flip =
      rect.bottom + POPOVER_EST_HEIGHT > window.innerHeight && rect.top > POPOVER_EST_HEIGHT
    setPopover((prev) =>
      prev?.index === index
        ? null
        : {
            index,
            top: flip ? rect.top - wrapRect.top - 4 : rect.bottom - wrapRect.top + 4,
            left: Math.max(0, Math.min(rect.left - wrapRect.left, wrapRect.width - POPOVER_WIDTH)),
            flip,
          },
    )
  }, [])

  // Esc or a click outside any token/popover closes; token clicks toggle in onTokenClick.
  useEffect(() => {
    if (popover === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    const onDown = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('[data-testid="token-popover"]') || el?.closest('[data-ti]')) return
      setPopover(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [popover])

  const { spans, overflowText, overflowCount } = useMemo(() => {
    const shown = tokens.length > TOKEN_RENDER_CAP ? tokens.slice(0, TOKEN_RENDER_CAP) : tokens
    const out: ReactElement[] = []
    let offset = 0
    shown.forEach((t, i) => {
      if (mode === 'tokens') {
        out.push(
          <span
            key={offset}
            className={`rounded-[2px] ${TOKEN_CYCLE_CLASSES[i % TOKEN_CYCLE_CLASSES.length]}`}
            title={tokensTitle(t)}
          >
            {t.token}
          </span>,
        )
      } else {
        const { body, newlines } = chipParts(t.token)
        if (body.length > 0) {
          out.push(
            <button
              key={offset}
              type="button"
              data-ti={i}
              data-testid="lp-token"
              onClick={onTokenClick}
              title={probsTitle(t)}
              className={`inline-flex cursor-pointer items-start whitespace-pre rounded border px-1 text-left font-mono text-xs hover:ring-1 hover:ring-slate-400 ${
                CONFIDENCE_CHIP_CLASSES[confidenceOf(t.logprob)]
              }`}
            >
              {body}
              {t.id !== undefined && (
                <span className="-mt-1 text-[8px] text-slate-500">{t.id}</span>
              )}
            </button>,
          )
        }
        if (newlines > 0) {
          out.push(
            <span
              key={`${offset}-nl`}
              className={`inline-flex rounded border px-1 font-mono text-xs ${CONFIDENCE_CHIP_CLASSES.na}`}
            >
              {'↵'.repeat(newlines)}
            </span>,
          )
        }
      }
      offset += t.token.length
    })
    return {
      spans: out,
      overflowText: tokens
        .slice(TOKEN_RENDER_CAP)
        .map((t) => t.token)
        .join(''),
      overflowCount: tokens.length - shown.length,
    }
  }, [tokens, mode, onTokenClick])

  const active = popover === null ? undefined : tokens[popover.index]
  const totalChars = useMemo(() => tokens.reduce((n, t) => n + t.token.length, 0), [tokens])

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      {mode === 'probs' && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="tabular-nums">
            {tokens.length} tokens · {totalChars} chars
          </span>
          <span className="flex items-center gap-1">
            {(['high', 'med', 'low', 'na'] as const).map((c) => (
              <span
                key={c}
                className={`rounded border px-1 text-[10px] ${CONFIDENCE_CHIP_CLASSES[c]}`}
              >
                {CONFIDENCE_LABELS[c]}
              </span>
            ))}
          </span>
        </div>
      )}
      <div
        className={
          mode === 'probs'
            ? 'flex flex-wrap gap-[3px] font-mono text-xs leading-5 text-slate-800'
            : 'whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-800'
        }
        data-testid="token-logprob-text"
      >
        {spans}
        {overflowCount > 0 && (
          <>
            <span className="whitespace-pre-wrap break-words">{overflowText}</span>
            <span className="ml-1 text-[10px] text-slate-400">+{overflowCount} more tokens</span>
          </>
        )}
      </div>
      {popover !== null && active !== undefined && (
        <div
          data-testid="token-popover"
          className={`absolute z-20 space-y-0.5 rounded-md border border-slate-200 bg-white p-2 text-[11px] shadow-lg ${
            popover.flip ? '-translate-y-full' : ''
          }`}
          style={{ top: popover.top, left: popover.left, width: POPOVER_WIDTH }}
        >
          <PopoverRow label="token" value={`"${visualizeWhitespace(active.token)}"`} mono />
          <PopoverRow label="id" value={active.id === undefined ? '—' : String(active.id)} />
          <PopoverRow label="logprob" value={active.logprob.toFixed(4)} />
          <PopoverRow label="p" value={`${(Math.exp(active.logprob) * 100).toFixed(2)}%`} />
          <PopoverRow label="confidence" value={CONFIDENCE_LABELS[confidenceOf(active.logprob)]} />
          {active.topk !== undefined && active.topk.length > 0 && (
            <div data-testid="topk-list" className="mt-1.5 border-t border-slate-100 pt-1">
              <div className="mb-0.5 text-slate-400">Inference top-k</div>
              {active.topk.map((alt) => {
                const chosen = alt.token === active.token && alt.logprob === active.logprob
                return (
                  <div
                    key={`${alt.token}:${alt.logprob}`}
                    className={`flex items-baseline justify-between gap-3 rounded px-1 ${
                      chosen ? 'bg-emerald-50 font-medium text-emerald-900' : 'text-slate-700'
                    }`}
                  >
                    <span className="break-all font-mono">{visualizeWhitespace(alt.token)}</span>
                    <span className="tabular-nums">
                      {(Math.exp(alt.logprob) * 100).toFixed(1)}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
