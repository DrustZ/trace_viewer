import 'dotenv/config'
import pkg from '../package.json'
import { createApp } from './app'
import { LOCAL_DATA_ROOTS_FILE, loadLocalDataRoots, resolveDataRoots } from './config/dataRoots'
import { DataRootManager } from './store/dataRootManager'
import { TraceStore } from './store/traceStore'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
let localRoots: string[] = []
try {
  localRoots = loadLocalDataRoots()
} catch (error) {
  console.error(
    `[api] ignored invalid local data-root registry: ${error instanceof Error ? error.message : String(error)}`,
  )
}
const dataRoots = resolveDataRoots(undefined, undefined, { persistedRoots: localRoots })
const store = new TraceStore()
const dataRootManager = new DataRootManager(store, dataRoots, {
  persistenceFile: LOCAL_DATA_ROOTS_FILE,
  localRoots,
})
const app = createApp({ store, version: pkg.version, dataRoots, dataRootManager })

// Progressive boot: listen immediately; the corpus streams in behind /api/meta progress.
dataRootManager
  .start()
  .then((boot) => {
    console.log(
      `[api] ${boot.traces} traces from ${boot.files} files (${boot.warnings} warnings) in ${boot.ms}ms`,
    )
  })
  .catch((e: unknown) => {
    console.error(`[api] boot scan failed: ${e instanceof Error ? e.message : String(e)}`)
  })

app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port}`)
})
