import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';
import { RoleDerivationService } from '../src/access/role-derivation.service';
import { AppModule } from '../src/app.module';
import { Clock, FixedClock } from '../src/common/clock';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const T0 = new Date('2026-10-01T19:00:00Z'); // noon Pacific
const d = (s: string): Date => new Date(`${s}T00:00:00Z`);

describe('RoleDerivationService (app connected as tocs_app)', () => {
  const clock = new FixedClock(T0);
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let service: RoleDerivationService;
  let ids: Record<string, number>;
  let currentYearId: number;
  let pastYearId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(PrismaService)
      .useValue(appPrisma)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RoleDerivationService);
  });

  beforeEach(async () => {
    await resetDatabase();
    await seed(appPrisma);
    const roles = await admin.role.findMany();
    ids = Object.fromEntries(roles.map((r) => [r.name, r.id]));
    pastYearId = (await admin.schoolYear.create({ data: { name: 'past', startDate: d('2025-08-20'), endDate: d('2026-06-10') } })).id;
    currentYearId = (await admin.schoolYear.create({ data: { name: 'current', startDate: d('2026-08-20'), endDate: d('2027-06-10') } })).id;
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  async function userWith(assignments: { role: string; schoolYearId: number }[], startingRoles: string[] = []): Promise<number> {
    const person = await admin.person.create({ data: { englishFirstName: 'Ina', englishLastName: 'Structor' } });
    const user = await admin.user.create({ data: { username: `u${person.id}`, personId: person.id } });
    for (const a of assignments) {
      await admin.instructorAssignment.create({ data: { instructorId: person.id, role: a.role, schoolYearId: a.schoolYearId } });
    }
    for (const r of startingRoles) {
      // Raw insert: the legacy join table may hold duplicates.
      await admin.$executeRaw`INSERT INTO roles_users (role_id, user_id) VALUES (${ids[r]}, ${user.id})`;
    }
    return user.id;
  }

  async function roleNames(userId: number): Promise<string[]> {
    const rows = await admin.roleUser.findMany({ where: { userId }, include: { role: true } });
    return rows.map((r) => r.role.name as string).sort();
  }

  it('Primary Instructor in the current year -> Instructor only', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: currentYearId }]);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual(['Instructor']);
  });

  it('Secondary Instructor in the current year -> Instructor (one row even with two assignments)', async () => {
    const u = await userWith([
      { role: 'Secondary Instructor', schoolYearId: currentYearId },
      { role: 'Primary Instructor', schoolYearId: currentYearId },
    ]);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual(['Instructor']);
  });

  it('Room Parent in the current year -> Room Parent only', async () => {
    const u = await userWith([{ role: 'Room Parent', schoolYearId: currentYearId }]);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual(['Room Parent']);
  });

  it('Teaching Assistant -> neither', async () => {
    const u = await userWith([{ role: 'Teaching Assistant', schoolYearId: currentYearId }]);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual([]);
  });

  it('an assignment in a non-current year -> neither, and stale (duplicate) derived rows are removed', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: pastYearId }], ['Instructor', 'Instructor', 'Room Parent']);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual([]);
  });

  it('keeps unrelated roles and collapses duplicate derived rows to exactly one', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: currentYearId }], ['Student Parent', 'Instructor', 'Instructor']);
    await service.adjust(u);
    expect(await roleNames(u)).toEqual(['Instructor', 'Student Parent']);
  });

  it('no current school year -> removes both roles and does not throw', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: currentYearId }], ['Instructor', 'Room Parent', 'Student Parent']);
    clock.set(new Date('2027-07-01T19:00:00Z')); // after every year's end date
    try {
      await expect(service.adjust(u)).resolves.toBeUndefined();
    } finally {
      clock.set(T0);
    }
    expect(await roleNames(u)).toEqual(['Student Parent']);
  });

  it('runs inside a caller transaction (rolled back with it)', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: currentYearId }]);
    await expect(
      appPrisma.$transaction(async (tx) => {
        await service.adjust(u, tx);
        expect(await tx.roleUser.count({ where: { userId: u } })).toBe(1);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await roleNames(u)).toEqual([]);
  });

  it('concurrent adjusts for one user leave exactly one Instructor row', async () => {
    const u = await userWith([{ role: 'Primary Instructor', schoolYearId: currentYearId }]);
    await Promise.all(Array.from({ length: 5 }, () => service.adjust(u)));
    expect(await roleNames(u)).toEqual(['Instructor']);
  });
});
