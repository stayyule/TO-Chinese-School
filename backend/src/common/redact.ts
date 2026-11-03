const SENSITIVE_KEY = /pass(word)?|token|secret|card(number)?|cvv|authorization|cookie/i;
const MASK = '[REDACTED]';

export function redact(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, seen));
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? MASK : walk(v, seen);
  }
  return out;
}
