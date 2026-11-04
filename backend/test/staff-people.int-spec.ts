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
const NOT_FOUND_ID = 2_000_000_000;

const address = {
  street: '1 New St',
  city: 'Newbury Park',
  state: 'CA',
  zipcode: '91320',
  homePhone: '(805) 555-0001',
  cellPhone: '',
  email: 'new@example.com',
};
const adult = { englishFirstName: 'Sam', englishLastName: 'Second', gender: 'M' };
const child = { englishFirstName: 'Kid', englishLastName: 'New', gender: 'F', birthYear: 2018, birthMonth: 4 };

type Method = 'get' | 'post' | 'patch';

describe('registration officer people and family API (app connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-10-01T19:00:00Z'));
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;

  let famA: number, parentA1: number, childA: number, noAddrPerson: number;
  let sidReg: string, sidParent: string, sidSuper: string, sidReadOnly: string;

  const http = () => request(app.getHttpServer());
  const call = (method: Method, url: string, sid?: string, body?: object) => {
    let r = http()[method](`/api/v1${url}`);
    // CSRF is always satisfied so anonymous mutations are rejected for authentication, not for the missing token.
    r = r.set('Cookie', [...(sid ? [`tocs_session=${sid}`] : []), `tocs_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);
    return body === undefined ? r : r.send(body);
  };

  async function userWithSession(username: string, personId: number | null, roleName: string): Promise<string> {
    const user = await admin.user.create({ data: { username, personId } });
    const role = await admin.role.findFirstOrThrow({ where: { name: roleName } });
    await admin.roleUser.create({ data: { roleId: role.id, userId: user.id } });
    return (await app.get(SessionService).create(user.id, {})).id;
  }
  const person = async (first: string, last: string, extra: object = {}) =>
    (await admin.person.create({ data: { englishFirstName: first, englishLastName: last, gender: 'F', ...extra } })).id;

  /** All 10 route shapes (11 handlers: GET /people and GET /people/:id included) with valid bodies and the permission each needs. */
  const routes = (): [Method, string, object | undefined, string][] => [
    ['get', '/people', undefined, 'people.read'],
    ['get', `/people/${parentA1}`, undefined, 'people.read'],
    ['patch', `/people/${parentA1}`, { ...adult, englishFirstName: 'Hacked' }, 'people.edit'],
    ['post', `/people/${noAddrPerson}/address`, address, 'people.address.create'],
    ['patch', `/people/${parentA1}/address`, address, 'people.address.edit'],
    ['get', `/families/${famA}`, undefined, 'families.read'],
    ['post', '/families', { address, parentOne: adult }, 'families.create'],
    ['patch', `/families/${famA}/address`, address, 'families.address.edit'],
    ['post', `/families/${famA}/parents`, adult, 'families.parent.add'],
    ['post', `/families/${famA}/children`, child, 'families.child.add'],
  ];

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
    parentA1 = await person('Alice', 'Able');
    childA = await person('Amy', 'Able', { birthYear: 2016, birthMonth: 3, chineseName: 'Amy-zh' });
    noAddrPerson = await person('Nora', 'Noaddr');
    const addrA = (
      await admin.address.create({ data: { street: '10 A St', city: 'Thousand Oaks', state: 'CA', zipcode: '91360', homePhone: '8055551234', email: 'a@example.com' } })
    ).id;
    await admin.person.update({ where: { id: parentA1 }, data: { addressId: addrA } });
    famA = (await admin.family.create({ data: { parentOneId: parentA1, addressId: addrA } })).id;
    await admin.familyChild.create({ data: { familyId: famA, childId: childA } });
    sidReg = await userWithSession('reg', await person('Rita', 'Registrar'), 'Registration Officer');
    sidParent = await userWithSession('alice', parentA1, 'Student Parent');
    sidSuper = await userWithSession('root', null, 'Super User');
    const readRole = await admin.role.create({ data: { name: 'Read Only People' } });
    const perm = await admin.permission.findUniqueOrThrow({ where: { code: 'people.read' } });
    await admin.rolePermission.create({ data: { roleId: readRole.id, permissionId: perm.id } });
    const u = await admin.user.create({ data: { username: 'readonly' } });
    await admin.roleUser.create({ data: { roleId: readRole.id, userId: u.id } });
    sidReadOnly = (await app.get(SessionService).create(u.id, {})).id;
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('access control', () => {
    it('anonymous requests get 401 on every route', async () => {
      for (const [method, url, body] of routes()) {
        const res = await call(method, url, undefined, body);
        expect([method, url, res.status]).toEqual([method, url, 401]);
      }
    });

    it('a Student Parent gets 403 on every route and nothing changes', async () => {
      const before = await admin.person.count();
      const families = await admin.family.count();
      for (const [method, url, body] of routes()) {
        const res = await call(method, url, sidParent, body);
        expect([method, url, res.status]).toEqual([method, url, 403]);
      }
      expect(await admin.person.count()).toBe(before);
      expect(await admin.family.count()).toBe(families);
    });

    it('a user with only people.read can read but every other route is 403', async () => {
      for (const [method, url, body, code] of routes()) {
        const res = await call(method, url, sidReadOnly, body);
        const expected = code === 'people.read' ? 200 : 403;
        expect([method, url, res.status]).toEqual([method, url, expected]);
      }
    });

    it('Super User works without grants', async () => {
      const res = await call('get', `/people/${parentA1}`, sidSuper);
      expect(res.status).toBe(200);
      const created = await call('post', '/families', sidSuper, { address, parentOne: adult });
      expect(created.status).toBe(201);
    });
  });

  describe('people', () => {
    it('searches by name with total', async () => {
      const res = await call('get', '/people?query=able', sidReg);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((p: { englishFirstName: string }) => p.englishFirstName)).toEqual(['Alice', 'Amy']);
    });

    it('clamps pageSize 1000 to 100', async () => {
      await admin.person.createMany({ data: Array.from({ length: 120 }, (_, i) => ({ englishFirstName: `P${i}`, englishLastName: 'Many', gender: 'M' })) });
      const res = await call('get', '/people?query=many&pageSize=1000', sidReg);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(120);
      expect(res.body.items).toHaveLength(100);
      const page2 = await call('get', '/people?query=many&pageSize=100&page=2', sidReg);
      expect(page2.body.items).toHaveLength(20);
    });

    it('defaults pageSize to 25 and page to 1', async () => {
      await admin.person.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ englishFirstName: `P${i}`, englishLastName: 'Many', gender: 'M' })) });
      const res = await call('get', '/people?query=many', sidReg);
      expect(res.body.items).toHaveLength(25);
    });

    it('accepts page 1000000 (empty page) but rejects 1000001 with 422 keyed page (no int4 skip overflow)', async () => {
      const ok = await call('get', '/people?page=1000000&pageSize=100', sidReg);
      expect(ok.status).toBe(200);
      expect(ok.body.items).toEqual([]);
      const res = await call('get', '/people?page=1000001&pageSize=100', sidReg);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.details)).toEqual(['page']);
    });

    it.each(['page=abc', 'pageSize=abc', 'page=0', 'pageSize=0', 'page=-1', 'page=1.5', `query=${'a'.repeat(101)}`, 'query=a%00b'])(
      'rejects bad query parameter %s with 422 keyed by field',
      async (qs) => {
        const res = await call('get', `/people?${qs}`, sidReg);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(Object.keys(res.body.details)).toEqual([qs.split('=')[0]]);
      },
    );

    it('shows a person with address and families, without user rows or hashes', async () => {
      const res = await call('get', `/people/${childA}`, sidReg);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: childA, englishFirstName: 'Amy', chineseName: 'Amy-zh', address: null });
      expect(res.body.families).toHaveLength(1);
      expect(res.body.families[0]).toMatchObject({ id: famA, parentOne: { englishFirstName: 'Alice' } });
      const parent = await call('get', `/people/${parentA1}`, sidReg);
      expect(parent.body.address).toMatchObject({ street: '10 A St', homePhone: '(805) 555-1234' });
      for (const key of ['users', 'user', 'password', 'passwordHash', 'studentClassAssignments']) expect(parent.body).not.toHaveProperty(key);
      expect(JSON.stringify(parent.body)).not.toMatch(/hash|password/i);
    });

    it('404s unknown ids and 422s malformed ids', async () => {
      expect((await call('get', `/people/${NOT_FOUND_ID}`, sidReg)).body.code).toBe('NOT_FOUND');
      expect((await call('patch', `/people/${NOT_FOUND_ID}`, sidReg, adult)).status).toBe(404);
      expect((await call('post', `/people/${NOT_FOUND_ID}/address`, sidReg, address)).status).toBe(404);
      expect((await call('patch', `/people/${NOT_FOUND_ID}/address`, sidReg, address)).status).toBe(404);
      expect((await call('get', '/people/abc', sidReg)).status).toBe(422);
    });

    it('edits any person and returns the updated resource', async () => {
      const res = await call('patch', `/people/${childA}`, sidReg, { ...child, englishFirstName: 'Amelia' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: childA, englishFirstName: 'Amelia', birthYear: 2018 });
      expect((await admin.person.findUniqueOrThrow({ where: { id: childA } })).englishFirstName).toBe('Amelia');
    });

    it('422 bodies are keyed by field name', async () => {
      const res = await call('patch', `/people/${parentA1}`, sidReg, { englishFirstName: '', gender: 'X' });
      expect(res.status).toBe(422);
      expect(res.body.details).toEqual({ englishFirstName: 'REQUIRED', englishLastName: 'REQUIRED', gender: 'INVALID' });
    });

    it('rejects mass assignment of id and other unknown fields with 422', async () => {
      for (const extra of [{ id: 1 }, { addressId: 1 }, { parentOneId: 1 }]) {
        const res = await call('patch', `/people/${parentA1}`, sidReg, { ...adult, ...extra });
        expect(res.status).toBe(422);
      }
      expect((await admin.person.findUniqueOrThrow({ where: { id: parentA1 } })).englishFirstName).toBe('Alice');
    });

    it('creates then updates a personal address; duplicates and missing are 409/404', async () => {
      const created = await call('post', `/people/${noAddrPerson}/address`, sidReg, address);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ street: '1 New St', homePhone: '(805) 555-0001' });
      expect((await call('post', `/people/${noAddrPerson}/address`, sidReg, address)).body.code).toBe('PERSONAL_ADDRESS_EXISTS');
      const updated = await call('patch', `/people/${noAddrPerson}/address`, sidReg, { ...address, city: 'Camarillo' });
      expect(updated.status).toBe(200);
      expect(updated.body.city).toBe('Camarillo');
      const none = await call('patch', `/people/${childA}/address`, sidReg, address);
      expect(none.body.code).toBe('NO_PERSONAL_ADDRESS');
    });

    it('address create has no family prefill: omitted fields are REQUIRED errors', async () => {
      const res = await call('post', `/people/${childA}/address`, sidReg, { street: '5 X St' });
      expect(res.status).toBe(422);
      expect(res.body.details.city).toBe('REQUIRED');
      expect(res.body.details.email).toBe('REQUIRED');
    });
  });

  describe('families', () => {
    it('shows a family', async () => {
      const res = await call('get', `/families/${famA}`, sidReg);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: famA, parentOne: { englishFirstName: 'Alice' }, parentTwo: null });
      expect(res.body.children).toHaveLength(1);
      expect((await call('get', `/families/${NOT_FOUND_ID}`, sidReg)).body.code).toBe('NOT_FOUND');
    });

    it('creates a family returning 201 {id}', async () => {
      const res = await call('post', '/families', sidReg, { address, parentOne: adult });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['id']);
      const fam = await admin.family.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(fam.parentOneId).not.toBeNull();
    });

    it('422s family creation with dotted field keys, and rejects mass assignment', async () => {
      const bad = await call('post', '/families', sidReg, { address: { ...address, zipcode: 'x' }, parentOne: { ...adult, gender: '' } });
      expect(bad.status).toBe(422);
      expect(bad.body.details).toEqual({ 'address.zipcode': 'INVALID', 'parentOne.gender': 'REQUIRED' });
      const mass = await call('post', '/families', sidReg, { address, parentOne: adult, parentOneId: parentA1 });
      expect(mass.status).toBe(422);
      const nested = await call('post', '/families', sidReg, { address, parentOne: { ...adult, id: parentA1 } });
      expect(nested.status).toBe(422);
    });

    it('updates the family address and returns it', async () => {
      const res = await call('patch', `/families/${famA}/address`, sidReg, { ...address, city: 'Moorpark' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ city: 'Moorpark', street: '1 New St' });
      expect((await call('patch', `/families/${NOT_FOUND_ID}/address`, sidReg, address)).status).toBe(404);
    });

    it('adds parent two (then 409) and children, returning the new person', async () => {
      const p2 = await call('post', `/families/${famA}/parents`, sidReg, adult);
      expect(p2.status).toBe(201);
      expect(p2.body).toMatchObject({ englishFirstName: 'Sam' });
      expect((await call('post', `/families/${famA}/parents`, sidReg, adult)).body.code).toBe('PARENT_TWO_EXISTS');
      const kid = await call('post', `/families/${famA}/children`, sidReg, child);
      expect(kid.status).toBe(201);
      expect(kid.body).toMatchObject({ englishFirstName: 'Kid', birthYear: 2018 });
      expect((await call('get', `/families/${famA}`, sidReg)).body.children).toHaveLength(2);
      expect((await call('post', `/families/${NOT_FOUND_ID}/children`, sidReg, child)).status).toBe(404);
      const bad = await call('post', `/families/${famA}/children`, sidReg, { ...child, birthYear: undefined });
      expect(bad.body.details).toEqual({ birthYear: 'REQUIRED' });
    });
  });
});
