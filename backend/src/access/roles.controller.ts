import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/session.guard';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { IdParam as id } from '../common/id.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AddRoleUserDto } from './dto/add-role-user.dto';
import { RequirePermission } from './permission.decorators';

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
   */
  @Post('roles/:id/users')
  @RequirePermission('access.roles.manage_users')
  @HttpCode(204)
  async addUser(@id('id') roleId: number, @Body() dto: AddRoleUserDto, @Req() req: AuthedRequest): Promise<void> {
    await this.requireRole(roleId);
    const username = dto.username.trim();
    const user = await this.prisma.user.findFirst({ where: { username }, select: { id: true }, orderBy: { id: 'asc' } });
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_user:${roleId}:${user.id}`}))`;
      if ((await tx.roleUser.count({ where: { roleId, userId: user.id } })) > 0) return;
      await tx.roleUser.create({ data: { roleId, userId: user.id, createdAt: new Date(), updatedAt: new Date() } });
      await this.audit.record(this.event('access.role_user_added', req, roleId, user.id), tx);
    });
  }

  @Delete('roles/:id/users/:userId')
  @RequirePermission('access.roles.manage_users')
  @HttpCode(204)
  async removeUser(@id('id') roleId: number, @id('userId') userId: number, @Req() req: AuthedRequest): Promise<void> {
    await this.requireRole(roleId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_user:${roleId}:${userId}`}))`;
      const { count } = await tx.roleUser.deleteMany({ where: { roleId, userId } }); // all duplicate rows
      if (count > 0) await this.audit.record(this.event('access.role_user_removed', req, roleId, userId), tx);
    });
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
