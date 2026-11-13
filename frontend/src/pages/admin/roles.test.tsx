import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { csrf, mockMe, problem, renderApp } from '../../test/render'
import { server } from '../../test/server'

const SU = ['access.roles.read', 'access.roles.manage_users', 'auth.invitations.create']

const detail = {
  id: 2,
  name: 'Registration Officer',
  permissions: ['people.read', 'families.read'],
  users: [{ id: 5, username: 'bob', personName: 'Bob 陈' }],
}

describe('roles', () => {
  it('lists roles with user counts and links to the detail page', async () => {
    mockMe(SU)
    server.use(http.get('/api/v1/roles', () => HttpResponse.json([{ id: 2, name: 'Registration Officer', userCount: 3 }])))
    renderApp('/admin/roles')
    const link = await screen.findByRole('link', { name: 'Registration Officer' })
    expect(link).toHaveAttribute('href', '/admin/roles/2')
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows permissions and users, including Chinese person names', async () => {
    mockMe(SU)
    server.use(http.get('/api/v1/roles/2', () => HttpResponse.json(detail)))
    renderApp('/admin/roles/2')
    expect(await screen.findByText('Bob 陈')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('people.read')).toBeInTheDocument()
  })

  it('hides user management without access.roles.manage_users', async () => {
    mockMe(['access.roles.read'])
    server.use(http.get('/api/v1/roles/2', () => HttpResponse.json(detail)))
    renderApp('/admin/roles/2')
    expect(await screen.findByText('bob')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('adds a user by username and refreshes the list', async () => {
    mockMe(SU)
    let body: unknown
    let added = false
    server.use(
      http.get('/api/v1/roles/2', () =>
        HttpResponse.json(added ? { ...detail, users: [...detail.users, { id: 6, username: 'carol', personName: null }] } : detail),
      ),
      csrf,
      http.post('/api/v1/roles/2/users', async ({ request }) => {
        body = await request.json()
        added = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/admin/roles/2')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'carol')
    await user.click(screen.getByRole('button', { name: 'Add user' }))
    expect(await screen.findByText('carol')).toBeInTheDocument()
    expect(body).toEqual({ username: 'carol' })
    expect(screen.getByLabelText('Username')).toHaveValue('')
  })

  it('maps USER_NOT_FOUND onto the username field', async () => {
    mockMe(SU)
    server.use(
      http.get('/api/v1/roles/2', () => HttpResponse.json(detail)),
      csrf,
      http.post('/api/v1/roles/2/users', () => problem(404, 'USER_NOT_FOUND')),
    )
    renderApp('/admin/roles/2')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'nobody')
    await user.click(screen.getByRole('button', { name: 'Add user' }))
    expect(await screen.findByText('No user with that username')).toBeInTheDocument()
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument()
  })

  it('asks for confirmation before removing a user and sends nothing when cancelled', async () => {
    mockMe(SU)
    let deletes = 0
    server.use(
      http.get('/api/v1/roles/2', () => HttpResponse.json(detail)),
      csrf,
      http.delete('/api/v1/roles/2/users/5', () => {
        deletes += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/admin/roles/2')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    const confirm = await screen.findByRole('tooltip')
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(deletes).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(within(await screen.findByRole('tooltip')).getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(deletes).toBe(1))
  })

  it('shows Not found for a role the API does not know and for a bad id', async () => {
    mockMe(SU)
    let calls = 0
    server.use(
      http.get('/api/v1/roles/99', () => problem(404, 'ROLE_NOT_FOUND')),
      http.get('/api/v1/roles/abc', () => {
        calls += 1
        return HttpResponse.json(detail)
      }),
    )
    renderApp('/admin/roles/99')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    renderApp('/admin/roles/abc')
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0)
    expect(calls).toBe(0)
  })
})

describe('invitations', () => {
  async function fill(person: string, email: string) {
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Person ID'), person)
    if (email) await user.type(screen.getByLabelText('Email'), email)
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
  }

  it('posts the person id as a number and the email, then confirms', async () => {
    mockMe(SU)
    let body: unknown
    server.use(
      csrf,
      http.post('/api/v1/admin/user-registration/invitations', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ personId: 12, expiresAt: '2099-01-01T00:00:00Z' }, { status: 201 })
      }),
    )
    renderApp('/admin/invitations')
    await fill('12', 'a@b.org')
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument()
    expect(body).toEqual({ personId: 12, emailDestination: 'a@b.org' })
  })

  it.each([
    [404, 'PERSON_NOT_FOUND', null, 'No person with that ID'],
    [409, 'PERSON_ALREADY_HAS_ACCOUNT', null, 'This person already has an account'],
    [422, 'EMAIL_REQUIRED', null, 'An email address is required'],
    [422, 'VALIDATION_ERROR', { emailDestination: 'INVALID' }, 'This value is not valid'],
  ])('maps %s %s', async (status, code, details, message) => {
    mockMe(SU)
    server.use(
      csrf,
      http.post('/api/v1/admin/user-registration/invitations', () => problem(status, code, details)),
    )
    renderApp('/admin/invitations')
    await fill('12', 'a@b.org')
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('rejects a non-numeric person id without calling the API', async () => {
    mockMe(SU)
    let posts = 0
    server.use(
      csrf,
      http.post('/api/v1/admin/user-registration/invitations', () => {
        posts += 1
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderApp('/admin/invitations')
    await fill('1.5', 'a@b.org')
    expect(await screen.findByText('Enter a whole number')).toBeInTheDocument()
    expect(posts).toBe(0)
  })
})
