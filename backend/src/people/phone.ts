import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** A US number after cleaning; anything shorter or longer never matches. */
const PHONE_DIGITS = 10;

/** Digits only; an 11-digit number starting with the country code 1 loses it. */
export function cleanPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/**
 * Both sides are cleaned (legacy rows may be stored formatted, e.g. "(805) 555-1234"). The input must clean to
 * exactly 10 digits, so empty or short input never matches, not even an equally empty stored value.
 */
export function phonesMatch(stored: string | null, input: string): boolean {
  const wanted = cleanPhone(input);
  return wanted.length === PHONE_DIGITS && stored !== null && cleanPhone(stored) === wanted;
}

@Injectable()
export class PersonPhoneService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Old Person#phone_number_correct?: a person with an address is checked against that address's home/cell
   * phone only; otherwise against the addresses of every family where the person is a parent or a child.
   */
  async phoneMatchesPerson(personId: number, input: string): Promise<boolean> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { address: { select: { homePhone: true, cellPhone: true } } },
    });
    if (!person) return false;
    const addresses = person.address
      ? [person.address]
      : (
          await this.prisma.family.findMany({
            where: {
              OR: [{ parentOneId: personId }, { parentTwoId: personId }, { familiesChildren: { some: { childId: personId } } }],
            },
            select: { address: { select: { homePhone: true, cellPhone: true } } },
          })
        )
          .map((f) => f.address)
          .filter((a) => a !== null);
    return addresses.some((a) => phonesMatch(a.homePhone, input) || phonesMatch(a.cellPhone, input));
  }
}
