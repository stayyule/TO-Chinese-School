import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { renderApp, mockMe } from '../test/render'
import { server } from '../test/server'
import { RequireRoutePermission } from './RequireRoutePermission'

describe('per-route permission guard', () => {
  it('shows the Forbidden page, not the page content, and requests no data, without the permission', async () => {
    mockMe(['home.panel.student_parent'])
    let dataCalls = 0
    server.use(
      http.get('/api/v1/me/families', () => {
        dataCalls += 1
        return HttpResponse.json([])
      }),
    )
    renderApp('/parent/families/5/children/new')
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByLabelText('Birth month')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 100))
    expect(dataCalls).toBe(0)
  })

  function renderGuard(perms: string[]) {
    mockMe(perms)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/parent']}>
          <AuthProvider>
            <RequireRoutePermission anyOf={['a.one', 'a.two']}>
              <p>guarded content</p>
            </RequireRoutePermission>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('anyOf allows a user holding one of the codes', async () => {
    renderGuard(['a.two'])
    expect(await screen.findByText('guarded content')).toBeInTheDocument()
  })

  it('anyOf forbids a user holding none of the codes', async () => {
    renderGuard(['a.three'])
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByText('guarded content')).not.toBeInTheDocument()
  })
})
