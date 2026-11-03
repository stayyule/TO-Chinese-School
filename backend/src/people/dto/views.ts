import type { Address, Person } from '@prisma/client';
import { formatPhone } from '../validation';

/** Output shapes: phones formatted for display; no timestamps or internal columns. */
export interface AddressView {
  id: number;
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  homePhone: string | null;
  cellPhone: string | null;
  email: string | null;
}

export interface PersonView {
  id: number;
  englishFirstName: string | null;
  englishLastName: string | null;
  chineseName: string | null;
  gender: string | null;
  birthYear: number | null;
  birthMonth: number | null;
  nativeLanguage: string | null;
}

export interface PersonDetailView extends PersonView {
  address: AddressView | null;
}

export interface FamilyView {
  id: number;
  parentOne: PersonView | null;
  parentTwo: PersonView | null;
  children: PersonView[];
  address: AddressView | null;
}

export const PERSON_SELECT = {
  id: true,
  englishFirstName: true,
  englishLastName: true,
  chineseName: true,
  gender: true,
  birthYear: true,
  birthMonth: true,
  nativeLanguage: true,
} as const;

export const ADDRESS_SELECT = {
  id: true,
  street: true,
  city: true,
  state: true,
  zipcode: true,
  homePhone: true,
  cellPhone: true,
  email: true,
} as const;

type PersonRow = Pick<Person, keyof typeof PERSON_SELECT>;
type AddressRow = Pick<Address, keyof typeof ADDRESS_SELECT>;

const phone = (p: string | null): string | null => (p === null || p === '' ? null : formatPhone(p));

export function toAddressView(a: AddressRow): AddressView {
  return {
    id: a.id,
    street: a.street,
    city: a.city,
    state: a.state,
    zipcode: a.zipcode,
    homePhone: phone(a.homePhone),
    cellPhone: phone(a.cellPhone),
    email: a.email,
  };
}

export function toPersonView(p: PersonRow): PersonView {
  return {
    id: p.id,
    englishFirstName: p.englishFirstName,
    englishLastName: p.englishLastName,
    chineseName: p.chineseName,
    gender: p.gender,
    birthYear: p.birthYear,
    birthMonth: p.birthMonth,
    nativeLanguage: p.nativeLanguage,
  };
}
