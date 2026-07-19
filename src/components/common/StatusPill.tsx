import type { TraceStatus } from '@shared/schema/types'

const STYLES: Record<TraceStatus, string> = {
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  executing: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse',
}

export function StatusPill({ status }: { status: TraceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  )
}
