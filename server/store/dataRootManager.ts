import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FSWatcher } from 'chokidar'
import type { DataRootSummary } from '../../shared/schema/dataRoots'
import {
  dataRootId,
  formatDataRootSpec,
  isValidDataRootLabel,
  MAX_DATA_ROOT_LABEL_LENGTH,
  parseDataRootSpec,
} from '../config/dataRoots'
import { getScanProgress, type ScanResult, scanAll, watch } from './scan'
import type { TraceStore } from './traceStore'

export class DataRootRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'DataRootRequestError'
  }
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function canonicalDirectory(rawPath: unknown): Promise<string> {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new DataRootRequestError('path must be a non-empty absolute directory')
  }
  const input = rawPath.trim()
  if (input.includes('\0') || input.length > 4096 || !path.isAbsolute(input)) {
    throw new DataRootRequestError('path must be a valid absolute directory')
  }

  let canonical: string
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    canonical = await fs.realpath(path.normalize(input))
    stat = await fs.stat(canonical)
  } catch {
    throw new DataRootRequestError('path must point to an existing readable directory')
  }
  if (!stat.isDirectory()) throw new DataRootRequestError('path must point to a directory')

  const filesystemRoot = path.parse(canonical).root
  const canonicalHome = await fs.realpath(os.homedir()).catch(() => path.resolve(os.homedir()))
  if (canonical === filesystemRoot) {
    throw new DataRootRequestError('filesystem root is too broad; choose a trace directory')
  }
  if (canonical === canonicalHome) {
    throw new DataRootRequestError('home directory is too broad; choose a trace directory')
  }
  return canonical
}

function normalizedLabel(rawLabel: unknown): string | undefined {
  if (rawLabel === undefined || rawLabel === null || rawLabel === '') return undefined
  if (typeof rawLabel !== 'string') throw new DataRootRequestError('label must be a string')
  const label = rawLabel.trim()
  if (!isValidDataRootLabel(label)) {
    throw new DataRootRequestError(
      `label must be 1-${MAX_DATA_ROOT_LABEL_LENGTH} characters using letters, numbers, dot, underscore, or hyphen`,
    )
  }
  return label
}

function watcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      watcher.off('error', onError)
      resolve()
    }
    const onError = (error: unknown) => {
      watcher.off('ready', onReady)
      reject(error)
    }
    watcher.once('ready', onReady)
    watcher.once('error', onError)
  })
}

export interface AddedDataRoot {
  root: DataRootSummary
  indexedTraces: number
  warnings: number
  traceCount: number
  dataVersion: number
}

export interface DataRootManagerOptions {
  /** Ignored, machine-local file used to restore folders added from the UI. */
  persistenceFile?: string
  /** Specs already loaded from persistenceFile at startup. */
  localRoots?: readonly string[]
}

/** Owns mutable runtime roots and serializes every whole-corpus scan. */
export class DataRootManager {
  readonly dataRoots: string[]
  private readonly dynamicPaths = new Set<string>()
  private readonly startupPaths = new Set<string>()
  private readonly locallyPersistentPaths = new Set<string>()
  private readonly localRootSpecs: string[]
  private readonly watchers: FSWatcher[] = []
  private operation: Promise<void> = Promise.resolve()
  private startPromise: Promise<ScanResult> | undefined

  constructor(
    private readonly store: TraceStore,
    initialRoots: readonly string[],
    private readonly options: DataRootManagerOptions = {},
  ) {
    const resolvedInitialRoots = initialRoots.map((spec) => parseDataRootSpec(spec))
    const labels = new Map<string, string>()
    for (const [index, root] of resolvedInitialRoots.entries()) {
      const resolvedPath = path.resolve(root.path)
      const effectiveLabel = (root.run ?? path.basename(resolvedPath) ?? 'external').toLowerCase()
      const labelOwner = labels.get(effectiveLabel)
      if (labelOwner && labelOwner !== resolvedPath) {
        throw new DataRootRequestError(
          `startup data roots reuse label ${JSON.stringify(effectiveLabel)}; give each root a unique label`,
          409,
        )
      }
      labels.set(effectiveLabel, resolvedPath)
      for (const previous of resolvedInitialRoots.slice(0, index)) {
        const previousPath = path.resolve(previous.path)
        if (
          resolvedPath !== previousPath &&
          (isSameOrWithin(resolvedPath, previousPath) || isSameOrWithin(previousPath, resolvedPath))
        ) {
          throw new DataRootRequestError(
            'startup data roots overlap; configure only the more specific trace directory',
            409,
          )
        }
      }
    }
    this.dataRoots = [...initialRoots]
    for (const spec of initialRoots)
      this.startupPaths.add(path.resolve(parseDataRootSpec(spec).path))
    this.localRootSpecs = [...(options.localRoots ?? [])]
    for (const spec of this.localRootSpecs) {
      this.locallyPersistentPaths.add(path.resolve(parseDataRootSpec(spec).path))
    }
  }

  get persistenceAvailable(): boolean {
    return this.options.persistenceFile !== undefined
  }

  private async writeLocalRoots(specs: readonly string[]): Promise<void> {
    const destination = this.options.persistenceFile
    if (!destination) return
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(
      temporary,
      `${JSON.stringify({ schemaVersion: 1, roots: specs }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    await fs.rename(temporary, destination)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work)
    this.operation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Starts boot scanning/watching once. createApp itself deliberately has no filesystem side effect. */
  start(): Promise<ScanResult> {
    if (this.startPromise) return this.startPromise
    if (this.dataRoots.length > 0) this.watchers.push(watch(this.store, this.dataRoots))
    this.startPromise = this.enqueue(() => scanAll(this.store, this.dataRoots))
    return this.startPromise
  }

  refresh(clear = true): Promise<ScanResult> {
    return this.enqueue(async () => {
      if (clear) this.store.clear()
      return scanAll(this.store, this.dataRoots)
    })
  }

  list(): DataRootSummary[] {
    return this.dataRoots.map((spec) => {
      const root = parseDataRootSpec(spec)
      return {
        id: dataRootId(root.path),
        label: (root.run ?? path.basename(root.path)) || 'external',
        run: root.run ?? null,
        dynamic: this.dynamicPaths.has(path.resolve(root.path)),
        persistent:
          this.startupPaths.has(path.resolve(root.path)) ||
          this.locallyPersistentPaths.has(path.resolve(root.path)),
      }
    })
  }

  add(rawPath: unknown, rawLabel?: unknown): Promise<AddedDataRoot> {
    return this.enqueue(async () => {
      const canonical = await canonicalDirectory(rawPath)
      const label = normalizedLabel(rawLabel)
      const existing = await Promise.all(
        this.dataRoots.map(async (spec) => {
          const root = parseDataRootSpec(spec)
          const canonicalPath = await fs.realpath(root.path).catch(() => path.resolve(root.path))
          return { root, canonicalPath }
        }),
      )

      for (const item of existing) {
        if (canonical === item.canonicalPath) {
          throw new DataRootRequestError('this directory is already watched', 409)
        }
        if (
          isSameOrWithin(canonical, item.canonicalPath) ||
          isSameOrWithin(item.canonicalPath, canonical)
        ) {
          throw new DataRootRequestError('this directory overlaps an existing watched root', 409)
        }
      }
      const effectiveLabel = (label ?? path.basename(canonical)) || 'external'
      if (
        existing.some(({ root }) => {
          const existingLabel = (root.run ?? path.basename(root.path)) || 'external'
          return existingLabel.toLowerCase() === effectiveLabel.toLowerCase()
        })
      ) {
        throw new DataRootRequestError(
          `label ${JSON.stringify(effectiveLabel)} is already in use; choose a unique label`,
          409,
        )
      }

      const spec = formatDataRootSpec({ path: canonical, ...(label ? { run: label } : {}) })
      const previousLocalRoots = [...this.localRootSpecs]
      if (this.persistenceAvailable) {
        const nextLocalRoots = [...previousLocalRoots, spec]
        await this.writeLocalRoots(nextLocalRoots)
        this.localRootSpecs.push(spec)
        this.locallyPersistentPaths.add(canonical)
      }
      this.dataRoots.push(spec)
      this.dynamicPaths.add(canonical)
      const watcher = watch(this.store, [spec])
      this.watchers.push(watcher)

      try {
        await watcherReady(watcher)
        const scan = await scanAll(this.store, this.dataRoots)
        const status = getScanProgress().scanRoots.find((root) => root.id === dataRootId(canonical))
        const root = this.list().find((item) => item.id === dataRootId(canonical))
        if (!root) throw new Error('added data root was not registered')
        return {
          root,
          indexedTraces: status?.traces ?? 0,
          warnings: status?.warnings ?? scan.warnings,
          traceCount: this.store.size,
          dataVersion: this.store.dataVersion,
        }
      } catch (error) {
        this.dataRoots.splice(this.dataRoots.indexOf(spec), 1)
        this.dynamicPaths.delete(canonical)
        if (this.persistenceAvailable) {
          this.localRootSpecs.splice(0, this.localRootSpecs.length, ...previousLocalRoots)
          this.locallyPersistentPaths.delete(canonical)
          await this.writeLocalRoots(previousLocalRoots).catch(() => undefined)
        }
        this.watchers.splice(this.watchers.indexOf(watcher), 1)
        await watcher.close()
        throw error
      }
    })
  }

  async close(): Promise<void> {
    await Promise.all(this.watchers.splice(0).map((watcher) => watcher.close()))
  }
}
