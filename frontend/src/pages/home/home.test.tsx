import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, mockMe } from '../../test/render'
import { PANELS } from './panels'

describe('PANELS', () => {
  it('has one panel per home.panel.* code', () => {
    expect(PANELS.map((p) => p.permission).sort()).toEqual(
      [
        'home.panel.principal',
        'home.panel.academic_vice_principal',
        'home.panel.registration_officer',
        'home.panel.accounting_officer',
        'home.panel.activity_officer',
        'home.panel.communication_officer',
        'home.panel.instruction_officer',
        'home.panel.instructor',
        'home.panel.pva',
        'home.panel.student_parent',
      ].sort(),
    )
  })
})

describe('home page', () => {
  it('shows only the Student Parent panel to a Student Parent', async () => {
    mockMe(['home.panel.student_parent'], ['Student Parent'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Student Parent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My family' })).toHaveAttribute('href', '/parent/family')
    expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/account/password')
    expect(screen.queryByRole('heading', { name: 'Principal Resources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Registration Officer Resources' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(1)
  })

  it('shows every panel to a Super User', async () => {
    mockMe(PANELS.map((p) => p.permission), ['Super User'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Student Parent' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(PANELS.length)
    expect(screen.getByRole('heading', { name: 'Registration Officer Resources' })).toBeInTheDocument()
  })

  const ADMIN = ['school_years.read', 'access.roles.read', 'auth.invitations.create', 'people.read', 'families.create', 'school_classes.read']

  it('shows a Principal only the links its grants allow', async () => {
    mockMe(['home.panel.principal'], ['Principal'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Principal Resources' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('No resources are available here yet.')).toBeInTheDocument()
  })

  it('shows a Registration Officer people, new family, school years and classes links', async () => {
    mockMe(['home.panel.registration_officer', 'people.read', 'families.create', 'school_years.read', 'school_classes.read'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Registration Officer Resources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'List all people' })).toHaveAttribute('href', '/registration/people')
    expect(screen.getByRole('link', { name: 'Register a new family' })).toHaveAttribute('href', '/registration/families/new')
    expect(screen.getByRole('link', { name: 'School years' })).toHaveAttribute('href', '/admin/school-years')
    expect(screen.getByRole('link', { name: 'School classes' })).toHaveAttribute('href', '/admin/school-classes')
    expect(screen.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument()
  })

  it('shows every link to a Super User', async () => {
    mockMe([...PANELS.map((p) => p.permission), ...ADMIN], ['Super User'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Principal Resources' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invitations' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(PANELS.reduce((n, p) => n + p.links.length, 0))
  })
})
