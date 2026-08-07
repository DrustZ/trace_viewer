import { decodeFilterSet } from '@shared/filter/parse'
import type { AceTaskScoringContract, AceTaskVariant } from '@shared/schema/aceTasks'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ScoringAuthority,
  taskAutorunHref,
  taskCompareHref,
  taskExperimentHref,
  taskLabHref,
  taskRunHref,
  taskTraceHref,
  Variant,
} from './AceTasksPage'

const variant = (overrides: Partial<AceTaskVariant> = {}): AceTaskVariant => ({
  definitionDigest: 'definition-a',
  sources: [{ pack: 'sealed', file: 'configs/scenarios/sealed.json' }],
  suite: 'sealed',
  journeyId: null,
  journeyStep: 0,
  split: null,
  persona: {
    issue: 'refund_payment',
    language: 'en',
    idKnowledge: 'exact',
    patience: 4,
    persistence: 'normal',
    style: [],
    orderId: 'order_1',
    goal: 'Get a refund.',
    adversarial: false,
  },
  taskBrief: 'Get a refund.',
  expectedActions: [],
  forbiddenActions: [],
  expectedOutcome: 'refund',
  rewardBasis: ['ACTIONS', 'REQUIRED_INFO'],
  authorizedEffects: [],
  requiredInfo: [],
  expectedStateDelta: [],
  mustPrecede: [],
  consentRequired: true,
  promiseCheck: false,
  userScript: [],
  ...overrides,
})

describe('ACE task explorer links', () => {
  it('deep-links to the trace list with an exact instance filter', () => {
    const href = taskTraceHref('s-refund-00')
    const search = new URL(href, 'http://localhost').searchParams
    expect(decodeFilterSet(search.get('filters'))).toEqual({
      conditions: [{ key: 'instanceId', op: 'eq', value: 's-refund-00' }],
    })
  })

  it('deep-links to one task inside one exact run', () => {
    const href = taskRunHref('s-refund-00', 'sealed baseline/chat')
    const search = new URL(href, 'http://localhost').searchParams
    expect(decodeFilterSet(search.get('filters'))).toEqual({
      conditions: [
        { key: 'instanceId', op: 'eq', value: 's-refund-00' },
        { key: 'run', op: 'eq', value: 'sealed baseline/chat' },
      ],
    })
  })

  it('only creates a matched compare link when the API provides two runs', () => {
    expect(taskCompareHref('s-refund-00', null)).toBeNull()
    const href = taskCompareHref('s-refund-00', ['baseline-chat', 'optimized-chat'])
    const search = new URL(href as string, 'http://localhost').searchParams
    expect(Object.fromEntries(search)).toEqual({
      instance: 's-refund-00',
      runA: 'baseline-chat',
      runB: 'optimized-chat',
    })
  })

  it('prefills a matched experiment from the selected task and source pack', () => {
    const href = taskExperimentHref('s-refund-00', 'configs/scenarios/sealed.json')
    const url = new URL(href as string, 'http://localhost')
    expect(url.pathname).toBe('/ace/experiments')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scenarioFile: 'sealed.json',
      scenarioId: 's-refund-00',
    })
    expect(taskExperimentHref('s-refund-00', 'configs/scenarios/not-json')).toBeNull()
  })

  it('prefills the interactive lab from the selected task and source pack', () => {
    const href = taskLabHref('s-refund-00', 'configs/scenarios/sealed.json')
    const url = new URL(href as string, 'http://localhost')
    expect(url.pathname).toBe('/ace/lab')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scenarioFile: 'sealed.json',
      scenarioId: 's-refund-00',
    })
    expect(taskLabHref('s-refund-00', 'configs/scenarios/../sealed.json')).toBeNull()
  })

  it('builds the one-click Run in Playground link: prefilled lab plus autorun=1', () => {
    const href = taskAutorunHref('s-refund-00', 'configs/scenarios/sealed.json')
    const url = new URL(href as string, 'http://localhost')
    expect(url.pathname).toBe('/ace/lab')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scenarioFile: 'sealed.json',
      scenarioId: 's-refund-00',
      autorun: '1',
    })
    // Same containment rules as the configure-only link.
    expect(taskAutorunHref('s-refund-00', 'configs/scenarios/../sealed.json')).toBeNull()
  })

  it('never renders stale check roles as verified after a source mismatch', () => {
    const html = renderToStaticMarkup(
      createElement(Variant, {
        index: 0,
        variant: variant({
          pythonAuthority: {
            status: 'mismatch',
            method: 'fixed_python_runtime_probe',
            reason: 'source_digest_mismatch',
          },
          effectiveChecks: [
            {
              name: 'STALE_REQUIRED_INFO',
              sourceSymbol: 'stale',
              purpose: 'stale',
              gatingRule: 'stale',
              effectiveGating: false,
              basis: 'stale',
            },
          ],
        }),
      }),
    )

    expect(html).toContain('Source changed during verification')
    expect(html).toContain('source_digest_mismatch')
    expect(html).not.toContain('STALE_REQUIRED_INFO')
    expect(html).not.toContain('ACE Python runtime verified')
  })

  it('labels only runtime-probed REQUIRED_INFO semantics as verified', () => {
    const html = renderToStaticMarkup(
      createElement(Variant, {
        index: 0,
        variant: variant({
          split: 'holdout',
          pythonAuthority: { status: 'verified', method: 'fixed_python_runtime_probe' },
          effectiveChecks: [
            {
              name: 'REQUIRED_INFO',
              sourceSymbol: 'src/ace/evaluation/grading/atomic.py::_check_required_info',
              purpose: 'Current source documentation.',
              gatingRule: 'Resolved by current Python runtime.',
              effectiveGating: true,
              basis: 'Runtime probe returned gating=true.',
            },
          ],
        }),
      }),
    )

    expect(html).toContain('ACE Python runtime verified')
    expect(html).toContain('REQUIRED_INFO')
    expect(html).toContain('GATING')
    expect(html).toContain('holdout')
  })

  it('does not describe a readable-but-unprobed source as verified', () => {
    const authority = {
      status: 'unavailable' as const,
      method: 'fixed_python_runtime_probe' as const,
      reason: 'python_probe_failed' as const,
    }
    const scoring: AceTaskScoringContract = {
      primaryGrader: {
        file: 'src/ace/evaluation/grading/atomic.py',
        digest: 'a'.repeat(64),
        available: false,
        authority,
        symbol: 'src/ace/evaluation/grading/atomic.py::grade_atomic',
        gating: true,
      },
      splitResolver: {
        file: 'src/ace/simulation/environment/database.py',
        digest: 'b'.repeat(64),
        available: false,
        authority,
        symbol: 'src/ace/simulation/environment/database.py::Database.split_of',
        sourceContract: null,
      },
      verdictFormula: 'STALE FORMULA',
      primaryBoundary: 'episode',
      botBoundaryAvailable: true,
      invalidUserSimPolicy: 'STALE POLICY',
      sourceContract: null,
      shadowRubrics: [],
    }
    const html = renderToStaticMarkup(createElement(ScoringAuthority, { scoring }))

    expect(html).toContain('Python scoring semantics unavailable')
    expect(html).toContain('not inferred from copied TypeScript rules')
    expect(html).not.toContain('STALE FORMULA')
    expect(html).not.toContain('Current grader source verified')
  })
})
