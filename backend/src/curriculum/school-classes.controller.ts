import { Body, Controller, Get, Patch, Post, Put, Req } from '@nestjs/common';
import { RequirePermission } from '../access/permission.decorators';
import type { AuthedRequest } from '../auth/session.guard';
import { IdParam } from '../common/id.pipe';
import { SchoolClassActiveDto, SchoolClassInputDto } from './dto/school-class-input.dto';
import { SchoolClassesService, type SchoolClassListItem, type SchoolClassView } from './school-classes.service';

/** Registration-officer school class administration (old Admin::SchoolClassesController). */
@Controller('school-classes')
export class SchoolClassesController {
  constructor(private readonly classes: SchoolClassesService) {}

  @Get()
  @RequirePermission('school_classes.read')
  list(): Promise<SchoolClassListItem[]> {
    return this.classes.list();
  }

  @Post()
  @RequirePermission('school_classes.create')
  create(@Body() dto: SchoolClassInputDto, @Req() req: AuthedRequest): Promise<SchoolClassView> {
    return this.classes.create(dto, req.user?.id);
  }

  @Patch(':id')
  @RequirePermission('school_classes.edit')
  update(@IdParam('id') id: number, @Body() dto: SchoolClassInputDto, @Req() req: AuthedRequest): Promise<SchoolClassView> {
    return this.classes.update(id, dto, req.user?.id);
  }

  @Put(':id/active')
  @RequirePermission('school_classes.toggle_active')
  setActive(
    @IdParam('id') id: number,
    @Body() dto: SchoolClassActiveDto,
    @Req() req: AuthedRequest,
  ): Promise<{ schoolClassId: number; schoolYearId: number; active: boolean }> {
    return this.classes.setActive(id, dto.schoolYearId, dto.active, req.user?.id);
  }
}
