import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PERMISSION_CODES } from '../src/access/permission-codes';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { SessionService } from '../src/auth/session.service';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { seed } from '../prisma/seed';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

const CSRF = 'csrf-token-for-tests';

describe('roles administration API (app connected as tocs_app)', () => {
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() });
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  let rootSid: string;
  let rootId: number;
  let regSid: string;
  let studentRoleId: number;
  let superRoleId: number;
  const http = () => request(app.getHttpServer());

  async function sessionFor(username: string, roleName: string | null, person?: { first: string; last: string }) {
    const p = person ? await admin.person.create({ data: { englishFirstName: person.first, englishLastName: person.last } }) : null;
    const user = await admin.user.create({ data: { username, personId: p?.id } });
    if (roleName) {
      const role = await admin.role.findFirstOrThrow({ where: { name: roleName } });
      await admin.roleUser.create({ data: { roleId: role.id, userId: user.id } });
    }
    const { id } = await app.get(SessionService).create(user.id, {});
    return { sid: id, userId: user.id };
  }

  const get = (url: string, sid: string) => http().get(url).set('Cookie', `tocs_session=${sid}`);
  const write = (method: 'post' | 'delete', url: string, sid: string) =>
    http()[method](url).set('Cookie', [`tocs_session=${sid}`, `tocs_csrf=${CSRF}`]).set('X-CSRF-Token', CSRF);
  const addUser = (roleId: number, username: unknown, sid = rootSid) =>
    write('post', `/api/v1/roles/${roleId}/users`, sid).send(username === undefined ? {} : { username });
  const memberRows = (roleId: number, userId: number) => admin.roleUser.count({ where: { roleId, userId } });
  const audits = (action: string) => admin.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(appPrisma).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seed(appPrisma);
    studentRoleId = (await admin.role.findFirstOrThrow({ where: { name: 'Student Parent' } })).id;
    superRoleId = (await admin.role.findFirstOrThrow({ where: { name: 'Super User' } })).id;
    const root = await sessionFor('root', 'Super User', { first: 'Ada', last: 'Root' });
    rootSid = root.sid;
    rootId = root.userId;
    regSid = (await sessionFor('reg', 'Registration Officer')).sid;
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('GET /roles and /roles/:id', () => {
    it('lists roles with distinct user counts (legacy duplicate rows do not inflate)', async () => {
      const u = await admin.user.create({ data: { username: 'dup' } });
      await admin.$executeRaw`INSERT INTO roles_users (role_id, user_id) VALUES (${studentRoleId}, ${u.id}), (${studentRoleId}, ${u.id})`;
      const res = await get('/api/v1/roles', rootSid);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(13);
      expect(res.body.find((r: { name: string }) => r.name === 'Super User')).toEqual({ id: superRoleId, name: 'Super User', userCount: 1 });
      expect(res.body.find((r: { name: string }) => r.name === 'Student Parent').userCount).toBe(1);
    });

    it('returns a role with users (personName) and permission codes', async () => {
      const res = await get(`/api/v1/roles/${superRoleId}`, rootSid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: superRoleId,
        name: 'Super User',
        permissions: [],
        users: [{ id: rootId, username: 'root', personName: 'Ada Root' }],
      });
      const reg = await admin.role.findFirstOrThrow({ where: { name: 'Registration Officer' } });
      const r2 = await get(`/api/v1/roles/${reg.id}`, rootSid);
      expect(r2.body.permissions).toContain('school_years.read');
      expect(r2.body.users).toEqual([{ id: expect.any(Number), username: 'reg', personName: null }]);
    });

    it('404 ROLE_NOT_FOUND for an unknown id; 422 for a non-integer id', async () => {
      const res = await get('/api/v1/roles/999999', rootSid);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROLE_NOT_FOUND');
      for (const bad of ['abc', '1.5', '99999999999', '0']) {
        const r = await get(`/api/v1/roles/${bad}`, rootSid);
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('GET /permissions', () => {
    it('lists every permission code with the roles granted it', async () => {
      const res = await get('/api/v1/permissions', rootSid);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { code: string }) => p.code).sort()).toEqual([...PERMISSION_CODES].sort());
      const sy = res.body.find((p: { code: string }) => p.code === 'school_years.read');
      expect(sy.roles).toContain('Registration Officer');
      expect(sy.roles).not.toContain('Student Parent');
      expect(res.body.find((p: { code: string }) => p.code === 'access.roles.read').roles).toEqual([]);
    });
  });

  describe('POST /roles/:id/users', () => {
    it('adds a user (trimmed username) and audits it', async () => {
      const { userId } = await sessionFor('bob', null);
      const res = await addUser(studentRoleId, '  bob  ');
      expect(res.status).toBe(204);
      expect(await memberRows(studentRoleId, userId)).toBe(1);
      const rows = await audits('access.role_user_added');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorUserId: rootId, actorUsername: 'root', targetType: 'role', targetId: String(studentRoleId) });
      expect(rows[0].meta).toMatchObject({ roleId: studentRoleId, userId });
    });

    it('404 USER_NOT_FOUND for an unknown username (case-sensitive); 404 ROLE_NOT_FOUND for unknown role', async () => {
      await sessionFor('bob', null);
      const a = await addUser(studentRoleId, 'nobody');
      expect(a.status).toBe(404);
      expect(a.body.code).toBe('USER_NOT_FOUND');
      expect((await addUser(studentRoleId, 'BOB')).body.code).toBe('USER_NOT_FOUND');
      const b = await addUser(999999, 'bob');
      expect(b.status).toBe(404);
      expect(b.body.code).toBe('ROLE_NOT_FOUND');
      expect(await audits('access.role_user_added')).toHaveLength(0);
    });

    it('422 on invalid bodies', async () => {
      for (const body of [undefined, '', '   ', 5, 'x'.repeat(256)]) {
        const r = await addUser(studentRoleId, body);
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('VALIDATION_ERROR');
      }
      const extra = await write('post', `/api/v1/roles/${studentRoleId}/users`, rootSid).send({ username: 'bob', x: 1 });
      expect(extra.status).toBe(422);
    });

    it('adding the same user twice returns 204 both times, leaves one row and audits once', async () => {
      const { userId } = await sessionFor('bob', null);
      expect((await addUser(studentRoleId, 'bob')).status).toBe(204);
      expect((await addUser(studentRoleId, 'bob')).status).toBe(204);
      expect(await memberRows(studentRoleId, userId)).toBe(1);
      expect(await audits('access.role_user_added')).toHaveLength(1); // decision: audit only real changes
    });

    it('concurrent adds of the same (role, user) leave exactly one row', async () => {
      const { userId } = await sessionFor('bob', null);
      const results = await Promise.all(Array.from({ length: 8 }, () => addUser(studentRoleId, 'bob')));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(204));
      expect(await memberRows(studentRoleId, userId)).toBe(1);
      expect(await audits('access.role_user_added')).toHaveLength(1);
    });

    it('rolls the membership back when the audit write fails', async () => {
      const { userId } = await sessionFor('bob', null);
      const spy = jest.spyOn(app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit down'));
      const res = await addUser(studentRoleId, 'bob');
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(await memberRows(studentRoleId, userId)).toBe(0);
    });
  });

  describe('DELETE /roles/:id/users/:userId', () => {
    it('removes all duplicate rows for the pair and audits once', async () => {
      const { userId } = await sessionFor('bob', null);
      await admin.$executeRaw`INSERT INTO roles_users (role_id, user_id) VALUES (${studentRoleId}, ${userId}), (${studentRoleId}, ${userId})`;
      const res = await write('delete', `/api/v1/roles/${studentRoleId}/users/${userId}`, rootSid);
      expect(res.status).toBe(204);
      expect(await memberRows(studentRoleId, userId)).toBe(0);
      const rows = await audits('access.role_user_removed');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorUserId: rootId, targetType: 'role', targetId: String(studentRoleId) });
      expect(rows[0].meta).toMatchObject({ roleId: studentRoleId, userId });
    });

    it('removing a non-member is a 204 no-op (no audit row); other roles are untouched', async () => {
      const { userId } = await sessionFor('bob', 'Instructor');
      const res = await write('delete', `/api/v1/roles/${studentRoleId}/users/${userId}`, rootSid);
      expect(res.status).toBe(204);
      expect(await audits('access.role_user_removed')).toHaveLength(0);
      expect(await admin.roleUser.count({ where: { userId } })).toBe(1);
    });

    it('404 ROLE_NOT_FOUND / 422 for bad ids', async () => {
      expect((await write('delete', `/api/v1/roles/999999/users/1`, rootSid)).body.code).toBe('ROLE_NOT_FOUND');
      expect((await write('delete', `/api/v1/roles/${studentRoleId}/users/abc`, rootSid)).status).toBe(422);
    });
  });

  describe('authorization', () => {
    it('a Registration Officer gets 403 on every endpoint; anonymous gets 401', async () => {
      const calls = [
        get('/api/v1/roles', regSid),
        get(`/api/v1/roles/${studentRoleId}`, regSid),
        get('/api/v1/permissions', regSid),
        addUser(studentRoleId, 'root', regSid),
        write('delete', `/api/v1/roles/${studentRoleId}/users/${rootId}`, regSid),
      ];
      for (const r of await Promise.all(calls)) {
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('FORBIDDEN');
      }
      expect((await http().get('/api/v1/roles')).status).toBe(401);
    });
  });
});
