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
});
