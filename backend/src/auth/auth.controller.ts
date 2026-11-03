import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { CSRF_COOKIE } from './csrf.guard';
import { LoginDto } from './dto/login.dto';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { AuthedRequest, SESSION_COOKIE } from './session.guard';
import { SESSION_ABSOLUTE_MS, SessionService } from './session.service';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BASE_COOKIE: CookieOptions = { secure: true, sameSite: 'lax', path: '/' };
const SESSION_COOKIE_OPTIONS: CookieOptions = { ...BASE_COOKIE, httpOnly: true };
const NO_PASSWORD = { passwordHashV2: null, passwordHash: null, passwordSalt: null };

const invalidCredentials = (): AppError => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');

/** 20 requests/minute/IP on every /auth/* route (ThrottlerModule config in AuthModule). */
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  /** Double-submit token, readable by the SPA (not HttpOnly). An existing well-formed token is kept for other tabs. */
  @Get('csrf')
  csrf(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): { token: string } {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && TOKEN.test(existing) ? existing : randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, BASE_COOKIE);
    return { token };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: number }> {
    const username = dto.username.trim(); // old system stripped; lookup stays case-sensitive
    const ip = req.ip;
    try {
      await this.throttle.assertAllowed(username);
    } catch (e) {
      if (e instanceof AppError && e.code === 'LOGIN_LOCKED') {
        res.setHeader('Retry-After', String((e.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      throw e;
    }

    // users.username is not unique in the legacy schema; the old find_by_username took the first row.
    const user = await this.prisma.user.findFirst({ where: { username }, orderBy: { id: 'asc' } });
    const result = await this.passwords.verify(dto.password, user ?? NO_PASSWORD);
    if (!user || !result.ok) {
      await this.audit.record({ action: 'auth.login_failed', actorUserId: user?.id, actorUsername: username, ip });
      throw invalidCredentials();
    }
    if (result.needsUpgrade) {
      // Silent upgrade; legacy password_hash/password_salt stay untouched until the upgrade deadline.
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHashV2: await this.passwords.hash(dto.password) } });
    }

    const presented: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof presented === 'string' && presented !== '') await this.sessions.destroy(presented);
    const session = await this.sessions.create(user.id, { ip, userAgent: req.get('user-agent') });
    await this.audit.record({ action: 'auth.login_succeeded', actorUserId: user.id, actorUsername: username, ip });
    // Browser-side lifetime = absolute lifetime; the 8 h idle limit is enforced server-side.
    res.cookie(SESSION_COOKIE, session.id, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_ABSOLUTE_MS });
    return { userId: user.id };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof raw === 'string' && raw !== '') await this.sessions.destroy(raw);
    if (req.user) {
      await this.audit.record({ action: 'auth.logout', actorUserId: req.user.id, actorUsername: req.user.username ?? undefined, ip: req.ip });
    }
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
  }
}
