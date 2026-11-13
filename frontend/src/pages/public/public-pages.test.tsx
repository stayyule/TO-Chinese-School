import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '../../routes'
import { server } from '../../test/server'

const problem = (status: number, code: string, details: unknown = null, headers?: Record<string, string>) =>
  HttpResponse.json({ code, message: code, details, requestId: 'r' }, { status, headers })

const csrf = http.get('/api/v1/auth/csrf', () => HttpResponse.json({ token: 'tok' }))

const ME = {
  user: { id: 1, username: 'alice' },
  person: { id: 7, englishName: 'Alice Wong', chineseName: null },
  roles: [],
  permissions: [],
}

function renderApp(path: string) {
  const router = createAppRouter([path])
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const PASSWORD = 'correct horse battery'

describe('sign-in page', () => {
  it('shows the invalid combination message and support email on 401', async () => {
    server.use(csrf, http.post('/api/v1/auth/login', () => problem(401, 'INVALID_CREDENTIALS')))
    renderApp('/signin')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Invalid username / password combination')).toBeInTheDocument()
    expect(screen.getByText(/engineering@to-cs\.org/)).toBeInTheDocument()
  })

  it('shows the lock message with minutes from Retry-After on 429', async () => {
    server.use(
      csrf,
      http.post('/api/v1/auth/login', () => problem(429, 'LOGIN_LOCKED', { retryAfterSeconds: 600 }, { 'Retry-After': '600' })),
    )
    renderApp('/signin')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/wait 10 minute\(s\)/)).toBeInTheDocument()
  })

  it('trims the username, then goes to returnTo', async () => {
    let body: unknown
    server.use(
      csrf,
      http.post('/api/v1/auth/login', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ userId: 1 })
      }),
      http.get('/api/v1/me', () => HttpResponse.json(ME)),
    )
    const router = renderApp('/signin?returnTo=%2Fparent')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), '  alice  ')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent'))
    expect(body).toEqual({ username: 'alice', password: 'pw' })
  })

  it('uses correct autocomplete attributes', async () => {
    renderApp('/signin')
    expect(await screen.findByLabelText('Username')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })
})

describe('forgot password / username', () => {
  const NEUTRAL_PW = /If the username is on record/
  it.each(['alice', 'nobody-here'])('shows the same neutral message for %s', async (name) => {
    server.use(csrf, http.post('/api/v1/auth/forgot-password', () => HttpResponse.json({}, { status: 202 })))
    renderApp('/forgot-password')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), name)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    const msg = await screen.findByText(NEUTRAL_PW)
    expect(msg.textContent).not.toContain(name)
  })

  it('shows a generic error (not the neutral message) on network failure', async () => {
    server.use(csrf, http.post('/api/v1/auth/forgot-password', () => HttpResponse.error()))
    renderApp('/forgot-password')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Username'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NEUTRAL_PW)).not.toBeInTheDocument()
  })

  it('forgot-username shows the neutral message', async () => {
    let body: unknown
    server.use(
      csrf,
      http.post('/api/v1/auth/forgot-username', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({}, { status: 202 })
      }),
    )
    renderApp('/forgot-username')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email'), ' a@b.org ')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/If the email address is on record/)).toBeInTheDocument()
    expect(body).toEqual({ email: 'a@b.org' })
  })
})

describe('reset password', () => {
  it('shows the invalid-link state when the token check is 404', async () => {
    server.use(http.get('/api/v1/auth/reset-tokens/bad', () => problem(404, 'INVALID_TOKEN')))
    renderApp('/reset-password/bad')
    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('blocks submit when the password is under 10 characters', async () => {
    let posted = false
    server.use(
      csrf,
      http.get('/api/v1/auth/reset-tokens/good', () => HttpResponse.json({})),
      http.post('/api/v1/auth/reset-password', () => {
        posted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/reset-password/good')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.type(screen.getByLabelText('Phone number on file'), '8055551234')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument()
    expect(posted).toBe(false)
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })

  it.each([
    ['PASSWORD_MISMATCH', 'Confirm password', 'The passwords do not match'],
    ['PHONE_MISMATCH', 'Phone number on file', 'The phone number does not match our records'],
  ])('maps %s onto the %s field', async (code, label, text) => {
    server.use(
      csrf,
      http.get('/api/v1/auth/reset-tokens/good', () => HttpResponse.json({})),
      http.post('/api/v1/auth/reset-password', () => problem(422, code)),
    )
    renderApp('/reset-password/good')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm password'), PASSWORD)
    await user.type(screen.getByLabelText('Phone number on file'), '8055551234')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    const err = await screen.findByText(text)
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(new RegExp(text))
    expect(err).toBeInTheDocument()
  })

  it('shows success after a 204 and posts the token', async () => {
    let body: unknown
    server.use(
      csrf,
      http.get('/api/v1/auth/reset-tokens/good', () => HttpResponse.json({})),
      http.post('/api/v1/auth/reset-password', async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/reset-password/good')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm password'), PASSWORD)
    await user.type(screen.getByLabelText('Phone number on file'), '8055551234')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Your password has been reset. You can now sign in.')).toBeInTheDocument()
    expect(body).toEqual({ token: 'good', password: PASSWORD, passwordConfirmation: PASSWORD, phoneNumber: '8055551234' })
  })
})

describe('register with invitation', () => {
  it('shows the invalid-link state on 404', async () => {
    server.use(http.get('/api/v1/auth/invitations/bad', () => problem(404, 'INVALID_TOKEN')))
    renderApp('/register-with-invitation/bad')
    expect(await screen.findByText('This invitation link is invalid or has expired.')).toBeInTheDocument()
  })

  it('greets the invited person and maps USERNAME_TAKEN and PHONE_MISMATCH', async () => {
    let code = 'USERNAME_TAKEN'
    server.use(
      csrf,
      http.get('/api/v1/auth/invitations/good', () => HttpResponse.json({ personName: 'Wei Chen' })),
      http.post('/api/v1/auth/register-with-invitation', () => problem(code === 'USERNAME_TAKEN' ? 409 : 422, code)),
    )
    renderApp('/register-with-invitation/good')
    const user = userEvent.setup()
    expect(await screen.findByText(/Wei Chen/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Username'), 'wei')
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm password'), PASSWORD)
    await user.type(screen.getByLabelText('Phone number on file'), '8055551234')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('That username is already taken. Please choose another.')).toBeInTheDocument()
    code = 'PHONE_MISMATCH'
    // the AntD button is named 'loading Submit' until the failed request settles, so wait for it
    await user.click(await screen.findByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('The phone number does not match our records')).toBeInTheDocument()
  })
})

describe('register', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, overrides: Partial<Record<string, string>> = {}) {
    const v = {
      Street: '1 Main St',
      City: 'Thousand Oaks',
      State: 'CA',
      'Zip code': '91360',
      'Home phone': '805-555-1234',
      Email: 'a@b.org',
      'English first name': 'Wei',
      'English last name': 'Chen',
      'Chinese name (optional)': '陳偉',
      Username: 'wchen',
      Password: PASSWORD,
      'Confirm password': PASSWORD,
      ...overrides,
    }
    for (const [label, value] of Object.entries(v)) await user.type(await screen.findByLabelText(label), value)
    await user.click(screen.getByLabelText('Gender'))
    await user.click(await screen.findByText('Female'))
  }

  it('submits the body (Chinese name intact)', async () => {
    let body: unknown
    server.use(
      csrf,
      http.post('/api/v1/auth/register', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderApp('/register')
    const user = userEvent.setup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Registration complete. You can now sign in.')).toBeInTheDocument()
    expect(body).toEqual({
      address: { street: '1 Main St', city: 'Thousand Oaks', state: 'CA', zipcode: '91360', homePhone: '805-555-1234', email: 'a@b.org' },
      parentOne: { englishFirstName: 'Wei', englishLastName: 'Chen', chineseName: '陳偉', gender: 'F' },
      username: 'wchen',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    })
  })

  it('shows the email-already-registered message on 409', async () => {
    server.use(csrf, http.post('/api/v1/auth/register', () => problem(409, 'EMAIL_ALREADY_REGISTERED')))
    renderApp('/register')
    const user = userEvent.setup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText(/This email is already registered/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forgot username' })).toHaveAttribute('href', '/forgot-username')
  })

  it('maps USERNAME_TAKEN onto the username field and 422 details onto form fields', async () => {
    let first = true
    server.use(
      csrf,
      http.post('/api/v1/auth/register', () => {
        if (first) {
          first = false
          return problem(409, 'USERNAME_TAKEN')
        }
        return problem(422, 'VALIDATION_ERROR', { 'address.zipcode': 'INVALID', 'parentOne.gender': 'REQUIRED' })
      }),
    )
    renderApp('/register')
    const user = userEvent.setup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('That username is already taken. Please choose another.')).toBeInTheDocument()
    // the AntD button is named 'loading Submit' until the failed request settles, so wait for it
    await user.click(await screen.findByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('This value is not valid')).toBeInTheDocument()
    expect(screen.getByLabelText('Zip code')).toHaveAccessibleDescription(/This value is not valid/)
    expect(screen.getByLabelText('Gender')).toBeInTheDocument()
    expect(screen.getAllByText('This field is required').length).toBeGreaterThan(0)
  })

  it('rejects a non-numeric zip code client-side', async () => {
    renderApp('/register')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Zip code'), '12ab')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('Zip code must be 1 to 5 digits')).toBeInTheDocument()
  })
})

describe('change password', () => {
  async function open() {
    server.use(csrf, http.get('/api/v1/me', () => HttpResponse.json(ME)))
    renderApp('/account/password')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Current password'), 'old password value')
    await user.type(screen.getByLabelText('New password'), PASSWORD)
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD)
    return user
  }

  it('has correct autocomplete attributes', async () => {
    server.use(http.get('/api/v1/me', () => HttpResponse.json(ME)))
    renderApp('/account/password')
    expect(await screen.findByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
  })

  it.each([
    ['CURRENT_PASSWORD_INVALID', 'Current password', 'The current password is incorrect'],
    ['PASSWORD_MISMATCH', 'Confirm new password', 'The passwords do not match'],
    ['PASSWORD_TOO_SHORT', 'New password', 'Password must be at least 10 characters'],
  ])('maps %s onto the %s field', async (code, label, text) => {
    server.use(http.post('/api/v1/me/password', () => problem(422, code)))
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(text)
  })

  it('shows the lock message on 429', async () => {
    server.use(
      http.post('/api/v1/me/password', () =>
        problem(429, 'PASSWORD_CHANGE_LOCKED', { retryAfterSeconds: 120 }, { 'Retry-After': '120' }),
      ),
    )
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/wait 2 minute\(s\)/)).toBeInTheDocument()
  })

  it('shows success on 204', async () => {
    server.use(http.post('/api/v1/me/password', () => new HttpResponse(null, { status: 204 })))
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Your password has been changed.')).toBeInTheDocument()
  })
})
