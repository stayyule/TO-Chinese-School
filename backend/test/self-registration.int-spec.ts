import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { Clock, FixedClock } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const T0 = new Date('2026-10-01T19:00:00Z');
const MINUTE = 60_000;
const CSRF = 'csrf-token-for-tests';
const PASSWORD = 'a long enough passphrase';
const CURRENT = 'current passphrase';
const NEW_PASSWORD = 'a brand new passphrase';
const LEGACY_SALT = 'legacysalt';
const LEGACY_HASH = createHash('sha256').update(CURRENT + LEGACY_SALT).digest('hex');

type Body = Record<string, unknown>;

const dump = (rows: object[]): string => JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].slice(name.length + 1);
}

describe('self-registration and change password (app connected as tocs_app)', () => {
  const clock = new FixedClock(T0);
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() }); // superuser: seeding + assertions only
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let audit: AuditService;
  let ipSeq = 0;

  const http = () => request(app.getHttpServer());
  const newIp = (): string => `10.3.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  const post = (url: string, body: object, cookies: string[] = []) =>
    http()
      .post(url)
      .set('X-Forwarded-For', newIp())
      .set('Cookie', [`tocs_csrf=${CSRF}`, ...cookies])
      .set('X-CSRF-Token', CSRF)
      .send(body);

  const registration = (over: Body = {}, address: Body = {}, parentOne: Body = {}): Body => ({
    address: {
      street: '123 Main St',
      city: 'Thousand Oaks',
      state: 'CA',
      zipcode: '91360',
      homePhone: '(805) 555-1234',
      cellPhone: '805.555.9876',
      email: 'nora@example.com',
      ...address,
    },
    parentOne: {
      englishFirstName: 'Nora',
      englishLastName: 'Newfamily',
      chineseName: '王小明',
      gender: 'F',
      nativeLanguage: 'Mandarin',
      ...parentOne,
    },
    username: 'nora',
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
    ...over,
  });
  const register = (body: Body) => post('/api/v1/auth/register', body);

  const counts = async () => ({
    addresses: await admin.address.count(),
    people: await admin.person.count(),
    families: await admin.family.count(),
    users: await admin.user.count(),
    rolesUsers: await admin.roleUser.count(),
  });

  const login = async (username: string, password: string): Promise<request.Response> =>
    post('/api/v1/auth/login', { username, password });
  const loginOk = async (username: string, password: string): Promise<string> => {
    const res = await login(username, password);
    expect(res.status).toBe(200);
    return cookieValue(res, 'tocs_session') as string;
  };
  const me = (sid: string) => http().get('/api/v1/me').set('Cookie', `tocs_session=${sid}`);

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
    audit = app.get(AuditService);
  });

  beforeEach(async () => {
    await resetDatabase();
    clock.set(T0);
    await seed(appPrisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('POST /auth/register', () => {
    /** An existing family whose address uses `email`; its parent has the account `existing`. */
    async function existingFamily(email: string): Promise<void> {
      const addr = await admin.address.create({ data: { homePhone: '8055550000', email } });
      const person = await admin.person.create({ data: { englishFirstName: 'Ex', englishLastName: 'Isting' } });
      await admin.family.create({ data: { parentOneId: person.id, addressId: addr.id } });
      await admin.user.create({ data: { username: 'existing', personId: person.id } });
    }

    it('201 {}: creates one address, one person (parent one), one family and one Student Parent user', async () => {
      const res = await register(registration({ username: ' nora ' }, { street: ' 123 Main St ', email: ' Nora@Example.com ' }));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({});

      const addresses = await admin.address.findMany();
      expect(addresses).toHaveLength(1);
      expect(addresses[0]).toMatchObject({
        street: '123 Main St',
        city: 'Thousand Oaks',
        state: 'CA',
        zipcode: '91360',
        homePhone: '8055551234',
        cellPhone: '8055559876',
        email: 'Nora@Example.com',
      });
      expect(addresses[0].createdAt?.getTime()).toBe(T0.getTime());

      const people = await admin.person.findMany();
      expect(people).toHaveLength(1);
      // As in the old signin#register, the address belongs to the family, not to the person.
      expect(people[0]).toMatchObject({
        englishFirstName: 'Nora',
        englishLastName: 'Newfamily',
        chineseName: '王小明',
        gender: 'F',
        nativeLanguage: 'Mandarin',
        addressId: null,
        birthYear: null,
        birthMonth: null,
      });

      const families = await admin.family.findMany();
      expect(families).toHaveLength(1);
      expect(families[0]).toMatchObject({ parentOneId: people[0].id, parentTwoId: null, addressId: addresses[0].id });

      const users = await admin.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ username: 'nora', personId: people[0].id, passwordHash: null, passwordSalt: null });
      expect(users[0].passwordHashV2).toMatch(/^\$argon2id\$/);

      const roles = await admin.roleUser.findMany({ where: { userId: users[0].id }, include: { role: true } });
      expect(roles.map((r) => r.role.name)).toEqual(['Student Parent']);

      const logs = await admin.auditLog.findMany({ where: { action: 'auth.account_created' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorUserId: users[0].id, actorUsername: 'nora', targetType: 'user', targetId: String(users[0].id) });
      expect(dump(logs)).not.toContain(PASSWORD);

      // The new account works (registration itself does not sign in).
      expect(cookieValue(res, 'tocs_session')).toBeUndefined();
      expect((await login('nora', PASSWORD)).status).toBe(200);
    });

    it('a blank cell phone is stored as null', async () => {
      expect((await register(registration({}, { cellPhone: '  ' }))).status).toBe(201);
      expect((await admin.address.findFirstOrThrow()).cellPhone).toBeNull();
    });

    it('422 VALIDATION_ERROR with details keyed by field; nothing is written', async () => {
      const res = await register(
        registration({}, { zipcode: '9301a', homePhone: '805-555-123', email: 'nope', city: ' ' }, { gender: 'X', englishLastName: '' }),
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual({
        'address.city': 'REQUIRED',
        'address.zipcode': 'INVALID',
        'address.homePhone': 'INVALID',
        'address.email': 'INVALID',
        'parentOne.gender': 'INVALID',
        'parentOne.englishLastName': 'REQUIRED',
      });
      expect(await counts()).toEqual({ addresses: 0, people: 0, families: 0, users: 0, rolesUsers: 0 });
    });

    it('422 for unknown fields (also inside nested objects) and for a missing address object', async () => {
      expect((await register(registration({}, {}, { birthYear: 1980 }))).status).toBe(422);
      expect((await register(registration({}, { country: 'US' }))).status).toBe(422);
      expect((await register(registration({ isAdmin: true }))).status).toBe(422);
      expect((await register(registration({ address: undefined }))).status).toBe(422);
      expect((await register(registration({ address: 'x' }))).status).toBe(422);
      expect(await counts()).toEqual({ addresses: 0, people: 0, families: 0, users: 0, rolesUsers: 0 });
    });

    it('422 PASSWORD_MISMATCH and 422 PASSWORD_TOO_SHORT (D3); nothing is written', async () => {
      const mismatch = await register(registration({ passwordConfirmation: `${PASSWORD}!` }));
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('PASSWORD_MISMATCH');
      const short = await register(registration({ password: '123456789', passwordConfirmation: '123456789' }));
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
      expect(await counts()).toEqual({ addresses: 0, people: 0, families: 0, users: 0, rolesUsers: 0 });
    });

    it('422 for a blank username', async () => {
      expect((await register(registration({ username: '   ' }))).status).toBe(422);
    });

    it('409 EMAIL_ALREADY_REGISTERED when any address has the email (trimmed, case-insensitive); no usernames in the body (D1)', async () => {
      await existingFamily(' Nora@EXAMPLE.com ');
      const before = await counts();
      const res = await register(registration({}, { email: 'nora@example.com' }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(res.text).not.toContain('existing');
      expect(await counts()).toEqual(before);
    });

    it('409 USERNAME_TAKEN for an existing username (case-sensitive, as the old system)', async () => {
      await existingFamily('other@example.com');
      const res = await register(registration({ username: 'existing' }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('USERNAME_TAKEN');
      expect((await register(registration({ username: 'Existing' }))).status).toBe(201);
    });

    it('all or nothing: a failure after the family (and user) insert leaves nothing behind', async () => {
      const real = audit.record.bind(audit);
      jest.spyOn(audit, 'record').mockImplementation(async (e, db) => {
        if (e.action === 'auth.account_created') throw new Error('injected failure');
        return real(e, db);
      });
      const res = await register(registration());
      expect(res.status).toBe(500);
      expect(await counts()).toEqual({ addresses: 0, people: 0, families: 0, users: 0, rolesUsers: 0 });
      jest.restoreAllMocks();
      expect((await register(registration())).status).toBe(201);
    });

    it('two concurrent registrations with the same username: exactly one 201 and one 409 USERNAME_TAKEN, one users row', async () => {
      const results = await Promise.all([
        register(registration({ username: 'twin' }, { email: 'one@example.com' })),
        register(registration({ username: 'twin' }, { email: 'two@example.com' })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('USERNAME_TAKEN');
      expect(await admin.user.count({ where: { username: 'twin' } })).toBe(1);
      expect(await counts()).toEqual({ addresses: 1, people: 1, families: 1, users: 1, rolesUsers: 1 });
    });

    it('two concurrent registrations with the same email: exactly one 201 and one 409 EMAIL_ALREADY_REGISTERED', async () => {
      const results = await Promise.all([
        register(registration({ username: 'first' }, { email: 'same@example.com' })),
        register(registration({ username: 'second' }, { email: ' SAME@example.com' })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await counts()).toEqual({ addresses: 1, people: 1, families: 1, users: 1, rolesUsers: 1 });
    });

    it('crossed concurrent registrations (shared usernames and emails) never deadlock and never duplicate', async () => {
      const combos: [string, string][] = [
        ['u1', 'e1@example.com'],
        ['u2', 'e2@example.com'],
        ['u1', 'e2@example.com'],
        ['u2', 'e1@example.com'],
      ];
      const results = await Promise.all(combos.map(([username, email]) => register(registration({ username }, { email }))));
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      const created = statuses.filter((s) => s === 201).length;
      expect(created).toBeGreaterThanOrEqual(1);
      expect(created).toBeLessThanOrEqual(2);
      const users = await admin.user.findMany({ select: { username: true } });
      expect(new Set(users.map((u) => u.username)).size).toBe(users.length);
      const emails = (await admin.address.findMany({ select: { email: true } })).map((a) => a.email?.toLowerCase());
      expect(new Set(emails).size).toBe(emails.length);
      expect(await counts()).toEqual({ addresses: created, people: created, families: created, users: created, rolesUsers: created });
    });
  });

  describe('POST /me/password', () => {
    let patId: number;

    const change = (sid: string | null, body: Body) =>
      post('/api/v1/me/password', body, sid ? [`tocs_session=${sid}`] : []);
    const changeBody = (over: Body = {}): Body => ({
      currentPassword: CURRENT,
      newPassword: NEW_PASSWORD,
      newPasswordConfirmation: NEW_PASSWORD,
      ...over,
    });
    const pat = () => admin.user.findUniqueOrThrow({ where: { id: patId } });

    beforeEach(async () => {
      const person = await admin.person.create({ data: { englishFirstName: 'Pat', englishLastName: 'Parent' } });
      // A legacy user: only the old SHA256(password + salt) columns are set.
      patId = (await admin.user.create({ data: { username: 'pat', personId: person.id, passwordHash: LEGACY_HASH, passwordSalt: LEGACY_SALT } })).id;
    });

    it('204: sets password_hash_v2, keeps the current session, destroys the other sessions, audits auth.password_changed', async () => {
      const current = await loginOk('pat', CURRENT);
      const other = await loginOk('pat', CURRENT);
      const v2BeforeChange = (await pat()).passwordHashV2; // silent upgrade at login
      const res = await change(current, changeBody());
      expect(res.status).toBe(204);

      const user = await pat();
      expect(user.passwordHashV2).toMatch(/^\$argon2id\$/);
      expect(user.passwordHashV2).not.toBe(v2BeforeChange);
      expect(user.passwordHash).toBe(LEGACY_HASH);
      expect(user.passwordSalt).toBe(LEGACY_SALT);

      expect((await me(current)).status).toBe(200);
      expect((await me(other)).status).toBe(401);
      expect(await admin.session.count({ where: { userId: patId } })).toBe(1);

      const logs = await admin.auditLog.findMany({ where: { action: 'auth.password_changed' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorUserId: patId, actorUsername: 'pat', targetType: 'user', targetId: String(patId) });
      const allLogs = dump(await admin.auditLog.findMany());
      expect(allLogs).not.toContain(CURRENT);
      expect(allLogs).not.toContain(NEW_PASSWORD);

      expect((await login('pat', CURRENT)).status).toBe(401);
      expect((await login('pat', NEW_PASSWORD)).status).toBe(200);
    });

    it('does not touch the sessions of other users', async () => {
      const otherPerson = await admin.person.create({ data: { englishFirstName: 'Ina' } });
      await admin.user.create({ data: { username: 'ina', personId: otherPerson.id, passwordHash: LEGACY_HASH, passwordSalt: LEGACY_SALT } });
      const inaSid = await loginOk('ina', CURRENT);
      const sid = await loginOk('pat', CURRENT);
      expect((await change(sid, changeBody())).status).toBe(204);
      expect((await me(inaSid)).status).toBe(200);
    });

    it('422 CURRENT_PASSWORD_INVALID for a wrong current password; nothing changes, the failure is audited', async () => {
      const sid = await loginOk('pat', CURRENT);
      const other = await loginOk('pat', CURRENT);
      const before = await pat();
      const res = await change(sid, changeBody({ currentPassword: 'wrong passphrase' }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CURRENT_PASSWORD_INVALID');
      expect((await pat()).passwordHashV2).toBe(before.passwordHashV2);
      expect((await me(other)).status).toBe(200);
      expect(await admin.auditLog.count({ where: { action: 'auth.password_change_failed', actorUserId: patId } })).toBe(1);
      expect(dump(await admin.auditLog.findMany())).not.toContain('wrong passphrase');
    });

    it('422 PASSWORD_MISMATCH and 422 PASSWORD_TOO_SHORT; nothing changes', async () => {
      const sid = await loginOk('pat', CURRENT);
      const before = await pat();
      const mismatch = await change(sid, changeBody({ newPasswordConfirmation: `${NEW_PASSWORD}!` }));
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.code).toBe('PASSWORD_MISMATCH');
      const short = await change(sid, changeBody({ newPassword: 'short', newPasswordConfirmation: 'short' }));
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
      expect((await pat()).passwordHashV2).toBe(before.passwordHashV2);
    });

    it('allows the new password to equal the current one', async () => {
      const sid = await loginOk('pat', CURRENT);
      expect((await change(sid, changeBody({ newPassword: CURRENT, newPasswordConfirmation: CURRENT }))).status).toBe(204);
      expect((await login('pat', CURRENT)).status).toBe(200);
    });

    it('works for a legacy user that never logged in with a v2 hash (verify falls back to the legacy hash)', async () => {
      const sid = await loginOk('pat', CURRENT);
      await admin.user.update({ where: { id: patId }, data: { passwordHashV2: null } });
      expect((await change(sid, changeBody())).status).toBe(204);
      expect((await pat()).passwordHashV2).toMatch(/^\$argon2id\$/);
    });

    it('401 without a session, 403 CSRF_INVALID without the CSRF header, 422 for unknown fields', async () => {
      expect((await change(null, changeBody())).status).toBe(401);
      const sid = await loginOk('pat', CURRENT);
      const noCsrf = await http().post('/api/v1/me/password').set('Cookie', `tocs_session=${sid}`).send(changeBody());
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.body.code).toBe('CSRF_INVALID');
      expect((await change(sid, changeBody({ username: 'someone-else' }))).status).toBe(422);
    });

    it('5 wrong current passwords within 15 min -> 429 PASSWORD_CHANGE_LOCKED, even with the right one; unlocks after 15 min', async () => {
      const sid = await loginOk('pat', CURRENT);
      for (let i = 0; i < 5; i++) {
        clock.advanceMs(MINUTE);
        const res = await change(sid, changeBody({ currentPassword: `wrong ${i}` }));
        expect(res.status).toBe(422);
      }
      const locked = await change(sid, changeBody());
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('PASSWORD_CHANGE_LOCKED');
      expect(locked.headers['retry-after']).toBe('900');
      // Failures are not recorded while locked.
      expect(await admin.auditLog.count({ where: { action: 'auth.password_change_failed' } })).toBe(5);

      clock.advanceMs(15 * MINUTE + 1000); // the last failure is now older than the window
      expect((await change(sid, changeBody())).status).toBe(204);
    });

    it('a successful change resets the failure count', async () => {
      const sid = await loginOk('pat', CURRENT);
      for (let i = 0; i < 4; i++) expect((await change(sid, changeBody({ currentPassword: `wrong ${i}` }))).status).toBe(422);
      expect((await change(sid, changeBody())).status).toBe(204);
      for (let i = 0; i < 4; i++) {
        expect((await change(sid, changeBody({ currentPassword: `wrong ${i}`, newPassword: CURRENT, newPasswordConfirmation: CURRENT }))).status).toBe(422);
      }
      expect((await change(sid, changeBody({ currentPassword: NEW_PASSWORD }))).status).toBe(204);
    });

    it('concurrent wrong guesses are serialized: at most 5 are checked, the rest get 429', async () => {
      const sid = await loginOk('pat', CURRENT);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => change(sid, changeBody({ currentPassword: `guess ${i}` }))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([422, 422, 422, 422, 422, 429, 429, 429]);
      expect(await admin.auditLog.count({ where: { action: 'auth.password_change_failed' } })).toBe(5);
    });
  });
});
