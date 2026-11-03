import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_BASE_URL: z.string().url().default('https://register.to-cs.org'),
  SMTP_URL: z.string().min(1),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

const mailSchema = schema.pick({ APP_BASE_URL: true, MAIL_TRANSPORT: true }).extend({ SMTP_URL: z.string().min(1).optional() });

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
