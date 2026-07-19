/**
 * Corpus-level aggregation over TraceSummary[] — the list payload, never full
 * traces. Null-score conventions follow shared/schema/types.ts: ungraded
 * traces are skipped by score averages but still counted everywhere else.
 */

import type {
  ComponentAggregate,
  RewardCurvePoint,
  RewardCurves,
  Split,
  StatTiles,
  TraceSummary,
} from '../schema/types'

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function meanOf(items: TraceSummary[], pick: (t: TraceSummary) => number): number {
  return mean(items.map(pick)) ?? 0
}

function definedScores(items: TraceSummary[]): number[] {
  return items.map((t) => t.stats.score).filter((s): s is number => s !== null)
}

function meanDurationMs(items: TraceSummary[]): number | null {
  return mean(items.map((t) => t.stats.durationMs).filter((d): d is number => d !== undefined))
}

function countStatus(items: TraceSummary[], status: TraceSummary['meta']['status']): number {
  return items.filter((t) => t.meta.status === status).length
}

export function statTiles(items: TraceSummary[]): StatTiles {
  return {
    total: items.length,
    completed: countStatus(items, 'completed'),
    failed: countStatus(items, 'failed'),
    executing: countStatus(items, 'executing'),
    avgScore: mean(definedScores(items)),
    avgTurns: meanOf(items, (t) => t.stats.turns),
    avgDurationMs: meanDurationMs(items),
  }
}

/**
 * One point per checkpointStep that has at least one scored trace; count spans
 * ALL traces at the step, avgScore only the scored ones. Sorted by step.
 */
function stepPoints(items: TraceSummary[]): RewardCurvePoint[] {
  const byStep = new Map<number, TraceSummary[]>()
  for (const t of items) {
    const at = byStep.get(t.meta.checkpointStep)
    if (at) at.push(t)
    else byStep.set(t.meta.checkpointStep, [t])
  }
  const points: RewardCurvePoint[] = []
  for (const [step, at] of byStep) {
    const avgScore = mean(definedScores(at))
    if (avgScore !== null) points.push({ step, avgScore, count: at.length })
  }
  return points.sort((a, b) => a.step - b.step)
}

const SPLIT_ORDER: Record<Split, number> = { train: 0, test: 1 }

export function componentAggregates(items: TraceSummary[]): ComponentAggregate[] {
  const groups = new Map<string, { component: string; split: Split; items: TraceSummary[] }>()
  for (const t of items) {
    const key = `${t.meta.component}\u0000${t.meta.split}`
    let group = groups.get(key)
    if (!group) {
      group = { component: t.meta.component, split: t.meta.split, items: [] }
      groups.set(key, group)
    }
    group.items.push(t)
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.component !== b.component) return a.component < b.component ? -1 : 1
      return SPLIT_ORDER[a.split] - SPLIT_ORDER[b.split]
    })
    .map(({ component, split, items: group }) => {
      const scored = definedScores(group)
      return {
        component,
        split,
        count: group.length,
        completed: countStatus(group, 'completed'),
        failed: countStatus(group, 'failed'),
        executing: countStatus(group, 'executing'),
        avgScore: mean(scored),
        successRate: scored.length > 0 ? scored.filter((s) => s > 0).length / scored.length : null,
        truncatedRate: group.filter((t) => t.stats.truncated).length / group.length,
        avgTurns: meanOf(group, (t) => t.stats.turns),
        avgToolUses: meanOf(group, (t) => t.stats.toolUses),
        avgDurationMs: meanDurationMs(group),
        avgOutputTokens: meanOf(group, (t) => t.stats.outputTokens),
        avgThinkingTokens: meanOf(group, (t) => t.stats.thinkingTokens),
        totalTokens: group.reduce((acc, t) => acc + t.stats.totalTokens, 0),
        scoreByStep: stepPoints(group),
      }
    })
}

export function rewardCurves(items: TraceSummary[], components?: string[]): RewardCurves {
  const pool = components ? items.filter((t) => components.includes(t.meta.component)) : items
  return {
    train: stepPoints(pool.filter((t) => t.meta.split === 'train')),
    test: stepPoints(pool.filter((t) => t.meta.split === 'test')),
  }
}
