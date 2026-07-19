// KaTeX CSS must match the katex version that GENERATES the markup. rehype-katex pins
// katex ^0.16 (nested under its own node_modules because the root has 0.18), and 0.18
// renamed ~21 layout classes (.stretchy → .katex-stretchy, …) — importing the root 0.18
// stylesheet against 0.16 markup collapses \boxed{} borders, accents and struts.
import '../../../node_modules/rehype-katex/node_modules/katex/dist/katex.min.css'
// highlight.js token colours for fenced code blocks (github light — dark tokens on a
// light surface, matching the app's slate theme; pre backgrounds are set below).
import 'highlight.js/styles/github.css'
import { Component, type ReactNode, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

/** Above this size markdown parsing cost outweighs the benefit — render plain text instead. */
export const MARKDOWN_CHAR_LIMIT = 50_000

export type ContentViewMode = 'rich' | 'raw'

// Per-block Rich/Raw choices keyed by a stable content id (message id or synthetic key).
// Module-level so the choice survives virtualization recycling — cards remount on scroll,
// so component-local state alone would reset. Persists for the browser session only.
const viewModes = new Map<string, ContentViewMode>()

export function getViewMode(id: string, fallback: ContentViewMode = 'rich'): ContentViewMode {
  return viewModes.get(id) ?? fallback
}

export function setViewMode(id: string, mode: ContentViewMode): void {
  viewModes.set(id, mode)
}

/** Test hook: reset the session store. */
export function clearViewModes(): void {
  viewModes.clear()
}

/**
 * Rich/Raw state for one content block, backed by the module-level session store.
 * Callers must remount (key) the owning component per content id.
 */
export function useViewMode(id: string, fallback: ContentViewMode = 'rich') {
  const [mode, setMode] = useState<ContentViewMode>(() => getViewMode(id, fallback))
  const set = (next: ContentViewMode) => {
    setViewMode(id, next)
    setMode(next)
  }
  return [mode, set] as const
}

/**
 * Bare TeX like "\frac{3}{4}" (a ground truth stored without $ delimiters) → "$...$" so
 * remark-math picks it up. Delimited or plain-prose strings pass through unchanged.
 */
export function wrapBareLatex(text: string): string {
  const t = text.trim()
  if (t.length > 0 && /^\\[a-zA-Z]+/.test(t) && !t.includes('$') && !t.includes('\n')) {
    return `$${t}$`
  }
  return text
}

/** sisyphus-style segmented pill switching one content block between Rich and Raw. */
export function RichRawToggle({
  mode,
  onChange,
}: {
  mode: ContentViewMode
  onChange: (mode: ContentViewMode) => void
}) {
  const segment = (value: ContentViewMode, label: string) => (
    <button
      type="button"
      data-testid={`view-${value}`}
      aria-pressed={mode === value}
      onClick={() => onChange(value)}
      className={`px-1.5 py-px text-[10px] font-medium transition-colors ${
        mode === value
          ? 'bg-slate-200 text-slate-700'
          : 'bg-white text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full border border-slate-200">
      {segment('rich', 'Rich')}
      {segment('raw', 'Raw')}
    </span>
  )
}

// Hand-styled markdown (no typography plugin): descendant selectors on the wrapping div.
const MD_STYLE = [
  'text-sm break-words',
  '[&_p]:my-1.5',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-50 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-slate-800',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm',
  '[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1',
  '[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold',
  '[&_table]:my-2 [&_table]:border-collapse',
  '[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1',
  '[&_a]:text-blue-600 [&_a]:underline',
  '[&_blockquote]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600',
  '[&_hr]:my-3 [&_hr]:border-slate-200',
  '[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
].join(' ')

/**
 * A malformed document must never crash the card — fall back to the plain string.
 * Resets automatically when the text prop changes (recycled rows render new content).
 */
class MarkdownBoundary extends Component<
  { text: string; children: ReactNode },
  { failed: boolean; forText: string }
> {
  state = { failed: false, forText: this.props.text }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(
    props: { text: string },
    state: { failed: boolean; forText: string },
  ) {
    if (props.text !== state.forText) return { failed: false, forText: props.text }
    return null
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="whitespace-pre-wrap break-words text-sm" data-testid="markdown-fallback">
          {this.props.text}
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Rich text block: GFM + math (KaTeX — \boxed{} et al. render natively), hand-styled
 * for the slate light theme. Oversized documents skip parsing; parse crashes fall
 * back to plain text via the error boundary.
 */
export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  if (text.length > MARKDOWN_CHAR_LIMIT) {
    return (
      <div className={className} data-testid="markdown-content">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">{text}</pre>
        <p className="mt-1 text-xs text-slate-400 italic">
          (shown as plain text — {text.length.toLocaleString()} chars exceeds the markdown render
          limit)
        </p>
      </div>
    )
  }
  return (
    <div className={`${MD_STYLE} ${className ?? ''}`} data-testid="markdown-content">
      <MarkdownBoundary text={text}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true, detect: false }]]}
        >
          {text}
        </ReactMarkdown>
      </MarkdownBoundary>
    </div>
  )
}
