/** Largest value of the database int4 column the amounts are stored in. */
const INT4_MAX = 2_147_483_647

const DOLLARS = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Dollars typed by a person to integer cents, or null. Same grammar as the backend `dollarsToCents`
 * (`^\d+(\.\d{1,2})?$`, nothing else) and the result must fit the int4 column. Integer arithmetic on the digit
 * groups only; no decimal string ever goes through a float.
 */
export function parseDollarsToCents(input: string): number | null {
  const m = DOLLARS.exec(input)
  if (!m) return null
  const whole = (m[1] ?? '').replace(/^0+(?=\d)/, '')
  if (whole.length > 10) return null // far beyond int4 already; keeps the integer conversion exact
  const cents = Number(whole) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= INT4_MAX ? cents : null
}

function parts(cents: number): { sign: string; dollars: string; rest: string } {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Amount must be a whole number of cents: ${String(cents)}`)
  const abs = BigInt(Math.abs(cents))
  return { sign: cents < 0 ? '-' : '', dollars: String(abs / 100n), rest: String(abs % 100n).padStart(2, '0') }
}

/** Integer cents as dollars for display: 1999 -> "$19.99", -250 -> "-$2.50". Throws RangeError for a non-integer. */
export function formatCents(cents: number): string {
  const p = parts(cents)
  return `${p.sign}$${p.dollars}.${p.rest}`
}

/** Integer cents as the plain dollar string shown in inputs: 38000 -> "380.00". */
export function centsToDollars(cents: number): string {
  const p = parts(cents)
  return `${p.sign}${p.dollars}.${p.rest}`
}

/** Dollars as typed into a form (surrounding spaces ignored) to cents, or null. */
export const parseMoneyInput = (input: string): number | null => parseDollarsToCents(input.trim())
