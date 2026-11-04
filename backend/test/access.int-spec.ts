import 'reflect-metadata';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Authenticated, Public, RequirePermission } from '../src/access/permission.decorators';
import { PERMISSION_CODES } from '../src/access/permission-codes';
import { assertRouteCoverage } from '../src/access/route-coverage';
import { PermissionsService } from '../src/access/permissions.service';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/auth/session.service';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { seed } from '../prisma/seed';
import { appRoleUrl, resetDatabase, testDatabaseUrl } from './helpers/db';

@Controller('test-access')
class AccessTestController {
  @Get('school-years')
  @RequirePermission('school_years.read')
  read(): { ok: true } {
    return { ok: true };
  }

  @Post('school-years')
  @RequirePermission('school_years.read')
  write(): { ok: true } {
    return { ok: true };
  }

  @Get('signed-in')
  @Authenticated()
  signedIn(): { ok: true } {
    return { ok: true };
  }

  @Get('open')
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('undecorated')
  undecorated(): { ok: true } {
    return { ok: true };
  }
}

/** Class-level rule, overridden per handler by a method-level one. */
@Controller('test-access-class')
@RequirePermission('school_years.read')
class ClassLevelController {
  @Get()
  inherited(): { ok: true } {
    return { ok: true };
  }

  @Get('open')
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }
}

const STUDENT_PARENT_CODES = [
  'family.self.address.edit',
  'family.self.parent.add',
  'family.self.child.add',
  'person.self.edit',
  'person.self.address.create',
  'person.self.address.edit',
  'home.panel.student_parent',
];

describe('access: permission guard, route coverage, seed, /me (app connected as tocs_app)', () => {
  const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl() }); // superuser: fixtures + assertions only
  const appPrisma = new PrismaService({ datasourceUrl: appRoleUrl() });
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  /** Creates a user (with a person) holding the given roles (by name, seeded) and returns a live session id. */
  async function sessionFor(username: string, roleNames: string[]): Promise<{ sid: string; userId: number; personId: number }> {
    const person = await admin.person.create({ data: { englishFirstName: 'Mei', englishLastName: 'Chen', chineseName: '陈美' } });
    const user = await admin.user.create({ data: { username, personId: person.id } });
    for (const name of roleNames) {
      const role = await admin.role.findFirstOrThrow({ where: { name } });
      await admin.roleUser.create({ data: { roleId: role.id, userId: user.id } });
    }
    const { id } = await app.get(SessionService).create(user.id, {});
    return { sid: id, userId: user.id, personId: person.id };
  }

  const get = (url: string, sid?: string) => {
    const r = http().get(url);
    return sid ? r.set('Cookie', `tocs_session=${sid}`) : r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AccessTestController, ClassLevelController],
    })
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
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
    await resetDatabase();
  });

  describe('route coverage', () => {
    it('throws at startup naming every undecorated handler', () => {
      expect(() => assertRouteCoverage(app)).toThrow(/AccessTestController\.undecorated/);
      let message = '';
      try {
        assertRouteCoverage(app);
      } catch (e) {
        message = (e as Error).message;
      }
      // Only the undecorated handler is reported (class-level rules count for inheriting handlers).
      expect(message).not.toMatch(/AccessTestController\.(read|write|signedIn|open)\b/);
      expect(message).not.toMatch(/ClassLevelController/);
    });

    it('refuses two access rules on the same handler or class', () => {
      expect(() => {
        class Twice {
          @Public()
          @Authenticated()
          m(): void {}
        }
        return Twice;
      }).toThrow(/only one of/);
      expect(() => {
        @RequirePermission('school_years.read')
        @Public()
        class TwiceClass {}
        return TwiceClass;
      }).toThrow(/only one of/);
    });

    it('passes for the real AppModule (every production route is annotated)', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(appPrisma)
        .compile();
      const real = moduleRef.createNestApplication();
      configureApp(real);
      expect(() => assertRouteCoverage(real)).not.toThrow();
    });
  });

  describe('PermissionGuard', () => {
    it('lets a Super User through without any grant', async () => {
      const { sid } = await sessionFor('root', ['Super User']);
      const res = await get('/api/v1/test-access/school-years', sid);
      expect(res.status).toBe(200);
      expect(await admin.rolePermission.count({ where: { roleId: (await admin.role.findFirstOrThrow({ where: { name: 'Super User' } })).id } })).toBe(0);
    });

    it('lets a Registration Officer through (granted school_years.read)', async () => {
      const { sid } = await sessionFor('reg', ['Registration Officer']);
      expect((await get('/api/v1/test-access/school-years', sid)).status).toBe(200);
      expect((await get('/api/v1/test-access-class', sid)).status).toBe(200);
    });

    it('rejects a Student Parent with 403 FORBIDDEN', async () => {
      const { sid } = await sessionFor('parent', ['Student Parent']);
      const res = await get('/api/v1/test-access/school-years', sid);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect((await get('/api/v1/test-access-class', sid)).status).toBe(403);
    });

    it('rejects a user with no roles with 403', async () => {
      const { sid } = await sessionFor('nobody', []);
      expect((await get('/api/v1/test-access/school-years', sid)).status).toBe(403);
    });

    it('rejects anonymous requests with 401 UNAUTHENTICATED', async () => {
      const res = await get('/api/v1/test-access/school-years');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      expect((await get('/api/v1/test-access/school-years', 'A'.repeat(43))).status).toBe(401);
      expect((await get('/api/v1/test-access-class')).status).toBe(401);
    });

    it('runs after CsrfGuard: an anonymous POST without a CSRF token gets 403 CSRF_INVALID, not 401', async () => {
      const res = await http().post('/api/v1/test-access/school-years');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_INVALID');
    });

    it('@Authenticated requires a session but no permission', async () => {
      const { sid } = await sessionFor('nobody', []);
      expect((await get('/api/v1/test-access/signed-in', sid)).status).toBe(200);
      const anon = await get('/api/v1/test-access/signed-in');
      expect(anon.status).toBe(401);
      expect(anon.body.code).toBe('UNAUTHENTICATED');
    });

    it('@Public allows anonymous requests, also overriding a class-level permission', async () => {
      expect((await get('/api/v1/test-access/open')).status).toBe(200);
      expect((await get('/api/v1/test-access-class/open')).status).toBe(200);
    });

    it('denies an undecorated route at runtime, even for a Super User', async () => {
      const { sid } = await sessionFor('root', ['Super User']);
      const res = await get('/api/v1/test-access/undecorated', sid);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect((await get('/api/v1/test-access/undecorated')).status).toBe(403);
    });

    it('keeps existing public routes reachable anonymously', async () => {
      expect((await get('/healthz')).status).toBe(200);
      expect((await get('/api/v1/auth/csrf')).status).toBe(200);
    });
  });

  describe('PermissionsService.forUser', () => {
    it('gives Super User every code', async () => {
      const { userId } = await sessionFor('root', ['Super User']);
      const result = await app.get(PermissionsService).forUser(userId);
      expect(result.roles).toEqual(['Super User']);
      expect([...result.permissions].sort()).toEqual([...PERMISSION_CODES].sort());
    });

    it('unions the grants of several roles', async () => {
      const { userId } = await sessionFor('both', ['Student Parent', 'Instructor']);
      const result = await app.get(PermissionsService).forUser(userId);
      expect(result.roles).toEqual(['Instructor', 'Student Parent']);
      expect([...result.permissions].sort()).toEqual([...STUDENT_PARENT_CODES, 'home.panel.instructor'].sort());
    });
  });

  describe('GET /api/v1/me', () => {
    it('returns the Student Parent profile with exactly the Student Parent permission set', async () => {
      const { sid, userId, personId } = await sessionFor('parent', ['Student Parent']);
      const res = await get('/api/v1/me', sid);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { id: userId, username: 'parent' },
        person: { id: personId, englishName: 'Mei Chen', chineseName: '陈美' },
        roles: ['Student Parent'],
        permissions: expect.any(Array),
      });
      expect([...res.body.permissions].sort()).toEqual([...STUDENT_PARENT_CODES].sort());
    });

    it('requires a session', async () => {
      const res = await get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('seed', () => {
    const counts = async () => ({
      roles: await admin.role.count(),
      permissions: await admin.permission.count(),
      grants: await admin.rolePermission.count(),
    });

    it('creates the roles, every permission code, and the legacy grants', async () => {
      const roles = (await admin.role.findMany({ select: { name: true } })).map((r) => r.name).sort();
      expect(roles).toEqual(
        [
          'Super User', 'Principal', 'Academic Vice Principal', 'Registration Officer', 'Accounting Officer',
          'Activity Officer', 'Communication Officer', 'Instruction Officer', 'Instructor', 'Room Parent',
          'Student Parent', 'CCCA Staff', 'PVA',
        ].sort(),
      );
      const codes = (await admin.permission.findMany()).map((p) => p.code).sort();
      expect(codes).toEqual([...PERMISSION_CODES].sort());
      const grantedAccess = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code LIKE 'access.%' OR p.code = 'auth.invitations.create'`;
      expect(Number(grantedAccess[0].n)).toBe(0);
    });

    it('is idempotent: running `npm run seed` twice more leaves row counts unchanged', async () => {
      const before = await counts();
      const root = path.resolve(__dirname, '..');
      const env = { ...process.env, DATABASE_URL: appRoleUrl() };
      for (let i = 0; i < 2; i++) {
        const out = execSync('npm run --silent seed', { cwd: root, env, stdio: 'pipe', encoding: 'utf8' });
        expect(out).toMatch(/seed: done/);
      }
      expect(await counts()).toEqual(before);
      expect(before.permissions).toBe(PERMISSION_CODES.length);
    }, 60_000);
  });
});
