import { Controller, Get } from '@nestjs/common';
import { Public } from './access/permission.decorators';

@Controller('healthz')
export class HealthController {
  @Get()
  @Public()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
