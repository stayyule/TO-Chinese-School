import { useQuery } from '@tanstack/react-query'
import { apiJson } from '../../api/client'
import type { MessageKey } from '../../i18n'

export const DATE_FIELDS = [
  ['startDate', 'year.startDate'],
  ['endDate', 'year.endDate'],
  ['earlyRegistrationStartDate', 'year.earlyRegistrationStartDate'],
  ['earlyRegistrationEndDate', 'year.earlyRegistrationEndDate'],
  ['registrationStartDate', 'year.registrationStartDate'],
  ['registration75PercentDate', 'year.registration75PercentDate'],
  ['registrationEndDate', 'year.registrationEndDate'],
  ['refund90PercentDate', 'year.refund90PercentDate'],
  ['refund50PercentDate', 'year.refund50PercentDate'],
  ['refundEndDate', 'year.refundEndDate'],
] as const satisfies readonly (readonly [string, MessageKey])[]

export const MONEY_FIELDS = [
  ['registrationFee', 'year.registrationFee'],
  ['earlyRegistrationTuition', 'year.earlyRegistrationTuition'],
  ['tuition', 'year.tuition'],
  ['electiveClassFee', 'year.electiveClassFee'],
  ['tuitionDiscountForThreeOrMoreChild', 'year.tuitionDiscountForThreeOrMoreChild'],
  ['tuitionDiscountForPreK', 'year.tuitionDiscountForPreK'],
  ['tuitionDiscountForInstructor', 'year.tuitionDiscountForInstructor'],
  ['pvaMembershipDue', 'year.pvaMembershipDue'],
  ['cccaMembershipDue', 'year.cccaMembershipDue'],
  ['parentAndStudentClassFee', 'year.parentAndStudentClassFee'],
  ['earlyRegistrationParentAndStudentClassFee', 'year.earlyRegistrationParentAndStudentClassFee'],
] as const satisfies readonly (readonly [string, MessageKey])[]

export type DateField = (typeof DATE_FIELDS)[number][0]
export type MoneyField = (typeof MONEY_FIELDS)[number][0]

/** A school year as the API returns it: money in integer cents, dates as YYYY-MM-DD (or null). */
export type SchoolYear = {
  id: number
  name: string | null
  description: string | null
  ageCutoffMonth: number | null
  previousSchoolYearId: number | null
  autoClassAssignment: boolean
} & Record<DateField, string | null> &
  Record<MoneyField, number>

export const SCHOOL_YEARS_KEY = ['school-years'] as const

export function useSchoolYears(enabled = true) {
  return useQuery({ queryKey: SCHOOL_YEARS_KEY, queryFn: () => apiJson<SchoolYear[]>('/school-years'), enabled })
}

export interface YearDates {
  id: number
  endDate: string | null
}

/**
 * The current year (first year, in list order, whose end date is today or later) and the one after it. Mirrors the
 * API's "current and future" lookup; both are null when no year qualifies. `todayIso` is YYYY-MM-DD.
 */
export function currentAndNextYear<Y extends YearDates>(years: readonly Y[], todayIso: string): { current: Y | null; next: Y | null } {
  const at = years.findIndex((y) => y.endDate !== null && y.endDate >= todayIso)
  if (at < 0) return { current: null, next: null }
  return { current: years[at] ?? null, next: years[at + 1] ?? null }
}

/** A stored date that is before today can no longer be edited (the API ignores changes to it). */
export function isFrozenDate(stored: string | null | undefined, todayIso: string): boolean {
  return !!stored && stored < todayIso
}

/** Today in the school's time zone (Pacific) as YYYY-MM-DD, the day the API compares dates against. */
export function pacificTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
