import { Module } from '@nestjs/common';
import { loadMailConfig } from '../config/env';
import { MAIL_CONFIG, MailService } from './mail.service';

@Module({
  providers: [{ provide: MAIL_CONFIG, useFactory: () => loadMailConfig(process.env) }, MailService],
  exports: [MailService],
})
export class MailModule {}
