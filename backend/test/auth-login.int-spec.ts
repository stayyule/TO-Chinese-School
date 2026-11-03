import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Authenticated } from '../src/access/permission.decorators';
import { AppModule } from '../src/app.module';
import type { AuthedRequest } from '../src/auth/session.guard';
import { Clock, FixedClock } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

/** Any signed-in user; the global PermissionGuard answers 401 when SessionGuard did not authenticate. */
@Controller('test-protected')
@Authenticated()
class ProtectedController {
  @Get()
  me(@Req() req: AuthedRequest): unknown {
    return req.user;
  }
}

const T0 = new Date('2026-09-01T12:00:00Z');
const HOUR = 3_600_000;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].slice(name.length + 1);
}

function setCookieLine(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  if (!line) throw new Error(`no Set-Cookie for ${name}`);
  return line;
}

describe('auth: login, sessions, CSRF, throttling (app connected as tocs_app)', () => {
  const clock = new FixedClock(T0);
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() }); // superuser: seeding + assertions only
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let ipSeq = 0;
  let aliceId: number;
  let alicePersonId: number;

  const http = () => request(app.getHttpServer());

  /** Every test uses its own client IP so the per-IP throttler never couples tests. */
  const newIp = (): string => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

  async function csrfFor(ip: string): Promise<{ token: string; cookie: string }> {
    const res = await http().get('/api/v1/auth/csrf').set('X-Forwarded-For', ip);
    expect(res.status).toBe(200);
    const token = cookieValue(res, 'tocs_csrf');
    expect(token).toBeDefined();
    expect(res.body).toEqual({ token });
    return { token: token as string, cookie: `tocs_csrf=${token}` };
  }

  async function login(username: string, password: string, ip: string, extraCookies: string[] = []): Promise<request.Response> {
    const { token, cookie } = await csrfFor(ip);
    return http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .set('Cookie', [cookie, ...extraCookies])
      .set('X-CSRF-Token', token)
      .send({ username, password });
  }

  async function loginOk(username: string, password: string, ip: string): Promise<string> {
    const res = await login(username, password, ip);
    expect(res.status).toBe(200);
    const sid = cookieValue(res, 'tocs_session');
    expect(sid).toBeDefined();
    return sid as string;
  }

  const protectedGet = (sid: string) => http().get('/api/v1/test-protected').set('Cookie', `tocs_session=${sid}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProtectedController] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(PrismaService)
      .useValue(appPrisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase();
    clock.set(T0);
    const person = await admin.person.create({ data: { englishFirstName: 'Alice', englishLastName: 'Wong' } });
    alicePersonId = person.id;
    const alice = await admin.user.create({
      data: {
        username: 'alice',
        // legacyHash('Pa55word!x', '/ab+c=') — the old Rails SHA256(password + salt) format
        passwordHash: '972b0585dcc05a98d22da9509125f971e5d837384436fa50c5e9ee341357b532',
        passwordSalt: '/ab+c=',
        personId: person.id,
      },
    });
    aliceId = alice.id;
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  it('really runs the app as the restricted tocs_app role', async () => {
    const rows = await appPrisma.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`;
    expect(rows[0].u).toBe('tocs_app');
    const roles = await appPrisma.$queryRaw<{ s: boolean }[]>`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`;
    expect(roles).toEqual([{ s: false }]);
  });

  it('logs a legacy user in, sets a hardened session cookie, upgrades the hash silently and audits', async () => {
    const ip = newIp();
    const res = await login('alice', 'Pa55word!x', ip);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: aliceId });

    const line = setCookieLine(res, 'tocs_session');
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; Secure/);
    expect(line).toMatch(/; SameSite=Lax/);
    expect(line).toMatch(/; Path=\//);
    expect(line).toMatch(/; Max-Age=604800/);
    const sid = cookieValue(res, 'tocs_session') as string;
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url

    const user = await admin.user.findUniqueOrThrow({ where: { id: aliceId } });
    expect(user.passwordHashV2).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).toBe('972b0585dcc05a98d22da9509125f971e5d837384436fa50c5e9ee341357b532');
    expect(user.passwordSalt).toBe('/ab+c=');

    const sessions = await admin.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ userId: aliceId, tokenHash: sha256(sid), ip });
    expect(sessions[0].expiresAt.toISOString()).toBe(new Date(T0.getTime() + 7 * 24 * HOUR).toISOString());

    const audit = await admin.auditLog.findMany({ where: { action: 'auth.login_succeeded' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: aliceId, actorUsername: 'alice', ip });

    const me = await protectedGet(sid);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ id: aliceId, personId: alicePersonId, username: 'alice' });

    // Second login goes through the upgraded argon2id hash.
    await loginOk('alice', 'Pa55word!x', newIp());
  });

  it('trims the username ("  alice " logs in as alice) but matches case-sensitively', async () => {
    const res = await login('  alice ', 'Pa55word!x', newIp());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: aliceId });
    const upper = await login('Alice', 'Pa55word!x', newIp());
    expect(upper.status).toBe(401);
  });

  it('returns identical 401 INVALID_CREDENTIALS bodies for a wrong password and an unknown username', async () => {
    const wrong = await login('alice', 'nope-nope-nope', newIp());
    const unknown = await login('nobody', 'nope-nope-nope', newIp());
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(cookieValue(wrong, 'tocs_session')).toBeUndefined();
    expect(await admin.session.count()).toBe(0);

    const failed = await admin.auditLog.findMany({ where: { action: 'auth.login_failed' }, orderBy: { id: 'asc' } });
    expect(failed.map((f) => f.actorUsername)).toEqual(['alice', 'nobody']);
    expect(JSON.stringify(failed.map((f) => ({ ...f, id: String(f.id) })))).not.toContain('nope-nope-nope');
    const user = await admin.user.findUniqueOrThrow({ where: { id: aliceId } });
    expect(user.passwordHashV2).toBeNull();
  });

  it('locks the username after 5 failures (case-insensitively) with 429 LOGIN_LOCKED, then unlocks after 15 minutes', async () => {
    for (const name of ['alice', 'ALICE', 'alice', ' Alice', 'alice']) {
      const r = await login(name, 'wrong-password', newIp());
      expect(r.status).toBe(401);
    }
    const locked = await login('alice', 'Pa55word!x', newIp());
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('LOGIN_LOCKED');
    expect(locked.headers['retry-after']).toBe('900');
    expect(locked.body.details).toEqual({ retryAfterSeconds: 900 });
    expect(cookieValue(locked, 'tocs_session')).toBeUndefined();
    expect(await admin.session.count()).toBe(0);

    clock.advanceMs(15 * 60_000 + 1000);
    await loginOk('alice', 'Pa55word!x', newIp());
  });

  it('locks unknown usernames the same way, with a 429 body identical to a real locked user', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('alice', 'wrong-password', newIp())).status).toBe(401);
      expect((await login('nobody', 'wrong-password', newIp())).status).toBe(401);
    }
    const real = await login('alice', 'Pa55word!x', newIp());
    const unknown = await login('nobody', 'whatever-pass', newIp());
    expect(real.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(unknown.headers['retry-after']).toBe(real.headers['retry-after']);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(unknown.body)).toEqual(strip(real.body));
  });

  it('serializes concurrent attempts per username: 8 parallel wrong passwords give exactly 5 failures and 3 lockouts', async () => {
    // Distinct client IPs so the per-IP throttler cannot mask the effect.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const ip = newIp();
        return { ip, csrf: await csrfFor(ip), i };
      }),
    );
    const results = await Promise.all(
      attempts.map(({ ip, csrf, i }) =>
        http()
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .set('Cookie', csrf.cookie)
          .set('X-CSRF-Token', csrf.token)
          .send({ username: i % 2 ? 'alice' : ' ALICE ', password: 'wrong-password' }),
      ),
    );
    const codes = results.map((r) => `${r.status} ${r.body.code}`).sort();
    expect(codes).toEqual([
      ...Array<string>(5).fill('401 INVALID_CREDENTIALS'),
      ...Array<string>(3).fill('429 LOGIN_LOCKED'),
    ]);
    expect(await admin.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(5);
  });

  it('rejects a whitespace-only username with 422 and writes no audit row', async () => {
    const ip = newIp();
    const { token, cookie } = await csrfFor(ip);
    const res = await http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ username: '   ', password: 'whatever-pass' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await admin.auditLog.count()).toBe(0);
  });

  it('rejects non-GET requests without a matching CSRF header with 403 CSRF_INVALID', async () => {
    const ip = newIp();
    const { token, cookie } = await csrfFor(ip);
    const body = { username: 'alice', password: 'Pa55word!x' };
    const post = () => http().post('/api/v1/auth/login').set('X-Forwarded-For', ip);

    const noHeader = await post().set('Cookie', cookie).send(body);
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe('CSRF_INVALID');

    const mismatch = await post().set('Cookie', cookie).set('X-CSRF-Token', `${token.slice(0, -1)}x`).send(body);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('CSRF_INVALID');

    const noCookie = await post().set('X-CSRF-Token', token).send(body);
    expect(noCookie.status).toBe(403);

    const logout = await http().post('/api/v1/auth/logout').set('X-Forwarded-For', ip);
    expect(logout.status).toBe(403);
    expect(logout.body.code).toBe('CSRF_INVALID');

    expect(await admin.session.count()).toBe(0);
  });

  it('reuses an existing valid CSRF cookie so several tabs keep working', async () => {
    const ip = newIp();
    const first = await csrfFor(ip);
    const again = await http().get('/api/v1/auth/csrf').set('X-Forwarded-For', ip).set('Cookie', first.cookie);
    expect(again.body).toEqual({ token: first.token });
  });

  it('logout destroys the session (204, cookie cleared) and the old cookie no longer resolves', async () => {
    const ip = newIp();
    const sid = await loginOk('alice', 'Pa55word!x', ip);
    expect((await protectedGet(sid)).status).toBe(200);

    const { token, cookie } = await csrfFor(ip);
    const out = await http()
      .post('/api/v1/auth/logout')
      .set('X-Forwarded-For', ip)
      .set('Cookie', [cookie, `tocs_session=${sid}`])
      .set('X-CSRF-Token', token);
    expect(out.status).toBe(204);
    expect(setCookieLine(out, 'tocs_session')).toMatch(/^tocs_session=;.*Expires=Thu, 01 Jan 1970/);

    const after = await protectedGet(sid);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('UNAUTHENTICATED');
    expect(await admin.session.count()).toBe(0);
    const audit = await admin.auditLog.findMany({ where: { action: 'auth.logout' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: aliceId, actorUsername: 'alice', ip });
  });

  it('issues a fresh session id on every login and drops the session presented at login (fixation)', async () => {
    const ip = newIp();
    const first = await loginOk('alice', 'Pa55word!x', ip);
    const res = await login('alice', 'Pa55word!x', ip, [`tocs_session=${first}`]);
    expect(res.status).toBe(200);
    const second = cookieValue(res, 'tocs_session') as string;
    expect(second).not.toBe(first);
    expect((await protectedGet(first)).status).toBe(401);
    expect((await protectedGet(second)).status).toBe(200);
  });

  it('rejects a session idle for 8 h + 1 s', async () => {
    const sid = await loginOk('alice', 'Pa55word!x', newIp());
    clock.advanceMs(8 * HOUR + 1000);
    expect((await protectedGet(sid)).status).toBe(401);
    expect(await admin.session.count()).toBe(0);
  });

  it('slides the idle window on use but enforces the 7-day absolute lifetime', async () => {
    const sid = await loginOk('alice', 'Pa55word!x', newIp());
    for (let i = 1; i <= 23; i++) {
      clock.advanceMs(7 * HOUR); // never idle 8 h, 161 h total
      expect((await protectedGet(sid)).status).toBe(200);
    }
    const row = await admin.session.findFirstOrThrow();
    expect(row.lastSeenAt.toISOString()).toBe(clock.now().toISOString());
    clock.advanceMs(7 * HOUR); // 168 h = 7 days
    expect((await protectedGet(sid)).status).toBe(401);
  });

  it('treats a missing, malformed or unknown session cookie as unauthenticated', async () => {
    expect((await http().get('/api/v1/test-protected')).status).toBe(401);
    expect((await protectedGet('garbage')).status).toBe(401);
    expect((await protectedGet('A'.repeat(43))).status).toBe(401);
  });

  it('validates the login body: unknown fields and missing password are 422 VALIDATION_ERROR', async () => {
    const ip = newIp();
    const { token, cookie } = await csrfFor(ip);
    const post = (body: object) =>
      http().post('/api/v1/auth/login').set('X-Forwarded-For', ip).set('Cookie', cookie).set('X-CSRF-Token', token).send(body);

    const extra = await post({ username: 'alice', password: 'Pa55word!x', admin: true });
    expect(extra.status).toBe(422);
    expect(extra.body.code).toBe('VALIDATION_ERROR');
    const missing = await post({ username: 'alice' });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(extra.body)).not.toContain('Pa55word!x');
  });

  it('limits /auth/* to 20 requests per minute per IP', async () => {
    const ip = newIp();
    for (let i = 0; i < 20; i++) {
      expect((await http().get('/api/v1/auth/csrf').set('X-Forwarded-For', ip)).status).toBe(200);
    }
    const limited = await http().get('/api/v1/auth/csrf').set('X-Forwarded-For', ip);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect((await http().get('/api/v1/auth/csrf').set('X-Forwarded-For', newIp())).status).toBe(200);
    // Non-auth routes are not throttled.
    expect((await http().get('/api/v1/test-protected').set('X-Forwarded-For', ip)).status).toBe(401);
  });
});
