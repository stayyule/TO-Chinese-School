import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * Default Express 'trust proxy': Caddy reaches the app over loopback or a private (Docker) network. Production
 * Compose narrows it with TRUST_PROXY=1 (Caddy is the only hop). The app port must never be internet-reachable.
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';
const PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

const isProxyEntry = (entry: string): boolean => {
  if (PROXY_NAMES.has(entry)) return true;
  const [addr, prefix, ...rest] = entry.split('/');
  if (rest.length > 0 || !isIP(addr)) return false;
  if (prefix === undefined) return true;
  if (/^\d{1,3}$/.test(prefix)) return Number(prefix) <= (isIP(addr) === 4 ? 32 : 128);
  return isIP(prefix) === 4 && isIP(addr) === 4; // IPv4 netmask form, e.g. 10.0.0.0/255.0.0.0
};

/**
 * Express 'trust proxy' value from TRUST_PROXY (whose X-Forwarded-For is believed for req.ip: per-IP throttling,
 * audit ip). Empty/unset -> DEFAULT_TRUST_PROXY; a non-negative integer -> hop count (1 = only the nearest proxy,
 * i.e. Caddy); otherwise a comma list of IPs, CIDR subnets or the names loopback/linklocal/uniquelocal.
 * `true` (trust every hop, so any client can spoof its address) and `false` are rejected.
 */
export function parseTrustProxy(raw: string | undefined): number | string {
  const value = raw?.trim();
  if (!value) return DEFAULT_TRUST_PROXY;
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value.split(',').map((e) => e.trim());
  const bad = entries.filter((e) => !isProxyEntry(e));
  if (bad.length > 0) {
    throw new Error(
      `TRUST_PROXY must be a hop count or a comma list of IPs/subnets/loopback/linklocal/uniquelocal (got ${bad.map((b) => JSON.stringify(b)).join(', ')})`,
    );
  }
  return entries.join(', ');
}

/** Placeholder text from example env files: such a value must never be accepted as a real secret. */
const PLACEHOLDER = /replace-with|changeme/i;
/** In production the dev example's `change-me-to-a-long-random-string` is refused as well. */
const PRODUCTION_PLACEHOLDER = /replace-with|changeme|change-me/i;

/** The password part of a connection URL ('' when absent or the URL does not parse). */
const urlPassword = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return '';
  }
};

const rejectPlaceholders = (
  v: { NODE_ENV: string; SESSION_SECRET: string; DATABASE_URL: string; DATABASE_MIGRATOR_URL: string },
  ctx: z.RefinementCtx,
): void => {
  const pattern = v.NODE_ENV === 'production' ? PRODUCTION_PLACEHOLDER : PLACEHOLDER;
  const secrets: [string, string][] = [
    ['SESSION_SECRET', v.SESSION_SECRET],
    ['DATABASE_URL', urlPassword(v.DATABASE_URL)],
    ['DATABASE_MIGRATOR_URL', urlPassword(v.DATABASE_MIGRATOR_URL)],
  ];
  for (const [key, value] of secrets) {
    if (pattern.test(value)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} still contains example placeholder text; generate a real secret` });
    }
  }
};

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_BASE_URL: z.string().url().default('https://register.to-cs.org'),
  SMTP_URL: z.string().optional(),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      try {
        parseTrustProxy(v);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message });
      }
    }),
});

/** SMTP_URL is required only when MAIL_TRANSPORT=smtp (the default). */
const requireSmtpUrl = (v: { MAIL_TRANSPORT: string; SMTP_URL?: string }, ctx: z.RefinementCtx): void => {
  if (v.MAIL_TRANSPORT === 'smtp' && !v.SMTP_URL?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when MAIL_TRANSPORT=smtp' });
  }
};

const schema = baseSchema.superRefine((v, ctx) => {
  requireSmtpUrl(v, ctx);
  rejectPlaceholders(v, ctx);
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }
  return result.data;
}

const mailSchema = baseSchema.pick({ APP_BASE_URL: true, MAIL_TRANSPORT: true, SMTP_URL: true }).superRefine(requireSmtpUrl);

/** Mail-only slice of the environment (does not require DB/session settings). */
export function loadMailConfig(source: Record<string, string | undefined>): {
  appBaseUrl: string;
  transport: 'smtp' | 'memory';
  smtpUrl: string | undefined;
} {
  const result = mailSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid mail configuration: ${problems.join('; ')}`);
  }
  return { appBaseUrl: result.data.APP_BASE_URL, transport: result.data.MAIL_TRANSPORT, smtpUrl: result.data.SMTP_URL };
}
