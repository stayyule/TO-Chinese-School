export type PacificDate = string & { readonly __brand: 'PacificDate' };

const TZ = 'America/Los_Angeles';
const DAY_MS = 86400000;
const FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function utcMidnightMs(s: string): number {
  const m = FORMAT.exec(s);
  if (!m) throw new RangeError(`Invalid PacificDate: ${JSON.stringify(s)}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== s) {
    throw new RangeError(`Invalid PacificDate: ${JSON.stringify(s)}`);
  }
  return ms;
}

export function pacificDate(s: string): PacificDate {
  utcMidnightMs(s);
  return s as PacificDate;
}

export function pacificDateFromUtc(d: Date): PacificDate {
  const parts = dateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}` as PacificDate;
}

/** First UTC instant (ms) whose Pacific date is `d`; binary search within the UTC day. */
function startOfPacificDayMs(d: PacificDate): number {
  // Pacific is UTC-7/-8, so the local day always starts within [UTC midnight, +24h).
  let lo = utcMidnightMs(d);
  let hi = lo + DAY_MS;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDateFromUtc(new Date(mid)) < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function pacificDayToUtcRange(d: PacificDate): { start: Date; end: Date } {
  return {
    start: new Date(startOfPacificDayMs(d)),
    end: new Date(startOfPacificDayMs(addDays(d, 1))),
  };
}

export function addDays(d: PacificDate, n: number): PacificDate {
  if (!Number.isInteger(n)) throw new RangeError('n must be an integer');
  return new Date(utcMidnightMs(d) + n * DAY_MS).toISOString().slice(0, 10) as PacificDate;
}

export function comparePacific(a: PacificDate, b: PacificDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function fromDbDate(d: Date): PacificDate {
  return d.toISOString().slice(0, 10) as PacificDate;
}

export function toDbDate(p: PacificDate): Date {
  return new Date(utcMidnightMs(p));
}
