import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthedRequest } from '../auth/session.guard';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { IdParam as id } from '../common/id.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AddRoleUserDto } from './dto/add-role-user.dto';
import { SUPER_USER_ROLE } from './permission-codes';
import { RequirePermission } from './permission.decorators';
import { PermissionsService } from './permissions.service';

const superUserOnly = (): AppError => new AppError(403, 'FORBIDDEN', 'Only a Super User can change Super User membership');

const englishName = (p: { englishFirstName: string | null; englishLastName: string | null } | null): string | null => {
  if (!p) return null;
  const name = [p.englishFirstName, p.englishLastName].filter((s) => s && s.trim() !== '').join(' ');
  return name === '' ? null : name;
};

@Controller()
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PermissionsService,
    private readonly clock: Clock,
  ) {}

  @Get('roles')
  @RequirePermission('access.roles.read')
  async list(): Promise<{ id: number; name: string | null; userCount: number }[]> {
    const roles = await this.prisma.role.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
    // Distinct users: the legacy join table may hold duplicate rows.
    const members = await this.prisma.roleUser.findMany({ select: { roleId: true, userId: true }, distinct: ['roleId', 'userId'] });
    const counts = new Map<number, number>();
    for (const m of members) counts.set(m.roleId, (counts.get(m.roleId) ?? 0) + 1);
    return roles.map((r) => ({ id: r.id, name: r.name, userCount: counts.get(r.id) ?? 0 }));
  }

  @Get('roles/:id')
  @RequirePermission('access.roles.read')
  async detail(@id('id') roleId: number): Promise<{
    id: number;
    name: string | null;
    permissions: string[];
    users: { id: number; username: string | null; personName: string | null }[];
  }> {
    const role = await this.requireRole(roleId);
    const grants = await this.prisma.rolePermission.findMany({ where: { roleId }, select: { permissionId: true } });
    const permissions = grants.length
      ? await this.prisma.permission.findMany({
          where: { id: { in: [...new Set(grants.map((g) => g.permissionId))] } },
          select: { code: true },
          orderBy: { code: 'asc' },
        })
      : [];
    const users = await this.prisma.user.findMany({
      where: { rolesUsers: { some: { roleId } } },
      select: { id: true, username: true, person: { select: { englishFirstName: true, englishLastName: true } } },
      orderBy: { id: 'asc' },
    });
    return {
      id: role.id,
      name: role.name,
      permissions: permissions.map((p) => p.code),
      users: users.map((u) => ({ id: u.id, username: u.username, personName: englishName(u.person) })),
    };
  }

  @Get('permissions')
  @RequirePermission('access.permissions.read')
  async permissions(): Promise<{ code: string; description: string | null; roles: string[] }[]> {
    const [perms, grants, roles] = await Promise.all([
      this.prisma.permission.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true } }),
      this.prisma.role.findMany({ select: { id: true, name: true } }),
    ]);
    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    return perms.map((p) => ({
      code: p.code,
      description: p.description,
      // Stored grants only (Super User's implicit "everything" is not listed).
      roles: [...new Set(grants.filter((g) => g.permissionId === p.id).map((g) => roleName.get(g.roleId)))]
        .filter((n): n is string => !!n)
        .sort(),
    }));
  }

  /**
   * Idempotent: the join table has no unique constraint, so the check-then-insert runs under a per-pair
   * advisory lock. The audit row is written in the same transaction and only when membership really changed.
   * Super User membership can only be changed by a Super User.
   */
  @Post('roles/:id/users')
  @RequirePermission('access.roles.manage_users')
  @HttpCode(204)
  async addUser(@id('id') roleId: number, @Body() dto: AddRoleUserDto, @Req() req: AuthedRequest): Promise<void> {
    const role = await this.requireRole(roleId);
    await this.requireSuperUserActorFor(role, req);
    const username = dto.username.trim();
    const user = await this.prisma.user.findFirst({ where: { username }, select: { id: true }, orderBy: { id: 'asc' } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    await this.prisma.$transaction(async (tx) => {
      await this.lockMembership(tx, role, user.id, req);
      if ((await tx.roleUser.count({ where: { roleId, userId: user.id } })) > 0) return;
      const now = this.clock.now();
      await tx.roleUser.create({ data: { roleId, userId: user.id, createdAt: now, updatedAt: now } });
      await this.audit.record(this.event('access.role_user_added', req, roleId, user.id), tx);
    });
  }

  /** Super User: only a Super User may remove members, and never the last one (409 LAST_SUPER_USER). */
  @Delete('roles/:id/users/:userId')
  @RequirePermission('access.roles.manage_users')
  @HttpCode(204)
  async removeUser(@id('id') roleId: number, @id('userId') userId: number, @Req() req: AuthedRequest): Promise<void> {
    const role = await this.requireRole(roleId);
    await this.requireSuperUserActorFor(role, req);
    await this.prisma.$transaction(async (tx) => {
      await this.lockMembership(tx, role, userId, req);
      if (role.name === SUPER_USER_ROLE && (await tx.roleUser.count({ where: { roleId, userId } })) > 0) {
        // Distinct users: the legacy join table may hold duplicate rows of one user.
        const others = await tx.roleUser.findMany({
          where: { roleId, userId: { not: userId } },
          select: { userId: true },
          distinct: ['userId'],
        });
        if (others.length === 0) throw new AppError(409, 'LAST_SUPER_USER', 'Cannot remove the last Super User');
      }
      const { count } = await tx.roleUser.deleteMany({ where: { roleId, userId } }); // all duplicate rows
      if (count > 0) await this.audit.record(this.event('access.role_user_removed', req, roleId, userId), tx);
    });
  }

  /** Changing Super User membership requires the acting user to currently be a Super User. */
  private async requireSuperUserActorFor(role: { name: string | null }, req: AuthedRequest): Promise<void> {
    if (role.name !== SUPER_USER_ROLE) return;
    const actorId = req.user?.id;
    if (actorId === undefined || !(await this.access.forUser(actorId)).roles.includes(SUPER_USER_ROLE)) throw superUserOnly();
  }

  /**
   * Per-pair advisory lock. For Super User a role-wide lock is taken first (always in this order), so concurrent
   * changes serialize for the last-member check, and the actor's own membership is re-checked under it.
   */
  private async lockMembership(
    tx: Prisma.TransactionClient,
    role: { id: number; name: string | null },
    userId: number,
    req: AuthedRequest,
  ): Promise<void> {
    if (role.name === SUPER_USER_ROLE) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_users:${role.id}`}))`;
      const actorId = req.user?.id;
      if (actorId === undefined || (await tx.roleUser.count({ where: { roleId: role.id, userId: actorId } })) === 0) {
        throw superUserOnly();
      }
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_user:${role.id}:${userId}`}))`;
  }

  private event(action: string, req: AuthedRequest, roleId: number, userId: number) {
    return {
      action,
      actorUserId: req.user?.id,
      actorUsername: req.user?.username ?? undefined,
      targetType: 'role',
      targetId: roleId,
      ip: req.ip,
      meta: { roleId, userId },
    };
  }

  private async requireRole(roleId: number): Promise<{ id: number; name: string | null }> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
    if (!role) throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
    return role;
  }
}
