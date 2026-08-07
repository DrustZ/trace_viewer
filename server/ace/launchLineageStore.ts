import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AceRunLineage } from '../../shared/schema/ace'

export interface AceLaunchLineageRecord {
  schemaVersion: 1
  runId: string
  createdAt: string
  lineage: AceRunLineage
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseLine(line: string): AceLaunchLineageRecord | null {
  try {
    const value = record(JSON.parse(line))
    const lineage = record(value.lineage)
    if (
      value.schemaVersion !== 1 ||
      typeof value.runId !== 'string' ||
      typeof value.createdAt !== 'string' ||
      lineage.relation !== 'fresh_task_rerun' ||
      typeof lineage.parentTraceUid !== 'string'
    ) {
      return null
    }
    return value as unknown as AceLaunchLineageRecord
  } catch {
    return null
  }
}

/** Append-only Viewer-owned ancestry registry; never writes into ACE source/config. */
export class AceLaunchLineageStore {
  private readonly records = new Map<string, AceLaunchLineageRecord>()
  private loadPromise: Promise<void> | undefined
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private load(): Promise<void> {
    this.loadPromise ??= (async () => {
      let text = ''
      try {
        text = await fs.readFile(this.filePath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        const parsed = parseLine(line)
        if (parsed) this.records.set(parsed.runId, parsed)
      }
    })()
    return this.loadPromise
  }

  async get(runId: string): Promise<AceRunLineage | undefined> {
    await this.load()
    return this.records.get(runId)?.lineage
  }

  async all(): Promise<Map<string, AceRunLineage>> {
    await this.load()
    return new Map([...this.records].map(([runId, value]) => [runId, value.lineage]))
  }

  /** Read-only preflight used before spawning a run; it never reserves the id. */
  async assertCompatible(runId: string, lineage: AceRunLineage): Promise<void> {
    await this.load()
    const existing = this.records.get(runId)
    if (existing && JSON.stringify(existing.lineage) !== JSON.stringify(lineage)) {
      throw new Error(`run ${runId} already has different immutable ancestry`)
    }
  }

  async append(runId: string, lineage: AceRunLineage): Promise<AceLaunchLineageRecord> {
    await this.load()
    const existing = this.records.get(runId)
    if (existing) {
      if (JSON.stringify(existing.lineage) !== JSON.stringify(lineage)) {
        throw new Error(`run ${runId} already has different immutable ancestry`)
      }
      return existing
    }
    const next: AceLaunchLineageRecord = {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
      lineage,
    }
    this.records.set(runId, next)
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, `${JSON.stringify(next)}\n`, 'utf8')
    })
    try {
      await this.writeQueue
    } catch (error) {
      this.records.delete(runId)
      throw error
    }
    return next
  }
}
