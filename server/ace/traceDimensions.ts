import type { AceTaskDetail } from '../../shared/schema/aceTasks'
import type { TraceSummary } from '../../shared/schema/types'

export interface AceTraceDimensions {
  issue?: string
  language?: string
}

function explicitString(summary: TraceSummary, key: 'issue' | 'language'): string | undefined {
  const value = summary.meta.extra?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Resolve the dimensions used by both ACE aggregate counts and trace-list
 * drilldowns. A recorded sidecar value always wins. Older sealed episodes may
 * fall back to the current scenario catalog, which is intentionally a
 * presentation dimension rather than trace-bound grading evidence.
 */
export function aceTraceDimensions(
  summary: TraceSummary,
  taskByScenarioId: ReadonlyMap<string, AceTaskDetail>,
): AceTraceDimensions {
  const task =
    summary.meta.corpusId === 'simulation'
      ? taskByScenarioId.get(summary.meta.instanceId)
      : undefined
  return {
    issue: explicitString(summary, 'issue') ?? task?.issue ?? undefined,
    language: explicitString(summary, 'language') ?? task?.language ?? undefined,
  }
}

/**
 * Request-local projection for the generic trace filter pipeline. It never
 * mutates TraceStore and labels catalog fallbacks so callers cannot confuse
 * them with trace-recorded metadata.
 */
export function projectAceTraceDimensions(
  summaries: readonly TraceSummary[],
  tasks: readonly AceTaskDetail[],
): TraceSummary[] {
  if (tasks.length === 0) return [...summaries]
  const taskByScenarioId = new Map(tasks.map((task) => [task.scenarioId, task]))
  return summaries.map((summary) => {
    if (summary.meta.corpusId !== 'simulation') return summary
    const explicitIssue = explicitString(summary, 'issue')
    const explicitLanguage = explicitString(summary, 'language')
    const dimensions = aceTraceDimensions(summary, taskByScenarioId)
    const fallbackIssue = explicitIssue === undefined ? dimensions.issue : undefined
    const fallbackLanguage = explicitLanguage === undefined ? dimensions.language : undefined
    if (fallbackIssue === undefined && fallbackLanguage === undefined) return summary
    return {
      ...summary,
      meta: {
        ...summary.meta,
        extra: {
          ...summary.meta.extra,
          ...(fallbackIssue !== undefined ? { issue: fallbackIssue } : {}),
          ...(fallbackLanguage !== undefined ? { language: fallbackLanguage } : {}),
          ace_dimension_provenance: {
            ...(fallbackIssue !== undefined ? { issue: 'current_task_catalog' } : {}),
            ...(fallbackLanguage !== undefined ? { language: 'current_task_catalog' } : {}),
          },
        },
      },
    }
  })
}
