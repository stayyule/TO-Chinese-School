import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CODES, PermissionCode, SUPER_USER_ROLE, isPermissionCode } from './permission-codes';

export interface UserAccess {
  roles: string[];
  permissions: PermissionCode[];
}

/** Role and permission lookups over roles, roles_users, role_permissions and permissions. Not cached. */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Role names sorted; permissions in PERMISSION_CODES order. Super User holds every code. */
  async forUser(userId: number): Promise<UserAccess> {
    const roleRows = await this.prisma.role.findMany({
      where: { rolesUsers: { some: { userId } } },
      select: { id: true, name: true },
    });
    const roles = [...new Set(roleRows.map((r) => r.name).filter((n): n is string => n !== null))].sort();
    if (roles.includes(SUPER_USER_ROLE)) return { roles, permissions: [...PERMISSION_CODES] };
    if (roleRows.length === 0) return { roles, permissions: [] };

    const grants = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleRows.map((r) => r.id) } },
      select: { permissionId: true },
    });
    if (grants.length === 0) return { roles, permissions: [] };
    const rows = await this.prisma.permission.findMany({
      where: { id: { in: [...new Set(grants.map((g) => g.permissionId))] } },
      select: { code: true },
    });
    // Codes stored in the DB but unknown to this build are ignored rather than trusted.
    const granted = new Set(rows.map((r) => r.code).filter(isPermissionCode));
    return { roles, permissions: PERMISSION_CODES.filter((c) => granted.has(c)) };
  }

  async userHas(userId: number, code: PermissionCode): Promise<boolean> {
    return (await this.forUser(userId)).permissions.includes(code);
  }
}
