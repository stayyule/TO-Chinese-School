import { Controller, Get, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/session.guard';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { Authenticated } from './permission.decorators';
import type { PermissionCode } from './permission-codes';
import { PermissionsService } from './permissions.service';

export interface MeResponse {
  user: { id: number; username: string | null };
  person: { id: number; englishName: string; chineseName: string | null } | null;
  roles: string[];
  permissions: PermissionCode[];
}

@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @Authenticated()
  async me(@Req() req: AuthedRequest): Promise<MeResponse> {
    const user = req.user;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required'); // PermissionGuard already ensures this
    const person = user.personId
      ? await this.prisma.person.findUnique({
          where: { id: user.personId },
          select: { id: true, englishFirstName: true, englishLastName: true, chineseName: true },
        })
      : null;
    const { roles, permissions } = await this.permissions.forUser(user.id);
    return {
      user: { id: user.id, username: user.username },
      person: person && {
        id: person.id,
        // Old Person#english_name: "#{english_first_name} #{english_last_name}" (blank parts dropped here).
        englishName: [person.englishFirstName, person.englishLastName].filter((s) => s && s.trim() !== '').join(' '),
        chineseName: person.chineseName,
      },
      roles,
      permissions,
    };
  }
}
