import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('shows the school name on the sign-in page', async () => {
    window.history.pushState({}, '', '/signin')
    render(<App />)
    expect(await screen.findByText('Thousand Oaks Chinese School')).toBeInTheDocument()
  })
})
