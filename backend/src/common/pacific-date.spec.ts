import {
  addDays,
  comparePacific,
  fromDbDate,
  pacificDate,
  pacificDateFromUtc,
  pacificDayToUtcRange,
  toDbDate,
} from './pacific-date';

const hours = (r: { start: Date; end: Date }) =>
  (r.end.getTime() - r.start.getTime()) / 3600000;

describe('pacific-date', () => {
  it('converts UTC instants in summer and winter', () => {
    expect(pacificDateFromUtc(new Date('2026-07-01T06:59:59Z'))).toBe('2026-06-30');
    expect(pacificDateFromUtc(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01');
    expect(pacificDateFromUtc(new Date('2026-01-01T07:59:59Z'))).toBe('2025-12-31');
    expect(pacificDateFromUtc(new Date('2026-01-01T08:00:00Z'))).toBe('2026-01-01');
  });

  it('computes DST-aware day ranges', () => {
    const spring = pacificDayToUtcRange(pacificDate('2026-03-08'));
    expect(spring.start.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(spring.end.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(hours(spring)).toBe(23);
    const fall = pacificDayToUtcRange(pacificDate('2026-11-01'));
    expect(fall.start.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(fall.end.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(hours(fall)).toBe(25);
    expect(hours(pacificDayToUtcRange(pacificDate('2026-05-10')))).toBe(24);
  });

  it('validates dates', () => {
    expect(() => pacificDate('2026-02-30')).toThrow(RangeError);
    expect(() => pacificDate('2026-2-3')).toThrow(RangeError);
    expect(pacificDate('2024-02-29')).toBe('2024-02-29');
  });

  it('adds days and compares', () => {
    expect(addDays(pacificDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(pacificDate('2026-03-01'), -1)).toBe('2026-02-28');
    expect(comparePacific(pacificDate('2026-01-01'), pacificDate('2026-01-02'))).toBeLessThan(0);
    expect(comparePacific(pacificDate('2026-01-02'), pacificDate('2026-01-02'))).toBe(0);
    expect(comparePacific(pacificDate('2026-01-03'), pacificDate('2026-01-02'))).toBeGreaterThan(0);
  });

  it('round-trips DB dates at UTC midnight', () => {
    expect(fromDbDate(new Date('2026-05-01T00:00:00Z'))).toBe('2026-05-01');
    expect(toDbDate(pacificDate('2026-05-01')).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
