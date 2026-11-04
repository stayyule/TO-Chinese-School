import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../auth/session.guard';
import { AppError } from '../common/errors';
import { ACCESS_RULE, AccessRule } from './permission.decorators';
import { PermissionsService } from './permissions.service';

/**
 * Global guard, default-deny. Must run after SessionGuard (which fills req.user); AuthModule registers the
 * global guards in one providers list, in order: CsrfGuard, SessionGuard, PermissionGuard.
 *   no rule → 403 FORBIDDEN (also caught at startup by assertRouteCoverage)
 *   @Public → allow; otherwise no req.user → 401 UNAUTHENTICATED
 *   @Authenticated → allow; @RequirePermission(code) → Super User or a granting role, else 403 FORBIDDEN
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) throw new AppError(403, 'FORBIDDEN', 'Forbidden');
    if (rule.kind === 'public') return true;

    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (rule.kind === 'authenticated') return true;

    if (await this.permissions.userHas(user.id, rule.code)) return true;
    throw new AppError(403, 'FORBIDDEN', 'Forbidden');
  }
}
