import 'dotenv/config'
import { createApp } from './app'
import { scanAll, watch } from './store/scan'
import { TraceStore } from './store/traceStore'

const port = Number(process.env.PORT ?? 8787)
const store = new TraceStore()
const app = createApp({ store })

const boot = await scanAll(store)
console.log(
  `[api] ${boot.traces} traces from ${boot.files} files (${boot.warnings} warnings) in ${boot.ms}ms`,
)
watch(store)

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})
