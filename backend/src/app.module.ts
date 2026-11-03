import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock.module';
import { HealthController } from './health.controller';

@Module({ imports: [ClockModule], controllers: [HealthController] })
export class AppModule {}
