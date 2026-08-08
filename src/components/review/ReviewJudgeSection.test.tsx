import type { AutomaticRubricVerdict } from '@shared/reviews/types'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { judgeReviewMode, ReviewJudgeOffNote, ReviewJudgeSection } from './ReviewJudgeSection'

// Mirror of judge_episode's sidecar shape (rubric v2): the three soft
// dimensions plus the outcome second opinion, each {verdict, evidence}.
const JUDGE_FIXTURE: Record<string, AutomaticRubricVerdict> = {
  resolution: { verdict: 'pass', critique: 'resolution evidence' },
  escalation: { verdict: 'fail', critique: 'escalated without a lookup' },
  communication: { verdict: 'unknown' },
  outcome: { verdict: 'pass', critique: 'outcome evidence' },
}

describe('ReviewJudgeSection', () => {
  it('renders every judge dimension with verdict, evidence, and the three decisions', () => {
    const html = renderToStaticMarkup(
      <ReviewJudgeSection
        judgeVerdicts={JUDGE_FIXTURE}
        reviews={{}}
        locked={false}
        onDecide={() => undefined}
        onNote={() => undefined}
      />,
    )
    expect(html).toContain('data-testid="review-judge-section"')
    for (const dimension of ['resolution', 'escalation', 'communication', 'outcome']) {
      expect(html).toContain(`data-testid="review-judge-${dimension}"`)
      for (const decision of ['agree', 'disagree', 'unsure']) {
        expect(html).toContain(`data-testid="review-judge-${dimension}-${decision}"`)
      }
    }
    expect(html).toContain('judge: pass')
    expect(html).toContain('judge: fail')
    expect(html).toContain('judge: unknown')
    expect(html).toContain('escalated without a lookup')
    // Missing evidence is stated, not blank.
    expect(html).toContain('The judge recorded no evidence for this dimension.')
  })

  it('prompts for the failure mode when the human disagrees', () => {
    const html = renderToStaticMarkup(
      <ReviewJudgeSection
        judgeVerdicts={JUDGE_FIXTURE}
        reviews={{
          escalation: { decision: 'disagree', note: '' },
          resolution: { decision: 'agree', note: '' },
        }}
        locked={false}
        onDecide={() => undefined}
        onNote={() => undefined}
      />,
    )
    expect(html).toContain(
      'Where did the judge go wrong: cited nonexistent evidence? Misread policy? Missed a message?',
    )
    // The agree row keeps the neutral placeholder.
    expect(html).toContain('Optional note')
  })

  it('disables all controls when the review is locked', () => {
    const html = renderToStaticMarkup(
      <ReviewJudgeSection
        judgeVerdicts={{ resolution: { verdict: 'pass' } }}
        reviews={{}}
        locked
        onDecide={vi.fn()}
        onNote={vi.fn()}
      />,
    )
    const disabledButtons = html.match(/<button[^>]*disabled[^>]*>/g) ?? []
    expect(disabledButtons).toHaveLength(3)
    expect(html).toMatch(/<input[^>]*disabled/)
  })
})

describe('judgeReviewMode', () => {
  it('leads with the judge section when the trace carries judge output', () => {
    expect(judgeReviewMode({ judgeVerdicts: JUDGE_FIXTURE })).toBe('review')
  })

  it('shows the explicit off note when automatic context has no judge verdicts', () => {
    expect(judgeReviewMode({})).toBe('off-note')
    expect(judgeReviewMode({ judgeVerdicts: {} })).toBe('off-note')
  })

  it('stays hidden while automatic context is withheld (blind calibration)', () => {
    expect(judgeReviewMode(undefined)).toBe('hidden')
  })
})

describe('ReviewJudgeOffNote', () => {
  it('explains how to enable the judge and why it matters', () => {
    const html = renderToStaticMarkup(<ReviewJudgeOffNote />)
    expect(html).toContain('data-testid="review-judge-off-note"')
    expect(html).toContain('LLM judge was off for this run')
    expect(html).toContain('--judge all')
    expect(html).toContain('primary object of human review')
  })
})
