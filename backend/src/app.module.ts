import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClockModule } from './common/clock.module';
import { HealthController } from './health.controller';
import { PeopleModule } from './people/people.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({ imports: [ClockModule, PrismaModule, AuditModule, AuthModule, AccessModule, PeopleModule], controllers: [HealthController] })
export class AppModule {}
