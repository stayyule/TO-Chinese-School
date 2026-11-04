import { describe, expect, it } from 'vitest'
import { centsToDollars, formatCents, parseDollarsToCents } from './money'

describe('parseDollarsToCents', () => {
  it.each([
    ['19.99', 1999],
    ['20', 2000],
    ['0.5', 50],
    ['0', 0],
    ['0.05', 5],
    ['007.10', 710],
    ['21474836.47', 2147483647],
  ])('parses %p as %p cents', (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected)
  })

  it.each(['19.999', 'abc', '', '-1', '1e3', ' 19.99', '19.99 ', '19.', '.5', '1,000', '$5', '21474836.48', '99999999999999999999', '0x10'])(
    'rejects %p',
    (input) => {
      expect(parseDollarsToCents(input)).toBeNull()
    },
  )
})

describe('formatCents', () => {
  it('formats whole numbers of cents as dollars', () => {
    expect(formatCents(1999)).toBe('$19.99')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(100)).toBe('$1.00')
    expect(formatCents(2147483647)).toBe('$21474836.47')
    expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe('$90071992547409.91')
  })

  it('formats negatives with a leading minus', () => {
    expect(formatCents(-250)).toBe('-$2.50')
  })

  it('throws for a non-integer amount', () => {
    expect(() => formatCents(1.5)).toThrow(RangeError)
    expect(() => formatCents(Number.NaN)).toThrow(RangeError)
  })
})

describe('centsToDollars', () => {
  it('gives the plain dollar string used in inputs', () => {
    expect(centsToDollars(38000)).toBe('380.00')
    expect(centsToDollars(5)).toBe('0.05')
  })

  it('round-trips through parseDollarsToCents', () => {
    for (const c of [0, 1, 99, 100, 1999, 38000, 2147483647]) expect(parseDollarsToCents(centsToDollars(c))).toBe(c)
  })
})
