import { Test } from '@nestjs/testing';
import { MailModule } from '../mail/mail.module';
import { loadEnv, loadMailConfig } from './env';

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

  it('requires SMTP_URL when MAIL_TRANSPORT is smtp (default)', () => {
    const noSmtp = { ...valid, SMTP_URL: undefined };
    expect(() => loadEnv(noSmtp)).toThrow(/SMTP_URL/);
    expect(() => loadEnv({ ...noSmtp, SMTP_URL: '  ' })).toThrow(/SMTP_URL/);
  });

  it('does not require SMTP_URL when MAIL_TRANSPORT is memory', () => {
    const noSmtp = { ...valid, SMTP_URL: undefined };
    expect(loadEnv({ ...noSmtp, MAIL_TRANSPORT: 'memory' }).MAIL_TRANSPORT).toBe('memory');
  });
});

describe('loadMailConfig', () => {
  it('throws naming SMTP_URL for smtp without it', () => {
    expect(() => loadMailConfig({})).toThrow(/SMTP_URL/);
    expect(() => loadMailConfig({ MAIL_TRANSPORT: 'smtp', SMTP_URL: '' })).toThrow(/SMTP_URL/);
  });

  it('accepts memory without SMTP_URL and smtp with it', () => {
    expect(loadMailConfig({ MAIL_TRANSPORT: 'memory' }).transport).toBe('memory');
    expect(loadMailConfig({ SMTP_URL: 'smtp://localhost:1025' }).smtpUrl).toBe('smtp://localhost:1025');
  });
});

describe('MailModule boot', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('fails to boot with smtp and no SMTP_URL', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_URL;
    await expect(Test.createTestingModule({ imports: [MailModule] }).compile()).rejects.toThrow(/SMTP_URL/);
  });

  it('boots with memory and no SMTP_URL', async () => {
    process.env.MAIL_TRANSPORT = 'memory';
    delete process.env.SMTP_URL;
    await expect(Test.createTestingModule({ imports: [MailModule] }).compile()).resolves.toBeDefined();
  });
});
