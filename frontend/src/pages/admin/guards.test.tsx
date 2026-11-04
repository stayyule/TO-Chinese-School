import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { menuItems } from '../../layout/menu'
import { mockMe, renderApp } from '../../test/render'
import { server } from '../../test/server'

const RO = ['school_years.read', 'school_classes.read', 'people.read', 'families.read', 'families.create']

const adminKeys = (perms: string[]): string[] => {
  const admin = menuItems((code) => perms.includes(code)).find((i) => i?.key === '/admin')
  return admin && 'children' in admin && admin.children ? admin.children.map((c) => String(c?.key)) : []
}

describe('menu', () => {
  it('hides Roles and Invitations from a Registration Officer but shows school years and classes', () => {
    expect(adminKeys(RO)).toEqual(['/admin/school-years', '/admin/school-classes'])
  })

  it('shows Roles and Invitations to a Super User', () => {
    expect(adminKeys([...RO, 'access.roles.read', 'auth.invitations.create'])).toEqual([
      '/admin/school-years',
      '/admin/school-classes',
      '/admin/roles',
      '/admin/invitations',
    ])
  })

  it('has no Administration entry without any admin permission, and links Registration to the people search', () => {
    expect(menuItems((c) => c === 'people.read').map((i) => String(i?.key))).toEqual(['/', '/registration/people'])
  })

  it('renders the Administration entry for a Registration Officer in the layout', async () => {
    mockMe(RO)
    renderApp('/')
    expect(await screen.findByText('Administration')).toBeInTheDocument()
    expect(screen.getByText('Registration')).toBeInTheDocument()
  })
})

describe('route guards', () => {
  it('shows Forbidden and makes no data request without the route permission', async () => {
    mockMe(RO)
    let calls = 0
    const count = () => {
      calls += 1
      return HttpResponse.json([])
    }
    server.use(http.get('/api/v1/roles', count), http.get('/api/v1/roles/1', count), http.get('/api/v1/school-years/3', count))
    for (const [i, path] of ['/admin/roles', '/admin/roles/1', '/admin/invitations', '/admin/school-years/3/edit'].entries()) {
      renderApp(path)
      await waitFor(() => expect(screen.getAllByText("You don't have access to this page")).toHaveLength(i + 1))
    }
    await new Promise((r) => setTimeout(r, 100))
    expect(calls).toBe(0)
  })
})
