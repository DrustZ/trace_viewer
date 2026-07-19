import 'dotenv/config'
import { createApp } from './app'

const port = Number(process.env.PORT ?? 8787)
const app = createApp()

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`)
})
