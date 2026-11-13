import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../access/permission.decorators';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { RegistrationService } from './registration.service';
import type { AuthedRequest } from './session.guard';

@Controller('admin/user-registration')
export class AdminInvitationsController {
  constructor(private readonly registration: RegistrationService) {}

  /** Mails a single-use invitation link to `emailDestination`; the token itself is never returned. */
  @Post('invitations')
  @RequirePermission('auth.invitations.create')
  @HttpCode(201)
  create(@Body() dto: CreateInvitationDto, @Req() req: AuthedRequest): Promise<{ personId: number; expiresAt: string }> {
    return this.registration.invite(dto.personId, dto.emailDestination, {
      userId: req.user?.id,
      username: req.user?.username ?? undefined,
      ip: req.ip,
    });
  }
}
