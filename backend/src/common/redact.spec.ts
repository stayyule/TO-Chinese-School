import { redact } from './redact';

describe('redact', () => {
  it('masks sensitive keys recursively', () => {
    expect(redact({ password: 'x', nested: { cardNumber: '4111', ok: 1 } })).toEqual({
      password: '[REDACTED]',
      nested: { cardNumber: '[REDACTED]', ok: 1 },
    });
  });

  it('handles arrays and primitives', () => {
    expect(redact([{ token: 't' }, 'a', 1, null])).toEqual([{ token: '[REDACTED]' }, 'a', 1, null]);
    expect(redact('s')).toBe('s');
  });

  it('handles cycles', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });

  it('shows [Circular] only for real cycles', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(redact(a)).toEqual({ n: 1, self: '[Circular]' });
    const shared = { v: 1 };
    expect(redact({ x: shared, y: shared })).toEqual({ x: { v: 1 }, y: { v: 1 } });
  });

  it('keeps Error stack and redacted cause', () => {
    const e = new Error('boom', { cause: { token: 'abc', k: 1 } });
    const out = redact({ err: e }) as { err: { stack: string; message: string; cause: unknown } };
    expect(out.err.stack).toContain('Error: boom');
    expect(out.err.cause).toEqual({ token: '[REDACTED]', k: 1 });
  });

  it('serializes Date as ISO and does not mutate input', () => {
    const input = { d: new Date('2026-01-02T03:04:05.000Z'), password: 'p', n: { cardNumber: '4111' } };
    const out = redact(input) as { d: string };
    expect(out.d).toBe('2026-01-02T03:04:05.000Z');
    expect(input.password).toBe('p');
    expect(input.n.cardNumber).toBe('4111');
    expect(input.d).toBeInstanceOf(Date);
  });
});
