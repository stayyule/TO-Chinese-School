import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ADDRESS_SELECT, AddressView, PERSON_SELECT, PersonDetailView, PersonView, toAddressView, toPersonView } from './dto/views';
import {
  AddressInput,
  PersonInput,
  normalizeAddressInput,
  normalizePersonInput,
  validateAddressInput,
  validatePersonInput,
  validationProblem,
} from './validation';

export const notFound = (what: string): AppError => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const MAX_PAGE_SIZE = 100;

/** Prisma does not escape LIKE wildcards in `contains`; backslash is PostgreSQL's default LIKE escape. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface SearchParams {
  query?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private currentYear(): number {
    return Number(this.clock.today().slice(0, 4));
  }

  async get(id: number): Promise<PersonDetailView> {
    const row = await this.prisma.person.findUnique({
      where: { id },
      select: { ...PERSON_SELECT, address: { select: ADDRESS_SELECT } },
    });
    if (!row) throw notFound('Person');
    return { ...toPersonView(row), address: row.address ? toAddressView(row.address) : null };
  }

  /**
   * Case-insensitive substring search over English first name, English last name and Chinese name. The query is
   * split on whitespace and EVERY word must match one of the three fields, so "amy chen" finds Amy Chen. Words
   * are literal text (LIKE wildcards are not interpreted). Ordered by last name, first name, id; `page` >= 1,
   * `pageSize` clamped to 1..100.
   */
  async search(params: SearchParams): Promise<{ items: PersonView[]; total: number }> {
    const page = Math.max(1, Math.floor(params.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize) || 1));
    const words = (params.query ?? '').split(/\s+/).filter((w) => w !== '');
    const where: Prisma.PersonWhereInput = {
      AND: words.map((w) => ({
        OR: (['englishFirstName', 'englishLastName', 'chineseName'] as const).map((f) => ({
          [f]: { contains: escapeLike(w), mode: 'insensitive' as const },
        })),
      })),
    };
    const [rows, total] = await Promise.all([
      this.prisma.person.findMany({
        where,
        select: PERSON_SELECT,
        orderBy: [{ englishLastName: 'asc' }, { englishFirstName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.person.count({ where }),
    ]);
    return { items: rows.map(toPersonView), total };
  }

  /**
   * Child-ness is derived, not caller-supplied: a person who is a child in any family (families_children) needs
   * birthYear and birthMonth; everyone else does not.
   */
  async update(id: number, input: PersonInput): Promise<PersonView> {
    const person = await this.prisma.person.findUnique({ where: { id }, select: { id: true } });
    if (!person) throw notFound('Person');
    const isChild = (await this.prisma.familyChild.count({ where: { childId: id } })) > 0;
    const problem = validationProblem(validatePersonInput(input, { isChild, currentYear: this.currentYear() }));
    if (problem) throw problem;
    const row = await this.prisma.person.update({
      where: { id },
      data: { ...normalizePersonInput(input), updatedAt: this.clock.now() },
      select: PERSON_SELECT,
    });
    return toPersonView(row);
  }

  /** The person row is locked so two concurrent creates cannot both attach an address. 409 PERSONAL_ADDRESS_EXISTS. */
  async createPersonalAddress(personId: number, input: AddressInput): Promise<AddressView> {
    const problem = validationProblem(validateAddressInput(input));
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ address_id: number | null }[]>`
        SELECT address_id FROM people WHERE id = ${personId} FOR UPDATE`;
      if (rows.length === 0) throw notFound('Person');
      if (problem) throw problem;
      if (rows[0].address_id !== null) {
        throw new AppError(409, 'PERSONAL_ADDRESS_EXISTS', 'This person already has a personal address');
      }
      const now = this.clock.now();
      const address = await tx.address.create({
        data: { ...normalizeAddressInput(input), createdAt: now, updatedAt: now },
        select: ADDRESS_SELECT,
      });
      await tx.person.update({ where: { id: personId }, data: { addressId: address.id, updatedAt: now } });
      return toAddressView(address);
    });
  }

  /** 404 NO_PERSONAL_ADDRESS when the person has none (create it first). */
  async updatePersonalAddress(personId: number, input: AddressInput): Promise<AddressView> {
    const person = await this.prisma.person.findUnique({ where: { id: personId }, select: { addressId: true } });
    if (!person) throw notFound('Person');
    const problem = validationProblem(validateAddressInput(input));
    if (problem) throw problem;
    if (person.addressId === null) throw new AppError(404, 'NO_PERSONAL_ADDRESS', 'This person has no personal address');
    const row = await this.prisma.address.update({
      where: { id: person.addressId },
      data: { ...normalizeAddressInput(input), updatedAt: this.clock.now() },
      select: ADDRESS_SELECT,
    });
    return toAddressView(row);
  }
}
