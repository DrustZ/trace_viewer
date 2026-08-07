import { notifyAuthenticationRequired } from './accessAuth'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  if (response.status === 401) notifyAuthenticationRequired()
  return response
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new ApiError(res.status, await safeText(res))
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await safeText(res))
  return res.json() as Promise<T>
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return res.statusText
  }
}
