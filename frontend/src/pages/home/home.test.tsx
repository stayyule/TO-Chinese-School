import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, useMeHandler } from '../../test/render'
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
    useMeHandler(['home.panel.student_parent'], ['Student Parent'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Student Parent' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My family' })).toHaveAttribute('href', '/parent/family')
    expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/account/password')
    expect(screen.queryByRole('heading', { name: 'Principal Resources' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Registration Officer Resources' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(1)
  })

  it('shows every panel to a Super User', async () => {
    useMeHandler(PANELS.map((p) => p.permission), ['Super User'])
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Student Parent' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(PANELS.length)
    expect(screen.getByRole('heading', { name: 'Registration Officer Resources' })).toBeInTheDocument()
  })
})
