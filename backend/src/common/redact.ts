const SENSITIVE_KEY = /pass(word)?|token|secret|card(number)?|cvv|authorization|cookie/i;
const MASK = '[REDACTED]';

export function redact(value: unknown): unknown {
  return walk(value, new Set());
}

// `ancestors` holds only the current path, so shared (non-circular) objects are fine.
function walk(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value)) return '[Circular]';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => walk(v, ancestors));
    if (value instanceof Error) {
      const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
      if (value.cause !== undefined) out.cause = walk(value.cause, ancestors);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? MASK : walk(v, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}
