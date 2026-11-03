import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/auth/session.service';
import { Clock, FixedClock } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const T0 = new Date('2026-10-01T19:00:00Z'); // noon Pacific
const HOUR = 3_600_000;
const CSRF = 'csrf-token-for-tests';
const PASSWORD = 'correct horse battery';
const d = (s: string): Date => new Date(`${s}T00:00:00Z`);

describe('invitations and register-with-invitation (app connected as tocs_app)', () => {
  const clock = new FixedClock(T0);
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() }); // superuser: seeding + assertions only
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let mail: MailService;
  let rootSid: string;
  let plainSid: string;
  let ipSeq = 0;
  /** Pat: no own address; parent of a family whose address has home phone (805) 555-1234. */
  let patId: number;
  /** Ina: own address (cell 805-555-9876); also parent two of Pat's family; current-year primary instructor. */
  let inaId: number;
  /** Kid: child of Pat's family, no own address. */
  let kidId: number;
  let currentYearId: number;

  const http = () => request(app.getHttpServer());
  const newIp = (): string => `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

  const post = (url: string, body: object, opts: { sid?: string; ip?: string } = {}) => {
    const cookies = [`tocs_csrf=${CSRF}`];
    if (opts.sid) cookies.push(`tocs_session=${opts.sid}`);
    return http()
      .post(url)
      .set('X-Forwarded-For', opts.ip ?? newIp())
      .set('Cookie', cookies)
      .set('X-CSRF-Token', CSRF)
      .send(body);
  };

  const invite = (personId: unknown, emailDestination: unknown, sid = rootSid) => {
    const body: Record<string, unknown> = {};
    if (personId !== undefined) body.personId = personId;
    if (emailDestination !== undefined) body.emailDestination = emailDestination;
    return post('/api/v1/admin/user-registration/invitations', body, { sid });
  };

  /** Invites through the API and returns the token from the delivered mail. */
  async function invitationToken(personId: number, to = 'parent@example.com'): Promise<string> {
    const res = await invite(personId, to);
    expect(res.status).toBe(201);
    const last = mail.outbox[mail.outbox.length - 1];
    const m = /\/register-with-invitation\/([A-Za-z0-9_-]{43})$/m.exec(last.text);
    if (!m) throw new Error('no invitation link in mail');
    return m[1];
  }

  const register = (body: Partial<Record<string, unknown>>, ip = newIp()) =>
    post(
      '/api/v1/auth/register-with-invitation',
      { username: 'newparent', password: PASSWORD, passwordConfirmation: PASSWORD, phoneNumber: '(805) 555-1234', ...body },
      { ip },
    );
  const peek = (token: string) => http().get(`/api/v1/auth/invitations/${token}`).set('X-Forwarded-For', newIp());
  const tokenRow = (personId: number) => admin.authToken.findFirstOrThrow({ where: { personId }, orderBy: { id: 'desc' } });
  const roleNames = async (userId: number): Promise<string[]> =>
    (await admin.roleUser.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.name as string).sort();
  const dump = (rows: object[]): string => JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));

  async function sessionFor(username: string, roleName: string | null): Promise<string> {
    const user = await admin.user.create({ data: { username } });
    if (roleName) {
      const role = await admin.role.findFirstOrThrow({ where: { name: roleName } });
      await admin.roleUser.create({ data: { roleId: role.id, userId: user.id } });
    }
    return (await app.get(SessionService).create(user.id, {})).id;
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
  });

  beforeEach(async () => {
    await resetDatabase();
    clock.set(T0);
    mail.outbox.length = 0;
    await seed(appPrisma);
    rootSid = await sessionFor('root', 'Super User');
    plainSid = await sessionFor('plain', 'Student Parent');
    currentYearId = (await admin.schoolYear.create({ data: { name: 'current', startDate: d('2026-08-20'), endDate: d('2027-06-10') } })).id;

    const famAddr = await admin.address.create({ data: { homePhone: '(805) 555-1234', cellPhone: '' } });
    const inaAddr = await admin.address.create({ data: { homePhone: null, cellPhone: '805-555-9876' } });
    patId = (await admin.person.create({ data: { englishFirstName: 'Pat', englishLastName: 'Parent' } })).id;
    inaId = (await admin.person.create({ data: { englishFirstName: 'Ina', englishLastName: 'Structor', addressId: inaAddr.id } })).id;
    kidId = (await admin.person.create({ data: { englishFirstName: 'Kid', englishLastName: 'Parent' } })).id;
    const fam = await admin.family.create({ data: { parentOneId: patId, parentTwoId: inaId, addressId: famAddr.id } });
    await admin.familyChild.create({ data: { familyId: fam.id, childId: kidId } });
    await admin.instructorAssignment.create({ data: { instructorId: inaId, role: 'Primary Instructor', schoolYearId: currentYearId } });
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('POST /admin/user-registration/invitations', () => {
    it('201: issues a token, mails the invitation with the English name, audits, and never returns the token', async () => {
      const res = await invite(patId, ' pat@example.com ');
      expect(res.status).toBe(201);
      expect(mail.outbox).toHaveLength(1);
      const sent = mail.outbox[0];
      expect(sent.to).toBe('pat@example.com');
      expect(sent.text).toContain('Dear Pat Parent,');
      const token = /\/register-with-invitation\/([A-Za-z0-9_-]{43})$/m.exec(sent.text)?.[1] as string;
      expect(token).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(res.body).toEqual({ personId: patId, expiresAt: new Date(T0.getTime() + 72 * HOUR).toISOString() });

      const row = await tokenRow(patId);
      expect(row.purpose).toBe('invitation');
      const audits = await admin.auditLog.findMany({ where: { action: 'auth.invitation_sent' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUsername: 'root', targetType: 'person', targetId: String(patId) });
      expect(dump(audits)).not.toContain(token);
      expect(dump(audits)).not.toContain(row.tokenHash);
    });

    it('requires auth.invitations.create: 401 anonymous, 403 without the permission', async () => {
      const anon = await post('/api/v1/admin/user-registration/invitations', { personId: patId, emailDestination: 'a@example.com' });
      expect(anon.status).toBe(401);
      const plain = await invite(patId, 'a@example.com', plainSid);
      expect(plain.status).toBe(403);
      expect(mail.outbox).toHaveLength(0);
      expect(await admin.authToken.count()).toBe(0);
    });

    it('404 PERSON_NOT_FOUND', async () => {
      const res = await invite(999_999, 'a@example.com');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PERSON_NOT_FOUND');
    });

    it('409 PERSON_ALREADY_HAS_ACCOUNT when the person already has a user', async () => {
      await admin.user.create({ data: { username: 'patexisting', personId: patId } });
      const res = await invite(patId, 'a@example.com');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PERSON_ALREADY_HAS_ACCOUNT');
      expect(mail.outbox).toHaveLength(0);
      expect(await admin.authToken.count()).toBe(0);
    });

    it('422 EMAIL_REQUIRED for an empty, blank or missing emailDestination', async () => {
      for (const e of ['', '   ', undefined]) {
        const res = await invite(patId, e);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('EMAIL_REQUIRED');
      }
      expect(mail.outbox).toHaveLength(0);
      expect(await admin.authToken.count()).toBe(0);
    });

    it('422 VALIDATION_ERROR for a malformed or multi-address emailDestination and a bad personId', async () => {
      for (const e of ['not-an-email', 'a@example.com, b@example.com', 'Pat <a@example.com>', 42]) {
        const res = await invite(patId, e);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      for (const p of ['1', 0, 1.5, undefined]) {
        const res = await invite(p, 'a@example.com');
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(mail.outbox).toHaveLength(0);
    });
  });

  describe('GET /auth/invitations/:token', () => {
    it('200 { personName } for a valid token; 404 INVALID_TOKEN for unknown or expired', async () => {
      const token = await invitationToken(patId);
      const ok = await peek(token);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ personName: 'Pat Parent' });

      const unknown = await peek('A'.repeat(43));
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('INVALID_TOKEN');

      clock.advanceMs(72 * HOUR);
      const expired = await peek(token);
      expect(expired.status).toBe(404);
      expect(expired.body.code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /auth/register-with-invitation', () => {
    it('201: creates the user (trimmed username, argon2id only) with Student Parent, consumes the token and audits', async () => {
      const token = await invitationToken(patId);
      const res = await register({ token, username: '  newparent  ', phoneNumber: '+1 805 555 1234' });
      expect(res.status).toBe(201);

      const user = await admin.user.findFirstOrThrow({ where: { personId: patId } });
      expect(res.body).toEqual({ userId: user.id });
      expect(user.username).toBe('newparent');
      expect(user.passwordHashV2).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).toBeNull();
      expect(user.passwordSalt).toBeNull();
      expect(user.createdAt?.getTime()).toBe(T0.getTime());
      expect(await roleNames(user.id)).toEqual(['Student Parent']);

      expect((await tokenRow(patId)).usedAt?.getTime()).toBe(T0.getTime());
      expect((await peek(token)).status).toBe(404);
      const again = await register({ token, username: 'other-name' });
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('INVALID_TOKEN');

      const audits = await admin.auditLog.findMany({ where: { action: 'auth.account_created' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: user.id, actorUsername: 'newparent', targetType: 'user', targetId: String(user.id) });
      expect(dump(audits)).not.toContain(token);
      expect(dump(audits)).not.toContain(PASSWORD);

      // The new credentials work.
      const login = await post('/api/v1/auth/login', { username: 'newparent', password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body).toEqual({ userId: user.id });
    });

    it('adds Instructor for a person with a current-year primary-instructor assignment (own address phone)', async () => {
      const token = await invitationToken(inaId);
      const res = await register({ token, username: 'ina', phoneNumber: '805.555.9876' });
      expect(res.status).toBe(201);
      expect(await roleNames(res.body.userId as number)).toEqual(['Instructor', 'Student Parent']);
    });

    it('a person with an own address is checked against it only, not against family addresses', async () => {
      const token = await invitationToken(inaId);
      const res = await register({ token, username: 'ina', phoneNumber: '(805) 555-1234' }); // the family phone
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PHONE_MISMATCH');
    });

    it('a child without an own address matches the phone of the family it belongs to', async () => {
      const token = await invitationToken(kidId);
      const res = await register({ token, username: 'kid', phoneNumber: '8055551234' });
      expect(res.status).toBe(201);
    });

    it('404 INVALID_TOKEN for an unknown token is reported before any other check', async () => {
      const res = await register({ token: 'A'.repeat(43), passwordConfirmation: 'different-password', phoneNumber: '' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('422 PASSWORD_MISMATCH and 422 PASSWORD_TOO_SHORT do not consume the token', async () => {
      const token = await invitationToken(patId);
      const mismatch = await register({ token, passwordConfirmation: `${PASSWORD}x` });
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('PASSWORD_MISMATCH');
      const short = await register({ token, password: 'short', passwordConfirmation: 'short' });
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('PASSWORD_TOO_SHORT');

      expect((await tokenRow(patId)).usedAt).toBeNull();
      expect(await admin.user.count({ where: { personId: patId } })).toBe(0);
      expect((await register({ token })).status).toBe(201);
    });

    it('422 PHONE_MISMATCH does not consume the token; the right phone then succeeds', async () => {
      const token = await invitationToken(patId);
      for (const phoneNumber of ['805-555-1235', '805-555-123', '']) {
        const res = await register({ token, phoneNumber });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('PHONE_MISMATCH');
      }
      expect((await tokenRow(patId)).usedAt).toBeNull();
      expect(await admin.user.count({ where: { personId: patId } })).toBe(0);
      expect((await register({ token, phoneNumber: '1 (805) 555-1234' })).status).toBe(201);
    });

    it('an empty stored phone never matches an empty input', async () => {
      const blankAddr = await admin.address.create({ data: { homePhone: '', cellPhone: null } });
      const blank = await admin.person.create({ data: { englishFirstName: 'Bo', englishLastName: 'Blank', addressId: blankAddr.id } });
      const token = await invitationToken(blank.id);
      for (const phoneNumber of ['', '   ', 'n/a']) {
        const res = await register({ token, phoneNumber, username: 'bo' });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('PHONE_MISMATCH');
      }
    });

    it('invalidates the invitation after 5 wrong phone numbers (even if the 6th is right)', async () => {
      const token = await invitationToken(patId);
      for (let i = 0; i < 5; i++) {
        const res = await register({ token, phoneNumber: `805-555-000${i}` });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('PHONE_MISMATCH');
      }
      const right = await register({ token });
      expect(right.status).toBe(404);
      expect(right.body.code).toBe('INVALID_TOKEN');
      expect((await peek(token)).status).toBe(404);
      expect(await admin.user.count({ where: { personId: patId } })).toBe(0);

      const failures = await admin.auditLog.findMany({ where: { action: 'auth.invitation_phone_failed' } });
      expect(failures).toHaveLength(5);
      const row = await tokenRow(patId);
      expect(new Set(failures.map((f) => `${f.targetType}:${f.targetId}`))).toEqual(new Set([`auth_token:${row.id}`]));
      expect(dump(failures)).not.toContain(token);
      expect(dump(failures)).not.toContain('805-555-000');

      // A fresh invitation starts a fresh count.
      const fresh = await invitationToken(patId);
      expect((await register({ token: fresh })).status).toBe(201);
    });

    it('serializes concurrent wrong phones per invitation: 8 parallel guesses give 5 mismatches and 3 invalid', async () => {
      const token = await invitationToken(patId);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register({ token, phoneNumber: `805-555-010${i}` })));
      const codes = results.map((r) => `${r.status} ${r.body.code}`).sort();
      expect(codes).toEqual([...Array<string>(3).fill('404 INVALID_TOKEN'),...Array<string>(5).fill('422 PHONE_MISMATCH')]);
      expect(await admin.auditLog.count({ where: { action: 'auth.invitation_phone_failed' } })).toBe(5);
    });

    it('409 ACCOUNT_EXISTS when the person got an account meanwhile; the body never reveals the username', async () => {
      const token = await invitationToken(patId);
      await admin.user.create({ data: { username: 'secret-existing-name', personId: patId } });
      const res = await register({ token });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACCOUNT_EXISTS');
      expect(JSON.stringify(res.body)).not.toContain('secret-existing-name');
      expect(await admin.user.count({ where: { personId: patId } })).toBe(1);
      expect((await tokenRow(patId)).usedAt).toBeNull();
    });

    it('409 USERNAME_TAKEN (case-sensitive, after trimming) does not consume the token', async () => {
      await admin.user.create({ data: { username: 'taken' } });
      const token = await invitationToken(patId);
      const res = await register({ token, username: ' taken ' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('USERNAME_TAKEN');
      expect((await tokenRow(patId)).usedAt).toBeNull();
      expect(await admin.user.count({ where: { personId: patId } })).toBe(0);

      const ok = await register({ token, username: 'Taken' });
      expect(ok.status).toBe(201);
    });

    it('422 VALIDATION_ERROR for a blank or over-long username and unknown fields', async () => {
      const token = await invitationToken(patId);
      for (const body of [{ username: '   ' }, { username: 'x'.repeat(256) }, { admin: true }]) {
        const res = await register({ token, ...body });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect((await tokenRow(patId)).usedAt).toBeNull();
    });

    it('two concurrent registrations with the same token: exactly one 201', async () => {
      const token = await invitationToken(patId);
      const results = await Promise.all([register({ token, username: 'first' }), register({ token, username: 'second' })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 404]);
      expect(await admin.user.count({ where: { personId: patId } })).toBe(1);
    });

    it('two concurrent registrations of different people with the same username: one 201, one 409', async () => {
      const t1 = await invitationToken(patId);
      const t2 = await invitationToken(kidId);
      const results = await Promise.all([register({ token: t1, username: 'same' }), register({ token: t2, username: 'same' })]);
      expect(results.map((r) => `${r.status} ${r.body.code ?? ''}`).sort()).toEqual(['201 ', '409 USERNAME_TAKEN']);
      expect(await admin.user.count({ where: { username: 'same' } })).toBe(1);
    });
  });
});
