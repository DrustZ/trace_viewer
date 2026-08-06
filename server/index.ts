import 'dotenv/config'
import pkg from '../package.json'
import { createApp } from './app'
import { resolveDataRoots } from './config/dataRoots'
import { scanAll, watch } from './store/scan'
import { TraceStore } from './store/traceStore'

const port = Number(process.env.PORT ?? 8787)
const dataRoots = resolveDataRoots()
const store = new TraceStore()
const app = createApp({ store, version: pkg.version, dataRoots })

// Progressive boot: listen immediately; the corpus streams in behind /api/meta progress.
scanAll(store, dataRoots)
  .then((boot) => {
    console.log(
      `[api] ${boot.traces} traces from ${boot.files} files (${boot.warnings} warnings) in ${boot.ms}ms`,
    )
  })
  .catch((e: unknown) => {
    console.error(`[api] boot scan failed: ${e instanceof Error ? e.message : String(e)}`)
  })
watch(store, dataRoots)

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})
