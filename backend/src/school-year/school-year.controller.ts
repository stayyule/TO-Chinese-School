import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../access/permission.decorators';
import type { AuthedRequest } from '../auth/session.guard';
import { IdParam } from '../common/id.pipe';
import { SchoolYearInputDto } from './dto/school-year-input.dto';
import { SchoolYearService, type SchoolYearView } from './school-year.service';

/** Registration-officer school-year administration (old Admin::SchoolYearsController). */
@Controller('school-years')
export class SchoolYearController {
  constructor(private readonly years: SchoolYearService) {}

  @Get()
  @RequirePermission('school_years.read')
  list(): Promise<SchoolYearView[]> {
    return this.years.list();
  }

  @Get(':id')
  @RequirePermission('school_years.read')
  show(@IdParam('id') id: number): Promise<SchoolYearView> {
    return this.years.get(id);
  }

  @Post()
  @RequirePermission('school_years.create')
  create(@Body() dto: SchoolYearInputDto, @Req() req: AuthedRequest): Promise<SchoolYearView> {
    return this.years.create(dto, req.user?.id);
  }

  @Patch(':id')
  @RequirePermission('school_years.edit')
  update(@IdParam('id') id: number, @Body() dto: SchoolYearInputDto, @Req() req: AuthedRequest): Promise<SchoolYearView> {
    return this.years.update(id, dto, req.user?.id);
  }

  @Post(':id/auto-class-assignment/toggle')
  @HttpCode(200)
  @RequirePermission('school_years.auto_class_assignment.toggle')
  async toggle(@IdParam('id') id: number): Promise<{ autoClassAssignment: boolean }> {
    return { autoClassAssignment: await this.years.toggleAutoClassAssignment(id) };
  }
}
