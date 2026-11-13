import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { csrf, mockMe, problem, renderApp } from '../../test/render'
import { server } from '../../test/server'

const year = {
  id: 3,
  name: '2099-2100',
  description: null,
  ageCutoffMonth: 9,
  startDate: '2020-09-01',
  endDate: '2099-06-30',
  earlyRegistrationStartDate: '2099-01-01',
  earlyRegistrationEndDate: '2099-02-01',
  registrationStartDate: '2099-02-02',
  registration75PercentDate: '2099-03-01',
  registrationEndDate: '2099-04-01',
  refund90PercentDate: '2099-05-01',
  refund50PercentDate: '2099-05-15',
  refundEndDate: '2099-06-01',
  registrationFee: 2500,
  earlyRegistrationTuition: 35000,
  tuition: 36000,
  electiveClassFee: 5000,
  tuitionDiscountForThreeOrMoreChild: 1000,
  tuitionDiscountForPreK: 500,
  tuitionDiscountForInstructor: 0,
  pvaMembershipDue: 2000,
  cccaMembershipDue: 1500,
  parentAndStudentClassFee: 100,
  earlyRegistrationParentAndStudentClassFee: 90,
  previousSchoolYearId: null,
  autoClassAssignment: false,
}

const YEAR_PERMS = ['school_years.read', 'school_years.create', 'school_years.edit', 'school_years.book_charges.edit']

describe('school year form', () => {
  it('shows money in dollars and sends integer cents on save', async () => {
    mockMe(YEAR_PERMS)
    let body: Record<string, unknown> | undefined
    server.use(
      http.get('/api/v1/school-years/3', () => HttpResponse.json(year)),
      csrf,
      http.patch('/api/v1/school-years/3', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(year)
      }),
    )
    const router = renderApp('/admin/school-years/3/edit')
    const user = userEvent.setup()
    const tuition = await screen.findByLabelText('Tuition')
    expect(tuition).toHaveValue('360.00')
    expect(screen.getByLabelText('Registration fee')).toHaveValue('25.00')
    await user.clear(tuition)
    await user.type(tuition, '380.00')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/school-years'))
    expect(body?.tuition).toBe(38000)
    expect(body?.registrationFee).toBe(2500)
    expect(body?.endDate).toBe('2099-06-30')
    // the frozen (past) start date is not sent
    expect(body).not.toHaveProperty('startDate')
  })

  it('disables date inputs whose stored value is in the past and keeps future dates editable', async () => {
    mockMe(YEAR_PERMS)
    server.use(http.get('/api/v1/school-years/3', () => HttpResponse.json({ ...year, refundEndDate: null })))
    renderApp('/admin/school-years/3/edit')
    expect(await screen.findByLabelText('Start date')).toBeDisabled()
    expect(screen.getByLabelText('End date')).toBeEnabled()
    expect(screen.getByLabelText('Refund end date')).toBeEnabled()
  })

  it('leaves every date editable on the new-year form', async () => {
    mockMe(YEAR_PERMS)
    renderApp('/admin/school-years/new')
    expect(await screen.findByLabelText('Start date')).toBeEnabled()
    expect(screen.getByLabelText('Refund end date')).toBeEnabled()
  })

  it('rejects an invalid dollar amount without calling the API', async () => {
    mockMe(YEAR_PERMS)
    let patches = 0
    server.use(
      http.get('/api/v1/school-years/3', () => HttpResponse.json(year)),
      csrf,
      http.patch('/api/v1/school-years/3', () => {
        patches += 1
        return HttpResponse.json(year)
      }),
    )
    renderApp('/admin/school-years/3/edit')
    const user = userEvent.setup()
    const tuition = await screen.findByLabelText('Tuition')
    await user.clear(tuition)
    await user.type(tuition, '19.999')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter an amount in dollars, for example 19.99')).toBeInTheDocument()
    expect(patches).toBe(0)
  })

  it('shows server 422 details on the fields', async () => {
    mockMe(YEAR_PERMS)
    server.use(
      http.get('/api/v1/school-years/3', () => HttpResponse.json(year)),
      csrf,
      http.patch('/api/v1/school-years/3', () => problem(422, 'VALIDATION_ERROR', { tuition: 'OUT_OF_RANGE', endDate: 'INVALID' })),
    )
    renderApp('/admin/school-years/3/edit')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This value is out of range')).toBeInTheDocument()
    expect(screen.getByText('This value is not valid')).toBeInTheDocument()
  })

  it('creates a year with POST and prevents a double submit', async () => {
    mockMe(YEAR_PERMS)
    let posts = 0
    server.use(
      csrf,
      http.post('/api/v1/school-years', async () => {
        posts += 1
        await new Promise((r) => setTimeout(r, 100))
        return HttpResponse.json(year, { status: 201 })
      }),
    )
    const router = renderApp('/admin/school-years/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Name'), '2099-2100')
    await user.type(screen.getByLabelText('Age cutoff month'), '9')
    for (const label of [
      'Start date',
      'End date',
      'Early registration start date',
      'Early registration end date',
      'Registration start date',
      'Registration 75% date',
      'Registration end date',
      'Refund 90% date',
      'Refund 50% date',
      'Refund end date',
    ]) {
      await user.type(screen.getByLabelText(label), '2099-01-01')
    }
    for (const label of [
      'Registration fee',
      'Early registration tuition',
      'Tuition',
      'Elective class fee',
      'Tuition discount for three or more children',
      'Tuition discount for Pre-K',
      'Tuition discount for instructors',
      'PVA membership due',
      'CCCA membership due',
      'Parent and student class fee',
      'Early registration parent and student class fee',
    ]) {
      await user.type(screen.getByLabelText(label), '10.50')
    }
    const save = screen.getByRole('button', { name: 'Save' })
    await user.dblClick(save)
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/school-years'))
    expect(posts).toBe(1)
  })

  it('shows Not found for a 404 and for a non-numeric id (no request)', async () => {
    mockMe(YEAR_PERMS)
    let calls = 0
    server.use(
      http.get('/api/v1/school-years/99', () => problem(404, 'NOT_FOUND')),
      http.get('/api/v1/school-years/abc', () => {
        calls += 1
        return HttpResponse.json(year)
      }),
    )
    renderApp('/admin/school-years/99/edit')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
    renderApp('/admin/school-years/abc/edit')
    expect((await screen.findAllByText(/not found/i)).length).toBeGreaterThan(0)
    expect(calls).toBe(0)
  })
})

describe('school years list', () => {
  it('lists years with formatted tuition and links gated by permission', async () => {
    mockMe(['school_years.read'])
    server.use(http.get('/api/v1/school-years', () => HttpResponse.json([year])))
    renderApp('/admin/school-years')
    expect(await screen.findByText('2099-2100')).toBeInTheDocument()
    expect(screen.getByText('$360.00')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New school year' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book charges' })).toHaveAttribute('href', '/admin/school-years/3/book-charges')
  })
})

const charges = [
  { id: 1, gradeId: 1, gradeName: 'Pre', bookChargeInCents: 2000 },
  { id: 2, gradeId: 2, gradeName: 'K', bookChargeInCents: 2000 },
]

describe('book charges', () => {
  it('sends a bare array with only the changed rows, in cents', async () => {
    mockMe(['school_years.read', 'school_years.book_charges.edit'])
    let body: unknown
    server.use(
      http.get('/api/v1/school-years/3/book-charges', () => HttpResponse.json(charges)),
      csrf,
      http.put('/api/v1/school-years/3/book-charges', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(charges)
      }),
    )
    renderApp('/admin/school-years/3/book-charges')
    const user = userEvent.setup()
    const k = await screen.findByLabelText('Book charge for K')
    expect(k).toHaveValue('20.00')
    await user.clear(k)
    await user.type(k, '25.50')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Book charges saved.')).toBeInTheDocument()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toEqual([{ id: 2, bookChargeInCents: 2550 }])
  })

  it('does not call the API when nothing changed', async () => {
    mockMe(['school_years.read', 'school_years.book_charges.edit'])
    let puts = 0
    server.use(
      http.get('/api/v1/school-years/3/book-charges', () => HttpResponse.json(charges)),
      csrf,
      http.put('/api/v1/school-years/3/book-charges', () => {
        puts += 1
        return HttpResponse.json(charges)
      }),
    )
    renderApp('/admin/school-years/3/book-charges')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('No changes to save.')).toBeInTheDocument()
    expect(puts).toBe(0)
  })

  it('is read-only without the edit permission', async () => {
    mockMe(['school_years.read'])
    server.use(http.get('/api/v1/school-years/3/book-charges', () => HttpResponse.json(charges)))
    renderApp('/admin/school-years/3/book-charges')
    expect(await screen.findAllByText('$20.00')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('maps INVALID_BOOK_CHARGE and field 422 details', async () => {
    mockMe(['school_years.read', 'school_years.book_charges.edit'])
    let attempt = 0
    server.use(
      http.get('/api/v1/school-years/3/book-charges', () => HttpResponse.json(charges)),
      csrf,
      http.put('/api/v1/school-years/3/book-charges', () => {
        attempt += 1
        return attempt === 1 ? problem(422, 'INVALID_BOOK_CHARGE') : problem(422, 'VALIDATION_ERROR', { 'items.0.bookChargeInCents': 'OUT_OF_RANGE' })
      }),
    )
    renderApp('/admin/school-years/3/book-charges')
    const user = userEvent.setup()
    const k = await screen.findByLabelText('Book charge for K')
    await user.clear(k)
    await user.type(k, '1.00')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A book charge does not belong to this school year. Reload the page and try again.')).toBeInTheDocument()
    // AntD keeps the spinner (aria-label 'loading') in the button for its leave animation, which jsdom never finishes, so the name stays 'loading Save'; match the end
    await user.click(screen.getByRole('button', { name: /Save$/ }))
    expect(await screen.findByText('This value is out of range')).toBeInTheDocument()
  })
})

const yearsForClasses = [
  { ...year, id: 9, name: 'Y-Old', startDate: '2019-09-01', endDate: '2020-06-30' },
  { ...year, id: 10, name: 'Y-Current', endDate: '2099-06-30' },
  { ...year, id: 11, name: 'Y-Next', startDate: '2099-09-01', endDate: '2100-06-30' },
]

const cls = {
  id: 1,
  englishName: 'Grade 1',
  chineseName: '一年级',
  shortName: null,
  description: null,
  location: null,
  schoolClassType: 'S',
  maxSize: 25,
  minAge: null,
  maxAge: null,
  gradeId: null,
  activeCurrent: true,
  activeNext: false,
}

describe('school classes', () => {
  it('toggles the active flag for the clicked year', async () => {
    mockMe(['school_classes.read', 'school_classes.toggle_active', 'school_years.read'])
    let body: unknown
    let calls = 0
    server.use(
      http.get('/api/v1/school-years', () => HttpResponse.json(yearsForClasses)),
      http.get('/api/v1/school-classes', () => HttpResponse.json([cls])),
      csrf,
      http.put('/api/v1/school-classes/1/active', async ({ request }) => {
        calls += 1
        body = await request.json()
        return HttpResponse.json({ schoolClassId: 1, schoolYearId: 11, active: true })
      }),
    )
    renderApp('/admin/school-classes')
    const user = userEvent.setup()
    expect(await screen.findByText('一年级')).toBeInTheDocument()
    const current = await screen.findByRole('switch', { name: 'Grade 1 active in Y-Current' })
    expect(current).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Grade 1 active in Y-Next' }))
    await waitFor(() => expect(calls).toBe(1))
    expect(body).toEqual({ schoolYearId: 11, active: true })
  })

  it('shows read-only flags without the toggle permission and does not request school years', async () => {
    mockMe(['school_classes.read'])
    server.use(http.get('/api/v1/school-classes', () => HttpResponse.json([cls])))
    renderApp('/admin/school-classes')
    expect(await screen.findByText('Grade 1')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('creates a class and maps NAME_TAKEN onto the English name', async () => {
    mockMe(['school_classes.read', 'school_classes.create'])
    server.use(
      csrf,
      http.post('/api/v1/school-classes', () => problem(409, 'NAME_TAKEN')),
    )
    renderApp('/admin/school-classes/new')
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('English name'), 'Grade 1')
    await user.type(screen.getByLabelText('Chinese name'), '一年级')
    await user.click(screen.getByRole('combobox', { name: 'Class type' }))
    await user.click(await screen.findByTitle('ELECTIVE'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A class with that name already exists')).toBeInTheDocument()
  })

  it('edits a class from the list data and PATCHes with Chinese preserved; without grades.read gradeId is not sent', async () => {
    mockMe(['school_classes.read', 'school_classes.edit'])
    let body: Record<string, unknown> | undefined
    server.use(
      http.get('/api/v1/school-classes', () => HttpResponse.json([{ ...cls, gradeId: 4 }])),
      csrf,
      http.patch('/api/v1/school-classes/1', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cls)
      }),
    )
    const router = renderApp('/admin/school-classes/1/edit')
    const user = userEvent.setup()
    expect(await screen.findByDisplayValue('一年级')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('English name'))
    await user.type(screen.getByLabelText('English name'), 'Grade One')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/school-classes'))
    expect(body).toMatchObject({ englishName: 'Grade One', chineseName: '一年级', schoolClassType: 'S', maxSize: 25, minAge: null })
    expect(screen.queryByLabelText('Grade')).not.toBeInTheDocument()
    expect(body).not.toHaveProperty('gradeId') // the hidden field must not clear the stored grade
  })

  it('with grades.read, clearing the grade PATCHes gradeId: null', async () => {
    mockMe(['school_classes.read', 'school_classes.edit', 'grades.read'])
    let body: Record<string, unknown> | undefined
    server.use(
      http.get('/api/v1/school-classes', () => HttpResponse.json([{ ...cls, gradeId: 4 }])),
      http.get('/api/v1/grades', () => HttpResponse.json([{ id: 4, englishName: 'First Grade', chineseName: '一年级', shortName: 'G1' }])),
      csrf,
      http.patch('/api/v1/school-classes/1', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cls)
      }),
    )
    const router = renderApp('/admin/school-classes/1/edit')
    const user = userEvent.setup()
    expect(await screen.findByTitle('First Grade')).toBeInTheDocument()
    const clear = document.querySelector('.ant-select-clear')
    expect(clear).not.toBeNull()
    await user.click(clear as Element)
    await waitFor(() => expect(screen.queryByTitle('First Grade')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/school-classes'))
    expect(body).toMatchObject({ englishName: 'Grade 1', gradeId: null })
  })

  it('shows Not found for an unknown class id', async () => {
    mockMe(['school_classes.read', 'school_classes.edit'])
    server.use(http.get('/api/v1/school-classes', () => HttpResponse.json([cls])))
    renderApp('/admin/school-classes/77/edit')
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })
})

