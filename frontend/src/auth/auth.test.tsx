import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '../routes'
import { server } from '../test/server'
import { AuthProvider } from './AuthProvider'
import { RequirePermission } from './RequirePermission'

const ME = {
  user: { id: 1, username: 'alice' },
  person: { id: 7, englishName: 'Alice Wong', chineseName: null },
  roles: ['Registration Officer'],
  permissions: ['school_years.read'],
}

const unauthenticated = () =>
  HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'no', details: null, requestId: 'r' }, { status: 401 })

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderApp(path: string) {
  const router = createAppRouter([path])
  render(
    <QueryClientProvider client={newClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

describe('protected routes', () => {
  it('redirects to /signin?returnTo=... when /me is 401', async () => {
    server.use(http.get('/api/v1/me', unauthenticated))
    const router = renderApp('/admin/school-years')
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(router.state.location.search).toBe('?returnTo=%2Fadmin%2Fschool-years')
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('does not probe /me on public pages', async () => {
    let meCalls = 0
    server.use(
      http.get('/api/v1/me', () => {
        meCalls += 1
        return unauthenticated()
      }),
    )
    renderApp('/signin')
    expect(await screen.findByText('Thousand Oaks Chinese School')).toBeInTheDocument()
    expect(meCalls).toBe(0)
  })

  it('navigates to returnTo after a successful login and sends the CSRF token', async () => {
    let loggedIn = false
    let csrfHeader: string | null = null
    server.use(
      http.get('/api/v1/me', () => (loggedIn ? HttpResponse.json(ME) : unauthenticated())),
      http.get('/api/v1/auth/csrf', () => HttpResponse.json({ token: 'csrf-abc' })),
      http.post('/api/v1/auth/login', async ({ request }) => {
        csrfHeader = request.headers.get('x-csrf-token')
        expect(await request.json()).toEqual({ username: 'alice', password: 'pw' })
        loggedIn = true
        return HttpResponse.json({ userId: 1 })
      }),
    )
    const router = renderApp('/admin/school-years')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/school-years'))
    expect(csrfHeader).toBe('csrf-abc')
  })

  it('ignores a malicious returnTo after login', async () => {
    let loggedIn = false
    server.use(
      http.get('/api/v1/me', () => (loggedIn ? HttpResponse.json(ME) : unauthenticated())),
      http.get('/api/v1/auth/csrf', () => HttpResponse.json({ token: 't' })),
      http.post('/api/v1/auth/login', () => {
        loggedIn = true
        return HttpResponse.json({ userId: 1 })
      }),
    )
    const router = renderApp('/signin?returnTo=%2F%2Fevil.com')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'a')
    await user.type(screen.getByLabelText('Password'), 'b')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('RequirePermission', () => {
  function renderGate(perms: string[]) {
    server.use(http.get('/api/v1/me', () => HttpResponse.json({ ...ME, permissions: perms })))
    render(
      <QueryClientProvider client={newClient()}>
        <MemoryRouter initialEntries={['/parent']}>
          <AuthProvider>
            <RequirePermission code="school_years.read">
              <p>secret panel</p>
            </RequirePermission>
            <p>gate rendered</p>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the child when /me lists the code', async () => {
    renderGate(['school_years.read'])
    expect(await screen.findByText('secret panel')).toBeInTheDocument()
  })

  it('hides the child when /me lacks the code', async () => {
    renderGate(['grades.read'])
    expect(await screen.findByText('gate rendered')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100)) // let /me settle
    expect(screen.queryByText('secret panel')).not.toBeInTheDocument()
  })
})
