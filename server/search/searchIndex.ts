import MiniSearch from 'minisearch'
import type { SearchHit } from '../../shared/schema/api'
import type { Message } from '../../shared/schema/types'
import type { TraceStore } from '../store/traceStore'

/** Per-trace text cap: bounds the index; the >1MB stress trace only contributes its head. */
const TEXT_CAP = 20000

const SNIPPET_RADIUS = 80

interface SearchDoc {
  id: string
  traceId: string
  instanceId: string
  component: string
  text: string
}

function joinContent(messages: Message[]): string {
  let text = ''
  for (const m of messages) {
    if (m.content === '') continue
    text += (text === '' ? '' : '\n') + m.content
    if (text.length >= TEXT_CAP) return text.slice(0, TEXT_CAP)
  }
  return text
}

/** ±80 chars around the first case-insensitive occurrence of q in any message content. */
function buildSnippet(messages: Message[], q: string): string | null {
  const needle = q.toLowerCase()
  for (const m of messages) {
    const idx = m.content.toLowerCase().indexOf(needle)
    if (idx === -1) continue
    const start = Math.max(0, idx - SNIPPET_RADIUS)
    const end = Math.min(m.content.length, idx + needle.length + SNIPPET_RADIUS)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < m.content.length ? '…' : ''
    return `${prefix}${m.content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
  }
  return null
}

/** Full-text index over the store, rebuilt lazily whenever store.dataVersion moves. */
export class SearchIndex {
  private mini: MiniSearch<SearchDoc> | null = null
  private builtVersion = -1

  constructor(private store: TraceStore) {}

  private ensureBuilt(): MiniSearch<SearchDoc> {
    if (this.mini && this.builtVersion === this.store.dataVersion) return this.mini
    const mini = new MiniSearch<SearchDoc>({
      fields: ['traceId', 'instanceId', 'component', 'text'],
    })
    const docs: SearchDoc[] = []
    for (const summary of this.store.list()) {
      const trace = this.store.getFull(summary.meta.traceId)
      if (!trace) continue
      docs.push({
        id: trace.meta.traceId,
        traceId: trace.meta.traceId,
        instanceId: trace.meta.instanceId,
        component: trace.meta.component,
        text: joinContent(trace.messages),
      })
    }
    mini.addAll(docs)
    this.mini = mini
    this.builtVersion = this.store.dataVersion
    return mini
  }

  /** All matching trace ids — used for the list endpoints' `q=` membership check. */
  matchingIds(q: string): Set<string> {
    const ids = new Set<string>()
    for (const hit of this.ensureBuilt().search(q, { prefix: true })) ids.add(String(hit.id))
    return ids
  }

  search(q: string, limit = 20): SearchHit[] {
    return this.ensureBuilt()
      .search(q, { prefix: true })
      .slice(0, limit)
      .map((hit) => {
        const traceId = String(hit.id)
        const trace = this.store.getFull(traceId)
        const component = trace?.meta.component ?? ''
        return {
          traceId,
          component,
          score: trace?.stats.score ?? null,
          snippet: (trace && buildSnippet(trace.messages, q)) || component,
        }
      })
  }
}
