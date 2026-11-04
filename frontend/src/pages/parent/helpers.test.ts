import { describe, expect, it } from 'vitest'
import { digitCount } from './helpers'

// Regression: the regex once lost its backslash (/D/g strips the letter D, not non-digits), so every formatted
// phone number failed the 10-digit rule. The parent address and public registration forms share this helper.
describe('digitCount', () => {
  it('counts only the digits of a formatted phone number', () => {
    expect(digitCount('(805) 555-1234')).toBe(10)
    expect(digitCount('805.555.1234')).toBe(10)
    expect(digitCount('+1 805 555 1234')).toBe(11)
  })

  it('counts 9 for a 9-digit value and 0 for no digits', () => {
    expect(digitCount('(805) 555-123')).toBe(9)
    expect(digitCount('DDD')).toBe(0)
    expect(digitCount('')).toBe(0)
  })
})
