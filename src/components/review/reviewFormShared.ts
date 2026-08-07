/** Small shared form helpers for the review panel and its sections. */

export function reviewInputClass(): string {
  return 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60'
}

export function csv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}
