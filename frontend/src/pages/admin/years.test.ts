import { describe, expect, it } from 'vitest'
import { currentAndNextYear, isFrozenDate, type YearDates } from './years'

const y = (id: number, endDate: string | null): YearDates => ({ id, endDate })

describe('currentAndNextYear', () => {
  const years = [y(1, '2020-06-30'), y(2, '2026-06-30'), y(3, '2027-06-30'), y(4, '2028-06-30')]

  it('picks the first year ending on or after today and the one after it', () => {
    expect(currentAndNextYear(years, '2026-03-01')).toEqual({ current: years[1], next: years[2] })
  })

  it('treats a year ending today as current', () => {
    expect(currentAndNextYear(years, '2026-06-30').current?.id).toBe(2)
    expect(currentAndNextYear(years, '2026-07-01').current?.id).toBe(3)
  })

  it('has no next year after the last one', () => {
    expect(currentAndNextYear(years, '2028-01-01')).toEqual({ current: years[3], next: null })
  })

  it('has neither when every year has ended or there are none', () => {
    expect(currentAndNextYear(years, '2030-01-01')).toEqual({ current: null, next: null })
    expect(currentAndNextYear([], '2026-01-01')).toEqual({ current: null, next: null })
  })

  it('ignores years without an end date', () => {
    expect(currentAndNextYear([y(1, null), y(2, '2027-06-30')], '2026-01-01').current?.id).toBe(2)
  })
})

describe('isFrozenDate', () => {
  it('freezes a stored date before today only', () => {
    expect(isFrozenDate('2020-01-01', '2026-03-01')).toBe(true)
    expect(isFrozenDate('2026-03-01', '2026-03-01')).toBe(false)
    expect(isFrozenDate('2026-03-02', '2026-03-01')).toBe(false)
    expect(isFrozenDate(null, '2026-03-01')).toBe(false)
    expect(isFrozenDate('', '2026-03-01')).toBe(false)
  })
})
