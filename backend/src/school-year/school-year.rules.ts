import { PacificDate, comparePacific, pacificDate } from '../common/pacific-date';
import { MAX_TEXT, trimToNull, type ValidationErrors } from '../people/validation';

/**
 * Pure school-year rules (old SchoolYear model validations). Error codes as in src/people/validation.ts:
 * REQUIRED (missing/blank), INVALID (wrong type/format, impossible date, start after end), OUT_OF_RANGE
 * (integer outside its range).
 *
 * The legacy columns registration_50_percent_date, refund_75_percent_date and refund_25_percent_date (and the
 * old model's required previous_school_year, which it set itself) are not part of the API.
 */

export const DATE_FIELDS = [
  'startDate',
  'endDate',
  'earlyRegistrationStartDate',
  'earlyRegistrationEndDate',
  'registrationStartDate',
  'registration75PercentDate',
  'registrationEndDate',
  'refund90PercentDate',
  'refund50PercentDate',
  'refundEndDate',
] as const;
export type DateField = (typeof DATE_FIELDS)[number];

/** API field name → school_years column (Prisma field). All integer cents. */
export const FEE_FIELDS = {
  registrationFee: 'registrationFeeInCents',
  earlyRegistrationTuition: 'earlyRegistrationTuitionInCents',
  tuition: 'tuitionInCents',
  electiveClassFee: 'electiveClassFeeInCents',
  tuitionDiscountForThreeOrMoreChild: 'tuitionDiscountForThreeOrMoreChildInCents',
  tuitionDiscountForPreK: 'tuitionDiscountForPreKInCents',
  tuitionDiscountForInstructor: 'tuitionDiscountForInstructorInCents',
  pvaMembershipDue: 'pvaMembershipDueInCents',
  cccaMembershipDue: 'cccaMembershipDueInCents',
  parentAndStudentClassFee: 'parentAndStudentClassFeeInCents',
  earlyRegistrationParentAndStudentClassFee: 'earlyRegistrationParentAndStudentClassFeeInCents',
} as const;
export type FeeField = keyof typeof FEE_FIELDS;

/** Fees that may be 0 (old: greater_than_or_equal_to 0); all others must be > 0. */
const ZERO_OK: readonly FeeField[] = ['tuitionDiscountForPreK', 'tuitionDiscountForInstructor'];
const INT4_MAX = 2_147_483_647;

type Opt<T> = T | null | undefined;

export type SchoolYearInput = { name?: Opt<string>; description?: Opt<string>; ageCutoffMonth?: Opt<number> } & {
  [K in DateField]?: Opt<string>;
} & { [K in FeeField]?: Opt<number> };

export function validateSchoolYear(input: SchoolYearInput): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = trimToNull(input.name);
  if (name === null) errors.name = 'REQUIRED';
  else if (name.includes('\u0000')) errors.name = 'INVALID';
  else if ([...name].length > MAX_TEXT) errors.name = 'TOO_LONG';
  const description = trimToNull(input.description);
  if (description !== null) {
    if (description.includes('\u0000')) errors.description = 'INVALID';
    else if ([...description].length > MAX_TEXT) errors.description = 'TOO_LONG';
  }

  const month = input.ageCutoffMonth;
  if (month === null || month === undefined) errors.ageCutoffMonth = 'REQUIRED';
  else if (!Number.isInteger(month)) errors.ageCutoffMonth = 'INVALID';
  else if (month < 1 || month > 12) errors.ageCutoffMonth = 'OUT_OF_RANGE';

  const parsed: Partial<Record<DateField, PacificDate>> = {};
  for (const f of DATE_FIELDS) {
    const raw = input[f];
    if (raw === null || raw === undefined || raw === '') {
      errors[f] = 'REQUIRED';
      continue;
    }
    try {
      parsed[f] = pacificDate(raw);
    } catch {
      errors[f] = 'INVALID';
    }
  }
  if (parsed.startDate && parsed.endDate && comparePacific(parsed.startDate, parsed.endDate) > 0) errors.startDate = 'INVALID';

  for (const f of Object.keys(FEE_FIELDS) as FeeField[]) {
    const n = input[f];
    if (n === null || n === undefined) errors[f] = 'REQUIRED';
    else if (!Number.isInteger(n)) errors[f] = 'INVALID';
    else if (n < (ZERO_OK.includes(f) ? 0 : 1) || n > INT4_MAX) errors[f] = 'OUT_OF_RANGE';
  }
  return errors;
}

export type SchoolYearDates = Record<DateField, PacificDate | null>;

/**
 * Old `set_date_if_original_in_future`: a date field takes the requested value only when the stored value is
 * empty or today/later (a date that has passed is frozen). Fields the request does not mention keep their stored
 * value. An explicitly requested null/blank clears an editable date (validateSchoolYear then reports REQUIRED).
 */
export function applyDateEdits(
  existing: Partial<Record<DateField, PacificDate | null>>,
  requested: Partial<Record<DateField, string | null | undefined>>,
  today: PacificDate,
): SchoolYearDates {
  const out = {} as SchoolYearDates;
  for (const f of DATE_FIELDS) {
    const stored = existing[f] ?? null;
    const asked = requested[f];
    const editable = stored === null || comparePacific(stored, today) >= 0;
    out[f] = asked !== undefined && editable ? (asked === null || asked === '' ? null : (asked as PacificDate)) : stored;
  }
  return out;
}
