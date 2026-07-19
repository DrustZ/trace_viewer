import { useState } from 'react'

const STR_CLAMP = 200

function StringLeaf({ value }: { value: string }) {
  const [full, setFull] = useState(false)
  if (full || value.length <= STR_CLAMP) {
    return <span className="break-all text-emerald-700">"{value}"</span>
  }
  return (
    <span className="break-all text-emerald-700">
      "{value.slice(0, STR_CLAMP)}"{' '}
      <button
        type="button"
        className="text-slate-400 hover:text-slate-700"
        onClick={() => setFull(true)}
      >
        … ({value.length.toLocaleString()} chars)
      </button>
    </span>
  )
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-purple-700">null</span>
  switch (typeof value) {
    case 'string':
      return <StringLeaf value={value} />
    case 'number':
      return <span className="text-amber-700">{String(value)}</span>
    case 'boolean':
      return <span className="text-purple-700">{String(value)}</span>
    default:
      return <span className="text-slate-500">{String(value)}</span>
  }
}

function KeyLabel({ name }: { name: string }) {
  return (
    <>
      <span className="text-sky-700">{name}</span>
      <span className="text-slate-400">: </span>
    </>
  )
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  if (typeof value !== 'object' || value === null) {
    return (
      <div>
        {name !== undefined && <KeyLabel name={name} />}
        <Leaf value={value} />
      </div>
    )
  }

  const isArr = Array.isArray(value)
  const entries: Array<[string, unknown]> = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const brackets = isArr ? '[]' : '{}'

  if (entries.length === 0) {
    return (
      <div>
        {name !== undefined && <KeyLabel name={name} />}
        <span className="text-slate-500">{brackets}</span>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        className="mr-1 text-slate-400 hover:text-slate-700"
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'}
      </button>
      {name !== undefined && <KeyLabel name={name} />}
      {open ? (
        <>
          <span className="text-slate-500">{brackets[0]}</span>
          <div className="ml-1.5 border-l border-slate-200 pl-4">
            {entries.map(([k, v]) => (
              <Node key={k} name={isArr ? undefined : k} value={v} depth={depth + 1} />
            ))}
          </div>
          <span className="ml-4 text-slate-500">{brackets[1]}</span>
        </>
      ) : (
        <span className="text-slate-400">
          {brackets[0]}…{brackets[1]} {entries.length} {isArr ? 'items' : 'keys'}
        </span>
      )}
    </div>
  )
}

export function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="font-mono text-xs leading-5 text-slate-700">
      <Node value={value} depth={0} />
    </div>
  )
}
