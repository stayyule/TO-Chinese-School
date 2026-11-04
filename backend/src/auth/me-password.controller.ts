import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Authenticated } from '../access/permission.decorators';
import { AppError } from '../common/errors';
import { AccountService } from './account.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { AuthedRequest } from './session.guard';

/** Same 20 requests/minute/IP limit as AuthController (ThrottlerModule config in AuthModule); CSRF is global. */
@Controller('me')
@UseGuards(ThrottlerGuard)
export class MePasswordController {
  constructor(private readonly account: AccountService) {}

  /** 204; keeps the calling session, signs out every other session of the user. */
  @Post('password')
  @Authenticated()
  @HttpCode(204)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { user, sessionTokenHash } = req;
    // PermissionGuard already ensures a user; SessionGuard sets both fields together.
    if (!user || !sessionTokenHash) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    try {
      await this.account.changePassword(user, sessionTokenHash, dto, req.ip);
    } catch (e) {
      if (e instanceof AppError && e.code === 'PASSWORD_CHANGE_LOCKED') {
        res.setHeader('Retry-After', String((e.details as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      throw e;
    }
  }
}
