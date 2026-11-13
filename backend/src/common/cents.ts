export type Cents = number & { readonly __brand: 'Cents' };

export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Cents must be a safe integer, got ${n}`);
  }
  return n as Cents;
}

const DOLLARS = /^(\d+)(?:\.(\d{1,2}))?$/;

export function dollarsToCents(input: string): Cents {
  const m = DOLLARS.exec(input);
  if (!m) {
    throw new RangeError(`Invalid dollar amount: ${JSON.stringify(input)}`);
  }
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  return cents(whole * 100 + frac);
}

export function formatCents(c: Cents): string {
  const abs = Math.abs(c);
  const body = `$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `-${body}` : body;
}
