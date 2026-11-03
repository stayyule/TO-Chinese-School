import { FixedClock } from '../src/common/clock';
import { pacificDate } from '../src/common/pacific-date';
import { PrismaService } from '../src/prisma/prisma.service';
import { SchoolYearLookup } from '../src/school-year/school-year.lookup';
import { resetDatabase } from './helpers/db';

// Noon Pacific (PDT/PST both fall within these UTC hours) on the given calendar day.
const noonPacific = (ymd: string): Date => new Date(`${ymd}T20:00:00Z`);

describe('SchoolYearLookup', () => {
  const prisma = new PrismaService();
  const clock = new FixedClock(noonPacific('2026-06-15'));
  const lookup = new SchoolYearLookup(prisma, clock);
  const at = (ymd: string): void => clock.set(noonPacific(ymd));

  const d = (s: string): Date => new Date(`${s}T00:00:00Z`);
  const year = (name: string, start: string, end: string, extra: Record<string, Date | null> = {}) =>
    prisma.schoolYear.create({
      data: { name, startDate: d(start), endDate: d(end), ...extra },
    });

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase();
    await year('A', '2025-09-01', '2026-06-15', {
      earlyRegistrationStartDate: d('2025-04-01'),
      registrationEndDate: d('2025-09-30'),
      refundEndDate: d('2025-12-01'),
    });
    await year('B', '2026-09-01', '2027-06-15', {
      earlyRegistrationStartDate: d('2026-04-01'),
      registrationEndDate: d('2026-09-30'),
      refundEndDate: d('2026-12-01'),
    });
    await year('C', '2027-09-01', '2028-06-15');
  });

  const names = (rows: { name: string | null }[]): (string | null)[] => rows.map((r) => r.name);

  it('current() is A on its end date (inclusive) and B the day after', async () => {
    at('2026-06-15');
    expect((await lookup.current())?.name).toBe('A');
    at('2026-06-16');
    expect((await lookup.current())?.name).toBe('B');
  });

  it('next() is the year after current()', async () => {
    at('2026-06-15');
    expect((await lookup.next())?.name).toBe('B');
    at('2026-06-16');
    expect((await lookup.next())?.name).toBe('C');
    at('2027-09-01');
    expect((await lookup.next())?.name).toBeUndefined();
  });

  it('newest() is the latest-ending year not yet ended', async () => {
    at('2026-06-15');
    expect((await lookup.newest())?.name).toBe('C');
  });

  it('currentAndFuture() is ordered by start date', async () => {
    at('2026-06-16');
    expect(names(await lookup.currentAndFuture())).toEqual(['B', 'C']);
  });

  it('returns null / [] once every year has ended', async () => {
    at('2028-06-16');
    expect(await lookup.current()).toBeNull();
    expect(await lookup.next()).toBeNull();
    expect(await lookup.newest()).toBeNull();
    expect(await lookup.currentAndFuture()).toEqual([]);
  });

  it('activeForRegistration() is early_registration_start <= today <= registration_end', async () => {
    at('2026-03-31');
    expect(names(await lookup.activeForRegistration())).toEqual([]);
    at('2026-04-01');
    expect(names(await lookup.activeForRegistration())).toEqual(['B']);
    at('2026-09-30');
    expect(names(await lookup.activeForRegistration())).toEqual(['B']);
    at('2026-10-01');
    expect(names(await lookup.activeForRegistration())).toEqual([]);
  });

  it('activeForRefund() is refund_end >= today (null refund_end never qualifies)', async () => {
    at('2026-12-01');
    expect(names(await lookup.activeForRefund())).toEqual(['B']);
    at('2026-12-02');
    expect(names(await lookup.activeForRefund())).toEqual([]);
  });

  it('maps dates to PacificDate and money to Cents', async () => {
    at('2026-06-15');
    const a = (await lookup.currentAndFuture())[0];
    expect(a.startDate).toBe(pacificDate('2025-09-01'));
    expect(a.endDate).toBe(pacificDate('2026-06-15'));
    expect(a.refund90PercentDate).toBeNull();
    expect(a.tuitionInCents).toBe(38000);
    expect(a.registrationFeeInCents).toBe(2000);
  });

  it('hasStarted() is today >= start_date', async () => {
    at('2026-06-15');
    const rows = await lookup.currentAndFuture();
    const [a, b] = rows;
    expect(lookup.hasStarted(a)).toBe(true);
    expect(lookup.hasStarted(b)).toBe(false);
    at('2026-09-01');
    expect(lookup.hasStarted(b)).toBe(true);
    at('2026-08-31');
    expect(lookup.hasStarted(b)).toBe(false);
  });
});
