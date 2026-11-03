import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Clock, FixedClock } from '../src/common/clock';
import { ClockModule } from '../src/common/clock.module';
import { AppError } from '../src/common/errors';
import { FamiliesService } from '../src/people/families.service';
import { PeopleModule } from '../src/people/people.module';
import { PeopleService } from '../src/people/people.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const address = {
  street: '123 Main St',
  city: 'Thousand Oaks',
  state: 'CA',
  zipcode: '91360',
  homePhone: '(805) 555-1234',
  cellPhone: '805.555.9876',
  email: 'pat@example.com',
};
const parent = { englishFirstName: 'Pat', englishLastName: 'Parent', gender: 'F' };

async function rejects(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected rejection');
}

describe('people and family domain services (connected as tocs_app)', () => {
  const clock = new FixedClock(new Date('2026-10-01T19:00:00Z'));
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let people: PeopleService;
  let families: FamiliesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ClockModule, PrismaModule, PeopleModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(PrismaService)
      .useValue(appPrisma)
      .compile();
    await moduleRef.init();
    people = moduleRef.get(PeopleService);
    families = moduleRef.get(FamiliesService);
  });
  beforeEach(resetDatabase);
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await appPrisma.$disconnect();
    await admin.$disconnect();
    await resetDatabase();
  });

  const newFamily = () => families.create({ address, parentOne: parent });

  describe('PeopleService', () => {
    it('round-trips Chinese and apostrophe/hyphen names unchanged; timestamps not exposed', async () => {
      const fam = await newFamily();
      const id = fam.parentOne!.id;
      const updated = await people.update(id, {
        englishFirstName: 'Shao-Ming',
        englishLastName: "O'Brien-Smith",
        chineseName: '陈小明',
        gender: 'M',
      });
      expect(updated).toMatchObject({ id, englishLastName: "O'Brien-Smith", chineseName: '陈小明' });
      const got = await people.get(id);
      expect(got).toMatchObject({ englishFirstName: 'Shao-Ming', englishLastName: "O'Brien-Smith", chineseName: '陈小明' });
      expect(Object.keys(got)).not.toContain('createdAt');
      expect(Object.keys(got)).not.toContain('updatedAt');
    });

    it('404 NOT_FOUND for unknown ids; 422 for invalid input; NUL byte is 422 not 500', async () => {
      expect((await rejects(people.get(999999))).code).toBe('NOT_FOUND');
      expect((await rejects(people.update(999999, parent))).status).toBe(404);
      const fam = await newFamily();
      const e = await rejects(people.update(fam.parentOne!.id, { ...parent, gender: 'X', englishFirstName: 'a\u0000b' }));
      expect(e.status).toBe(422);
      expect(e.details).toEqual({ gender: 'INVALID', englishFirstName: 'INVALID' });
    });

    it('birth year/month are required only for children (derived from families_children)', async () => {
      const fam = await newFamily();
      const kid = await families.addChild(fam.id, { ...parent, englishFirstName: 'Kid', birthYear: 2018, birthMonth: 5 });
      expect((await rejects(people.update(kid.id, { ...parent, englishFirstName: 'Kid' }))).details).toEqual({
        birthYear: 'REQUIRED',
        birthMonth: 'REQUIRED',
      });
      await expect(people.update(fam.parentOne!.id, parent)).resolves.toBeDefined();
      // current year comes from the Clock: 2026 is not a valid birth year (must be < current year)
      expect((await rejects(people.update(kid.id, { ...parent, birthYear: 2026, birthMonth: 1 }))).details).toEqual({
        birthYear: 'OUT_OF_RANGE',
      });
    });

    it('search matches chen (case-insensitive), the Chinese name, full names; order, paging, clamping, literal wildcards', async () => {
      const mk = (englishFirstName: string, englishLastName: string, chineseName?: string) =>
        admin.person.create({ data: { englishFirstName, englishLastName, chineseName: chineseName ?? null, gender: 'M' } });
      const a = await mk('Amy', 'Chen', '陈小明');
      const b = await mk('Bob', 'Chen');
      const c = await mk('Al', 'Zed', '陈大');
      await mk('100%', 'Real_Name');
      await mk('Xavier', 'Realxname');

      expect((await people.search({ query: 'CHEN', page: 1, pageSize: 10 })).items.map((p) => p.id)).toEqual([a.id, b.id]);
      const han = await people.search({ query: '陈', page: 1, pageSize: 10 });
      expect(han.items.map((p) => p.id)).toEqual([a.id, c.id]);
      expect(han.total).toBe(2);
      expect((await people.search({ query: 'amy chen', page: 1, pageSize: 10 })).items.map((p) => p.id)).toEqual([a.id]);
      expect((await people.search({ query: '%', page: 1, pageSize: 10 })).total).toBe(1);
      expect((await people.search({ query: 'real_name', page: 1, pageSize: 10 })).total).toBe(1);
      expect((await people.search({ query: '\\', page: 1, pageSize: 10 })).total).toBe(0);
      expect((await people.search({ page: 1, pageSize: 100 })).total).toBe(5);
      const p2 = await people.search({ query: 'chen', page: 2, pageSize: 1 });
      expect(p2.items.map((p) => p.id)).toEqual([b.id]);
      expect(p2.total).toBe(2);
      expect((await people.search({ page: 0, pageSize: 0 })).items).toHaveLength(1);
      expect((await people.search({ page: 1, pageSize: 100000 })).items).toHaveLength(5);
    });

    it('personal address: create once, update, 404 without, phones formatted', async () => {
      const fam = await newFamily();
      const two = await families.addParentTwo(fam.id, { ...parent, englishFirstName: 'Two' });
      const id = two.id;
      expect((await rejects(people.updatePersonalAddress(id, address))).code).toBe('NO_PERSONAL_ADDRESS');
      const created = await people.createPersonalAddress(id, address);
      expect(created).toMatchObject({ homePhone: '(805) 555-1234', cellPhone: '(805) 555-9876', zipcode: '91360' });
      expect((await rejects(people.createPersonalAddress(id, address))).code).toBe('PERSONAL_ADDRESS_EXISTS');
      const updated = await people.updatePersonalAddress(id, { ...address, city: 'Camarillo', cellPhone: '' });
      expect(updated).toMatchObject({ city: 'Camarillo', cellPhone: null });
      expect((await people.get(id)).address).toMatchObject({ city: 'Camarillo' });
      expect(await admin.address.count()).toBe(2);
      expect((await rejects(people.createPersonalAddress(999999, address))).status).toBe(404);
      expect((await rejects(people.updatePersonalAddress(999999, address))).status).toBe(404);
      expect((await rejects(people.updatePersonalAddress(id, { ...address, zipcode: 'x' }))).details).toEqual({ zipcode: 'INVALID' });
    });

    it('concurrent createPersonalAddress creates exactly one address', async () => {
      const fam = await newFamily();
      const id = fam.parentOne!.id;
      const results = await Promise.allSettled([people.createPersonalAddress(id, address), people.createPersonalAddress(id, address)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await admin.address.count()).toBe(2);
    });

    it('a legacy cell phone with fewer than 10 digits does not block an update', async () => {
      const fam = await newFamily();
      const id = fam.parentOne!.id;
      await people.createPersonalAddress(id, address);
      await expect(people.updatePersonalAddress(id, { ...address, cellPhone: '555-9876' })).resolves.toMatchObject({ cellPhone: '5559876' });
    });
  });

  describe('FamiliesService', () => {
    it('create stores address, parent one and family together; get returns them with formatted phones', async () => {
      const fam = await newFamily();
      const got = await families.get(fam.id);
      expect(got.parentOne).toMatchObject({ englishFirstName: 'Pat' });
      expect(got.parentTwo).toBeNull();
      expect(got.children).toEqual([]);
      expect(got.address).toMatchObject({ homePhone: '(805) 555-1234', cellPhone: '(805) 555-9876', email: 'pat@example.com' });
      expect(await admin.person.count()).toBe(1);
    });

    it('create with an invalid address stores nothing, field errors prefixed', async () => {
      const e = await rejects(families.create({ address: { ...address, zipcode: 'x' }, parentOne: { ...parent, gender: 'Q' } }));
      expect(e.status).toBe(422);
      expect(e.details).toEqual({ 'address.zipcode': 'INVALID', 'parentOne.gender': 'INVALID' });
      expect(await admin.address.count()).toBe(0);
      expect(await admin.person.count()).toBe(0);
      expect(await admin.family.count()).toBe(0);
    });

    it('create rolls back everything when a later insert fails', async () => {
      const real = appPrisma.$transaction.bind(appPrisma) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      jest.spyOn(appPrisma, '$transaction').mockImplementation(((fn: (tx: unknown) => Promise<unknown>) =>
        real((tx) =>
          fn(
            new Proxy(tx as object, {
              get: (t, k, r) =>
                k === 'family' ? { create: () => Promise.reject(new Error('boom')) } : (Reflect.get(t, k, r) as unknown),
            }),
          ),
        )) as never);
      await expect(newFamily()).rejects.toThrow('boom');
      expect(await admin.address.count()).toBe(0);
      expect(await admin.person.count()).toBe(0);
    });

    it('addParentTwo twice gives 409 PARENT_TWO_EXISTS; concurrent calls create one parent', async () => {
      const fam = await newFamily();
      const two = await families.addParentTwo(fam.id, { ...parent, englishFirstName: 'Two' });
      const e = await rejects(families.addParentTwo(fam.id, { ...parent, englishFirstName: 'Three' }));
      expect([e.status, e.code]).toEqual([409, 'PARENT_TWO_EXISTS']);
      expect((await families.get(fam.id)).parentTwo?.id).toBe(two.id);
      expect(await admin.person.count()).toBe(2);

      const fam2 = await newFamily();
      const before = await admin.person.count();
      const results = await Promise.allSettled([
        families.addParentTwo(fam2.id, { ...parent, englishFirstName: 'A' }),
        families.addParentTwo(fam2.id, { ...parent, englishFirstName: 'B' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await admin.person.count()).toBe(before + 1);
      expect((await rejects(families.addParentTwo(999999, parent))).code).toBe('NOT_FOUND');
    });

    it('addChild needs birth year/month, creates person and link atomically, lists children once despite duplicate links', async () => {
      const fam = await newFamily();
      const bad = await rejects(families.addChild(fam.id, parent));
      expect(bad.details).toEqual({ birthYear: 'REQUIRED', birthMonth: 'REQUIRED' });
      expect(await admin.person.count()).toBe(1);
      const kid = await families.addChild(fam.id, { ...parent, englishFirstName: 'Kid', chineseName: '陈小明', birthYear: 2018, birthMonth: 5 });
      await admin.$executeRaw`INSERT INTO families_children (family_id, child_id) VALUES (${fam.id}, ${kid.id})`;
      const got = await families.get(fam.id);
      expect(got.children).toHaveLength(1);
      expect(got.children[0]).toMatchObject({ id: kid.id, chineseName: '陈小明', birthYear: 2018 });
      expect((await rejects(families.addChild(999999, { ...parent, birthYear: 2018, birthMonth: 5 }))).code).toBe('NOT_FOUND');
    });

    it('updateAddress updates the family address; 404 for unknown family; validates', async () => {
      const fam = await newFamily();
      const out = await families.updateAddress(fam.id, { ...address, city: 'Camarillo', homePhone: '8055550000' });
      expect(out).toMatchObject({ city: 'Camarillo', homePhone: '(805) 555-0000' });
      expect((await rejects(families.updateAddress(fam.id, { ...address, homePhone: '12' }))).details).toEqual({ homePhone: 'INVALID' });
      expect((await rejects(families.updateAddress(999999, address))).code).toBe('NOT_FOUND');
      expect(await admin.address.count()).toBe(1);
    });

    it('personIsParentOf / personIsParentInFamily', async () => {
      const fam = await newFamily();
      const two = await families.addParentTwo(fam.id, { ...parent, englishFirstName: 'Two' });
      const kid = await families.addChild(fam.id, { ...parent, birthYear: 2018, birthMonth: 5 });
      const other = await newFamily();
      const stranger = other.parentOne!.id;
      expect(await families.personIsParentOf(fam.parentOne!.id, kid.id)).toBe(true);
      expect(await families.personIsParentOf(two.id, kid.id)).toBe(true);
      expect(await families.personIsParentOf(stranger, kid.id)).toBe(false);
      expect(await families.personIsParentOf(kid.id, kid.id)).toBe(false);
      expect(await families.personIsParentInFamily(two.id, fam.id)).toBe(true);
      expect(await families.personIsParentInFamily(stranger, fam.id)).toBe(false);
      expect(await families.personIsParentInFamily(kid.id, fam.id)).toBe(false);
    });
  });
});
