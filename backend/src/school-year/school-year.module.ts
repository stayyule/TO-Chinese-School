import { Module } from '@nestjs/common';
import { clockProvider } from '../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { SchoolYearLookup } from './school-year.lookup';

@Module({
  imports: [PrismaModule],
  providers: [clockProvider, SchoolYearLookup],
  exports: [SchoolYearLookup],
})
export class SchoolYearModule {}
