import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../api/client'

interface Health {
  ok: boolean
  version: string
}

export default function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiGet<Health>('/api/health') })

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-xl font-semibold">Trace Viewer</h1>
      <p className="mt-2 text-sm text-slate-500">
        API: {health.isLoading ? 'connecting…' : health.data?.ok ? 'connected' : 'unreachable'}
      </p>
    </div>
  )
}
