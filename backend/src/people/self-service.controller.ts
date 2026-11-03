import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../access/permission.decorators';
import type { AuthedRequest } from '../auth/session.guard';
import { AppError } from '../common/errors';
import { IdParam } from '../common/id.pipe';
import { AddressInputDto } from './dto/address-input.dto';
import { PersonInputDto } from './dto/person-input.dto';
import type { AddressView, FamilyView, PersonView } from './dto/views';
import { FamiliesService } from './families.service';
import { PeopleService } from './people.service';
import { FamilyAccessPolicy, PersonAccessPolicy } from './policies';
import type { AddressInput } from './validation';

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zipcode', 'homePhone', 'cellPhone', 'email'] as const;

/** The signed-in user's person id (null when the user has no person record). */
function personIdOf(req: AuthedRequest): number | null {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required'); // PermissionGuard already ensures this
  return req.user.personId ?? null;
}

/**
 * Parent self-service (old Student::FamiliesController / Student::PeopleController). Every handler with an id
 * runs its object-level policy first, so "not yours" and "does not exist" are the same 404 NOT_FOUND.
 * Staff work on any family/person through the families/people routes instead.
 */
@Controller('me')
export class SelfServiceController {
  constructor(
    private readonly families: FamiliesService,
    private readonly people: PeopleService,
    private readonly familyPolicy: FamilyAccessPolicy,
    private readonly personPolicy: PersonAccessPolicy,
  ) {}

  /** The families in which the user is parent one or two (by id), with both parents, children and address. */
  @Get('families')
  @Authenticated()
  async myFamilies(@Req() req: AuthedRequest): Promise<FamilyView[]> {
    const personId = personIdOf(req);
    if (personId === null) return [];
    const ids = await this.families.familyIdsAsParent(personId);
    return Promise.all(ids.map((id) => this.families.get(id)));
  }

  @Patch('families/:id/address')
  @RequirePermission('family.self.address.edit')
  @HttpCode(204)
  async updateFamilyAddress(@IdParam('id') familyId: number, @Body() dto: AddressInputDto, @Req() req: AuthedRequest): Promise<void> {
    await this.familyPolicy.assertParentOf(personIdOf(req), familyId);
    await this.families.updateAddress(familyId, dto);
  }

  /** Adds parent two; 409 PARENT_TWO_EXISTS when the family already has one. */
  @Post('families/:id/parents')
  @RequirePermission('family.self.parent.add')
  async addParent(@IdParam('id') familyId: number, @Body() dto: PersonInputDto, @Req() req: AuthedRequest): Promise<PersonView> {
    await this.familyPolicy.assertParentOf(personIdOf(req), familyId);
    return this.families.addParentTwo(familyId, dto);
  }

  @Post('families/:id/children')
  @RequirePermission('family.self.child.add')
  async addChild(@IdParam('id') familyId: number, @Body() dto: PersonInputDto, @Req() req: AuthedRequest): Promise<PersonView> {
    await this.familyPolicy.assertParentOf(personIdOf(req), familyId);
    return this.families.addChild(familyId, dto);
  }

  /** The user's own record or a child of one of the user's families (full replacement of the editable fields). */
  @Patch('people/:id')
  @RequirePermission('person.self.edit')
  @HttpCode(204)
  async updatePerson(@IdParam('id') personId: number, @Body() dto: PersonInputDto, @Req() req: AuthedRequest): Promise<void> {
    await this.personPolicy.assertSelfOrParent(personIdOf(req), personId);
    await this.people.update(personId, dto);
  }

  /**
   * Creates the personal address. Fields left out of the body default to the person's first family address
   * among the requester's own families (the old form was prefilled with it; see FamiliesService.firstFamilyAddress); 409 PERSONAL_ADDRESS_EXISTS when one already exists.
   */
  @Post('people/:id/address')
  @RequirePermission('person.self.address.create')
  async createPersonalAddress(@IdParam('id') personId: number, @Body() dto: AddressInputDto, @Req() req: AuthedRequest): Promise<AddressView> {
    const requester = personIdOf(req);
    await this.personPolicy.assertSelfOrParent(requester, personId);
    // The policy guarantees a requester person here; prefill only from a family the requester belongs to.
    const defaults = await this.families.firstFamilyAddress(personId, requester as number);
    const input: AddressInput = { ...dto };
    if (defaults) {
      for (const f of ADDRESS_FIELDS) if (input[f] === undefined) input[f] = defaults[f];
    }
    return this.people.createPersonalAddress(personId, input);
  }

  /** 404 NO_PERSONAL_ADDRESS when the person has none. */
  @Patch('people/:id/address')
  @RequirePermission('person.self.address.edit')
  @HttpCode(204)
  async updatePersonalAddress(@IdParam('id') personId: number, @Body() dto: AddressInputDto, @Req() req: AuthedRequest): Promise<void> {
    await this.personPolicy.assertSelfOrParent(personIdOf(req), personId);
    await this.people.updatePersonalAddress(personId, dto);
  }
}
