import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import { Public } from '../access/permission.decorators';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import { CSRF_COOKIE } from './csrf.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotUsernameDto } from './dto/forgot-username.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { RegisterWithInvitationDto } from './dto/register-with-invitation.dto';
import { RegistrationService } from './registration.service';
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
    private readonly registration: RegistrationService,
    private readonly account: AccountService,
  ) {}

  /** Double-submit token, readable by the SPA (not HttpOnly). An existing well-formed token is kept for other tabs. */
  @Get('csrf')
  @Public()
  csrf(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): { token: string } {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && TOKEN.test(existing) ? existing : randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, BASE_COOKIE);
    return { token };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: number }> {
    const username = dto.username.trim(); // old system stripped; lookup stays case-sensitive
    const ip = req.ip;

    // Lockout check, verification and the audit write are serialized per username (see withUsernameLock).
    let outcome: { user: User | null; ok: boolean; needsUpgrade: boolean };
    try {
      outcome = await this.throttle.withUsernameLock(username, async (tx) => {
        await this.throttle.assertAllowed(username, tx);
        // users.username is not unique in the legacy schema; the old find_by_username took the first row.
        const user = await tx.user.findFirst({ where: { username }, orderBy: { id: 'asc' } });
        const result = await this.passwords.verify(dto.password, user ?? NO_PASSWORD);
        const ok = user !== null && result.ok;
        const action = ok ? 'auth.login_succeeded' : 'auth.login_failed';
        await this.audit.record({ action, actorUserId: user?.id, actorUsername: username, ip }, tx);
        return { user, ok, needsUpgrade: result.needsUpgrade };
      });
    } catch (e) {
      if (e instanceof AppError && e.code === 'LOGIN_LOCKED') {
        res.setHeader('Retry-After', String((e.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      throw e;
    }
    const { user, ok, needsUpgrade } = outcome;
    if (!user || !ok) throw invalidCredentials();

    if (needsUpgrade) {
      // Silent upgrade; legacy password_hash/password_salt stay untouched until the upgrade deadline.
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHashV2: await this.passwords.hash(dto.password) } });
    }

    const presented: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof presented === 'string' && presented !== '') await this.sessions.destroy(presented);
    const session = await this.sessions.create(user.id, { ip, userAgent: req.get('user-agent') });
    // Browser-side lifetime = absolute lifetime; the 8 h idle limit is enforced server-side.
    res.cookie(SESSION_COOKIE, session.id, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_ABSOLUTE_MS });
    return { userId: user.id };
  }

  /**
   * Public so logout is idempotent: a stale or expired session still gets 204 and a cleared cookie (CSRF still
   * applies). Any session row named by the cookie is dropped; only a live session (req.user) is audited.
   */
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof raw === 'string' && raw !== '') await this.sessions.destroy(raw);
    if (req.user) {
      await this.audit.record({ action: 'auth.logout', actorUserId: req.user.id, actorUsername: req.user.username ?? undefined, ip: req.ip });
    }
    res.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
  }

  /** Name of the invited person for the registration form; 404 INVALID_TOKEN for unknown/used/expired links. */
  @Get('invitations/:token')
  @Public()
  invitation(@Param('token') token: string): Promise<{ personName: string | null }> {
    return this.registration.invitationInfo(token);
  }

  /** Creates the invited person's account (Student Parent, plus derived instructor roles). Does not sign in. */
  @Post('register-with-invitation')
  @Public()
  @HttpCode(201)
  register(@Body() dto: RegisterWithInvitationDto, @Req() req: AuthedRequest): Promise<{ userId: number }> {
    return this.registration.register(dto, req.ip);
  }

  /**
   * Self-registration of a new family (old signin#register). 201 {}; does not sign in. 409 EMAIL_ALREADY_REGISTERED
   * names no username (D1; "Forgot username" mails it to the address on record).
   */
  @Post('register')
  @Public()
  @HttpCode(201)
  async selfRegister(@Body() dto: RegisterDto, @Req() req: AuthedRequest): Promise<Record<string, never>> {
    await this.registration.selfRegister(dto, req.ip);
    return {};
  }

  /** D1: always 202 {}; the lookup and the mail happen after the response (see AccountService). */
  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  forgotPassword(@Body() dto: ForgotPasswordDto): Record<string, never> {
    this.account.requestPasswordReset(dto.username);
    return {};
  }

  /** 200 {} while the reset link is usable; 404 INVALID_TOKEN otherwise. */
  @Get('reset-tokens/:token')
  @Public()
  async resetToken(@Param('token') token: string): Promise<Record<string, never>> {
    await this.account.checkResetToken(token);
    return {};
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: AuthedRequest): Promise<void> {
    await this.account.resetPassword(dto, req.ip);
  }

  /** D1: always 202 {}; usernames only ever travel by mail to the address on record. */
  @Post('forgot-username')
  @Public()
  @HttpCode(202)
  forgotUsername(@Body() dto: ForgotUsernameDto): Record<string, never> {
    this.account.requestUsernameReminder(dto.email);
    return {};
  }
}