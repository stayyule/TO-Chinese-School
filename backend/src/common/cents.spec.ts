import { cents, dollarsToCents, formatCents } from './cents';

describe('cents', () => {
  it('parses dollar strings to integer cents', () => {
    expect(dollarsToCents('19.99')).toBe(1999);
    expect(dollarsToCents('0.5')).toBe(50);
    expect(dollarsToCents('20')).toBe(2000);
  });

  it.each(['19.999', '-1', '1e3', '', 'abc'])('rejects %p', (s) => {
    expect(() => dollarsToCents(s)).toThrow(RangeError);
  });

  it('rejects non-integer cents', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(cents(150)).toBe(150);
  });

  it('formats cents as dollars', () => {
    expect(formatCents(cents(1999))).toBe('$19.99');
    expect(formatCents(cents(5))).toBe('$0.05');
    expect(formatCents(cents(-250))).toBe('-$2.50');
  });
});
