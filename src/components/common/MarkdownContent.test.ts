import katex from 'katex'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearViewModes,
  getViewMode,
  MARKDOWN_CHAR_LIMIT,
  setViewMode,
  wrapBareLatex,
} from './MarkdownContent'

describe('view mode store', () => {
  beforeEach(() => clearViewModes())

  it('returns the fallback for unknown ids', () => {
    expect(getViewMode('m-1')).toBe('rich')
    expect(getViewMode('m-1', 'raw')).toBe('raw')
  })

  it('persists choices per id across reads (survives card remounts)', () => {
    setViewMode('m-1', 'raw')
    expect(getViewMode('m-1')).toBe('raw')
    expect(getViewMode('m-2')).toBe('rich')
    setViewMode('m-1', 'rich')
    expect(getViewMode('m-1', 'raw')).toBe('rich')
  })

  it('clears on reset', () => {
    setViewMode('m-1', 'raw')
    clearViewModes()
    expect(getViewMode('m-1')).toBe('rich')
  })
})

describe('wrapBareLatex', () => {
  it('wraps bare TeX commands in $ delimiters', () => {
    expect(wrapBareLatex('\\frac{3}{4}')).toBe('$\\frac{3}{4}$')
    expect(wrapBareLatex('  \\sqrt{2}  ')).toBe('$\\sqrt{2}$')
    expect(wrapBareLatex('\\boxed{42}')).toBe('$\\boxed{42}$')
  })

  it('leaves already-delimited math alone', () => {
    expect(wrapBareLatex('$\\frac{3}{4}$')).toBe('$\\frac{3}{4}$')
    expect(wrapBareLatex('the answer is $x$')).toBe('the answer is $x$')
  })

  it('leaves plain prose and multiline text alone', () => {
    expect(wrapBareLatex('B) Earth')).toBe('B) Earth')
    expect(wrapBareLatex('3367')).toBe('3367')
    expect(wrapBareLatex('')).toBe('')
    expect(wrapBareLatex('\\frac{1}\n{2}')).toBe('\\frac{1}\n{2}')
  })
})

describe('markdown guards', () => {
  it('exposes the 50k plain-text threshold', () => {
    expect(MARKDOWN_CHAR_LIMIT).toBe(50_000)
  })

  // The MarkdownContent contract relies on KaTeX rendering \boxed{} natively.
  it('katex renders \\boxed{} natively', () => {
    const html = katex.renderToString('\\boxed{\\frac{3}{4}}', { throwOnError: true })
    expect(html).toContain('fbox')
  })
})
