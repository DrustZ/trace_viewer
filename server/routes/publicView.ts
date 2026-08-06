import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EvolutionSeries, Trace, TraceMeta, TraceSummary } from '../../shared/schema/types'
import { displayDataRootPath } from '../config/dataRoots'

/**
 * Filesystem paths are private server implementation details. Keep URLs and already-relative
 * logical locations intact, but redact absolute POSIX/Windows locations before serialization.
 */
export function publicDataLocation(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (/^file:/i.test(value)) {
    try {
      return publicDataLocation(fileURLToPath(value))
    } catch {
      try {
        return path.posix.basename(new URL(value).pathname) || 'trace source'
      } catch {
        return 'trace source'
      }
    }
  }
  if (path.isAbsolute(value)) return displayDataRootPath(value)
  // Also protect traces produced on another OS (for example a Windows trace viewed on macOS).
  if (path.win32.isAbsolute(value)) return path.win32.basename(value) || 'trace source'
  return value
}

export function publicMeta(meta: TraceMeta): TraceMeta {
  const dataLocation = publicDataLocation(meta.dataLocation)
  return dataLocation === meta.dataLocation ? meta : { ...meta, dataLocation }
}

export function publicTraceSummary(summary: TraceSummary): TraceSummary {
  const meta = publicMeta(summary.meta)
  return meta === summary.meta ? summary : { ...summary, meta }
}

export function publicTrace(trace: Trace): Trace {
  const meta = publicMeta(trace.meta)
  return meta === trace.meta ? trace : { ...trace, meta }
}

export function publicEvolution(series: EvolutionSeries): EvolutionSeries {
  return {
    ...series,
    points: series.points.map((point) => ({
      ...point,
      rollouts: point.rollouts.map(publicTraceSummary),
    })),
  }
}
