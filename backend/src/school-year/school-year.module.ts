import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchoolYearLookup } from './school-year.lookup';

@Module({
  imports: [PrismaModule],
  providers: [SchoolYearLookup],
  exports: [SchoolYearLookup],
})
export class SchoolYearModule {}
