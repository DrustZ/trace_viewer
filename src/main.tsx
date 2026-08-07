import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { consumeAccessTokenFromUrl } from './api/accessAuth'
import { ApiError } from './api/client'
import { AccessGate } from './components/auth/AccessGate'
import './index.css'
import { applyTheme, getTheme } from './theme'

// Apply the persisted/system theme before first paint to avoid a flash.
applyTheme(getTheme())
const startupAccessToken = consumeAccessTokenFromUrl()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Retry transient failures once, but never auth/not-found responses. Those should
      // show their dedicated state immediately instead of spinning through retries.
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof ApiError && (error.status === 401 || error.status === 404)),
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AccessGate startupAccessToken={startupAccessToken}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AccessGate>
    </QueryClientProvider>
  </StrictMode>,
)
