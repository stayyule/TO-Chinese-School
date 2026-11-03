import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { createAppRouter } from '../routes'
import { server } from './server'

export const problem = (status: number, code: string, details: unknown = null) =>
  HttpResponse.json({ code, message: code, details, requestId: 'r' }, { status })

export const csrf = http.get('/api/v1/auth/csrf', () => HttpResponse.json({ token: 'tok' }))

export function meWith(permissions: string[], roles: string[] = []) {
  return {
    user: { id: 1, username: 'alice' },
    person: { id: 7, englishName: 'Alice Wong', chineseName: null },
    roles,
    permissions,
  }
}

export function mockMe(permissions: string[], roles: string[] = []) {
  server.use(http.get('/api/v1/me', () => HttpResponse.json(meWith(permissions, roles))))
}

export function renderApp(path: string) {
  const router = createAppRouter([path])
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
