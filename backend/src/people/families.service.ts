import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ADDRESS_SELECT, AddressView, FamilyView, PERSON_SELECT, PersonView, toAddressView, toPersonView } from './dto/views';
import { notFound } from './people.service';
import {
  AddressInput,
  PersonInput,
  normalizeAddressInput,
  normalizePersonInput,
  prefixErrors,
  validateAddressInput,
  validatePersonInput,
  validationProblem,
} from './validation';

@Injectable()
export class FamiliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private currentYear(): number {
    return Number(this.clock.today().slice(0, 4));
  }

  /** Parents, children (each once, even if families_children holds duplicate links) and the family address. */
  async get(id: number): Promise<FamilyView> {
    const row = await this.prisma.family.findUnique({
      where: { id },
      select: {
        id: true,
        parentOne: { select: PERSON_SELECT },
        parentTwo: { select: PERSON_SELECT },
        address: { select: ADDRESS_SELECT },
        familiesChildren: { select: { child: { select: PERSON_SELECT } } },
      },
    });
    if (!row) throw notFound('Family');
    const seen = new Set<number>();
    const children: PersonView[] = [];
    for (const link of row.familiesChildren) {
      if (seen.has(link.child.id)) continue;
      seen.add(link.child.id);
      children.push(toPersonView(link.child));
    }
    children.sort((a, b) => a.id - b.id);
    return {
      id: row.id,
      parentOne: row.parentOne ? toPersonView(row.parentOne) : null,
      parentTwo: row.parentTwo ? toPersonView(row.parentTwo) : null,
      children,
      address: row.address ? toAddressView(row.address) : null,
    };
  }

  /** A new family (address, parent one, family) in one transaction; errors keyed `address.*` / `parentOne.*`. */
  async create(input: { address: AddressInput; parentOne: PersonInput }): Promise<FamilyView> {
    const problem = validationProblem({
      ...prefixErrors('address', validateAddressInput(input.address)),
      ...prefixErrors('parentOne', validatePersonInput(input.parentOne, { isChild: false, currentYear: this.currentYear() })),
    });
    if (problem) throw problem;
    const familyId = await this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      const stamps = { createdAt: now, updatedAt: now };
      const address = await tx.address.create({ data: { ...normalizeAddressInput(input.address), ...stamps }, select: { id: true } });
      const person = await tx.person.create({ data: { ...normalizePersonInput(input.parentOne), ...stamps }, select: { id: true } });
      const family = await tx.family.create({ data: { parentOneId: person.id, addressId: address.id, ...stamps }, select: { id: true } });
      return family.id;
    });
    return this.get(familyId);
  }

  /** Locks the family row for the rest of the transaction; 404 when it does not exist. */
  private async lockFamily(tx: Prisma.TransactionClient, familyId: number): Promise<{ parentTwoId: number | null; addressId: number | null }> {
    const rows = await tx.$queryRaw<{ parent_two_id: number | null; address_id: number | null }[]>`
      SELECT parent_two_id, address_id FROM families WHERE id = ${familyId} FOR UPDATE`;
    if (rows.length === 0) throw notFound('Family');
    return { parentTwoId: rows[0].parent_two_id, addressId: rows[0].address_id };
  }

  /** Updates the family address (a family without one gets a new address attached). */
  async updateAddress(familyId: number, input: AddressInput): Promise<AddressView> {
    const problem = validationProblem(validateAddressInput(input));
    return this.prisma.$transaction(async (tx) => {
      const family = await this.lockFamily(tx, familyId);
      if (problem) throw problem;
      const now = this.clock.now();
      const data = normalizeAddressInput(input);
      if (family.addressId === null) {
        const created = await tx.address.create({ data: { ...data, createdAt: now, updatedAt: now }, select: ADDRESS_SELECT });
        await tx.family.update({ where: { id: familyId }, data: { addressId: created.id, updatedAt: now } });
        return toAddressView(created);
      }
      const row = await tx.address.update({ where: { id: family.addressId }, data: { ...data, updatedAt: now }, select: ADDRESS_SELECT });
      return toAddressView(row);
    });
  }

  /** The old code overwrote parent two silently; now 409 PARENT_TWO_EXISTS. Race-safe (family row lock). */
  async addParentTwo(familyId: number, input: PersonInput): Promise<PersonView> {
    const problem = validationProblem(validatePersonInput(input, { isChild: false, currentYear: this.currentYear() }));
    return this.prisma.$transaction(async (tx) => {
      const family = await this.lockFamily(tx, familyId);
      if (problem) throw problem;
      if (family.parentTwoId !== null) throw new AppError(409, 'PARENT_TWO_EXISTS', 'This family already has a second parent');
      const now = this.clock.now();
      const person = await tx.person.create({
        data: { ...normalizePersonInput(input), createdAt: now, updatedAt: now },
        select: PERSON_SELECT,
      });
      await tx.family.update({ where: { id: familyId }, data: { parentTwoId: person.id, updatedAt: now } });
      return toPersonView(person);
    });
  }

  /** Creates the child (birth year and month required) and its families_children link in one transaction. */
  async addChild(familyId: number, input: PersonInput): Promise<PersonView> {
    const problem = validationProblem(validatePersonInput(input, { isChild: true, currentYear: this.currentYear() }));
    return this.prisma.$transaction(async (tx) => {
      await this.lockFamily(tx, familyId);
      if (problem) throw problem;
      const now = this.clock.now();
      const person = await tx.person.create({
        data: { ...normalizePersonInput(input), createdAt: now, updatedAt: now },
        select: PERSON_SELECT,
      });
      await tx.familyChild.create({ data: { familyId, childId: person.id, createdAt: now, updatedAt: now } });
      return toPersonView(person);
    });
  }

  /** True when `personId` is parent one or two of a family that lists `childId` as a child. */
  async personIsParentOf(personId: number, childId: number): Promise<boolean> {
    const n = await this.prisma.family.count({
      where: {
        OR: [{ parentOneId: personId }, { parentTwoId: personId }],
        familiesChildren: { some: { childId } },
      },
    });
    return n > 0;
  }

  /** Ids of the families in which `personId` is parent one or two, ascending. */
  async familyIdsAsParent(personId: number): Promise<number[]> {
    const rows = await this.prisma.family.findMany({
      where: { OR: [{ parentOneId: personId }, { parentTwoId: personId }] },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  /**
   * The prefill address for `personId`'s personal-address form, as seen by `requesterPersonId`, or null when there
   * is no such family or it has no address. Own record: the first family as parent, then as child, each by id
   * (old Person#families). Someone else (a child): only the first family, by id, in which the requester is parent
   * one or two AND the person is a child — never a family the requester does not belong to.
   */
  async firstFamilyAddress(personId: number, requesterPersonId: number): Promise<AddressInput | null> {
    const select = { address: { select: ADDRESS_SELECT } } as const;
    const asParent = (id: number) => ({ OR: [{ parentOneId: id }, { parentTwoId: id }] });
    const asChild = (id: number) => ({ familiesChildren: { some: { childId: id } } });
    const family =
      personId === requesterPersonId
        ? ((await this.prisma.family.findFirst({ where: asParent(personId), select, orderBy: { id: 'asc' } })) ??
          (await this.prisma.family.findFirst({ where: asChild(personId), select, orderBy: { id: 'asc' } })))
        : await this.prisma.family.findFirst({ where: { AND: [asParent(requesterPersonId), asChild(personId)] }, select, orderBy: { id: 'asc' } });
    if (!family?.address) return null;
    const { street, city, state, zipcode, homePhone, cellPhone, email } = family.address;
    return { street, city, state, zipcode, homePhone, cellPhone, email };
  }

  async personIsParentInFamily(personId: number, familyId: number): Promise<boolean> {
    const n = await this.prisma.family.count({
      where: { id: familyId, OR: [{ parentOneId: personId }, { parentTwoId: personId }] },
    });
    return n > 0;
  }
}
