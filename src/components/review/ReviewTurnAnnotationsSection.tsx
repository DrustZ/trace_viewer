import type { ReviewTranscriptMessage, TurnAnnotation } from '@shared/reviews/types'
import { csv, reviewInputClass } from './reviewFormShared'

export interface ReviewTurnAnnotationsSectionProps {
  annotations: readonly TurnAnnotation[]
  transcript: readonly ReviewTranscriptMessage[] | undefined
  locked: boolean
  onAdd: () => void
  onChange: (annotationId: string, patch: Partial<Omit<TurnAnnotation, 'annotationId'>>) => void
  onRemove: (annotationId: string) => void
}

export function ReviewTurnAnnotationsSection({
  annotations,
  transcript,
  locked,
  onAdd,
  onChange,
  onRemove,
}: ReviewTurnAnnotationsSectionProps) {
  return (
    <div className="space-y-2">
      {!locked ? (
        <button
          type="button"
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
          onClick={onAdd}
        >
          Add annotation
        </button>
      ) : null}
      {annotations.length === 0 ? (
        <p className="text-xs text-slate-500">No turn annotations.</p>
      ) : null}
      {annotations.map((annotation) => (
        <article
          key={annotation.annotationId}
          className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
        >
          <select
            className={reviewInputClass()}
            aria-label="Annotated message"
            value={annotation.messageId}
            disabled={locked}
            onChange={(event) => onChange(annotation.annotationId, { messageId: event.target.value })}
          >
            {transcript?.map((message) => (
              <option key={message.id} value={message.id}>
                {message.id} · {message.role}
              </option>
            ))}
          </select>
          <input
            className={reviewInputClass()}
            placeholder="Label"
            value={annotation.label}
            disabled={locked}
            onChange={(event) => onChange(annotation.annotationId, { label: event.target.value })}
          />
          <input
            className={reviewInputClass()}
            placeholder="Tags, comma separated"
            value={annotation.tags.join(', ')}
            disabled={locked}
            onChange={(event) => onChange(annotation.annotationId, { tags: csv(event.target.value) })}
          />
          <div className="flex gap-2">
            <input
              className={reviewInputClass()}
              placeholder="Annotation note"
              value={annotation.note}
              disabled={locked}
              onChange={(event) => onChange(annotation.annotationId, { note: event.target.value })}
            />
            {!locked ? (
              <button
                type="button"
                className="rounded-md px-2 text-xs text-red-600"
                onClick={() => onRemove(annotation.annotationId)}
              >
                Remove
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}
