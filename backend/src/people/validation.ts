import { AppError } from '../common/errors';
import { SINGLE_EMAIL } from '../mail/mail.service';
import { cleanPhone } from './phone';

/**
 * Pure field validation for people and addresses (old Person / Address model validations), shared by
 * self-registration and the people/family screens.
 *
 * `ValidationErrors` maps a field name to ONE error code (the first failing rule for that field); an empty
 * object means valid. Codes:
 *   - REQUIRED      missing, or blank after trimming
 *   - TOO_LONG      more than 255 characters (code points, matching VARCHAR(255))
 *   - INVALID       wrong format/type (gender not 'M'/'F', non-integer, zipcode, phone, email)
 *   - OUT_OF_RANGE  an integer outside its allowed range (birthYear, birthMonth)
 * Nested inputs are reported with dotted keys (`prefixErrors('address', …)` → `address.zipcode`), and
 * `validationProblem` turns a non-empty map into a 422 `VALIDATION_ERROR` whose `details` is the map.
 */
export type FieldError = 'REQUIRED' | 'TOO_LONG' | 'INVALID' | 'OUT_OF_RANGE';
export type ValidationErrors = Record<string, FieldError>;

export const MAX_TEXT = 255;
const PHONE_DIGITS = 10;
/** Old Address: numericality only_integer, < 100000; here digits only, so 1..5 digits. */
const ZIPCODE = /^\d{1,5}$/;

type Text = string | null | undefined;
type Int = number | null | undefined;

export interface PersonInput {
  englishFirstName?: Text;
  englishLastName?: Text;
  chineseName?: Text;
  gender?: Text;
  birthYear?: Int;
  birthMonth?: Int;
  nativeLanguage?: Text;
}

export interface AddressInput {
  street?: Text;
  city?: Text;
  state?: Text;
  zipcode?: Text;
  homePhone?: Text;
  cellPhone?: Text;
  email?: Text;
}

export interface NormalizedPerson {
  englishFirstName: string | null;
  englishLastName: string | null;
  chineseName: string | null;
  gender: string | null;
  birthYear: number | null;
  birthMonth: number | null;
  nativeLanguage: string | null;
}

export interface NormalizedAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  homePhone: string | null;
  cellPhone: string | null;
  email: string | null;
}

/** Trimmed; blank → null. */
export function trimToNull(s: Text): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t === '' ? null : t;
}

const tooLong = (s: string): boolean => [...s].length > MAX_TEXT;

function checkText(errors: ValidationErrors, field: string, raw: Text, required: boolean): string | null {
  const value = trimToNull(raw);
  if (value === null) {
    if (required) errors[field] = 'REQUIRED';
  } else if (tooLong(value)) {
    errors[field] = 'TOO_LONG';
  }
  return value;
}

function checkInt(errors: ValidationErrors, field: string, raw: Int, required: boolean, ok: (n: number) => boolean): void {
  if (raw === null || raw === undefined) {
    if (required) errors[field] = 'REQUIRED';
  } else if (!Number.isInteger(raw)) {
    errors[field] = 'INVALID';
  } else if (!ok(raw)) {
    errors[field] = 'OUT_OF_RANGE';
  }
}

function checkPhone(errors: ValidationErrors, field: string, raw: Text, required: boolean): void {
  const value = trimToNull(raw);
  if (value === null) {
    if (required) errors[field] = 'REQUIRED';
  } else if (cleanPhone(value).length !== PHONE_DIGITS) {
    errors[field] = 'INVALID';
  }
}

/**
 * Old Person validations. Children (`isChild`) also need birthYear and birthMonth. When given (for anyone),
 * birthYear must be an integer with 1900 < year < `currentYear` (pass the Pacific-date year from Clock),
 * birthMonth an integer 1..12. chineseName and nativeLanguage are optional (≤ 255).
 */
export function validatePersonInput(input: PersonInput, opts: { isChild: boolean; currentYear: number }): ValidationErrors {
  const errors: ValidationErrors = {};
  const gender = trimToNull(input.gender);
  if (gender === null) errors.gender = 'REQUIRED';
  else if (gender !== 'M' && gender !== 'F') errors.gender = 'INVALID';
  checkText(errors, 'englishFirstName', input.englishFirstName, true);
  checkText(errors, 'englishLastName', input.englishLastName, true);
  checkText(errors, 'chineseName', input.chineseName, false);
  checkText(errors, 'nativeLanguage', input.nativeLanguage, false);
  checkInt(errors, 'birthYear', input.birthYear, opts.isChild, (y) => y > 1900 && y < opts.currentYear);
  checkInt(errors, 'birthMonth', input.birthMonth, opts.isChild, (m) => m >= 1 && m <= 12);
  return errors;
}

/** The values to store for a person that passed `validatePersonInput`: strings trimmed, blanks null. */
export function normalizePersonInput(input: PersonInput): NormalizedPerson {
  return {
    englishFirstName: trimToNull(input.englishFirstName),
    englishLastName: trimToNull(input.englishLastName),
    chineseName: trimToNull(input.chineseName),
    gender: trimToNull(input.gender),
    birthYear: input.birthYear ?? null,
    birthMonth: input.birthMonth ?? null,
    nativeLanguage: trimToNull(input.nativeLanguage),
  };
}

/**
 * Old Address validations: street, city, state, zipcode, homePhone and email required; zipcode 1-5 digits
 * (an integer < 100000); homePhone must clean (`cleanPhone`) to exactly 10 digits; cellPhone is optional but
 * must clean to 10 digits when given; email must be a single address. Text fields ≤ 255.
 */
export function validateAddressInput(input: AddressInput): ValidationErrors {
  const errors: ValidationErrors = {};
  checkText(errors, 'street', input.street, true);
  checkText(errors, 'city', input.city, true);
  checkText(errors, 'state', input.state, true);
  const zipcode = trimToNull(input.zipcode);
  if (zipcode === null) errors.zipcode = 'REQUIRED';
  else if (!ZIPCODE.test(zipcode)) errors.zipcode = 'INVALID';
  checkPhone(errors, 'homePhone', input.homePhone, true);
  checkPhone(errors, 'cellPhone', input.cellPhone, false);
  const email = checkText(errors, 'email', input.email, true);
  if (email !== null && errors.email === undefined && !SINGLE_EMAIL.test(email)) errors.email = 'INVALID';
  return errors;
}

/** The values to store for an address that passed `validateAddressInput`: trimmed, phones as digits only. */
export function normalizeAddressInput(input: AddressInput): NormalizedAddress {
  const phone = (s: Text): string | null => {
    const t = trimToNull(s);
    return t === null ? null : cleanPhone(t);
  };
  return {
    street: trimToNull(input.street),
    city: trimToNull(input.city),
    state: trimToNull(input.state),
    zipcode: trimToNull(input.zipcode),
    homePhone: phone(input.homePhone),
    cellPhone: phone(input.cellPhone),
    email: trimToNull(input.email),
  };
}

/** Display form of a stored 10-digit phone: `(805) 555-1234`. Anything else is returned unchanged. */
export function formatPhone(digits: string): string {
  if (!/^\d{10}$/.test(digits)) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** `{zipcode: 'INVALID'}` → `{'address.zipcode': 'INVALID'}`. */
export function prefixErrors(prefix: string, errors: ValidationErrors): ValidationErrors {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`${prefix}.${k}`, v]));
}

/** A 422 VALIDATION_ERROR carrying `errors` as `details`, or null when `errors` is empty. */
export function validationProblem(errors: ValidationErrors): AppError | null {
  return Object.keys(errors).length === 0 ? null : new AppError(422, 'VALIDATION_ERROR', 'Validation failed', errors);
}
