import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('shows the school name', () => {
    render(<App />)
    expect(screen.getByText('Thousand Oaks Chinese School')).toBeInTheDocument()
  })
})
