import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../access/permission.decorators';
import { IdParam } from '../common/id.pipe';
import { AddressInputDto } from './dto/address-input.dto';
import { CreateFamilyDto, PersonInputDto } from './dto/person-input.dto';
import type { AddressView, FamilyView, PersonDetailView, PersonView } from './dto/views';
import { FamiliesService } from './families.service';
import { MAX_PAGE_SIZE, PeopleService } from './people.service';
import { validationProblem, type ValidationErrors } from './validation';

const DEFAULT_PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 100;
const INT4_MAX = 2_147_483_647;
/** Keeps (page - 1) * pageSize (pageSize at most 100) far below the int4 range of the OFFSET. */
const MAX_PAGE = 1_000_000;

/** A positive integer query value up to `max` (default when absent); anything else is reported under `field`. */
function positiveInt(errors: ValidationErrors, field: string, raw: unknown, fallback: number, max = INT4_MAX): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    errors[field] = 'INVALID';
    return fallback;
  }
  return Number(raw);
}

/**
 * Registration-officer people and family routes (old Registration::PeopleController / FamiliesController). Staff
 * are not object-scoped: any person or family may be used, and unknown ids are 404 NOT_FOUND.
 */
@Controller()
export class StaffController {
  constructor(
    private readonly people: PeopleService,
    private readonly families: FamiliesService,
  ) {}

  /**
   * `pageSize` above 100 is clamped to 100; non-numeric or < 1 `page`/`pageSize`, `page` above 1,000,000, or a bad
   * `query`, is a field-keyed 422.
   */
  @Get('people')
  @RequirePermission('people.read')
  async search(@Query('query') query?: unknown, @Query('page') page?: unknown, @Query('pageSize') pageSize?: unknown): Promise<{ items: PersonView[]; total: number }> {
    const errors: ValidationErrors = {};
    if (query !== undefined && (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH || query.includes('\u0000'))) errors.query = 'INVALID';
    const p = positiveInt(errors, 'page', page, 1, MAX_PAGE);
    const size = positiveInt(errors, 'pageSize', pageSize, DEFAULT_PAGE_SIZE);
    const problem = validationProblem(errors);
    if (problem) throw problem;
    return this.people.search({ query: query as string | undefined, page: p, pageSize: Math.min(size, MAX_PAGE_SIZE) });
  }

  /** The person (no user account data) with their address and every family they belong to as parent or child. */
  @Get('people/:id')
  @RequirePermission('people.read')
  async showPerson(@IdParam('id') id: number): Promise<PersonDetailView & { families: FamilyView[] }> {
    const person = await this.people.get(id);
    const ids = await this.families.familyIdsOfPerson(id);
    const families = await Promise.all(ids.map((fid) => this.families.get(fid)));
    return { ...person, families };
  }

  @Patch('people/:id')
  @RequirePermission('people.edit')
  updatePerson(@IdParam('id') id: number, @Body() dto: PersonInputDto): Promise<PersonView> {
    return this.people.update(id, dto);
  }

  /** No family prefill for staff: every address field is supplied (and validated) explicitly. */
  @Post('people/:id/address')
  @RequirePermission('people.address.create')
  createPersonalAddress(@IdParam('id') id: number, @Body() dto: AddressInputDto): Promise<AddressView> {
    return this.people.createPersonalAddress(id, dto);
  }

  @Patch('people/:id/address')
  @RequirePermission('people.address.edit')
  updatePersonalAddress(@IdParam('id') id: number, @Body() dto: AddressInputDto): Promise<AddressView> {
    return this.people.updatePersonalAddress(id, dto);
  }

  @Get('families/:id')
  @RequirePermission('families.read')
  showFamily(@IdParam('id') id: number): Promise<FamilyView> {
    return this.families.get(id);
  }

  @Post('families')
  @RequirePermission('families.create')
  async createFamily(@Body() dto: CreateFamilyDto): Promise<{ id: number }> {
    const family = await this.families.create(dto);
    return { id: family.id };
  }

  @Patch('families/:id/address')
  @RequirePermission('families.address.edit')
  updateFamilyAddress(@IdParam('id') id: number, @Body() dto: AddressInputDto): Promise<AddressView> {
    return this.families.updateAddress(id, dto);
  }

  @Post('families/:id/parents')
  @RequirePermission('families.parent.add')
  addParent(@IdParam('id') id: number, @Body() dto: PersonInputDto): Promise<PersonView> {
    return this.families.addParentTwo(id, dto);
  }

  @Post('families/:id/children')
  @RequirePermission('families.child.add')
  addChild(@IdParam('id') id: number, @Body() dto: PersonInputDto): Promise<PersonView> {
    return this.families.addChild(id, dto);
  }
}
