import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { CsrfGuard } from './csrf.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

/**
 * Global guards, in this order: CsrfGuard (rejects bad non-GET requests before any DB work), then
 * SessionGuard (fills req.user, never rejects). The per-IP ThrottlerGuard is applied on AuthController only.
 * PrismaService, AuditService and Clock come from their global modules.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 20 }])],
  controllers: [AuthController],
  providers: [
    PasswordService,
    SessionService,
    LoginThrottleService,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [PasswordService, SessionService],
})
export class AuthModule {}
