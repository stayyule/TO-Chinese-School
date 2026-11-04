import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { Clock, FixedClock } from '../src/common/clock';
import { ClockModule } from '../src/common/clock.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './helpers/db';

describe('AuditService', () => {
  const clock = new FixedClock(new Date('2026-09-01T12:00:00Z'));
  let moduleRef: TestingModule;
  let audit: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule, ClockModule, AuditModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    await moduleRef.init();
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase();
    clock.set(new Date('2026-09-01T12:00:00Z'));
  });

  afterAll(async () => {
    await moduleRef.close();
    await resetDatabase();
  });

  it('stores an event with occurred_at set from the clock and lower-cased username', async () => {
    await audit.record({ action: 'x.did', actorUserId: 5, actorUsername: 'BoB', targetType: 'person', targetId: 42, ip: '1.2.3.4' });
    const rows = await prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'x.did', actorUserId: 5, actorUsername: 'bob', targetType: 'person', targetId: '42', ip: '1.2.3.4' });
    expect(rows[0].occurredAt.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(rows[0].meta).toEqual({});
  });

  it('redacts sensitive meta keys and survives circular meta', async () => {
    const circ: Record<string, unknown> = { reason: 'y' };
    circ.self = circ;
    await audit.record({ action: 'a', meta: { password: 'x', reason: 'y' } });
    await audit.record({ action: 'b', meta: circ });
    const [a, b] = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(a.meta).toEqual({ password: '[REDACTED]', reason: 'y' });
    expect(b.meta).toEqual({ reason: 'y', self: '[Circular]' });
  });

  it('counts recent failures case-insensitively, within the window, and resets on success', async () => {
    const win = 15 * 60_000;
    await audit.record({ action: 'auth.login_failed', actorUsername: 'bob' });
    clock.advanceMs(10 * 60_000);
    await audit.record({ action: 'auth.login_failed', actorUsername: 'BOB' });
    await audit.record({ action: 'auth.login_failed', actorUsername: 'alice' });
    expect(await audit.countRecentFailures('Bob', win)).toBe(2);
    clock.advanceMs(6 * 60_000); // first failure is now 16 min old
    expect(await audit.countRecentFailures('Bob', win)).toBe(1);
    await audit.record({ action: 'auth.login_succeeded', actorUsername: 'bob' });
    expect(await audit.countRecentFailures('Bob', win)).toBe(0);
    await audit.record({ action: 'auth.login_failed', actorUsername: 'bob' }); // same instant as success
    expect(await audit.countRecentFailures('bob', win)).toBe(1);
    expect(await audit.countRecentFailures('alice', win)).toBe(1);
  });
});
