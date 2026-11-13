const BACKSLASH = String.fromCharCode(92)
export const API_BASE = '/api/v1'

/** Problem JSON body the backend returns for every error: { code, message, details, requestId }. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Antd-form field error entries from a 422 VALIDATION_ERROR `details` object keyed by field name. */
export function fieldErrors(err: ApiError): Array<{ name: string[]; errors: string[] }> {
  const d = err.details
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return []
  return Object.entries(d as Record<string, unknown>).map(([field, value]) => ({
    name: [field],
    errors: (Array.isArray(value) ? value : [value]).map(String),
  }))
}

export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body: unknown = await res.clone().json()
    if (typeof body === 'object' && body !== null) {
      const b = body as { code?: unknown; message?: unknown; details?: unknown }
      return new ApiError(
        res.status,
        typeof b.code === 'string' ? b.code : 'HTTP_ERROR',
        typeof b.message === 'string' ? b.message : res.statusText || 'Request failed',
        b.details ?? null,
      )
    }
  } catch {
    // not JSON; fall through
  }
  return new ApiError(res.status, 'HTTP_ERROR', res.statusText || 'Request failed')
}

function hasControlChar(s: string): boolean {
  return [...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)
}

/**
 * Accepts only a same-origin relative path: starts with exactly one "/", no backslashes, no control characters,
 * and does not decode (once) into a protocol-relative URL. Anything else yields the fallback.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string' || value === '') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.includes(BACKSLASH) || hasControlChar(value)) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || decoded.includes(BACKSLASH)) return fallback
  } catch {
    return fallback
  }
  return value
}

// --- CSRF (double submit): token lives in memory only, never in storage ---
let csrfToken: string | null = null
let csrfInflight: Promise<string> | null = null

export function resetCsrfToken(): void {
  csrfToken = null
  csrfInflight = null
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' })
  if (!res.ok) throw await toApiError(res)
  const body = (await res.json()) as { token: string }
  csrfToken = body.token
  return body.token
}

function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return Promise.resolve(csrfToken)
  csrfInflight ??= fetchCsrfToken().finally(() => {
    csrfInflight = null
  })
  return csrfInflight
}

// --- 401 handling: the app registers a navigator (AuthProvider) ---
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

async function send(path: string, init: RequestInit | undefined, retriedCsrf: boolean): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers)
  if (!SAFE_METHODS.has(method)) headers.set('X-CSRF-Token', await ensureCsrfToken())
  if (init?.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const url = path.startsWith('/api/') ? path : `${API_BASE}${path}`
  const res = await fetch(url, { ...init, method, headers, credentials: 'include' })
  if (res.status === 403 && !retriedCsrf && !SAFE_METHODS.has(method)) {
    const err = await toApiError(res)
    if (err.code === 'CSRF_INVALID') {
      resetCsrfToken()
      return send(path, init, true)
    }
  }
  return res
}

/** Low-level variant used by the /me probe: never triggers the 401 redirect (callers handle it). */
export function apiFetchNoRedirect(path: string, init?: RequestInit): Promise<Response> {
  return send(path, init, false)
}

/** fetch against /api/v1 with credentials and CSRF; a 401 navigates to /signin?returnTo=<current path>. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await send(path, init, false)
  if (res.status === 401) onUnauthorized?.()
  return res
}

/** apiFetch + JSON body; throws ApiError for non-2xx. 204 resolves to undefined. */
export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
