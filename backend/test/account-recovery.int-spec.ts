import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { AccountService } from '../src/auth/account.service';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { SessionService } from '../src/auth/session.service';
import { Clock, FixedClock } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const T0 = new Date('2026-10-01T19:00:00Z');
const HOUR = 3_600_000;
const CSRF = 'csrf-token-for-tests';
const NEW_PASSWORD = 'brand new passphrase';
const LEGACY_PASSWORD = 'oldpass';
const LEGACY_SALT = 'legacysalt';
const LEGACY_HASH = createHash('sha256').update(LEGACY_PASSWORD + LEGACY_SALT).digest('hex');

describe('account recovery: forgot password, reset password, forgot username (app connected as tocs_app)', () => {
  const clock = new FixedClock(T0);
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() }); // superuser: seeding + assertions only
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let mail: MailService;
  let account: AccountService;
  let ipSeq = 0;
  /** Pat: no own address; parent one of famBlank (blank email, lower id) and famMain (family@example.com, (805) 555-1234). */
  let patId: number;
  let patUserId: number;
  /** Ina: own address ina@example.com (cell 805-555-9876); parent two of famMain. */
  let inaId: number;
  let inaUserId: number;
  /** Nomail: own address without an email. */
  let nomailId: number;

  const http = () => request(app.getHttpServer());
  const newIp = (): string => `10.2.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  const post = (url: string, body: object) =>
    http()
      .post(url)
      .set('X-Forwarded-For', newIp())
      .set('Cookie', [`tocs_csrf=${CSRF}`])
      .set('X-CSRF-Token', CSRF)
      .send(body);

  const forgotPassword = (username: unknown) => post('/api/v1/auth/forgot-password', { username });
  const forgotUsername = (email: unknown) => post('/api/v1/auth/forgot-username', { email });
  const reset = (body: Partial<Record<string, unknown>>) =>
    post('/api/v1/auth/reset-password', {
      password: NEW_PASSWORD,
      passwordConfirmation: NEW_PASSWORD,
      phoneNumber: '(805) 555-1234',
      ...body,
    });
  const peek = (token: string) => http().get(`/api/v1/auth/reset-tokens/${token}`).set('X-Forwarded-For', newIp());
  const tokenRow = (personId: number) => admin.authToken.findFirstOrThrow({ where: { personId }, orderBy: { id: 'desc' } });
  const dump = (rows: object[]): string => JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));

  /** Requests a reset through the API and returns the token from the delivered mail. */
  async function resetToken(username = 'pat'): Promise<string> {
    const res = await forgotPassword(username);
    expect(res.status).toBe(202);
    await account.whenIdle();
    const last = mail.outbox[mail.outbox.length - 1];
    const m = /\/reset-password\/([A-Za-z0-9_-]{43})$/m.exec(last?.text ?? '');
    if (!m) throw new Error('no reset link in mail');
    return m[1];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(PrismaService)
      .useValue(appPrisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    mail = app.get(MailService);
    account = app.get(AccountService);
  });

  beforeEach(async () => {
    await resetDatabase();
    clock.set(T0);
    mail.outbox.length = 0;
    await seed(appPrisma);

    const blankAddr = await admin.address.create({ data: { homePhone: '(805) 555-0000', email: '   ' } });
    const famAddr = await admin.address.create({ data: { homePhone: '(805) 555-1234', email: 'family@example.com' } });
    const inaAddr = await admin.address.create({ data: { cellPhone: '805-555-9876', email: 'ina@example.com' } });
    const nomailAddr = await admin.address.create({ data: { homePhone: '(805) 555-4321', email: null } });
    patId = (await admin.person.create({ data: { englishFirstName: 'Pat', englishLastName: 'Parent' } })).id;
    inaId = (await admin.person.create({ data: { englishFirstName: 'Ina', englishLastName: 'Structor', addressId: inaAddr.id } })).id;
    nomailId = (await admin.person.create({ data: { englishFirstName: 'No', englishLastName: 'Mail', addressId: nomailAddr.id } })).id;
    await admin.family.create({ data: { parentOneId: patId, addressId: blankAddr.id } });
    await admin.family.create({ data: { parentOneId: patId, parentTwoId: inaId, addressId: famAddr.id } });

    patUserId = (
      await admin.user.create({ data: { username: 'pat', personId: patId, passwordHash: LEGACY_HASH, passwordSalt: LEGACY_SALT } })
    ).id;
    inaUserId = (await admin.user.create({ data: { username: 'ina', personId: inaId } })).id;
    await admin.user.create({ data: { username: 'nomail', personId: nomailId } });
    await admin.user.create({ data: { username: 'orphan', personId: null } });
  });

  afterEach(async () => {
    await account.whenIdle();
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('POST /auth/forgot-password', () => {
    it('202 {}: mails one reset link to the first family address with a non-blank email (person without own address)', async () => {
      const res = await forgotPassword(' pat ');
      expect(res.status).toBe(202);
      expect(res.body).toEqual({});
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].to).toBe('family@example.com');
      expect(mail.outbox[0].subject).toContain('Password Reset');
      expect(mail.outbox[0].text).toContain('Dear Pat Parent,');
      const token = /\/reset-password\/([A-Za-z0-9_-]{43})$/m.exec(mail.outbox[0].text)?.[1] as string;
      expect(token).toBeDefined();
      const row = await tokenRow(patId);
      expect(row.purpose).toBe('password_reset');
      expect(row.expiresAt.getTime()).toBe(T0.getTime() + 6 * HOUR);
    });

    it("uses the person's own address email when the person has an address", async () => {
      expect((await forgotPassword('ina')).status).toBe(202);
      await account.whenIdle();
      expect(mail.outbox.map((m) => m.to)).toEqual(['ina@example.com']);
    });

    it('D1: unknown username, user without email and user without person all get the identical 202 {} and nothing is sent', async () => {
      const known = await forgotPassword('pat');
      await account.whenIdle();
      mail.outbox.length = 0;
      const tokensBefore = await admin.authToken.count();
      for (const username of ['no-such-user', 'nomail', 'orphan', 'Pat']) {
        const res = await forgotPassword(username);
        expect(res.status).toBe(known.status);
        expect(res.body).toEqual(known.body);
        expect(res.text).toBe(known.text);
      }
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(0);
      expect(await admin.authToken.count()).toBe(tokensBefore);
    });

    it('a mail delivery failure does not change the response', async () => {
      await admin.address.update({ where: { id: (await admin.person.findUniqueOrThrow({ where: { id: inaId } })).addressId as number }, data: { email: 'not an email' } });
      const res = await forgotPassword('ina');
      expect(res.status).toBe(202);
      expect(res.body).toEqual({});
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(0);
    });

    it('422 VALIDATION_ERROR for a blank or non-string username (independent of existence)', async () => {
      for (const username of ['', '   ', 42, undefined]) {
        const res = await forgotPassword(username);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('GET /auth/reset-tokens/:token', () => {
    it('200 {} for a valid token; 404 INVALID_TOKEN for unknown, expired, or invitation tokens', async () => {
      const token = await resetToken();
      const ok = await peek(token);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({});

      const unknown = await peek('A'.repeat(43));
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('INVALID_TOKEN');

      clock.advanceMs(6 * HOUR);
      const expired = await peek(token);
      expect(expired.status).toBe(404);
      expect(expired.body.code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('204: sets password_hash_v2 only, destroys all of the user\'s sessions, consumes the token and audits', async () => {
      const sessions = app.get(SessionService);
      await sessions.create(patUserId, {});
      await sessions.create(patUserId, {});
      await sessions.create(inaUserId, {});
      const token = await resetToken();

      const res = await reset({ token, phoneNumber: '+1 805 555 1234' });
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      const user = await admin.user.findUniqueOrThrow({ where: { id: patUserId } });
      expect(user.passwordHashV2).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).toBe(LEGACY_HASH);
      expect(user.passwordSalt).toBe(LEGACY_SALT);
      expect(await admin.session.count({ where: { userId: patUserId } })).toBe(0);
      expect(await admin.session.count({ where: { userId: inaUserId } })).toBe(1);

      expect((await tokenRow(patId)).usedAt?.getTime()).toBe(T0.getTime());
      expect((await peek(token)).status).toBe(404);
      const again = await reset({ token });
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('INVALID_TOKEN');

      const audits = await admin.auditLog.findMany({ where: { action: 'auth.password_reset' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: patUserId, actorUsername: 'pat', targetType: 'user', targetId: String(patUserId) });
      expect(dump(audits)).not.toContain(token);
      expect(dump(audits)).not.toContain(NEW_PASSWORD);

      // v2 is authoritative: the new password works, the legacy one no longer does.
      expect((await post('/api/v1/auth/login', { username: 'pat', password: NEW_PASSWORD })).status).toBe(200);
      expect((await post('/api/v1/auth/login', { username: 'pat', password: LEGACY_PASSWORD })).status).toBe(401);
    });

    it('404 INVALID_TOKEN for an unknown token is reported before any other check', async () => {
      const res = await reset({ token: 'A'.repeat(43), passwordConfirmation: 'different-password', phoneNumber: '' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('an invitation token is not a reset token', async () => {
      const { token } = await app.get(AuthTokenService).issue('invitation', patId);
      expect((await peek(token)).status).toBe(404);
      const res = await reset({ token });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVALID_TOKEN');
      expect((await tokenRow(patId)).usedAt).toBeNull();
    });

    it('422 PASSWORD_MISMATCH and 422 PASSWORD_TOO_SHORT do not consume the token', async () => {
      const token = await resetToken();
      const mismatch = await reset({ token, passwordConfirmation: `${NEW_PASSWORD}x` });
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('PASSWORD_MISMATCH');
      const short = await reset({ token, password: 'short', passwordConfirmation: 'short' });
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
      expect((await tokenRow(patId)).usedAt).toBeNull();
      expect((await admin.user.findUniqueOrThrow({ where: { id: patUserId } })).passwordHashV2).toBeNull();
      expect((await reset({ token })).status).toBe(204);
    });

    it('422 PHONE_MISMATCH does not consume the token; the right phone then succeeds', async () => {
      const token = await resetToken();
      for (const phoneNumber of ['805-555-1235', '805-555-123', '']) {
        const res = await reset({ token, phoneNumber });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('PHONE_MISMATCH');
      }
      expect((await tokenRow(patId)).usedAt).toBeNull();
      expect((await admin.user.findUniqueOrThrow({ where: { id: patUserId } })).passwordHashV2).toBeNull();
      expect((await reset({ token, phoneNumber: '1 (805) 555-1234' })).status).toBe(204);
    });

    it('invalidates the reset token after 5 wrong phone numbers (even if the 6th is right)', async () => {
      const token = await resetToken();
      for (let i = 0; i < 5; i++) {
        const res = await reset({ token, phoneNumber: `805-555-010${i}` });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('PHONE_MISMATCH');
      }
      const right = await reset({ token });
      expect(right.status).toBe(404);
      expect(right.body.code).toBe('INVALID_TOKEN');
      expect((await peek(token)).status).toBe(404);
      expect((await admin.user.findUniqueOrThrow({ where: { id: patUserId } })).passwordHashV2).toBeNull();

      const failures = await admin.auditLog.findMany({ where: { action: 'auth.password_reset_phone_failed' } });
      expect(failures).toHaveLength(5);
      const row = await tokenRow(patId);
      expect(new Set(failures.map((f) => `${f.targetType}:${f.targetId}`))).toEqual(new Set([`auth_token:${row.id}`]));
      expect(dump(failures)).not.toContain(token);
      expect(dump(failures)).not.toContain('805-555-010');
      // Invitation failures are counted separately.
      expect(await admin.auditLog.count({ where: { action: 'auth.invitation_phone_failed' } })).toBe(0);

      // A fresh reset link starts a fresh count.
      const fresh = await resetToken();
      expect((await reset({ token: fresh })).status).toBe(204);
    });

    it('serializes concurrent wrong phones per token: 8 parallel guesses give 5 mismatches and 3 invalid', async () => {
      const token = await resetToken();
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => reset({ token, phoneNumber: `805-555-020${i}` })));
      const codes = results.map((r) => `${r.status} ${r.body.code}`).sort();
      expect(codes).toEqual([...Array<string>(3).fill('404 INVALID_TOKEN'), ...Array<string>(5).fill('422 PHONE_MISMATCH')]);
      expect(await admin.auditLog.count({ where: { action: 'auth.password_reset_phone_failed' } })).toBe(5);
    });

    it('two concurrent resets with the same token: exactly one 204', async () => {
      const token = await resetToken();
      const results = await Promise.all([reset({ token }), reset({ token })]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
      expect(await admin.auditLog.count({ where: { action: 'auth.password_reset' } })).toBe(1);
    });

    it('404 INVALID_TOKEN when the person no longer has a user; the token is not consumed', async () => {
      const token = await resetToken();
      await admin.user.delete({ where: { id: patUserId } });
      const res = await reset({ token });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVALID_TOKEN');
      expect((await tokenRow(patId)).usedAt).toBeNull();
    });

    it('a person with several (legacy duplicate) users: only the lowest-id user is reset', async () => {
      const dup = await admin.user.create({ data: { username: 'pat2', personId: patId } });
      const token = await resetToken('pat2');
      expect((await reset({ token })).status).toBe(204);
      expect((await admin.user.findUniqueOrThrow({ where: { id: patUserId } })).passwordHashV2).toMatch(/^\$argon2id\$/);
      expect((await admin.user.findUniqueOrThrow({ where: { id: dup.id } })).passwordHashV2).toBeNull();
      const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'auth.password_reset' } });
      expect(audit.meta).toMatchObject({ personId: patId, otherUserIds: [dup.id] });
    });

    it('422 VALIDATION_ERROR for missing fields and unknown fields', async () => {
      const token = await resetToken();
      for (const body of [{ token, phoneNumber: undefined }, { token, admin: true }, { token: 42 }]) {
        const res = await reset(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect((await tokenRow(patId)).usedAt).toBeNull();
    });
  });

  describe('POST /auth/forgot-username', () => {
    it('202 {}: one reminder listing the usernames of the family parents (case-insensitive, trimmed match)', async () => {
      const res = await forgotUsername('  FAMILY@Example.COM ');
      expect(res.status).toBe(202);
      expect(res.body).toEqual({});
      expect(res.text).not.toContain('pat');
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].to).toBe('family@example.com');
      expect(mail.outbox[0].subject).toContain('Username Reminder');
      expect(mail.outbox[0].text).toMatch(/^pat$/m);
      expect(mail.outbox[0].text).toMatch(/^ina$/m);
      expect(mail.outbox[0].text).not.toMatch(/^nomail$/m);
    });

    it("a person's own address lists that person's username only", async () => {
      expect((await forgotUsername('ina@example.com')).status).toBe(202);
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].to).toBe('ina@example.com');
      expect(mail.outbox[0].text).toMatch(/^ina$/m);
      expect(mail.outbox[0].text).not.toMatch(/^pat$/m);
    });

    it('several matching addresses still produce one mail, without duplicate usernames', async () => {
      const extra = await admin.address.create({ data: { email: 'Family@example.com' } });
      await admin.person.update({ where: { id: inaId }, data: { addressId: extra.id } });
      expect((await forgotUsername('family@example.com')).status).toBe(202);
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0].text.match(/^ina$/gm)).toHaveLength(1);
    });

    it('D1: unknown email and an address whose people have no account get the identical 202 {} and nothing is sent', async () => {
      const known = await forgotUsername('family@example.com');
      await account.whenIdle();
      mail.outbox.length = 0;
      await admin.address.create({ data: { email: 'noaccount@example.com' } });
      const lonely = await admin.address.create({ data: { email: 'lonely@example.com' } });
      await admin.person.create({ data: { englishFirstName: 'Lo', englishLastName: 'Nely', addressId: lonely.id } });
      for (const email of ['nobody@example.com', 'noaccount@example.com', 'lonely@example.com']) {
        const res = await forgotUsername(email);
        expect(res.status).toBe(known.status);
        expect(res.body).toEqual(known.body);
        expect(res.text).toBe(known.text);
      }
      await account.whenIdle();
      expect(mail.outbox).toHaveLength(0);
    });

    it('422 VALIDATION_ERROR for a blank, malformed or non-string email (independent of existence)', async () => {
      for (const email of ['', '   ', 'not-an-email', 'a@example.com, b@example.com', 42, undefined]) {
        const res = await forgotUsername(email);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
