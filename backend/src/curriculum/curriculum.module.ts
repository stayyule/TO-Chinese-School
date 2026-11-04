import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SchoolYearModule } from '../school-year/school-year.module';
import { GradesController } from './grades.controller';
import { SchoolClassesController } from './school-classes.controller';
import { SchoolClassesService } from './school-classes.service';

@Module({
  imports: [PrismaModule, AuditModule, SchoolYearModule],
  controllers: [GradesController, SchoolClassesController],
  providers: [SchoolClassesService],
})
export class CurriculumModule {}
