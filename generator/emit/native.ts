import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Trace } from '../../shared/schema/types'

/** Path of a native trace file, relative to the output root. */
export function nativeTracePath(trace: Trace): string {
  return join(
    'native',
    trace.meta.component,
    `step-${trace.meta.checkpointStep}`,
    `${trace.meta.traceId}.json`,
  )
}

/** Writes the full normalized trace as pretty-printed JSON. Returns bytes written. */
export function writeNative(outDir: string, trace: Trace): { path: string; bytes: number } {
  const rel = nativeTracePath(trace)
  const abs = join(outDir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  const body = `${JSON.stringify(trace, null, 2)}\n`
  writeFileSync(abs, body)
  return { path: rel, bytes: Buffer.byteLength(body) }
}
