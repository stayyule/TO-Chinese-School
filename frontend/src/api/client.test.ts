import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { ApiError, apiFetch, apiJson, fieldErrors, safeReturnTo } from './client'

describe('safeReturnTo', () => {
  it.each([
    ['/admin/school-years', '/admin/school-years'],
    ['/admin?x=1#top', '/admin?x=1#top'],
    ['/', '/'],
  ])('accepts %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })

  it.each([
    '//evil.com',
    '///evil.com',
    'https://evil.com',
    'http://evil.com/x',
    'javascript:alert(1)',
    '/\\evil.com',
    '\\\\evil.com',
    '/ok\\bad',
    'admin',
    '',
    '/a\nb',
    '/%2F%2Fevil.com',
  ])('rejects %j', (input) => {
    expect(safeReturnTo(input)).toBe('/')
  })

  it('falls back for null/undefined and honors a custom fallback', () => {
    expect(safeReturnTo(null)).toBe('/')
    expect(safeReturnTo(undefined, '/parent')).toBe('/parent')
  })
})

describe('ApiError', () => {
  it('turns a problem body into a typed ApiError', async () => {
    server.use(
      http.get('/api/v1/things', () =>
        HttpResponse.json(
          { code: 'VALIDATION_ERROR', message: 'Validation failed', details: { name: ['must not be empty'] }, requestId: 'r1' },
          { status: 422 },
        ),
      ),
    )
    const err = await apiJson('/things').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const apiErr = err as ApiError
    expect(apiErr.status).toBe(422)
    expect(apiErr.code).toBe('VALIDATION_ERROR')
    expect(apiErr.message).toBe('Validation failed')
    expect(apiErr.details).toEqual({ name: ['must not be empty'] })
    expect(fieldErrors(apiErr)).toEqual([{ name: ['name'], errors: ['must not be empty'] }])
  })

  it('maps scalar details and ignores non-object details', () => {
    const e1 = new ApiError(422, 'VALIDATION_ERROR', 'x', { a: 'bad' })
    expect(fieldErrors(e1)).toEqual([{ name: ['a'], errors: ['bad'] }])
    expect(fieldErrors(new ApiError(422, 'VALIDATION_ERROR', 'x', ['list']))).toEqual([])
    expect(fieldErrors(new ApiError(500, 'INTERNAL_ERROR', 'x', null))).toEqual([])
  })

  it('falls back to a generic error for a non-JSON body', async () => {
    server.use(http.get('/api/v1/boom', () => new HttpResponse('oops', { status: 502 })))
    const err = (await apiJson('/boom').catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.code).toBe('HTTP_ERROR')
  })
})

describe('apiFetch CSRF', () => {
  it('sends X-CSRF-Token (from /auth/csrf) on POST but not on GET, fetching the token once', async () => {
    let csrfCalls = 0
    const seen: Array<string | null> = []
    server.use(
      http.get('/api/v1/auth/csrf', () => {
        csrfCalls += 1
        return HttpResponse.json({ token: 'tok-123' })
      }),
      http.post('/api/v1/things', ({ request }) => {
        seen.push(request.headers.get('x-csrf-token'))
        return HttpResponse.json({ ok: true })
      }),
      http.get('/api/v1/things', ({ request }) => {
        seen.push(request.headers.get('x-csrf-token'))
        return HttpResponse.json({ ok: true })
      }),
    )
    await apiFetch('/things', { method: 'POST', body: '{}' })
    await apiFetch('/things', { method: 'POST', body: '{}' })
    await apiFetch('/things')
    expect(seen).toEqual(['tok-123', 'tok-123', null])
    expect(csrfCalls).toBe(1)
  })

  it('re-fetches the token once after 403 CSRF_INVALID and retries', async () => {
    const tokens = ['stale', 'fresh']
    const seen: Array<string | null> = []
    server.use(
      http.get('/api/v1/auth/csrf', () => HttpResponse.json({ token: tokens.shift() })),
      http.post('/api/v1/things', ({ request }) => {
        const t = request.headers.get('x-csrf-token')
        seen.push(t)
        return t === 'fresh'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ code: 'CSRF_INVALID', message: 'bad', details: null, requestId: 'r' }, { status: 403 })
      }),
    )
    const res = await apiFetch('/things', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(seen).toEqual(['stale', 'fresh'])
  })
})
