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
type Method = 'get' | 'post' | 'patch' | 'put';

describe('grades and school classes API (app connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-11-02T20:00:00Z'));
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let sidReg: string, sidParent: string;
  let currentId: number, nextId: number;

  const call = (method: Method, url: string, sid?: string, payload?: unknown) => {
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
  const cls = (over: Record<string, unknown> = {}) => ({ englishName: 'Class A', chineseName: '甲班', schoolClassType: 'T', ...over });
  const flags = (schoolClassId: number) => admin.schoolClassActiveFlag.findMany({ where: { schoolClassId }, orderBy: { schoolYearId: 'asc' } });
  const rawClass = (english: string, chinese: string) =>
    admin.schoolClass.create({ data: { englishName: english, chineseName: chinese, schoolClassType: 'T', maxSize: 25 } });

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
    await admin.schoolYear.create({ data: yearData('2024-2025', '2024-09-01', '2025-06-01') });
    currentId = (await admin.schoolYear.create({ data: yearData('2026-2027', '2026-09-06', '2027-06-06') })).id;
    nextId = (await admin.schoolYear.create({ data: yearData('2027-2028', '2027-09-05', '2028-06-04') })).id;
    sidReg = await userWithSession('reg', 'Registration Officer');
    sidParent = await userWithSession('alice', 'Student Parent');
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('access control', () => {
    it('401 anonymous, 403 for a Student Parent, nothing changes', async () => {
      const c = await rawClass('X', '乙');
      const routes: [Method, string, unknown][] = [
        ['get', '/grades', undefined],
        ['get', '/school-classes', undefined],
        ['post', '/school-classes', cls()],
        ['patch', `/school-classes/${c.id}`, { location: 'x' }],
        ['put', `/school-classes/${c.id}/active`, { schoolYearId: currentId, active: true }],
      ];
      for (const [m, u, b] of routes) {
        expect([m, u, (await call(m, u, undefined, b)).status]).toEqual([m, u, 401]);
        expect([m, u, (await call(m, u, sidParent, b)).status]).toEqual([m, u, 403]);
      }
      expect(await admin.schoolClass.count()).toBe(1);
      expect(await admin.schoolClassActiveFlag.count()).toBe(0);
    });
  });

  describe('grades', () => {
    it('follows the next_grade chain from Pre', async () => {
      const g1 = await admin.grade.create({ data: { englishName: 'First', shortName: '1' } });
      const k = await admin.grade.create({ data: { englishName: 'K', shortName: 'K', nextGrade: g1.id } });
      const pre = await admin.grade.create({ data: { englishName: 'PreK', shortName: 'Pre', nextGrade: k.id } });
      const res = await call('get', '/grades', sidReg);
      expect(res.status).toBe(200);
      expect(res.body.map((g: { id: number }) => g.id)).toEqual([pre.id, k.id, g1.id]);
      expect(res.body[0]).toMatchObject({ id: pre.id, shortName: 'Pre', englishName: 'PreK', nextGradeId: k.id });
      expect(res.body[2].nextGradeId).toBeNull();
    });

    it('appends grades off the chain in id order and terminates on a cycle', async () => {
      const orphan1 = await admin.grade.create({ data: { englishName: 'O1' } });
      const a = await admin.grade.create({ data: { englishName: 'A', shortName: 'Pre' } });
      const b = await admin.grade.create({ data: { englishName: 'B', nextGrade: a.id } });
      await admin.grade.update({ where: { id: a.id }, data: { nextGrade: b.id } });
      const orphan2 = await admin.grade.create({ data: { englishName: 'O2' } });
      const res = await call('get', '/grades', sidReg);
      expect(res.body.map((g: { id: number }) => g.id)).toEqual([a.id, b.id, orphan1.id, orphan2.id]);
    });

    it('with no Pre grade returns every grade in id order', async () => {
      const x = await admin.grade.create({ data: { englishName: 'X' } });
      const y = await admin.grade.create({ data: { englishName: 'Y' } });
      expect((await call('get', '/grades', sidReg)).body.map((g: { id: number }) => g.id)).toEqual([x.id, y.id]);
    });
  });

  describe('create', () => {
    it('creates the class with defaults and an active flag for every current-and-future year only', async () => {
      const res = await call('post', '/school-classes', sidReg, cls({ chineseName: '中文班' }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ englishName: 'Class A', chineseName: '中文班', schoolClassType: 'T', maxSize: 25, minAge: null, maxAge: null, gradeId: null });
      const fl = await flags(res.body.id);
      expect(fl.map((f) => [f.schoolYearId, f.active])).toEqual([[currentId, true], [nextId, true]]);
      expect((await admin.schoolClass.findUniqueOrThrow({ where: { id: res.body.id } })).chineseName).toBe('中文班');
    });

    it('accepts every listed type, optional fields and an existing grade', async () => {
      const grade = await admin.grade.create({ data: { englishName: 'G' } });
      let n = 0;
      for (const t of ['S', 'T', 'M', 'SE', 'ELECTIVE', 'EC', 'ECPS']) {
        n += 1;
        const res = await call(
          'post',
          '/school-classes',
          sidReg,
          cls({ englishName: `E${n}`, chineseName: `C${n}`, schoolClassType: t, maxSize: 30, minAge: 5, maxAge: 9, gradeId: grade.id, shortName: 's', description: 'd', location: 'room 1' }),
        );
        expect([t, res.status]).toEqual([t, 201]);
        expect(res.body).toMatchObject({ schoolClassType: t, maxSize: 30, minAge: 5, maxAge: 9, gradeId: grade.id, location: 'room 1' });
      }
    });

    it('creates no flag rows when no year is current or future', async () => {
      await admin.schoolYear.deleteMany({ where: { id: { in: [currentId, nextId] } } });
      const res = await call('post', '/school-classes', sidReg, cls());
      expect(res.status).toBe(201);
      expect(await flags(res.body.id)).toEqual([]);
    });

    it('409 NAME_TAKEN for a duplicate English or Chinese name, nothing created', async () => {
      expect((await call('post', '/school-classes', sidReg, cls())).status).toBe(201);
      const e = await call('post', '/school-classes', sidReg, cls({ chineseName: '别的' }));
      expect([e.status, e.body.code]).toEqual([409, 'NAME_TAKEN']);
      const c = await call('post', '/school-classes', sidReg, cls({ englishName: 'Other' }));
      expect([c.status, c.body.code]).toEqual([409, 'NAME_TAKEN']);
      const trimmed = await call('post', '/school-classes', sidReg, cls({ englishName: '  Class A ', chineseName: '又' }));
      expect(trimmed.status).toBe(409);
      expect(await admin.schoolClass.count()).toBe(1);
    });

    it('concurrent creates with the same name give one 201 and one 409', async () => {
      const results = await Promise.all([
        call('post', '/school-classes', sidReg, cls({ chineseName: '甲' })),
        call('post', '/school-classes', sidReg, cls({ chineseName: '乙' })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await admin.schoolClass.count()).toBe(1);
    });

    it.each([
      ['maxSize 0', { maxSize: 0 }],
      ['maxSize negative', { maxSize: -3 }],
      ['maxSize fractional', { maxSize: 2.5 }],
      ['maxSize above int4', { maxSize: 2147483648 }],
      ['maxSize null', { maxSize: null }],
      ['type XX', { schoolClassType: 'XX' }],
      ['type missing', { schoolClassType: undefined }],
      ['english name blank', { englishName: '  ' }],
      ['chinese name missing', { chineseName: undefined }],
      ['minAge negative', { minAge: -1 }],
      ['maxAge fractional', { maxAge: 1.5 }],
      ['minAge string', { minAge: '5' }],
      ['unknown grade', { gradeId: 2000000000 }],
      ['unknown field', { bogus: 1 }],
    ])('422 for %s', async (_n, over) => {
      const res = await call('post', '/school-classes', sidReg, cls(over));
      expect(res.status).toBe(422);
      expect(await admin.schoolClass.count()).toBe(0);
    });
  });

  describe('update', () => {
    let id: number;
    beforeEach(async () => {
      id = (await call('post', '/school-classes', sidReg, cls())).body.id;
      await call('post', '/school-classes', sidReg, cls({ englishName: 'Class B', chineseName: '乙班' }));
    });

    it('partially updates fields and keeps the rest', async () => {
      const res = await call('patch', `/school-classes/${id}`, sidReg, { location: 'Room 9', maxSize: 18, minAge: null, schoolClassType: 'S' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, englishName: 'Class A', chineseName: '甲班', location: 'Room 9', maxSize: 18, schoolClassType: 'S' });
    });

    it('allows re-sending its own names but 409s taking another class name; renames work', async () => {
      expect((await call('patch', `/school-classes/${id}`, sidReg, { englishName: 'Class A', chineseName: '甲班' })).status).toBe(200);
      const clash = await call('patch', `/school-classes/${id}`, sidReg, { englishName: 'Class B' });
      expect([clash.status, clash.body.code]).toEqual([409, 'NAME_TAKEN']);
      const clash2 = await call('patch', `/school-classes/${id}`, sidReg, { chineseName: '乙班' });
      expect(clash2.status).toBe(409);
      const ok = await call('patch', `/school-classes/${id}`, sidReg, { englishName: 'Class C' });
      expect([ok.status, ok.body.englishName]).toEqual([200, 'Class C']);
    });

    it('404 unknown class, 422 invalid values (nothing changes)', async () => {
      expect((await call('patch', '/school-classes/2000000000', sidReg, { location: 'x' })).status).toBe(404);
      expect((await call('patch', `/school-classes/${id}`, sidReg, { maxSize: 0 })).status).toBe(422);
      expect((await call('patch', `/school-classes/${id}`, sidReg, { schoolClassType: 'XX' })).status).toBe(422);
      expect((await call('patch', `/school-classes/${id}`, sidReg, { englishName: '' })).status).toBe(422);
      expect((await call('patch', `/school-classes/${id}`, sidReg, { gradeId: 2000000000 })).status).toBe(422);
      expect((await admin.schoolClass.findUniqueOrThrow({ where: { id } })).maxSize).toBe(25);
    });
  });

  describe('list and toggle', () => {
    it('lists classes by English name with activeCurrent/activeNext', async () => {
      const b = (await call('post', '/school-classes', sidReg, cls({ englishName: 'Beta', chineseName: 'B' }))).body.id;
      const a = (await call('post', '/school-classes', sidReg, cls({ englishName: 'Alpha', chineseName: 'A' }))).body.id;
      await call('put', `/school-classes/${b}/active`, sidReg, { schoolYearId: nextId, active: false });
      const res = await call('get', '/school-classes', sidReg);
      expect(res.status).toBe(200);
      expect(res.body.map((c: { id: number }) => c.id)).toEqual([a, b]);
      expect(res.body[0]).toMatchObject({ englishName: 'Alpha', activeCurrent: true, activeNext: true, maxSize: 25 });
      expect(res.body[1]).toMatchObject({ activeCurrent: true, activeNext: false });
    });

    it('a missing flag row counts as false; both flags are false when no current year exists', async () => {
      const id = (await call('post', '/school-classes', sidReg, cls())).body.id;
      await admin.schoolClassActiveFlag.deleteMany({ where: { schoolYearId: nextId } });
      expect((await call('get', '/school-classes', sidReg)).body[0]).toMatchObject({ activeCurrent: true, activeNext: false });
      await admin.schoolClassActiveFlag.deleteMany({ where: { schoolClassId: id } });
      await admin.schoolYear.deleteMany({ where: { id: { in: [currentId, nextId] } } });
      expect((await call('get', '/school-classes', sidReg)).body[0]).toMatchObject({ activeCurrent: false, activeNext: false });
    });

    it('toggling for a year with no flag row creates it; toggling again updates it (one row), and audits', async () => {
      const id = (await rawClass('Z', 'Z')).id;
      const on = await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: currentId, active: true });
      expect(on.status).toBe(200);
      expect(on.body).toEqual({ schoolClassId: id, schoolYearId: currentId, active: true });
      await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: currentId, active: false });
      await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: currentId, active: false });
      const fl = await flags(id);
      expect(fl.map((f) => [f.schoolYearId, f.active])).toEqual([[currentId, false]]);
      const audits = await admin.auditLog.findMany({ where: { action: 'school_class.active_changed' }, orderBy: { id: 'asc' } });
      expect(audits).toHaveLength(3);
      expect(audits[0].meta).toMatchObject({ schoolClassId: id, schoolYearId: currentId, active: true });
    });

    it('concurrent toggles of a missing flag leave exactly one row', async () => {
      const id = (await rawClass('Z', 'Z')).id;
      const results = await Promise.all([true, false, true, false, true].map((active) => call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: nextId, active })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(await flags(id)).toHaveLength(1);
    });

    it('404 for an unknown class or school year, 422 for a bad body', async () => {
      const id = (await call('post', '/school-classes', sidReg, cls())).body.id;
      expect((await call('put', '/school-classes/2000000000/active', sidReg, { schoolYearId: currentId, active: true })).status).toBe(404);
      expect((await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: 2000000000, active: true })).status).toBe(404);
      expect((await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: currentId, active: 'yes' })).status).toBe(422);
      expect((await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: currentId })).status).toBe(422);
      expect((await call('put', `/school-classes/${id}/active`, sidReg, { schoolYearId: 1.5, active: true })).status).toBe(422);
    });
  });
});
