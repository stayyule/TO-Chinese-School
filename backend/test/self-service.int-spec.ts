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

describe('parent self-service API (app connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-10-01T19:00:00Z'));
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;

  // Family A: parentA1 (parent one, user), parentA2 (parent two, user), childA; address addrA.
  // Family B: parentB (parent one, user), childB; address addrB.
  let famA: number, famB: number;
  let parentA1: number, parentA2: number, childA: number, parentB: number, childB: number;
  let addrA: number;
  let sidA1: string, sidA2: string, sidB: string, sidReg: string, sidNoPerson: string;

  const http = () => request(app.getHttpServer());
  const call = (method: Method, url: string, sid: string, body?: object) => {
    const r = http()[method](`/api/v1${url}`).set('Cookie', [`tocs_session=${sid}`, `tocs_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);
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
  const addr = async (street: string) =>
    (
      await admin.address.create({
        data: { street, city: 'Thousand Oaks', state: 'CA', zipcode: '91360', homePhone: '8055551234', email: `${street.replace(/\W/g, '')}@example.com` },
      })
    ).id;

  /** The six self-service mutations against family/person ids, each with a valid body. */
  const mutations = (familyId: number, personId: number): [Method, string, object][] => [
    ['patch', `/me/families/${familyId}/address`, address],
    ['post', `/me/families/${familyId}/parents`, adult],
    ['post', `/me/families/${familyId}/children`, child],
    ['patch', `/me/people/${personId}`, { ...child, englishFirstName: 'Hacked' }],
    ['post', `/me/people/${personId}/address`, address],
    ['patch', `/me/people/${personId}/address`, address],
  ];

  /** Everything the mutations could change, for "nothing changed" assertions. */
  const snapshot = async () => ({
    people: await admin.person.findMany({ orderBy: { id: 'asc' } }),
    addresses: await admin.address.findMany({ orderBy: { id: 'asc' } }),
    families: await admin.family.findMany({ orderBy: { id: 'asc' } }),
    links: await admin.familyChild.findMany({ orderBy: [{ familyId: 'asc' }, { childId: 'asc' }] }),
  });
  const withoutRequestId = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });

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
    parentA2 = await person('Andy', 'Able', { gender: 'M' });
    childA = await person('Amy', 'Able', { birthYear: 2016, birthMonth: 3 });
    parentB = await person('Bob', 'Baker', { gender: 'M' });
    childB = await person('Ben', 'Baker', { gender: 'M', birthYear: 2015, birthMonth: 9 });
    addrA = await addr('10 A St');
    famA = (await admin.family.create({ data: { parentOneId: parentA1, parentTwoId: parentA2, addressId: addrA } })).id;
    famB = (await admin.family.create({ data: { parentOneId: parentB, addressId: await addr('20 B St') } })).id;
    await admin.familyChild.createMany({ data: [{ familyId: famA, childId: childA }, { familyId: famB, childId: childB }] });
    sidA1 = await userWithSession('alice', parentA1, 'Student Parent');
    sidA2 = await userWithSession('andy', parentA2, 'Student Parent');
    sidB = await userWithSession('bob', parentB, 'Student Parent');
    sidReg = await userWithSession('reg', await person('Rita', 'Registrar'), 'Registration Officer');
    sidNoPerson = await userWithSession('nobody', null, 'Student Parent');
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('IDOR matrix', () => {
    it('parent A on family B / child B: 404 NOT_FOUND for every mutation, identical to a nonexistent id, nothing changes', async () => {
      const before = await snapshot();
      const foreign = mutations(famB, childB);
      const missing = mutations(NOT_FOUND_ID, NOT_FOUND_ID);
      for (let i = 0; i < foreign.length; i++) {
        const [method, url, body] = foreign[i];
        const res = await call(method, url, sidA1, body);
        expect({ url, status: res.status, code: res.body.code }).toEqual({ url, status: 404, code: 'NOT_FOUND' });
        const [m2, url2, body2] = missing[i];
        const res2 = await call(m2, url2, sidA1, body2);
        expect(res2.status).toBe(404);
        expect(withoutRequestId(res.body)).toEqual(withoutRequestId(res2.body));
        expect(res.body.details).toBeNull();
        expect(res.body.message).toBe(url.startsWith('/me/families') ? 'Family not found' : 'Person not found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('404 for a foreign id even when the body would fail domain validation (policy runs first)', async () => {
      const res = await call('patch', `/me/families/${famB}/address`, sidA1, { street: '' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      const r2 = await call('patch', `/me/people/${childB}`, sidA1, {});
      expect(r2.status).toBe(404);
    });

    it('GET /me/families never includes family B or its people', async () => {
      const res = await call('get', '/me/families', sidA1);
      expect(res.status).toBe(200);
      expect(res.body.map((f: { id: number }) => f.id)).toEqual([famA]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Baker');
      expect(text).not.toContain('20 B St');
    });

    it('parent A updates family A address → 204 and it persists', async () => {
      const res = await call('patch', `/me/families/${famA}/address`, sidA1, address);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await admin.address.findUniqueOrThrow({ where: { id: addrA } })).toMatchObject({ street: '1 New St', homePhone: '8055550001' });
    });

    it('parent two of family A is authorized for the family mutations too', async () => {
      expect((await call('patch', `/me/families/${famA}/address`, sidA2, address)).status).toBe(204);
      const res = await call('post', `/me/families/${famA}/children`, sidA2, child);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ englishFirstName: 'Kid', birthYear: 2018 });
    });

    it('PATCH /me/people/:id: own record and own child → 204; child via the other parent of the same family → 204', async () => {
      expect((await call('patch', `/me/people/${parentA1}`, sidA1, { ...adult, englishFirstName: 'Alicia', gender: 'F' })).status).toBe(204);
      expect((await call('patch', `/me/people/${childA}`, sidA1, { ...child, englishFirstName: 'Amelia' })).status).toBe(204);
      expect((await call('patch', `/me/people/${childA}`, sidA2, { ...child, englishFirstName: 'Amy' })).status).toBe(204);
      expect((await admin.person.findUniqueOrThrow({ where: { id: parentA1 } })).englishFirstName).toBe('Alicia');
      expect((await admin.person.findUniqueOrThrow({ where: { id: childA } })).englishFirstName).toBe('Amy');
    });

    it('PATCH /me/people/:id: another family’s child → 404; the other parent (spouse) → 404 as in the old app', async () => {
      expect((await call('patch', `/me/people/${childB}`, sidA1, child)).status).toBe(404);
      const spouse = await call('patch', `/me/people/${parentA2}`, sidA1, adult);
      expect(spouse.status).toBe(404);
      expect(spouse.body.code).toBe('NOT_FOUND');
      expect((await admin.person.findUniqueOrThrow({ where: { id: parentA2 } })).englishFirstName).toBe('Andy');
    });

    it('a child linked to family B cannot be edited by family A through any other link', async () => {
      // childB is also parent one of an unrelated family; family A still has no claim on it.
      await admin.family.create({ data: { parentOneId: childB } });
      expect((await call('patch', `/me/people/${childB}`, sidA1, child)).status).toBe(404);
      expect((await call('post', `/me/people/${childB}/address`, sidA1, address)).status).toBe(404);
    });

    it('a user without a person record: GET → [], every mutation → 404', async () => {
      const res = await call('get', '/me/families', sidNoPerson);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      for (const [method, url, body] of mutations(famA, childA)) {
        expect({ url, status: (await call(method, url, sidNoPerson, body)).status }).toEqual({ url, status: 404 });
      }
    });

    it('Registration Officer (no family.self.* / person.self.*) → 403 FORBIDDEN on every mutation', async () => {
      for (const [method, url, body] of [...mutations(famA, childA), ...mutations(NOT_FOUND_ID, NOT_FOUND_ID)]) {
        const res = await call(method, url, sidReg, body);
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
    });

    it('401 UNAUTHENTICATED without a session, for GET and every mutation', async () => {
      expect((await http().get('/api/v1/me/families')).status).toBe(401);
      for (const [method, url, body] of mutations(famA, childA)) {
        const res = await http()[method](`/api/v1${url}`).set('Cookie', `tocs_csrf=${CSRF}`).set('X-CSRF-Token', CSRF).send(body);
        expect({ url, status: res.status, code: res.body.code }).toEqual({ url, status: 401, code: 'UNAUTHENTICATED' });
      }
    });

    it('non-numeric or out-of-range ids → 422 VALIDATION_ERROR', async () => {
      for (const bad of ['abc', '0', '1.5', '99999999999']) {
        for (const [method, url, body] of mutations(famA, childA)) {
          const badUrl = url.replace(String(famA), bad).replace(String(childA), bad);
          const res = await call(method, badUrl, sidA1, body);
          expect({ badUrl, status: res.status, code: res.body.code }).toEqual({ badUrl, status: 422, code: 'VALIDATION_ERROR' });
        }
      }
    });

    it('mass assignment: ids and foreign keys in the body → 422, nothing changes', async () => {
      const before = await snapshot();
      const attempts: [Method, string, object][] = [
        ['patch', `/me/people/${childA}`, { ...child, id: parentB }],
        ['post', `/me/families/${famA}/parents`, { ...adult, parentOneId: parentB }],
        ['post', `/me/families/${famA}/children`, { ...child, familyId: famB }],
        ['patch', `/me/families/${famA}/address`, { ...address, id: 1 }],
        ['post', `/me/people/${childA}/address`, { ...address, personId: childB }],
        ['patch', `/me/people/${parentA1}`, { ...adult, roles: ['Super User'] }],
      ];
      for (const [method, url, body] of attempts) {
        const res = await call(method, url, sidA1, body);
        expect({ url, status: res.status, code: res.body.code }).toEqual({ url, status: 422, code: 'VALIDATION_ERROR' });
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('GET /me/families', () => {
    it('both parents, children (each once), and the address; families as parent two included; ordered by id', async () => {
      const other = (await admin.family.create({ data: { parentOneId: parentB, parentTwoId: parentA1 } })).id;
      const res = await call('get', '/me/families', sidA1);
      expect(res.status).toBe(200);
      expect(res.body.map((f: { id: number }) => f.id)).toEqual([famA, other]);
      expect(res.body[0]).toEqual({
        id: famA,
        parentOne: expect.objectContaining({ id: parentA1, englishFirstName: 'Alice' }),
        parentTwo: expect.objectContaining({ id: parentA2, englishFirstName: 'Andy' }),
        children: [expect.objectContaining({ id: childA, englishFirstName: 'Amy' })],
        address: expect.objectContaining({ id: addrA, street: '10 A St', homePhone: '(805) 555-1234' }),
      });
      expect(res.body[1]).toMatchObject({ parentOne: { id: parentB }, parentTwo: { id: parentA1 }, children: [], address: null });
    });

    it('a family where the user is only a child is not listed', async () => {
      await admin.familyChild.create({ data: { familyId: famB, childId: parentA1 } });
      const res = await call('get', '/me/families', sidA1);
      expect(res.body.map((f: { id: number }) => f.id)).toEqual([famA]);
    });
  });

  describe('family mutations', () => {
    it('POST parents → 201 with the new parent two; a second time → 409 PARENT_TWO_EXISTS', async () => {
      const res = await call('post', `/me/families/${famB}/parents`, sidB, adult);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ englishFirstName: 'Sam', englishLastName: 'Second', gender: 'M' });
      expect((await admin.family.findUniqueOrThrow({ where: { id: famB } })).parentTwoId).toBe(res.body.id);
      const again = await call('post', `/me/families/${famB}/parents`, sidB, adult);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('PARENT_TWO_EXISTS');
    });

    it('POST children → 201 and links the child; missing birth fields → 422 keyed by field', async () => {
      const res = await call('post', `/me/families/${famA}/children`, sidA1, child);
      expect(res.status).toBe(201);
      expect(await admin.familyChild.count({ where: { familyId: famA, childId: res.body.id } })).toBe(1);
      const bad = await call('post', `/me/families/${famA}/children`, sidA1, { ...child, birthYear: undefined });
      expect(bad.status).toBe(422);
      expect(bad.body.details).toEqual({ birthYear: 'REQUIRED' });
    });

    it('PATCH address with invalid fields → 422 keyed by field', async () => {
      const res = await call('patch', `/me/families/${famA}/address`, sidA1, { ...address, zipcode: 'abc' });
      expect(res.status).toBe(422);
      expect(res.body.details).toEqual({ zipcode: 'INVALID' });
    });
  });

  describe('personal addresses', () => {
    it('creating a personal address then editing it persists (family address untouched)', async () => {
      const created = await call('post', `/me/people/${childA}/address`, sidA1, address);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ street: '1 New St', homePhone: '(805) 555-0001' });
      const row = await admin.person.findUniqueOrThrow({ where: { id: childA } });
      expect(row.addressId).toBe(created.body.id);
      expect(row.addressId).not.toBe(addrA);

      const edited = await call('patch', `/me/people/${childA}/address`, sidA1, { ...address, street: '2 Edited Ave' });
      expect(edited.status).toBe(204);
      expect((await admin.address.findUniqueOrThrow({ where: { id: created.body.id } })).street).toBe('2 Edited Ave');
      expect((await admin.address.findUniqueOrThrow({ where: { id: addrA } })).street).toBe('10 A St');

      const twice = await call('post', `/me/people/${childA}/address`, sidA1, address);
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('PERSONAL_ADDRESS_EXISTS');
    });

    it('fields left out of POST default from the person’s first family address (old form prefill)', async () => {
      const res = await call('post', `/me/people/${parentA1}/address`, sidA1, { street: '3 Own Rd' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        street: '3 Own Rd',
        city: 'Thousand Oaks',
        state: 'CA',
        zipcode: '91360',
        homePhone: '(805) 555-1234',
        email: '10ASt@example.com',
      });
      const empty = await call('post', `/me/people/${childA}/address`, sidA1, {});
      expect(empty.status).toBe(201);
      expect(empty.body).toMatchObject({ street: '10 A St', city: 'Thousand Oaks', email: '10ASt@example.com' });
      expect(empty.body.id).not.toBe(addrA);
    });

    it('prefill never copies the address of a family the requester does not belong to', async () => {
      // childA moves to a new family of parentA1 (higher id than famB) and is also linked to famB (parentB's).
      const addrA2 = await addr('30 A2 St');
      const famA2 = (await admin.family.create({ data: { parentOneId: parentA1, addressId: addrA2 } })).id;
      await admin.familyChild.deleteMany({ where: { familyId: famA, childId: childA } });
      await admin.familyChild.createMany({ data: [{ familyId: famB, childId: childA }, { familyId: famA2, childId: childA }] });
      expect(famB).toBeLessThan(famA2);
      const res = await call('post', `/me/people/${childA}/address`, sidA1, {});
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ street: '30 A2 St', email: '30A2St@example.com' });
      const text = JSON.stringify(res.body);
      for (const leaked of ['20 B St', '20BSt@example.com']) expect(text).not.toContain(leaked);
      const { addressId } = await admin.person.findUniqueOrThrow({ where: { id: childA } });
      expect(await admin.address.findUniqueOrThrow({ where: { id: addressId as number } })).toMatchObject({
        street: '30 A2 St',
        email: '30A2St@example.com',
      });
    });

    it('without any family address, a POST missing fields → 422 keyed by field', async () => {
      const lone = (await admin.family.create({ data: { parentOneId: parentB } })).id;
      const kid = await person('Lone', 'Kid', { birthYear: 2017, birthMonth: 1 });
      await admin.familyChild.create({ data: { familyId: lone, childId: kid } });
      // The kid's only family has no address, so there is nothing to default from.
      const res = await call('post', `/me/people/${kid}/address`, sidB, { street: 'x' });
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.details).sort()).toEqual(['city', 'email', 'homePhone', 'state', 'zipcode']);
    });

    it('editing without a personal address → 404 NO_PERSONAL_ADDRESS', async () => {
      const res = await call('patch', `/me/people/${childA}/address`, sidA1, address);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NO_PERSONAL_ADDRESS');
    });
  });
});
