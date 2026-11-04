import { MAX_TEXT, trimToNull, type ValidationErrors } from '../people/validation';

/**
 * Pure school-class rules (old SchoolClass model validations). Codes as in src/people/validation.ts: REQUIRED,
 * TOO_LONG, INVALID, OUT_OF_RANGE. Name uniqueness and grade existence need the database and live in the service.
 */
export const SCHOOL_CLASS_TYPES = ['S', 'T', 'M', 'SE', 'ELECTIVE', 'EC', 'ECPS'] as const;
export const DEFAULT_MAX_SIZE = 25;
const INT4_MAX = 2_147_483_647;

export interface SchoolClassInput {
  englishName?: string | null;
  chineseName?: string | null;
  shortName?: string | null;
  description?: string | null;
  location?: string | null;
  schoolClassType?: string | null;
  maxSize?: number | null;
  minAge?: number | null;
  maxAge?: number | null;
  gradeId?: number | null;
}

export interface NormalizedSchoolClass {
  englishName: string;
  chineseName: string;
  shortName: string | null;
  description: string | null;
  location: string | null;
  schoolClassType: string;
  maxSize: number;
  minAge: number | null;
  maxAge: number | null;
  gradeId: number | null;
}

function text(errors: ValidationErrors, field: string, raw: string | null | undefined, required: boolean): void {
  const v = trimToNull(raw);
  if (v === null) {
    if (required) errors[field] = 'REQUIRED';
  } else if (v.includes('\u0000')) {
    errors[field] = 'INVALID';
  } else if ([...v].length > MAX_TEXT) {
    errors[field] = 'TOO_LONG';
  }
}

function int(errors: ValidationErrors, field: string, raw: number | null | undefined, min: number, nullable: boolean): void {
  if (raw === null || raw === undefined) {
    if (!nullable) errors[field] = 'REQUIRED';
  } else if (!Number.isInteger(raw)) {
    errors[field] = 'INVALID';
  } else if (raw < min || raw > INT4_MAX) {
    errors[field] = 'OUT_OF_RANGE';
  }
}

/** Required: englishName, chineseName, schoolClassType (in the list), maxSize (integer > 0). minAge/maxAge: integer >= 0 or null. */
export function validateSchoolClass(input: SchoolClassInput): ValidationErrors {
  const errors: ValidationErrors = {};
  text(errors, 'englishName', input.englishName, true);
  text(errors, 'chineseName', input.chineseName, true);
  text(errors, 'shortName', input.shortName, false);
  text(errors, 'description', input.description, false);
  text(errors, 'location', input.location, false);
  const type = input.schoolClassType;
  if (type === null || type === undefined || type === '') errors.schoolClassType = 'REQUIRED';
  else if (!(SCHOOL_CLASS_TYPES as readonly string[]).includes(type)) errors.schoolClassType = 'INVALID';
  int(errors, 'maxSize', input.maxSize, 1, false);
  int(errors, 'minAge', input.minAge, 0, true);
  int(errors, 'maxAge', input.maxAge, 0, true);
  return errors;
}

/** Values to store for an input that passed `validateSchoolClass`. */
export function normalizeSchoolClass(input: SchoolClassInput): NormalizedSchoolClass {
  return {
    englishName: trimToNull(input.englishName) as string,
    chineseName: trimToNull(input.chineseName) as string,
    shortName: trimToNull(input.shortName),
    description: trimToNull(input.description),
    location: trimToNull(input.location),
    schoolClassType: input.schoolClassType as string,
    maxSize: input.maxSize as number,
    minAge: input.minAge ?? null,
    maxAge: input.maxAge ?? null,
    gradeId: input.gradeId ?? null,
  };
}
