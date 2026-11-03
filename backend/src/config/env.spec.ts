import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://a@localhost/db',
  DATABASE_MIGRATOR_URL: 'postgres://m@localhost/db',
  SESSION_SECRET: 'x'.repeat(32),
  SMTP_URL: 'smtp://localhost:1025',
};

describe('loadEnv', () => {
  it('throws naming DATABASE_URL when empty', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.APP_BASE_URL).toBe('https://register.to-cs.org');
    expect(env.MAIL_TRANSPORT).toBe('smtp');
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects invalid MAIL_TRANSPORT', () => {
    expect(() => loadEnv({ ...valid, MAIL_TRANSPORT: 'pigeon' })).toThrow(/MAIL_TRANSPORT/);
  });
});
