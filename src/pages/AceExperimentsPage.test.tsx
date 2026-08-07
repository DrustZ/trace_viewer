import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  scenarios: vi.fn(),
  starts: [] as ReturnType<typeof vi.fn>[],
  startHook: vi.fn(),
}))

vi.mock('../api/ace', () => ({
  useAceCapabilities: mocks.capabilities,
  useAceScenarios: mocks.scenarios,
  useStartAceRun: mocks.startHook,
}))

import AceExperimentsPage from './AceExperimentsPage'

describe('ACE Experiment Matrix page', () => {
  beforeEach(() => {
    mocks.capabilities.mockReset()
    mocks.scenarios.mockReset()
    mocks.startHook.mockReset()
    mocks.starts = [vi.fn(), vi.fn()]
    let index = 0
    mocks.capabilities.mockReturnValue({ data: { available: true }, isLoading: false })
    mocks.scenarios.mockReturnValue({
      data: {
        items: [
          { file: 'atomic.json', count: 8, scenarioIds: ['a'] },
          { file: 'sealed.json', count: 23, scenarioIds: ['s-refund-00'] },
        ],
      },
    })
    mocks.startHook.mockImplementation(() => ({
      mutateAsync: mocks.starts[index++],
      isPending: false,
    }))
  })

  it('shows two independent policy columns and one shared matched harness', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/ace/experiments']}>
        <AceExperimentsPage />
      </MemoryRouter>,
    )

    for (const text of [
      'ACE Experiment Matrix',
      'Variant A',
      'Variant B',
      'Bot harness',
      'Assistant model',
      'Prompt source',
      'Prompt preset',
      'Temperature',
      'Transport',
      'Reasoning effort',
      'Shared harness, budget, and faults',
      'Per-run cost cap (USD)',
      'Launch matched A/B',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('Experiment matrices never enter scored aggregates.')
    expect(html).toContain('checkpoints enabled')
    expect(mocks.starts[0]).not.toHaveBeenCalled()
    expect(mocks.starts[1]).not.toHaveBeenCalled()
  })

  it('prefills one pack and task from task-explorer query parameters without starting runs', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter
        initialEntries={[
          '/ace/experiments?scenarioFile=sealed.json&scenarioId=s-refund-00&seeds=3%2C5&experimentId=sealed-refund',
        ]}
      >
        <AceExperimentsPage />
      </MemoryRouter>,
    )

    expect(html).toMatch(/<option value="sealed.json" selected="">/)
    expect(html).toContain('value="s-refund-00"')
    expect(html).toContain('value="3,5"')
    expect(html).toContain('value="sealed-refund"')
    expect(mocks.starts[0]).not.toHaveBeenCalled()
    expect(mocks.starts[1]).not.toHaveBeenCalled()
  })
})
