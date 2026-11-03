import { z } from 'zod';

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_BASE_URL: z.string().url().default('https://register.to-cs.org'),
  SMTP_URL: z.string().optional(),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** SMTP_URL is required only when MAIL_TRANSPORT=smtp (the default). */
const requireSmtpUrl = (v: { MAIL_TRANSPORT: string; SMTP_URL?: string }, ctx: z.RefinementCtx): void => {
  if (v.MAIL_TRANSPORT === 'smtp' && !v.SMTP_URL?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required when MAIL_TRANSPORT=smtp' });
  }
};

const schema = baseSchema.superRefine(requireSmtpUrl);

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
