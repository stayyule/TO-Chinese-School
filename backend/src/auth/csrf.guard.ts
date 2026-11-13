import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';

export const CSRF_COOKIE = 'tocs_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time string equality (hashing first makes the comparison independent of the inputs' lengths). */
export function tokensMatch(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Global guard, double-submit cookie: every non-GET/HEAD/OPTIONS request must carry an `X-CSRF-Token`
 * header equal to the `tocs_csrf` cookie (obtained from GET /api/v1/auth/csrf), login included.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.header(CSRF_HEADER);
    if (typeof cookie !== 'string' || cookie === '' || !header || !tokensMatch(cookie, header)) {
      throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
    }
    return true;
  }
}
