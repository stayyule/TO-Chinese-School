import { Injectable } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { notFound } from './people.service';

/*
 * Object-level authorization for the parent self-service routes. Denial is the same 404 NOT_FOUND
 * ("Family not found" / "Person not found") that a nonexistent id produces, so a caller cannot probe which
 * families or people exist. Call the policy FIRST in each handler, before any other lookup or validation.
 * A user without a person record (`userPersonId` null) is never authorized.
 */

@Injectable()
export class FamilyAccessPolicy {
  constructor(private readonly families: FamiliesService) {}

  /** The user's person must be parent one or parent two of the family (old Student::FamiliesController). */
  async assertParentOf(userPersonId: number | null, familyId: number): Promise<void> {
    if (userPersonId === null || !(await this.families.personIsParentInFamily(userPersonId, familyId))) {
      throw notFound('Family');
    }
  }
}

@Injectable()
export class PersonAccessPolicy {
  constructor(private readonly families: FamiliesService) {}

  /**
   * The person is the user's own person, or a child (families_children) of a family in which the user's person
   * is parent one or two (old Student::PeopleController#action_authorized?). The other parent of the user's
   * family is NOT covered, matching the old app.
   */
  async assertSelfOrParent(userPersonId: number | null, personId: number): Promise<void> {
    if (userPersonId === null) throw notFound('Person');
    if (userPersonId === personId) return;
    if (!(await this.families.personIsParentOf(userPersonId, personId))) throw notFound('Person');
  }
}
