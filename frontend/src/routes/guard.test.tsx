import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp, useMeHandler } from '../test/render'

describe('per-route permission guard', () => {
  it('shows the Forbidden page, not the page content, without the permission', async () => {
    useMeHandler(['home.panel.student_parent'])
    renderApp('/parent/families/5/children/new')
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument()
    expect(screen.queryByLabelText('Birth month')).not.toBeInTheDocument()
  })
})
