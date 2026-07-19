import type { TokenLogprob } from '@shared/schema/types'
import { BUCKET_CLASSES, BUCKET_LABELS, type LogprobBucket, logprobToBucket } from './logprobColor'

interface Segment {
  bucket: LogprobBucket
  text: string
  /** Character offset of the segment start — stable render key. */
  offset: number
  /** Least-confident token in the segment, shown in the tooltip. */
  minToken: TokenLogprob | null
}

/**
 * Merge consecutive same-bucket tokens so long messages stay at few spans, not
 * one per token. When `text` is given, tokens are zipped back onto it (the
 * generator's tokenizer drops whitespace), so gaps between tokens — and any
 * untokenized tail — are preserved. Gaps attach to the preceding segment.
 */
export function segmentTokens(tokens: TokenLogprob[], text?: string): Segment[] {
  const segments: Segment[] = []
  let offset = 0
  let cursor = 0
  for (const t of tokens) {
    if (text !== undefined) {
      const start = text.indexOf(t.token, cursor)
      if (start > cursor) {
        const gap = text.slice(cursor, start)
        const last = segments[segments.length - 1]
        if (last) last.text += gap
        else segments.push({ bucket: 0, text: gap, offset, minToken: null })
        offset += gap.length
      }
      if (start >= 0) cursor = start + t.token.length
    }
    const bucket = logprobToBucket(t.logprob)
    const last = segments[segments.length - 1]
    if (last && last.bucket === bucket) {
      last.text += t.token
      if (last.minToken === null || t.logprob < last.minToken.logprob) last.minToken = t
    } else {
      segments.push({ bucket, text: t.token, offset, minToken: t })
    }
    offset += t.token.length
  }
  if (text !== undefined && cursor < text.length) {
    segments.push({ bucket: 0, text: text.slice(cursor), offset, minToken: null })
  }
  return segments
}

function segmentTitle(seg: Segment): string | undefined {
  if (seg.minToken === null) return undefined
  const p = Math.exp(seg.minToken.logprob) * 100
  return `${JSON.stringify(seg.minToken.token)} · ${seg.minToken.logprob.toFixed(3)} · ${p.toFixed(1)}%`
}

export function TokenLogprobText({
  tokens,
  text,
  className,
}: {
  tokens: TokenLogprob[]
  /** Original message text the tokens were sampled from; restores whitespace. */
  text?: string
  className?: string
}) {
  const segments = segmentTokens(tokens, text)
  return (
    <div className={className}>
      <div
        className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-800"
        data-testid="token-logprob-text"
      >
        {segments.map((seg) => (
          <span key={seg.offset} className={BUCKET_CLASSES[seg.bucket]} title={segmentTitle(seg)}>
            {seg.text}
          </span>
        ))}
      </div>
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
    </div>
  )
}
