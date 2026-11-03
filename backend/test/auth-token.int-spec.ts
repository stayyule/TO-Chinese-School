import 'reflect-metadata';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../src/common/errors';
import { FixedClock } from '../src/common/clock';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const HOUR = 3_600_000;

describe('AuthTokenService (DB as tocs_app)', () => {
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  const clock = new FixedClock(new Date('2027-01-10T12:00:00Z'));
  const svc = new AuthTokenService(appPrisma, clock);
  let personId: number;

  const invalid = async (p: Promise<unknown>) => {
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ status: 404, code: 'INVALID_TOKEN' });
    return (e as AppError).message;
  };

  beforeAll(async () => {
    await appPrisma.$connect();
  });
  beforeEach(async () => {
    await resetDatabase();
    clock.set(new Date('2027-01-10T12:00:00Z'));
    personId = (await admin.person.create({ data: { englishFirstName: 'Ada', englishLastName: 'Lin' } })).id;
  });
  afterAll(async () => {
    await resetDatabase();
    await appPrisma.$disconnect();
    await admin.$disconnect();
  });

  it('issues 32-byte base64url tokens and stores only the SHA-256 hex', async () => {
    const { token, expiresAt } = await svc.issue('invitation', personId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(expiresAt.getTime()).toBe(clock.now().getTime() + 72 * HOUR);
    const rows = await admin.authToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(rows[0].purpose).toBe('invitation');
    expect(rows[0].personId).toBe(personId);
    expect(rows[0].usedAt).toBeNull();
    const reset = await svc.issue('password_reset', personId);
    expect(reset.expiresAt.getTime()).toBe(clock.now().getTime() + 6 * HOUR);
  });

  it('peek does not consume; consume is single-use', async () => {
    const { token } = await svc.issue('invitation', personId);
    await expect(svc.peek('invitation', token)).resolves.toEqual({ personId });
    await expect(svc.peek('invitation', token)).resolves.toEqual({ personId });
    await expect(svc.consume('invitation', token)).resolves.toEqual({ personId });
    expect((await admin.authToken.findFirstOrThrow()).usedAt).toEqual(clock.now());
    await invalid(svc.consume('invitation', token));
    await invalid(svc.peek('invitation', token));
  });

  it('concurrent consumes of one token: exactly one succeeds', async () => {
    const { token } = await svc.issue('password_reset', personId);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => svc.consume('password_reset', token)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.reason).toMatchObject({ status: 404, code: 'INVALID_TOKEN' });
  });

  it('invitation: valid at +71h, invalid at +73h; the exact expiry instant is expired', async () => {
    const { token, expiresAt } = await svc.issue('invitation', personId);
    clock.set(new Date(clock.now().getTime() + 71 * HOUR));
    await expect(svc.peek('invitation', token)).resolves.toEqual({ personId });
    clock.set(new Date(expiresAt.getTime() - 1));
    await expect(svc.peek('invitation', token)).resolves.toEqual({ personId });
    clock.set(expiresAt);
    await invalid(svc.peek('invitation', token));
    await invalid(svc.consume('invitation', token));
    clock.set(new Date(expiresAt.getTime() + HOUR));
    await invalid(svc.peek('invitation', token));
  });

  it('reset: valid at +5h, invalid at +7h; consume honours the boundary too', async () => {
    const { token, expiresAt } = await svc.issue('password_reset', personId);
    clock.advanceMs(5 * HOUR);
    await expect(svc.peek('password_reset', token)).resolves.toEqual({ personId });
    clock.set(new Date(expiresAt.getTime() - 1));
    await expect(svc.consume('password_reset', token)).resolves.toEqual({ personId });
    const second = await svc.issue('password_reset', personId);
    clock.set(new Date(second.expiresAt.getTime() + HOUR));
    await invalid(svc.consume('password_reset', second.token));
  });

  it('a token for one purpose fails for the other; all failures share one message', async () => {
    const reset = await svc.issue('password_reset', personId);
    const m1 = await invalid(svc.peek('invitation', reset.token));
    await invalid(svc.consume('invitation', reset.token));
    // a wrong-purpose attempt must not burn the token
    await expect(svc.peek('password_reset', reset.token)).resolves.toEqual({ personId });
    const m2 = await invalid(svc.peek('invitation', 'does-not-exist'));
    await svc.consume('password_reset', reset.token);
    const m3 = await invalid(svc.peek('password_reset', reset.token));
    const inv = await svc.issue('invitation', personId);
    clock.advanceMs(100 * HOUR);
    const m4 = await invalid(svc.peek('invitation', inv.token));
    expect(new Set([m1, m2, m3, m4]).size).toBe(1);
  });

  it('issuing a new token invalidates older unused tokens of the same purpose and person only', async () => {
    const other = (await admin.person.create({ data: { englishFirstName: 'B', englishLastName: 'C' } })).id;
    const a1 = await svc.issue('invitation', personId);
    const resetA = await svc.issue('password_reset', personId);
    const otherInv = await svc.issue('invitation', other);
    const a2 = await svc.issue('invitation', personId);
    await invalid(svc.peek('invitation', a1.token));
    await expect(svc.peek('invitation', a2.token)).resolves.toEqual({ personId });
    await expect(svc.peek('password_reset', resetA.token)).resolves.toEqual({ personId });
    await expect(svc.peek('invitation', otherInv.token)).resolves.toEqual({ personId: other });
  });
});
