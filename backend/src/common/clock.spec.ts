import { Clock, FixedClock, SystemClock } from './clock';

describe('clock', () => {
  it('FixedClock reports Pacific today and advances', () => {
    const c = new FixedClock(new Date('2026-07-01T06:59:59Z'));
    expect(c.today()).toBe('2026-06-30');
    c.advanceMs(1000);
    expect(c.today()).toBe('2026-07-01');
    c.set(new Date('2026-01-01T08:00:00Z'));
    expect(c.today()).toBe('2026-01-01');
  });

  it('SystemClock returns the current time', () => {
    const c: Clock = new SystemClock();
    expect(Math.abs(c.now().getTime() - Date.now())).toBeLessThan(5000);
    expect(c.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
