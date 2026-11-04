import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/server'
import { csrf, problem, renderApp, mockMe } from '../../test/render'

const PERMS = [
  'home.panel.student_parent',
  'family.self.address.edit',
  'family.self.parent.add',
  'family.self.child.add',
  'person.self.edit',
]

const address = { id: 3, street: '1 Oak St', city: 'Thousand Oaks', state: 'CA', zipcode: '91360', homePhone: '(805) 555-1234', cellPhone: null, email: 'a@b.org' }
const parentOne = { id: 7, englishFirstName: 'Alice', englishLastName: 'Chen', chineseName: '陈爱丽', gender: 'F', birthYear: null, birthMonth: null, nativeLanguage: 'Mandarin' }
const child = { id: 8, englishFirstName: 'Ming', englishLastName: 'Chen', chineseName: '陈小明', gender: 'M', birthYear: 2015, birthMonth: 4, nativeLanguage: null }
const family = { id: 5, parentOne, parentTwo: null, children: [child], address }

const families = () => http.get('/api/v1/me/families', () => HttpResponse.json([family]))

describe('my family page', () => {
  it('lists parents, children and address; Chinese names render unchanged', async () => {
    mockMe(PERMS)
    server.use(families())
    renderApp('/parent/family')
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
    expect(screen.getByText('陈爱丽')).toBeInTheDocument()
    expect(screen.getByText(/\(805\) 555-1234/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add child' })).toHaveAttribute('href', '/parent/families/5/children/new')
    expect(screen.getByRole('link', { name: 'Add second parent' })).toHaveAttribute('href', '/parent/families/5/parents/new')
    expect(screen.getByRole('link', { name: 'Edit address' })).toHaveAttribute('href', '/parent/families/5/address')
  })

  it('hides action links the user lacks the permission for', async () => {
    mockMe(['home.panel.student_parent'])
    server.use(families())
    renderApp('/parent/family')
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Add child' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Add second parent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit address' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('shows an error state with retry when loading fails', async () => {
    mockMe(PERMS)
    server.use(http.get('/api/v1/me/families', () => problem(500, 'INTERNAL')))
    renderApp('/parent/family')
    expect(await screen.findByText('Could not load your family. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('add child', () => {
  it('without birth month shows the field error and does not call the API', async () => {
    mockMe(PERMS)
    let posts = 0
    server.use(
      families(),
      csrf,
      http.post('/api/v1/me/families/5/children', () => {
        posts += 1
        return HttpResponse.json(child, { status: 201 })
      }),
    )
    renderApp('/parent/families/5/children/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('English first name'), 'Ming')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.type(screen.getByLabelText('Birth year'), '2015')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(posts).toBe(0)
  })

  it('sends numbers and Chinese as typed, then returns to the family page with a notice', async () => {
    mockMe(PERMS)
    let body: unknown
    server.use(
      families(),
      csrf,
      http.post('/api/v1/me/families/5/children', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(child, { status: 201 })
      }),
    )
    const router = renderApp('/parent/families/5/children/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('English first name'), 'Ming')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.type(screen.getByLabelText('Chinese name'), '陈小明')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.type(screen.getByLabelText('Birth year'), '2015')
    await user.type(screen.getByLabelText('Birth month'), '4')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/family'))
    expect(body).toMatchObject({ englishFirstName: 'Ming', englishLastName: 'Chen', chineseName: '陈小明', gender: 'M', birthYear: 2015, birthMonth: 4 })
    expect(await screen.findByText('Your changes have been saved.')).toBeInTheDocument()
  })

  it('maps server 422 details onto fields', async () => {
    mockMe(PERMS)
    server.use(
      families(),
      csrf,
      http.post('/api/v1/me/families/5/children', () => problem(422, 'VALIDATION_ERROR', { birthYear: 'OUT_OF_RANGE' })),
    )
    renderApp('/parent/families/5/children/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('English first name'), 'Ming')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.type(screen.getByLabelText('Birth year'), '2015')
    await user.type(screen.getByLabelText('Birth month'), '4')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This value is out of range')).toBeInTheDocument()
  })
})

describe('not found handling', () => {
  it('shows Not found when the API answers 404 for the family', async () => {
    mockMe(PERMS)
    server.use(
      families(),
      csrf,
      http.patch('/api/v1/me/families/5/address', () => problem(404, 'NOT_FOUND')),
    )
    renderApp('/parent/families/5/address')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('shows Not found without any request for a non-numeric id', async () => {
    mockMe(PERMS)
    let calls = 0
    server.use(
      http.get('/api/v1/me/families', () => {
        calls += 1
        return HttpResponse.json([family])
      }),
    )
    renderApp('/parent/families/abc/address')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    renderApp('/parent/people/abc/edit')
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toBe(0)
  })

  it('shows Not found for a family that is not in the user list', async () => {
    mockMe(PERMS)
    server.use(families())
    renderApp('/parent/families/99/children/new')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })
})

describe('add parent and edit person', () => {
  it('reports PARENT_TWO_EXISTS', async () => {
    mockMe(PERMS)
    server.use(
      families(),
      csrf,
      http.post('/api/v1/me/families/5/parents', () => problem(409, 'PARENT_TWO_EXISTS')),
    )
    renderApp('/parent/families/5/parents/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('English first name'), 'Bob')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This family already has a second parent.')).toBeInTheDocument()
  })

  it('prefills the person and PATCHes the edit', async () => {
    mockMe(PERMS)
    let body: unknown
    server.use(
      families(),
      csrf,
      http.patch('/api/v1/me/people/8', async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const router = renderApp('/parent/people/8/edit')
    const user = userEvent.setup()
    expect(await screen.findByDisplayValue('陈小明')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('English first name'))
    await user.type(screen.getByLabelText('English first name'), 'Ming Ming')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/family'))
    expect(body).toMatchObject({ englishFirstName: 'Ming Ming', chineseName: '陈小明', birthYear: 2015, birthMonth: 4 })
  })

  it('edits the address with a zipcode maximum of 5 digits and prefilled phone', async () => {
    mockMe(PERMS)
    server.use(families())
    renderApp('/parent/families/5/address')
    expect(await screen.findByDisplayValue('(805) 555-1234')).toBeInTheDocument()
    expect(screen.getByLabelText('Zip code')).toHaveAttribute('maxlength', '5')
  })

  it('blocks a 9-digit home phone and accepts a 10-digit one', async () => {
    mockMe(PERMS)
    let patches = 0
    server.use(
      families(),
      csrf,
      http.patch('/api/v1/me/families/5/address', () => {
        patches += 1
        return HttpResponse.json(address)
      }),
    )
    const router = renderApp('/parent/families/5/address')
    const user = userEvent.setup()
    const phone = await screen.findByLabelText('Home phone')
    await user.clear(phone)
    await user.type(phone, '(805) 555-123')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Home phone must have 10 digits')).toBeInTheDocument()
    expect(patches).toBe(0)
    await user.clear(phone)
    await user.type(phone, '(805) 555-1234')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/parent/family'))
    expect(patches).toBe(1)
  })
})
