import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SchoolYearController } from './school-year.controller';
import { SchoolYearLookup } from './school-year.lookup';
import { SchoolYearService } from './school-year.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SchoolYearController],
  providers: [SchoolYearLookup, SchoolYearService],
  exports: [SchoolYearLookup, SchoolYearService],
})
export class SchoolYearModule {}
