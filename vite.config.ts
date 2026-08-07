import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Preserve Vite's default secret denylist and add all Viewer-owned local data/state. */
export const PRIVATE_FS_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem}',
  '**/.git/**',
  `${path.resolve(__dirname, '.trace-viewer')}/**`,
  `${path.resolve(__dirname, 'data')}/**`,
]

export function isPrivateViewerUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  let pathname: string
  try {
    pathname = new URL(rawUrl, 'http://vite.local').pathname
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const decoded = decodeURIComponent(pathname)
      if (decoded === pathname) break
      pathname = decoded
    }
  } catch {
    return true
  }
  const normalized = pathname
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/')
    .toLowerCase()
  return (
    normalized === '/data' ||
    normalized.startsWith('/data/') ||
    normalized === '/.trace-viewer' ||
    normalized.startsWith('/.trace-viewer/')
  )
}

const denyPrivateViewerUrls: Plugin = {
  name: 'deny-private-viewer-urls',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!isPrivateViewerUrl(req.url)) {
        next()
        return
      }
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Forbidden')
    })
  },
}

export default defineConfig({
  plugins: [denyPrivateViewerUrls, react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    fs: {
      strict: true,
      deny: PRIVATE_FS_DENY,
    },
    proxy: {
      // Pin IPv4: the API server binds 127.0.0.1, and `localhost` resolves to
      // ::1 first whenever any other app (observed: Cursor) squats the same
      // port on IPv6 — every /api call then 404s against the stranger.
      '/api': `http://127.0.0.1:${process.env.PORT ?? 8787}`,
    },
  },
})
