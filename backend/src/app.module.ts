import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClockModule } from './common/clock.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({ imports: [ClockModule, PrismaModule, AuditModule, AuthModule], controllers: [HealthController] })
export class AppModule {}
