import { runGenerate } from './generate'

/**
 * Regenerates the whole per-run corpus under data/runs/<run>/ deterministically.
 *
 * One run per folder. traceIds are namespaced per run by generate.ts
 * (run-a bare, run-b `b-`, run-c `c-`, run-d `d-`) so ids never collide when the
 * scanner loads every run into one store; instanceIds stay UNPREFIXED so the
 * same instance joins across runs for cross-run comparison.
 *
 * run-a is the full-scale reference corpus (~49MB on its own). run-c/run-d were
 * trimmed below their nominal 0.4/0.3 to keep the combined corpus reasonable —
 * see the final total this script prints.
 */
interface RunSpec {
  run: string
  seed: number
  scale: number
}

const RUNS: readonly RunSpec[] = [
  { run: 'run-a', seed: 42, scale: 0.6 },
  { run: 'run-b', seed: 43, scale: 0.4 },
  { run: 'run-c', seed: 44, scale: 0.3 },
  { run: 'run-d', seed: 45, scale: 0.2 },
]

function main(): void {
  let totalBytes = 0
  const perRun: Array<{ run: string; bytes: number; total: number }> = []
  for (const spec of RUNS) {
    console.log(`\n=== ${spec.run}  (seed ${spec.seed}, scale ${spec.scale}) ===`)
    const summary = runGenerate({
      seed: spec.seed,
      out: `data/runs/${spec.run}`,
      scale: spec.scale,
      runName: spec.run,
    })
    totalBytes += summary.totalBytes
    perRun.push({ run: spec.run, bytes: summary.totalBytes, total: summary.counts.total })
  }
  const mb = (b: number): string => `${(b / (1024 * 1024)).toFixed(1)} MB`
  console.log('\n=== combined ===')
  for (const r of perRun)
    console.log(
      `  ${r.run.padEnd(6)} ${String(r.total).padStart(5)} traces  ${mb(r.bytes).padStart(9)}`,
    )
  console.log(
    `  ${'all'.padEnd(6)} ${String(perRun.reduce((a, r) => a + r.total, 0)).padStart(5)} traces  ${mb(totalBytes).padStart(9)} (approx)`,
  )
}

main()
