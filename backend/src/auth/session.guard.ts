import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';

export const SESSION_COOKIE = 'tocs_session';

export interface AuthUser {
  id: number;
  personId: number | null;
  username: string | null;
}

export type AuthedRequest = Request & { user?: AuthUser };

/**
 * Global guard: authentication context only. Resolves the `tocs_session` cookie and sets `req.user`;
 * it never rejects. Deciding whether a route needs a user (401) or a permission (403) is the job of
 * Task 9's PermissionGuard, which runs after this one.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const raw: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== 'string' || raw === '') return true;
    const session = await this.sessions.resolve(raw);
    if (!session) return true;
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, personId: true, username: true },
    });
    if (user) req.user = user;
    return true;
  }
}
