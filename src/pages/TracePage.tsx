import { useParams } from 'react-router-dom'

export default function TracePage() {
  const { traceId } = useParams()
  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="text-xl font-semibold">Trace {traceId}</h1>
    </div>
  )
}
