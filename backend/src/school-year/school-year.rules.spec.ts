import { pacificDate } from '../common/pacific-date';
import { applyDateEdits, validateSchoolYear, type SchoolYearInput } from './school-year.rules';

const valid = (): SchoolYearInput => ({
  name: '2026-2027',
  description: null,
  ageCutoffMonth: 9,
  startDate: '2026-09-06',
  endDate: '2027-06-06',
  earlyRegistrationStartDate: '2026-03-01',
  earlyRegistrationEndDate: '2026-04-01',
  registrationStartDate: '2026-04-02',
  registration75PercentDate: '2026-07-01',
  registrationEndDate: '2026-09-01',
  refund90PercentDate: '2026-09-07',
  refund50PercentDate: '2026-10-01',
  refundEndDate: '2026-11-01',
  registrationFee: 2000,
  earlyRegistrationTuition: 36000,
  tuition: 38000,
  electiveClassFee: 5000,
  tuitionDiscountForThreeOrMoreChild: 3800,
  tuitionDiscountForPreK: 4000,
  tuitionDiscountForInstructor: 0,
  pvaMembershipDue: 1500,
  cccaMembershipDue: 2000,
  parentAndStudentClassFee: 3000,
  earlyRegistrationParentAndStudentClassFee: 2800,
});

describe('validateSchoolYear', () => {
  it('accepts a complete year', () => {
    expect(validateSchoolYear(valid())).toEqual({});
  });

  it('rejects a start date after the end date on startDate', () => {
    expect(validateSchoolYear({ ...valid(), startDate: '2027-06-07' })).toEqual({ startDate: 'INVALID' });
  });

  it('allows start equal to end', () => {
    expect(validateSchoolYear({ ...valid(), startDate: '2027-06-06' })).toEqual({});
  });

  it('requires the old required fields', () => {
    const errors = validateSchoolYear({});
    expect(Object.keys(errors).sort()).toEqual(
      [
        'name', 'startDate', 'endDate', 'ageCutoffMonth', 'earlyRegistrationStartDate', 'earlyRegistrationEndDate',
        'registrationStartDate', 'registration75PercentDate', 'registrationEndDate', 'refund90PercentDate',
        'refund50PercentDate', 'refundEndDate', 'registrationFee', 'earlyRegistrationTuition', 'tuition',
        'electiveClassFee', 'tuitionDiscountForThreeOrMoreChild', 'tuitionDiscountForPreK',
        'tuitionDiscountForInstructor', 'pvaMembershipDue', 'cccaMembershipDue', 'parentAndStudentClassFee',
        'earlyRegistrationParentAndStudentClassFee',
      ].sort(),
    );
    expect(Object.values(errors).every((c) => c === 'REQUIRED')).toBe(true);
  });

  it('rejects tuition 0 but accepts a 0 PreK or instructor discount', () => {
    expect(validateSchoolYear({ ...valid(), tuition: 0 })).toEqual({ tuition: 'OUT_OF_RANGE' });
    expect(validateSchoolYear({ ...valid(), tuitionDiscountForPreK: 0, tuitionDiscountForInstructor: 0 })).toEqual({});
    expect(validateSchoolYear({ ...valid(), tuitionDiscountForPreK: -1 })).toEqual({ tuitionDiscountForPreK: 'OUT_OF_RANGE' });
  });

  it('rejects non-integer money, impossible dates and a bad cutoff month', () => {
    expect(validateSchoolYear({ ...valid(), tuition: 1999.5 })).toEqual({ tuition: 'INVALID' });
    expect(validateSchoolYear({ ...valid(), refundEndDate: '2026-02-30' })).toEqual({ refundEndDate: 'INVALID' });
    expect(validateSchoolYear({ ...valid(), ageCutoffMonth: 13 })).toEqual({ ageCutoffMonth: 'OUT_OF_RANGE' });
  });
});

describe('applyDateEdits', () => {
  const today = pacificDate('2026-11-02');
  const requested = { startDate: '2027-01-01', refund90PercentDate: '2027-01-02' };

  it('keeps a stored past date', () => {
    expect(applyDateEdits({ startDate: pacificDate('2026-10-01') }, requested, today).startDate).toBe('2026-10-01');
  });

  it('replaces a stored date that is today or later', () => {
    expect(applyDateEdits({ startDate: pacificDate('2026-11-02') }, requested, today).startDate).toBe('2027-01-01');
    expect(applyDateEdits({ startDate: pacificDate('2026-12-01') }, requested, today).startDate).toBe('2027-01-01');
  });

  it('sets a stored empty date', () => {
    expect(applyDateEdits({ startDate: null }, requested, today).startDate).toBe('2027-01-01');
    expect(applyDateEdits({}, requested, today).startDate).toBe('2027-01-01');
  });

  it('applies the same rule to refund90PercentDate', () => {
    expect(applyDateEdits({ refund90PercentDate: pacificDate('2026-10-01') }, requested, today).refund90PercentDate).toBe('2026-10-01');
    expect(applyDateEdits({ refund90PercentDate: pacificDate('2026-11-02') }, requested, today).refund90PercentDate).toBe('2027-01-02');
    expect(applyDateEdits({ refund90PercentDate: null }, requested, today).refund90PercentDate).toBe('2027-01-02');
  });

  it('leaves a date alone when the request does not mention it', () => {
    const out = applyDateEdits({ endDate: pacificDate('2026-12-01') }, requested, today);
    expect(out.endDate).toBe('2026-12-01');
  });
});
