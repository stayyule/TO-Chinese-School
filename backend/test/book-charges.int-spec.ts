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
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const CSRF = 'csrf-token-for-tests';
const dbDate = (s: string) => new Date(`${s}T00:00:00Z`);
const yearData = (name: string, start: string, end: string) => ({ name, startDate: dbDate(start), endDate: dbDate(end) });

describe('book charges API (app connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-11-02T20:00:00Z'));
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let sidReg: string, sidParent: string;
  let yearA: number, yearB: number;
  let g1: number, g2: number;
  let chargesA: { id: number; gradeId: number }[];
  let chargeB: number;

  const call = (method: 'get' | 'put', url: string, sid?: string, payload?: unknown) => {
    const server = request(app.getHttpServer());
    const r = server[method](`/api/v1${url}`)
      .set('Cookie', [...(sid ? [`tocs_session=${sid}`] : []), `tocs_csrf=${CSRF}`])
      .set('X-CSRF-Token', CSRF);
    return payload === undefined ? r : r.send(payload as object);
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
    await resetDatabase();
    await seed(appPrisma);
    yearA = (await admin.schoolYear.create({ data: yearData('2026-2027', '2026-09-06', '2027-06-06') })).id;
    yearB = (await admin.schoolYear.create({ data: yearData('2027-2028', '2027-09-05', '2028-06-04') })).id;
    g2 = (await admin.grade.create({ data: { englishName: 'Two', chineseName: '二年级' } })).id;
    g1 = (await admin.grade.create({ data: { englishName: 'One', chineseName: '一年级' } })).id;
    // Inserted with the higher grade id's row first so charge-id order differs from grade_id order.
    chargesA = [];
    for (const gradeId of [g1, g2]) {
      chargesA.push(await admin.bookCharge.create({ data: { gradeId, schoolYearId: yearA, bookChargeInCents: 2000 }, select: { id: true, gradeId: true } }));
    }
    chargesA.reverse(); // [g2 row, g1 row]
    chargeB = (await admin.bookCharge.create({ data: { gradeId: g1, schoolYearId: yearB, bookChargeInCents: 3000 } })).id;
    sidReg = await userWithSession('reg', 'Registration Officer');
    sidParent = await userWithSession('alice', 'Student Parent');
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  const snapshot = async () => (await admin.bookCharge.findMany({ orderBy: { id: 'asc' } })).map((c) => [c.id, c.bookChargeInCents]);

  it('requires authentication and permission (401 / 403, nothing changes)', async () => {
    const before = await snapshot();
    const put = [{ id: chargesA[0].id, bookChargeInCents: 1 }];
    expect((await call('get', `/school-years/${yearA}/book-charges`)).status).toBe(401);
    expect((await call('put', `/school-years/${yearA}/book-charges`, undefined, put)).status).toBe(401);
    expect((await call('get', `/school-years/${yearA}/book-charges`, sidParent)).status).toBe(403);
    expect((await call('put', `/school-years/${yearA}/book-charges`, sidParent, put)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it('lists a year charges ordered by grade_id with the grade name', async () => {
    const res = await call('get', `/school-years/${yearA}/book-charges`, sidReg);
    expect(res.status).toBe(200);
    const byGrade = new Map(chargesA.map((c) => [c.gradeId, c.id]));
    expect(res.body.map((r: { gradeId: number }) => r.gradeId)).toEqual([g1, g2].sort((a, b) => a - b));
    expect(res.body.find((r: { gradeId: number }) => r.gradeId === g1)).toEqual({ id: byGrade.get(g1), gradeId: g1, gradeName: '一年级(One)', bookChargeInCents: 2000 });
    expect(res.body.find((r: { gradeId: number }) => r.gradeId === g2).gradeName).toBe('二年级(Two)');
  });

  it('404s an unknown year', async () => {
    expect((await call('get', '/school-years/2000000000/book-charges', sidReg)).status).toBe(404);
    expect((await call('put', '/school-years/2000000000/book-charges', sidReg, [{ id: 1, bookChargeInCents: 1 }])).status).toBe(404);
  });

  it('reads back exactly 1999 for 1999 and audits the change', async () => {
    const res = await call('put', `/school-years/${yearA}/book-charges`, sidReg, [
      { id: chargesA[0].id, bookChargeInCents: 1999 },
      { id: chargesA[1].id, bookChargeInCents: 0 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.find((r: { id: number }) => r.id === chargesA[0].id).bookChargeInCents).toBe(1999);
    const got = await call('get', `/school-years/${yearA}/book-charges`, sidReg);
    expect(got.body.map((r: { bookChargeInCents: number }) => r.bookChargeInCents).sort()).toEqual([0, 1999]);
    expect((await admin.bookCharge.findUniqueOrThrow({ where: { id: chargesA[0].id } })).bookChargeInCents).toBe(1999);
    expect((await admin.bookCharge.findUniqueOrThrow({ where: { id: chargeB } })).bookChargeInCents).toBe(3000);
    const audit = await admin.auditLog.findFirstOrThrow({ where: { action: 'school_year.book_charges_updated' } });
    expect(audit.targetId).toBe(String(yearA));
    expect(audit.meta).toMatchObject({ schoolYearId: yearA, changed: 2 });
  });

  it.each([
    ['non-integer', [{ id: 0, bookChargeInCents: 1999.5 }]],
    ['string', [{ id: 0, bookChargeInCents: '1999' }]],
    ['negative', [{ id: 0, bookChargeInCents: -1 }]],
    ['above int4', [{ id: 0, bookChargeInCents: 2147483648 }]],
    ['missing value', [{ id: 0 }]],
    ['extra field', [{ id: 0, bookChargeInCents: 5, gradeId: 1 }]],
    ['empty array', []],
    ['not an array', { id: 0, bookChargeInCents: 5 }],
  ])('rejects %s with 422 and changes nothing', async (_n, payload) => {
    const before = await snapshot();
    const fixed = JSON.parse(JSON.stringify(payload), (k, v) => (k === 'id' && v === 0 ? chargesA[0].id : v));
    const res = await call('put', `/school-years/${yearA}/book-charges`, sidReg, fixed);
    expect(res.status).toBe(422);
    expect(await snapshot()).toEqual(before);
  });

  it('accepts int4 max exactly', async () => {
    const res = await call('put', `/school-years/${yearA}/book-charges`, sidReg, [{ id: chargesA[0].id, bookChargeInCents: 2147483647 }]);
    expect(res.status).toBe(200);
    expect((await admin.bookCharge.findUniqueOrThrow({ where: { id: chargesA[0].id } })).bookChargeInCents).toBe(2147483647);
  });

  it('a batch with one negative value changes no row', async () => {
    const before = await snapshot();
    const res = await call('put', `/school-years/${yearA}/book-charges`, sidReg, [
      { id: chargesA[0].id, bookChargeInCents: 500 },
      { id: chargesA[1].id, bookChargeInCents: -5 },
    ]);
    expect(res.status).toBe(422);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects an id from another year, an unknown id, and duplicate ids (422, nothing changes)', async () => {
    const before = await snapshot();
    for (const payload of [
      [{ id: chargesA[0].id, bookChargeInCents: 500 }, { id: chargeB, bookChargeInCents: 1 }],
      [{ id: chargesA[0].id, bookChargeInCents: 500 }, { id: 2000000000, bookChargeInCents: 1 }],
      [{ id: chargesA[0].id, bookChargeInCents: 500 }, { id: chargesA[0].id, bookChargeInCents: 600 }],
    ]) {
      const res = await call('put', `/school-years/${yearA}/book-charges`, sidReg, payload);
      expect(res.status).toBe(422);
      expect(await snapshot()).toEqual(before);
    }
    const bad = await call('put', `/school-years/${yearA}/book-charges`, sidReg, [{ id: chargeB, bookChargeInCents: 1 }]);
    expect(bad.body.code).toBe('INVALID_BOOK_CHARGE');
  });
});
