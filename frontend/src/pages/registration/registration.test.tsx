import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { csrf, mockMe, problem, renderApp } from '../../test/render'
import { server } from '../../test/server'

const ALL = [
  'people.read',
  'people.edit',
  'people.address.create',
  'people.address.edit',
  'families.read',
  'families.create',
  'families.address.edit',
  'families.parent.add',
  'families.child.add',
]

const address = { id: 3, street: '1 Oak St', city: 'Thousand Oaks', state: 'CA', zipcode: '91360', homePhone: '(805) 555-1234', cellPhone: null, email: 'a@b.org' }
const parentOne = { id: 7, englishFirstName: 'Alice', englishLastName: 'Chen', chineseName: '陈爱丽', gender: 'F', birthYear: null, birthMonth: null, nativeLanguage: 'Mandarin' }
const child = { id: 8, englishFirstName: 'Ming', englishLastName: 'Chen', chineseName: '陈小明', gender: 'M', birthYear: 2015, birthMonth: 4, nativeLanguage: null }
const family = { id: 5, parentOne, parentTwo: null, children: [child], address }

interface Hit {
  query: string | null
  page: string | null
  pageSize: string | null
}

function peopleHandler(hits: Hit[], total = 1) {
  return http.get('/api/v1/people', ({ request }) => {
    const u = new URL(request.url)
    hits.push({ query: u.searchParams.get('query'), page: u.searchParams.get('page'), pageSize: u.searchParams.get('pageSize') })
    return HttpResponse.json({ items: [child], total })
  })
}

describe('people search', () => {
  it('lists people with English name, Chinese name and a link to the person page', async () => {
    mockMe(ALL)
    server.use(peopleHandler([]))
    renderApp('/registration/people')
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
    expect(screen.getByText('Ming Chen')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ming Chen' })).toHaveAttribute('href', '/registration/people/8')
  })

  it('issues a single request, 300 ms after typing stops', async () => {
    mockMe(ALL)
    const hits: Hit[] = []
    server.use(peopleHandler(hits))
    renderApp('/registration/people')
    await screen.findByText('陈小明')
    expect(hits).toHaveLength(1)
    const user = userEvent.setup()
    const started = Date.now()
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'chen')
    expect(hits).toHaveLength(1)
    await waitFor(() => expect(hits).toHaveLength(2))
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect(hits[1]).toEqual({ query: 'chen', page: '1', pageSize: '25' })
    await new Promise((r) => setTimeout(r, 400))
    expect(hits).toHaveLength(2)
  })

  it('searches with a Chinese query', async () => {
    mockMe(ALL)
    const hits: Hit[] = []
    server.use(peopleHandler(hits))
    renderApp('/registration/people')
    await screen.findByText('陈小明')
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), '陈')
    await waitFor(() => expect(hits.at(-1)?.query).toBe('陈'))
  })

  it('pages on the server', async () => {
    mockMe(ALL)
    const hits: Hit[] = []
    server.use(peopleHandler(hits, 60))
    renderApp('/registration/people')
    await screen.findByText('陈小明')
    const user = userEvent.setup()
    await user.click(screen.getByTitle('2'))
    await waitFor(() => expect(hits.at(-1)).toEqual({ query: null, page: '2', pageSize: '25' }))
  })

  it('shows an error state with retry when the search fails', async () => {
    mockMe(ALL)
    server.use(http.get('/api/v1/people', () => problem(500, 'INTERNAL')))
    renderApp('/registration/people')
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

const detail = { ...parentOne, address, families: [family] }

describe('person page', () => {
  it('shows the person, address and families; Chinese names render unchanged', async () => {
    mockMe(ALL)
    server.use(http.get('/api/v1/people/7', () => HttpResponse.json(detail)))
    renderApp('/registration/people/7')
    expect(await screen.findByText('陈爱丽')).toBeInTheDocument()
    expect(screen.getByText('1 Oak St')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Family 5' })).toHaveAttribute('href', '/registration/families/5')
  })

  it('shows Not found when the API answers 404, and for a non-numeric id without a request', async () => {
    mockMe(ALL)
    let calls = 0
    server.use(
      http.get('/api/v1/people/99', () => problem(404, 'NOT_FOUND')),
      http.get('/api/v1/people/abc', () => {
        calls += 1
        return HttpResponse.json(detail)
      }),
    )
    renderApp('/registration/people/99')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    renderApp('/registration/people/abc')
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0)
    expect(calls).toBe(0)
  })

  it('hides edit controls without the permissions', async () => {
    mockMe(['people.read'])
    server.use(http.get('/api/v1/people/7', () => HttpResponse.json(detail)))
    renderApp('/registration/people/7')
    expect(await screen.findByText('陈爱丽')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit person' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit address' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Family 5' })).not.toBeInTheDocument()
  })

  it('PATCHes the person edit (Chinese preserved) and prevents a double submit', async () => {
    mockMe(ALL)
    const bodies: unknown[] = []
    server.use(
      http.get('/api/v1/people/7', () => HttpResponse.json(detail)),
      csrf,
      http.patch('/api/v1/people/7', async ({ request }) => {
        bodies.push(await request.json())
        await new Promise((r) => setTimeout(r, 100))
        return HttpResponse.json(parentOne)
      }),
    )
    renderApp('/registration/people/7')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit person' }))
    const first = screen.getByLabelText('English first name')
    await user.clear(first)
    await user.type(first, 'Alicia')
    await user.dblClick(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByLabelText('English first name')).not.toBeInTheDocument())
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ englishFirstName: 'Alicia', chineseName: '陈爱丽', gender: 'F' })
  })

  it('creates an address for a person without one using POST', async () => {
    mockMe(ALL)
    let body: unknown
    server.use(
      http.get('/api/v1/people/7', () => HttpResponse.json({ ...detail, address: null })),
      csrf,
      http.post('/api/v1/people/7/address', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(address, { status: 201 })
      }),
    )
    renderApp('/registration/people/7')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add address' }))
    await user.type(screen.getByLabelText('Street'), '1 Oak St')
    await user.type(screen.getByLabelText('City'), 'Thousand Oaks')
    await user.type(screen.getByLabelText('State'), 'CA')
    await user.type(screen.getByLabelText('Zip code'), '91360')
    await user.type(screen.getByLabelText('Home phone'), '(805) 555-1234')
    await user.type(screen.getByLabelText('Email'), 'a@b.org')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toMatchObject({ street: '1 Oak St', zipcode: '91360', homePhone: '(805) 555-1234' }))
  })

  it('PATCHes an existing address and shows 422 details on the field', async () => {
    mockMe(ALL)
    server.use(
      http.get('/api/v1/people/7', () => HttpResponse.json(detail)),
      csrf,
      http.patch('/api/v1/people/7/address', () => problem(422, 'VALIDATION_ERROR', { zipcode: 'INVALID' })),
    )
    renderApp('/registration/people/7')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit address' }))
    expect(screen.getByDisplayValue('(805) 555-1234')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This value is not valid')).toBeInTheDocument()
  })
})

describe('new family', () => {
  it('posts address and parent one, then opens the new family', async () => {
    mockMe(ALL)
    let body: unknown
    server.use(
      csrf,
      http.post('/api/v1/families', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 12 }, { status: 201 })
      }),
      http.get('/api/v1/families/12', () => HttpResponse.json({ ...family, id: 12 })),
    )
    const router = renderApp('/registration/families/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Street'), '1 Oak St')
    await user.type(screen.getByLabelText('City'), 'Thousand Oaks')
    await user.type(screen.getByLabelText('State'), 'CA')
    await user.type(screen.getByLabelText('Zip code'), '91360')
    await user.type(screen.getByLabelText('Home phone'), '(805) 555-1234')
    await user.type(screen.getByLabelText('Email'), 'a@b.org')
    await user.type(screen.getByLabelText('English first name'), 'Alice')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.type(screen.getByLabelText('Chinese name'), '陈爱丽')
    await user.click(screen.getByRole('radio', { name: 'Female' }))
    await user.click(screen.getByRole('button', { name: 'Create family' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/registration/families/12'))
    expect(body).toMatchObject({
      address: { street: '1 Oak St', zipcode: '91360', homePhone: '(805) 555-1234', email: 'a@b.org' },
      parentOne: { englishFirstName: 'Alice', englishLastName: 'Chen', chineseName: '陈爱丽', gender: 'F' },
    })
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
  })

  it('maps nested 422 details onto the address and parent fields', async () => {
    mockMe(ALL)
    server.use(
      csrf,
      http.post('/api/v1/families', () => problem(422, 'VALIDATION_ERROR', { 'address.zipcode': 'INVALID', 'parentOne.englishLastName': 'TOO_LONG' })),
    )
    renderApp('/registration/families/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Street'), '1 Oak St')
    await user.type(screen.getByLabelText('City'), 'Thousand Oaks')
    await user.type(screen.getByLabelText('State'), 'CA')
    await user.type(screen.getByLabelText('Zip code'), '91360')
    await user.type(screen.getByLabelText('Home phone'), '(805) 555-1234')
    await user.type(screen.getByLabelText('Email'), 'a@b.org')
    await user.type(screen.getByLabelText('English first name'), 'Alice')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.click(screen.getByRole('radio', { name: 'Female' }))
    await user.click(screen.getByRole('button', { name: 'Create family' }))
    expect(await screen.findByText('This value is not valid')).toBeInTheDocument()
    expect(screen.getByText('This value is too long')).toBeInTheDocument()
  })

  it('is forbidden without families.create', async () => {
    mockMe(['people.read', 'families.read'])
    renderApp('/registration/families/new')
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
  })
})

describe('family page', () => {
  it('shows parents, children and address with action buttons per permission', async () => {
    mockMe(ALL)
    server.use(http.get('/api/v1/families/5', () => HttpResponse.json(family)))
    renderApp('/registration/families/5')
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
    expect(screen.getByText('陈爱丽')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ming Chen' })).toHaveAttribute('href', '/registration/people/8')
    expect(screen.getByRole('button', { name: 'Add second parent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add child' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit address' })).toBeInTheDocument()
  })

  it('hides action buttons without the permissions', async () => {
    mockMe(['families.read'])
    server.use(http.get('/api/v1/families/5', () => HttpResponse.json(family)))
    renderApp('/registration/families/5')
    expect(await screen.findByText('陈小明')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add child' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add second parent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit address' })).not.toBeInTheDocument()
  })

  it('adds a child with POST and refreshes the family', async () => {
    mockMe(ALL)
    let body: unknown
    let added = false
    server.use(
      http.get('/api/v1/families/5', () =>
        HttpResponse.json(added ? { ...family, children: [child, { ...child, id: 9, englishFirstName: 'Mei', chineseName: '陈小美' }] } : family),
      ),
      csrf,
      http.post('/api/v1/families/5/children', async ({ request }) => {
        body = await request.json()
        added = true
        return HttpResponse.json(child, { status: 201 })
      }),
    )
    renderApp('/registration/families/5')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add child' }))
    await user.type(screen.getByLabelText('English first name'), 'Mei')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.type(screen.getByLabelText('Chinese name'), '陈小美')
    await user.click(screen.getByRole('radio', { name: 'Female' }))
    await user.type(screen.getByLabelText('Birth year'), '2017')
    await user.type(screen.getByLabelText('Birth month'), '6')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('陈小美')).toBeInTheDocument()
    expect(body).toMatchObject({ englishFirstName: 'Mei', chineseName: '陈小美', birthYear: 2017, birthMonth: 6 })
  })

  it('reports PARENT_TWO_EXISTS when adding a second parent', async () => {
    mockMe(ALL)
    server.use(
      http.get('/api/v1/families/5', () => HttpResponse.json(family)),
      csrf,
      http.post('/api/v1/families/5/parents', () => problem(409, 'PARENT_TWO_EXISTS')),
    )
    renderApp('/registration/families/5')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add second parent' }))
    await user.type(screen.getByLabelText('English first name'), 'Bob')
    await user.type(screen.getByLabelText('English last name'), 'Chen')
    await user.click(screen.getByRole('radio', { name: 'Male' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This family already has a second parent.')).toBeInTheDocument()
  })

  it('PATCHes the family address', async () => {
    mockMe(ALL)
    let body: unknown
    server.use(
      http.get('/api/v1/families/5', () => HttpResponse.json(family)),
      csrf,
      http.patch('/api/v1/families/5/address', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(address)
      }),
    )
    renderApp('/registration/families/5')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit address' }))
    const street = screen.getByLabelText('Street')
    await user.clear(street)
    await user.type(street, '2 Elm St')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body).toMatchObject({ street: '2 Elm St', homePhone: '(805) 555-1234' }))
  })

  it('shows Not found for a 404 and for a non-numeric id without a request', async () => {
    mockMe(ALL)
    let calls = 0
    server.use(
      http.get('/api/v1/families/99', () => problem(404, 'NOT_FOUND')),
      http.get('/api/v1/families/abc', () => {
        calls += 1
        return HttpResponse.json(family)
      }),
    )
    renderApp('/registration/families/99')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    renderApp('/registration/families/abc')
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0)
    expect(calls).toBe(0)
  })
})
