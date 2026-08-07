import { useQueryClient } from '@tanstack/react-query'
import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTH_REQUIRED_EVENT, exchangeAccessToken } from '../../api/accessAuth'

interface AccessPromptProps {
  busy: boolean
  error: string | null
  onUnlock: (token: string) => Promise<void>
}

export function AccessPrompt({ busy, error, onUnlock }: AccessPromptProps) {
  const [token, setToken] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = token.trim()
    if (normalized) void onUnlock(normalized)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-700">
          ACE Trace Cockpit
        </p>
        <h1 className="text-2xl font-bold text-slate-900">Trace Viewer is locked</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Paste the access token for this server. It is exchanged for an HttpOnly browser session
          and is not saved in local storage.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-slate-700" htmlFor="access-token">
            Access token
          </label>
          <input
            id="access-token"
            name="access-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            placeholder="Paste token"
          />
          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || token.trim() === ''}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Unlocking…' : 'Unlock Trace Viewer'}
          </button>
        </form>
      </section>
    </main>
  )
}

interface AccessGateProps {
  children: ReactNode
  startupAccessToken?: string | null
}

/** Unmounts every API consumer (including EventSource) while the server is locked. */
export function AccessGate({ children, startupAccessToken = null }: AccessGateProps) {
  const queryClient = useQueryClient()
  const startupAttempted = useRef(false)
  const [state, setState] = useState<'ready' | 'authenticating' | 'locked'>(
    startupAccessToken !== null ? 'authenticating' : 'ready',
  )
  const [busy, setBusy] = useState(startupAccessToken !== null)
  const [error, setError] = useState<string | null>(null)

  const unlock = useCallback(
    async (token: string) => {
      setBusy(true)
      setError(null)
      try {
        await exchangeAccessToken(token)
        // Remove cached 401 results before API consumers and EventSource remount.
        queryClient.clear()
        setState('ready')
      } catch (reason) {
        setState('locked')
        setError(reason instanceof Error ? reason.message : 'Authentication failed')
      } finally {
        setBusy(false)
      }
    },
    [queryClient],
  )

  useEffect(() => {
    const lock = () => {
      void queryClient.cancelQueries()
      setError(null)
      setBusy(false)
      setState('locked')
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, lock)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, lock)
  }, [queryClient])

  useEffect(() => {
    if (startupAccessToken === null || startupAttempted.current) return
    startupAttempted.current = true
    void unlock(startupAccessToken)
  }, [startupAccessToken, unlock])

  if (state === 'ready') return children
  return <AccessPrompt busy={busy || state === 'authenticating'} error={error} onUnlock={unlock} />
}
