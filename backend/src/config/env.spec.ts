import { Test } from '@nestjs/testing';
import { MailModule } from '../mail/mail.module';
import { DEFAULT_TRUST_PROXY, loadEnv, loadMailConfig, parseTrustProxy } from './env';

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

describe('placeholder secrets', () => {
  it('rejects a SESSION_SECRET containing example placeholder text', () => {
    for (const secret of ['replace-with-64-hex-characters-xxxxxxxxxxxxxxxxxxxxxxxx', 'CHANGEME'.padEnd(40, 'x')]) {
      expect(() => loadEnv({ ...valid, SESSION_SECRET: secret })).toThrow(/SESSION_SECRET.*placeholder/);
    }
  });

  it('rejects placeholder database passwords (percent-encoded too)', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'postgresql://tocs_app:replace-with-random-hex@db/tocs' })).toThrow(
      /DATABASE_URL.*placeholder/,
    );
    expect(() => loadEnv({ ...valid, DATABASE_MIGRATOR_URL: 'postgresql://m:x%63hangeme@db/tocs' })).toThrow(
      /DATABASE_MIGRATOR_URL.*placeholder/,
    );
  });

  it('refuses the dev example secret (change-me-...) only in production', () => {
    const dev = { ...valid, SESSION_SECRET: 'change-me-to-a-long-random-string' };
    expect(loadEnv(dev).SESSION_SECRET).toBe(dev.SESSION_SECRET);
    expect(() => loadEnv({ ...dev, NODE_ENV: 'production' })).toThrow(/SESSION_SECRET.*placeholder/);
  });

  it('accepts real random values and password-less URLs', () => {
    expect(() =>
      loadEnv({ ...valid, SESSION_SECRET: 'a3f9'.repeat(16), DATABASE_MIGRATOR_URL: 'postgresql://tocs_migrator@db/tocs', NODE_ENV: 'production' }),
    ).not.toThrow();
  });
});

describe('parseTrustProxy / TRUST_PROXY', () => {
  it('defaults to loopback, linklocal, uniquelocal when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('  ')).toBe(DEFAULT_TRUST_PROXY);
    expect(DEFAULT_TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
  });

  it('turns an integer into a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 0 ')).toBe(0);
  });

  it('accepts a list of IPs, CIDR subnets and proxy-addr names', () => {
    expect(parseTrustProxy('172.30.0.0/16,loopback')).toBe('172.30.0.0/16, loopback');
    expect(parseTrustProxy('10.0.0.1, fd00::/8, 10.0.0.0/255.0.0.0')).toBe('10.0.0.1, fd00::/8, 10.0.0.0/255.0.0.0');
  });

  it('rejects true/false and malformed entries', () => {
    for (const bad of ['true', 'false', 'TRUE', '1.2.3', '10.0.0.0/33', 'fd00::/129', 'nope', '10.0.0.0/8/1', '1,']) {
      expect(() => parseTrustProxy(bad)).toThrow(/TRUST_PROXY/);
    }
  });

  it('loadEnv validates TRUST_PROXY and leaves the raw value', () => {
    expect(loadEnv({ ...valid, TRUST_PROXY: '1' }).TRUST_PROXY).toBe('1');
    expect(loadEnv(valid).TRUST_PROXY).toBeUndefined();
    expect(() => loadEnv({ ...valid, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
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
