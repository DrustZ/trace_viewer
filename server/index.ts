import 'dotenv/config'
import { createApp } from './app'
import { scanAll, watch } from './store/scan'
import { TraceStore } from './store/traceStore'

const port = Number(process.env.PORT ?? 8787)
const store = new TraceStore()
const app = createApp({ store })

// Progressive boot: listen immediately; the corpus streams in behind /api/meta progress.
scanAll(store)
  .then((boot) => {
    console.log(
      `[api] ${boot.traces} traces from ${boot.files} files (${boot.warnings} warnings) in ${boot.ms}ms`,
    )
  })
  .catch((e: unknown) => {
    console.error(`[api] boot scan failed: ${e instanceof Error ? e.message : String(e)}`)
  })
watch(store)

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})
