import MiniSearch from 'minisearch'
import type { SearchHit } from '../../shared/schema/api'
import type { Message } from '../../shared/schema/types'
import type { TraceStore } from '../store/traceStore'

/** Per-MESSAGE text cap — bounds each doc without hiding a long trace's tail. */
const MESSAGE_TEXT_CAP = 10_000

const SNIPPET_RADIUS = 80

/** One document per message, so every part of even a >1MB trace is indexed. */
interface SearchDoc {
  /** `<traceId>#<msgIdx>` */
  id: string
  traceId: string
  msgIdx: number
  component: string
  text: string
}

/** Searchable text of one message: content + tool-call names/arguments/parse errors. */
function messageText(m: Message): string {
  let text = m.content
  for (const call of m.toolCalls ?? []) {
    text += `\n${call.name} ${call.arguments}`
    if (call.parseError !== undefined) text += `\n${call.parseError}`
  }
  return text.length > MESSAGE_TEXT_CAP ? text.slice(0, MESSAGE_TEXT_CAP) : text
}

/** ±80 chars around the first case-insensitive occurrence of q in the doc text. */
function buildSnippet(text: string, q: string): string | null {
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(text.length, idx + q.length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

/** Full-text index over the store, rebuilt lazily whenever store.dataVersion moves. */
export class SearchIndex {
  private mini: MiniSearch<SearchDoc> | null = null
  private builtVersion = -1

  constructor(private store: TraceStore) {}

  private ensureBuilt(): MiniSearch<SearchDoc> {
    if (this.mini && this.builtVersion === this.store.dataVersion) return this.mini
    const mini = new MiniSearch<SearchDoc>({
      fields: ['traceId', 'component', 'text'],
      storeFields: ['traceId', 'msgIdx'],
    })
    const docs: SearchDoc[] = []
    for (const summary of this.store.list()) {
      const trace = this.store.getFull(summary.meta.traceId)
      if (!trace) continue
      trace.messages.forEach((message, msgIdx) => {
        docs.push({
          id: `${trace.meta.traceId}#${msgIdx}`,
          traceId: trace.meta.traceId,
          msgIdx,
          component: trace.meta.component,
          text: messageText(message),
        })
      })
      // Message-less traces still get one empty doc, so id/component search finds them.
      if (trace.messages.length === 0) {
        docs.push({
          id: `${trace.meta.traceId}#0`,
          traceId: trace.meta.traceId,
          msgIdx: 0,
          component: trace.meta.component,
          text: '',
        })
      }
    }
    mini.addAll(docs)
    this.mini = mini
    this.builtVersion = this.store.dataVersion
    return mini
  }

  /** All matching trace ids (unique) — used for the list endpoints' `q=` membership check. */
  matchingIds(q: string): Set<string> {
    const ids = new Set<string>()
    for (const hit of this.ensureBuilt().search(q, { prefix: true })) ids.add(String(hit.traceId))
    return ids
  }

  /** Hits deduped by trace; results are score-desc, so the first doc per trace wins. */
  search(q: string, limit = 20): SearchHit[] {
    const hits: SearchHit[] = []
    const seen = new Set<string>()
    for (const hit of this.ensureBuilt().search(q, { prefix: true })) {
      const traceId = String(hit.traceId)
      if (seen.has(traceId)) continue
      seen.add(traceId)
      const trace = this.store.getFull(traceId)
      const component = trace?.meta.component ?? ''
      const message = trace?.messages[Number(hit.msgIdx)]
      hits.push({
        traceId,
        component,
        score: trace?.stats.score ?? null,
        snippet: (message && buildSnippet(messageText(message), q)) || component,
      })
      if (hits.length >= limit) break
    }
    return hits
  }
}
