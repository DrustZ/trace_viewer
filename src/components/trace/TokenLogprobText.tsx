import type { TokenLogprob } from '@shared/schema/types'
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BUCKET_CLASSES, BUCKET_LABELS, logprobToBucket, TOKEN_CYCLE_CLASSES } from './logprobColor'

/** Past this many tokens the remainder renders as plain text (a span per token gets slow). */
export const TOKEN_RENDER_CAP = 1500

/** Make whitespace visible in the popover's quoted token: space → ·, newline → ⏎, tab → →. */
export function visualizeWhitespace(s: string): string {
  return s.replace(/ /g, '·').replace(/\n/g, '⏎').replace(/\t/g, '→')
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
}

const POPOVER_WIDTH = 232

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
    setPopover((prev) =>
      prev?.index === index
        ? null
        : {
            index,
            top: rect.bottom - wrapRect.top + 4,
            left: Math.max(0, Math.min(rect.left - wrapRect.left, wrapRect.width - POPOVER_WIDTH)),
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
        out.push(
          <button
            key={offset}
            type="button"
            data-ti={i}
            data-testid="lp-token"
            onClick={onTokenClick}
            title={probsTitle(t)}
            className={`cursor-pointer whitespace-pre-wrap rounded-[2px] text-left align-baseline hover:ring-1 hover:ring-slate-300 ${
              BUCKET_CLASSES[logprobToBucket(t.logprob)]
            }`}
          >
            {t.token}
            {t.id !== undefined && (
              <sup className="align-super text-[8px] text-slate-500">{t.id}</sup>
            )}
          </button>,
        )
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

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <div
        className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-800"
        data-testid="token-logprob-text"
      >
        {spans}
        {overflowCount > 0 && (
          <>
            <span>{overflowText}</span>
            <span className="ml-1 text-[10px] text-slate-400">+{overflowCount} more tokens</span>
          </>
        )}
      </div>
      {mode === 'probs' && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
          {BUCKET_CLASSES.map((cls, i) => (
            <span
              key={BUCKET_LABELS[i]}
              className={`h-2.5 w-2.5 rounded-sm border border-slate-200 ${cls}`}
              title={BUCKET_LABELS[i]}
            />
          ))}
          <span className="ml-1">high → low confidence</span>
        </div>
      )}
      {popover !== null && active !== undefined && (
        <div
          data-testid="token-popover"
          className="absolute z-20 space-y-0.5 rounded-md border border-slate-200 bg-white p-2 text-[11px] shadow-lg"
          style={{ top: popover.top, left: popover.left, width: POPOVER_WIDTH }}
        >
          <PopoverRow label="token" value={`"${visualizeWhitespace(active.token)}"`} mono />
          <PopoverRow label="id" value={active.id === undefined ? '—' : String(active.id)} />
          <PopoverRow label="logprob" value={active.logprob.toFixed(4)} />
          <PopoverRow label="p" value={`${(Math.exp(active.logprob) * 100).toFixed(2)}%`} />
          <PopoverRow label="bucket" value={BUCKET_LABELS[logprobToBucket(active.logprob)]} />
        </div>
      )}
    </div>
  )
}
