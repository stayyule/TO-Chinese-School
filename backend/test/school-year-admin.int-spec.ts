import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { SessionService } from '../src/auth/session.service';
import { Clock, FixedClock } from '../src/common/clock';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const CSRF = 'csrf-token-for-tests';
const NOT_FOUND_ID = 2_000_000_000;

const body = (over: Record<string, unknown> = {}) => ({
  name: '2027-2028',
  description: 'next year',
  ageCutoffMonth: 9,
  startDate: '2027-09-05',
  endDate: '2028-06-04',
  earlyRegistrationStartDate: '2027-03-01',
  earlyRegistrationEndDate: '2027-04-01',
  registrationStartDate: '2027-04-02',
  registration75PercentDate: '2027-07-01',
  registrationEndDate: '2027-09-01',
  refund90PercentDate: '2027-09-06',
  refund50PercentDate: '2027-10-01',
  refundEndDate: '2027-11-01',
  registrationFee: 2000,
  earlyRegistrationTuition: 36000,
  tuition: 38000,
  electiveClassFee: 5000,
  tuitionDiscountForThreeOrMoreChild: 3800,
  tuitionDiscountForPreK: 4000,
  tuitionDiscountForInstructor: 0,
  pvaMembershipDue: 1500,
  cccaMembershipDue: 2000,
  parentAndStudentClassFee: 3000,
  earlyRegistrationParentAndStudentClassFee: 2800,
  ...over,
});

const dbDate = (s: string) => new Date(`${s}T00:00:00Z`);
/** A year inserted straight into the database. */
const rowData = (name: string, start: string, end: string, extra: object = {}) => ({
  name,
  startDate: dbDate(start),
  endDate: dbDate(end),
  ageCutoffMonth: 9,
  earlyRegistrationStartDate: dbDate(start),
  earlyRegistrationEndDate: dbDate(start),
  registrationStartDate: dbDate(start),
  registration75PercentDate: dbDate(start),
  registrationEndDate: dbDate(start),
  refund90PercentDate: dbDate(start),
  refund50PercentDate: dbDate(start),
  refundEndDate: dbDate(end),
  registrationFeeInCents: 2000,
  earlyRegistrationTuitionInCents: 36000,
  tuitionInCents: 38000,
  electiveClassFeeInCents: 5000,
  tuitionDiscountForThreeOrMoreChildInCents: 3800,
  tuitionDiscountForPreKInCents: 4000,
  tuitionDiscountForInstructorInCents: 0,
  pvaMembershipDueInCents: 1500,
  cccaMembershipDueInCents: 2000,
  parentAndStudentClassFeeInCents: 3000,
  earlyRegistrationParentAndStudentClassFeeInCents: 2800,
  ...extra,
});

type Method = 'get' | 'post' | 'patch';

describe('school year administration API (app connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-11-02T20:00:00Z')); // Pacific 2026-11-02
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let sidReg: string, sidParent: string;
  let pastId: number, currentId: number;

  const http = () => request(app.getHttpServer());
  const call = (method: Method, url: string, sid?: string, payload?: object) => {
    let r = http()[method](`/api/v1${url}`);
    r = r.set('Cookie', [...(sid ? [`tocs_session=${sid}`] : []), `tocs_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);
    return payload === undefined ? r : r.send(payload);
  };

  async function userWithSession(username: string, roleName: string): Promise<string> {
    const user = await admin.user.create({ data: { username } });
    const role = await admin.role.findFirstOrThrow({ where: { name: roleName } });
    await admin.roleUser.create({ data: { roleId: role.id, userId: user.id } });
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
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase();
    await seed(appPrisma);
    // Inserted out of date order on purpose.
    currentId = (await admin.schoolYear.create({ data: rowData('2026-2027', '2026-09-06', '2027-06-06') })).id;
    pastId = (await admin.schoolYear.create({ data: rowData('2024-2025', '2024-09-01', '2025-06-01') })).id;
    sidReg = await userWithSession('reg', 'Registration Officer');
    sidParent = await userWithSession('alice', 'Student Parent');
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('access control', () => {
    const routes = (): [Method, string, object | undefined][] => [
      ['get', '/school-years', undefined],
      ['get', `/school-years/${currentId}`, undefined],
      ['post', '/school-years', body()],
      ['patch', `/school-years/${currentId}`, { tuition: 39000 }],
      ['post', `/school-years/${currentId}/auto-class-assignment/toggle`, undefined],
    ];

    it('anonymous requests get 401', async () => {
      for (const [m, u, b] of routes()) expect([m, u, (await call(m, u, undefined, b)).status]).toEqual([m, u, 401]);
    });

    it('a Student Parent gets 403 and nothing changes', async () => {
      for (const [m, u, b] of routes()) expect([m, u, (await call(m, u, sidParent, b)).status]).toEqual([m, u, 403]);
      expect(await admin.schoolYear.count()).toBe(2);
      const row = await admin.schoolYear.findUniqueOrThrow({ where: { id: currentId } });
      expect(row.tuitionInCents).toBe(38000);
      expect(row.autoClassAssignment).toBe(false);
    });

    it('a Registration Officer is allowed on every route', async () => {
      for (const [m, u, b] of routes()) {
        const res = await call(m, u, sidReg, b);
        expect([m, u, res.status < 300]).toEqual([m, u, true]);
      }
    });
  });

  describe('list and get', () => {
    it('lists years ordered by start date ascending with money in cents and dates as strings', async () => {
      const res = await call('get', '/school-years', sidReg);
      expect(res.status).toBe(200);
      expect(res.body.map((y: { name: string }) => y.name)).toEqual(['2024-2025', '2026-2027']);
      expect(res.body[1]).toMatchObject({ id: currentId, tuition: 38000, startDate: '2026-09-06', autoClassAssignment: false });
      expect(res.body[1]).not.toHaveProperty('registration50PercentDate');
      expect(res.body[1]).not.toHaveProperty('refund25PercentDate');
    });

    it('404s an unknown id, 422s a malformed one, and serves a year that has already ended', async () => {
      expect((await call('get', `/school-years/${NOT_FOUND_ID}`, sidReg)).body.code).toBe('NOT_FOUND');
      expect((await call('get', '/school-years/abc', sidReg)).status).toBe(422);
      const past = await call('get', `/school-years/${pastId}`, sidReg);
      expect(past.status).toBe(200);
      expect(past.body.endDate).toBe('2025-06-01');
    });
  });

  describe('create', () => {
    it('sets the previous year, flags every class and charges 2000 for every grade', async () => {
      const g1 = (await admin.grade.create({ data: { englishName: 'G1' } })).id;
      const g2 = (await admin.grade.create({ data: { englishName: 'G2' } })).id;
      const classes = await Promise.all([1, 2, 3].map(async (n) => (await admin.schoolClass.create({ data: { englishName: `C${n}`, gradeId: g1 } })).id));
      const res = await call('post', '/school-years', sidReg, body());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: '2027-2028', tuition: 38000, startDate: '2027-09-05', previousSchoolYearId: currentId, autoClassAssignment: false });

      const flags = await admin.schoolClassActiveFlag.findMany({ where: { schoolYearId: res.body.id } });
      expect(flags.map((f) => f.schoolClassId).sort()).toEqual([...classes].sort());
      expect(flags.every((f) => f.active)).toBe(true);
      const charges = await admin.bookCharge.findMany({ where: { schoolYearId: res.body.id } });
      expect(charges.map((c) => c.gradeId).sort()).toEqual([g1, g2].sort());
      expect(charges.every((c) => c.bookChargeInCents === 2000)).toBe(true);

      const row = await admin.schoolYear.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.registration50PercentDate).toBeNull();
      expect(row.refund75PercentDate).toBeNull();
      expect(row.refund25PercentDate).toBeNull();
      const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'school_year.created' } });
      expect(audit).toMatchObject({ targetType: 'school_year', targetId: String(res.body.id) });
    });

    it('previous year is the latest year ending on or before the new start, null when none', async () => {
      const first = await call('post', '/school-years', sidReg, body({ name: 'early', startDate: '2020-09-01', endDate: '2021-06-01' }));
      expect(first.status).toBe(201);
      expect(first.body.previousSchoolYearId).toBeNull();
      // an end date exactly equal to the new start counts
      const equal = await call('post', '/school-years', sidReg, body({ name: 'eq', startDate: '2025-06-01', endDate: '2025-12-01' }));
      expect(equal.body.previousSchoolYearId).toBe(pastId);
    });

    it('is atomic: a failure after the inserts leaves no year, flags or charges', async () => {
      const g = (await admin.grade.create({ data: { englishName: 'G1' } })).id;
      await admin.schoolClass.create({ data: { englishName: 'C1', gradeId: g } });
      jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('forced'));
      const res = await call('post', '/school-years', sidReg, body());
      expect(res.status).toBe(500);
      expect(await admin.schoolYear.count()).toBe(2);
      expect(await admin.schoolClassActiveFlag.count()).toBe(0);
      expect(await admin.bookCharge.count()).toBe(0);
    });

    it('two simultaneous creates leave consistent previous links', async () => {
      const [a, b] = await Promise.all([
        call('post', '/school-years', sidReg, body({ name: 'A', startDate: '2028-09-01', endDate: '2029-06-01' })),
        call('post', '/school-years', sidReg, body({ name: 'B', startDate: '2029-06-01', endDate: '2030-06-01' })),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      // Which one committed first is not deterministic: B points at A or at the older year, A at the older year.
      expect([currentId, b.body.id]).toContain(a.body.previousSchoolYearId);
      expect([currentId, a.body.id]).toContain(b.body.previousSchoolYearId);
      expect(a.body.previousSchoolYearId).not.toBe(a.body.id);
      expect(b.body.previousSchoolYearId).not.toBe(b.body.id);
      // no cycle
      expect(a.body.previousSchoolYearId === b.body.id && b.body.previousSchoolYearId === a.body.id).toBe(false);
      const ids = (await admin.schoolYear.findMany({ select: { id: true } })).map((y) => y.id);
      for (const link of [a.body.previousSchoolYearId, b.body.previousSchoolYearId]) expect(ids).toContain(link);
    });

    it('sequential creates chain: a later year points at the one just created', async () => {
      const a = await call('post', '/school-years', sidReg, body({ name: 'A', startDate: '2028-09-01', endDate: '2029-06-01' }));
      const b = await call('post', '/school-years', sidReg, body({ name: 'B', startDate: '2029-06-01', endDate: '2030-06-01' }));
      expect(a.body.previousSchoolYearId).toBe(currentId);
      expect(b.body.previousSchoolYearId).toBe(a.body.id);
    });

    it.each(['2026-9-6', ' 2026-09-06', '2026-09-06 ', '2026/09/06'])('rejects non-canonical date %j with 422 keyed startDate', async (d) => {
      const res = await call('post', '/school-years', sidReg, body({ startDate: d }));
      expect(res.status).toBe(422);
      expect(res.body.details.startDate).toBe('INVALID');
      expect(await admin.schoolYear.count()).toBe(2);
    });

    it('rejects a fee above int4 max with OUT_OF_RANGE keyed tuition', async () => {
      const res = await call('post', '/school-years', sidReg, body({ tuition: 2147483648 }));
      expect(res.status).toBe(422);
      expect(res.body.details.tuition).toBe('OUT_OF_RANGE');
    });

    it('422s invalid input keyed by field and creates nothing', async () => {
      const bad: [Record<string, unknown>, string][] = [
        [{ tuition: 0 }, 'tuition'],
        [{ tuition: 1999.5 }, 'tuition'],
        [{ tuition: '38000' }, 'tuition'],
        [{ startDate: '2026-02-30' }, 'startDate'],
        [{ startDate: '2028-07-01' }, 'startDate'],
        [{ name: '' }, 'name'],
        [{ ageCutoffMonth: 13 }, 'ageCutoffMonth'],
      ];
      for (const [over, field] of bad) {
        const res = await call('post', '/school-years', sidReg, body(over));
        expect([field, res.status, res.body.code]).toEqual([field, 422, 'VALIDATION_ERROR']);
        expect(JSON.stringify(res.body.details)).toContain(field);
      }
      const missing = await call('post', '/school-years', sidReg, { name: 'x' });
      expect(missing.status).toBe(422);
      expect(missing.body.details.tuition).toBe('REQUIRED');
      const unknown = await call('post', '/school-years', sidReg, { ...body(), previousSchoolYearId: 1 });
      expect(unknown.status).toBe(422);
      expect(await admin.schoolYear.count()).toBe(2);
    });

    it('accepts a zero PreK discount', async () => {
      expect((await call('post', '/school-years', sidReg, body({ tuitionDiscountForPreK: 0 }))).status).toBe(201);
    });
  });

  describe('update', () => {
    it('applies fee changes to a year that has ended while its past dates stay frozen', async () => {
      const res = await call('patch', `/school-years/${pastId}`, sidReg, { tuition: 40000, startDate: '2020-01-01', endDate: '2020-06-01', name: 'renamed' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ tuition: 40000, startDate: '2024-09-01', endDate: '2025-06-01', name: 'renamed' });
      const row = await admin.schoolYear.findUniqueOrThrow({ where: { id: pastId } });
      expect(row.tuitionInCents).toBe(40000);
      expect(row.startDate).toEqual(dbDate('2024-09-01'));
      const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'school_year.updated' } });
      expect(audit.targetId).toBe(String(pastId));
      expect(audit.meta).toEqual({ id: pastId, changed: ['name', 'tuition'] });
    });

    it('changes a date that is today or later and never touches previous_school_year_id', async () => {
      await admin.schoolYear.update({ where: { id: currentId }, data: { previousSchoolYearId: pastId, refund90PercentDate: dbDate('2026-11-02') } });
      const res = await call('patch', `/school-years/${currentId}`, sidReg, { startDate: '2026-09-07', refund90PercentDate: '2026-12-01', endDate: '2027-06-07' });
      expect(res.status).toBe(200);
      // startDate 2026-09-06 has passed (frozen); refund90 (today) and endDate (future) change.
      expect(res.body).toMatchObject({ startDate: '2026-09-06', refund90PercentDate: '2026-12-01', endDate: '2027-06-07', previousSchoolYearId: pastId });
    });

    it('refund90PercentDate is frozen when stored past, editable when stored future or empty (D5)', async () => {
      const past = await call('patch', `/school-years/${pastId}`, sidReg, { refund90PercentDate: '2030-01-01' });
      expect(past.body.refund90PercentDate).toBe('2024-09-01');
      await admin.schoolYear.update({ where: { id: currentId }, data: { refund90PercentDate: dbDate('2027-01-01') } });
      const future = await call('patch', `/school-years/${currentId}`, sidReg, { refund90PercentDate: '2027-02-02' });
      expect(future.body.refund90PercentDate).toBe('2027-02-02');
      await admin.schoolYear.update({ where: { id: currentId }, data: { refund90PercentDate: null } });
      const empty = await call('patch', `/school-years/${currentId}`, sidReg, { refund90PercentDate: '2027-03-03' });
      expect(empty.body.refund90PercentDate).toBe('2027-03-03');
    });

    it('validates the merged result', async () => {
      const res = await call('patch', `/school-years/${currentId}`, sidReg, { tuition: 0 });
      expect(res.status).toBe(422);
      expect(res.body.details.tuition).toBe('OUT_OF_RANGE');
      expect((await admin.schoolYear.findUniqueOrThrow({ where: { id: currentId } })).tuitionInCents).toBe(38000);
      expect((await call('patch', `/school-years/${currentId}`, sidReg, { endDate: '2026-01-01' })).body.details.startDate).toBe('INVALID');
    });

    it('404s an unknown id', async () => {
      expect((await call('patch', `/school-years/${NOT_FOUND_ID}`, sidReg, { tuition: 1 })).status).toBe(404);
    });
  });

  describe('auto class assignment toggle', () => {
    it('flips and returns the new value; twice returns to the original', async () => {
      const one = await call('post', `/school-years/${currentId}/auto-class-assignment/toggle`, sidReg);
      expect(one.body).toEqual({ autoClassAssignment: true });
      const two = await call('post', `/school-years/${currentId}/auto-class-assignment/toggle`, sidReg);
      expect(two.body).toEqual({ autoClassAssignment: false });
      expect((await admin.schoolYear.findUniqueOrThrow({ where: { id: currentId } })).autoClassAssignment).toBe(false);
    });

    it('two concurrent toggles end at the original value', async () => {
      const url = `/school-years/${currentId}/auto-class-assignment/toggle`;
      const rs = await Promise.all([call('post', url, sidReg), call('post', url, sidReg)]);
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect((await admin.schoolYear.findUniqueOrThrow({ where: { id: currentId } })).autoClassAssignment).toBe(false);
    });

    it('404s an unknown year', async () => {
      expect((await call('post', `/school-years/${NOT_FOUND_ID}/auto-class-assignment/toggle`, sidReg)).status).toBe(404);
    });
  });
});
