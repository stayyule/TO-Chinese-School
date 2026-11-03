import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccessModule } from '../access/access.module';
import { AccountService } from './account.service';
import { TokenPhoneLimiter } from './token-phone-limiter';
import { MailModule } from '../mail/mail.module';
import { PermissionGuard } from '../access/permission.guard';
import { PersonPhoneService } from '../people/phone';
import { AdminInvitationsController } from './admin-invitations.controller';
import { AuthController } from './auth.controller';
import { AuthTokenService } from './auth-token.service';
import { CsrfGuard } from './csrf.guard';
import { LoginThrottleService } from './login-throttle.service';
import { MePasswordController } from './me-password.controller';
import { PasswordService } from './password.service';
import { RegistrationService } from './registration.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

/**
 * ALL global guards are registered here, in one list: Nest runs APP_GUARDs in registration order, and across
 * modules that order would depend on module initialization order. Order:
 *   1. CsrfGuard (rejects bad non-GET requests before any DB work)
 *   2. SessionGuard (fills req.user, never rejects)
 *   3. PermissionGuard (default-deny: 401/403 from the route's access rule; needs req.user)
 * Do not register APP_GUARDs in any other module. The per-IP ThrottlerGuard is applied on AuthController and MePasswordController only.
 * PrismaService, AuditService and Clock come from their global modules.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 20 }]), AccessModule, MailModule],
  controllers: [AuthController, AdminInvitationsController, MePasswordController],
  providers: [
    PasswordService,
    AuthTokenService,
    SessionService,
    LoginThrottleService,
    PersonPhoneService,
    RegistrationService,
    TokenPhoneLimiter,
    AccountService,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PasswordService, SessionService, AuthTokenService, RegistrationService, MailModule],
})
export class AuthModule {}
