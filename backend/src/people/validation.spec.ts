import {
  AddressInput,
  PersonInput,
  formatPhone,
  normalizeAddressInput,
  normalizePersonInput,
  prefixErrors,
  validateAddressInput,
  validatePersonInput,
  validationProblem,
} from './validation';

const YEAR = 2026;
const adult: PersonInput = { englishFirstName: 'Pat', englishLastName: 'Parent', gender: 'F' };
const child: PersonInput = { ...adult, birthYear: 2018, birthMonth: 5 };
const address: AddressInput = {
  street: '123 Main St',
  city: 'Thousand Oaks',
  state: 'CA',
  zipcode: '91360',
  homePhone: '(805) 555-1234',
  email: 'pat@example.com',
};

describe('validatePersonInput', () => {
  const parent = (p: PersonInput) => validatePersonInput(p, { isChild: false, currentYear: YEAR });
  const kid = (p: PersonInput) => validatePersonInput(p, { isChild: true, currentYear: YEAR });

  it('accepts a complete adult and a complete child', () => {
    expect(parent(adult)).toEqual({});
    expect(kid(child)).toEqual({});
  });

  it('requires gender, English first and last name (blank counts as missing)', () => {
    expect(parent({ englishFirstName: '  ', englishLastName: undefined, gender: null })).toEqual({
      gender: 'REQUIRED',
      englishFirstName: 'REQUIRED',
      englishLastName: 'REQUIRED',
    });
  });

  it("gender must be 'M' or 'F'", () => {
    expect(parent({ ...adult, gender: 'M' })).toEqual({});
    expect(parent({ ...adult, gender: 'X' })).toEqual({ gender: 'INVALID' });
    expect(parent({ ...adult, gender: 'f' })).toEqual({ gender: 'INVALID' });
  });

  it('names are at most 255 characters (counted as code points)', () => {
    expect(parent({ ...adult, englishFirstName: 'a'.repeat(255) })).toEqual({});
    expect(parent({ ...adult, englishFirstName: 'a'.repeat(256) })).toEqual({ englishFirstName: 'TOO_LONG' });
    expect(parent({ ...adult, chineseName: '王'.repeat(255) })).toEqual({});
    expect(parent({ ...adult, chineseName: '王'.repeat(256) })).toEqual({ chineseName: 'TOO_LONG' });
    expect(parent({ ...adult, nativeLanguage: 'x'.repeat(256) })).toEqual({ nativeLanguage: 'TOO_LONG' });
  });

  it('chineseName and nativeLanguage are optional', () => {
    expect(parent({ ...adult, chineseName: null, nativeLanguage: undefined })).toEqual({});
    expect(parent({ ...adult, chineseName: '王小明', nativeLanguage: 'Mandarin' })).toEqual({});
  });

  it('a child without birth data gets errors on both fields; a parent does not', () => {
    expect(kid(adult)).toEqual({ birthYear: 'REQUIRED', birthMonth: 'REQUIRED' });
    expect(parent(adult)).toEqual({});
  });

  it('birthYear must be an integer > 1900 and < the current year', () => {
    expect(kid({ ...child, birthYear: 1900 })).toEqual({ birthYear: 'OUT_OF_RANGE' });
    expect(kid({ ...child, birthYear: YEAR })).toEqual({ birthYear: 'OUT_OF_RANGE' });
    expect(kid({ ...child, birthYear: 1901 })).toEqual({});
    expect(kid({ ...child, birthYear: YEAR - 1 })).toEqual({});
    expect(kid({ ...child, birthYear: 2010.5 })).toEqual({ birthYear: 'INVALID' });
    // also checked for adults when given
    expect(parent({ ...adult, birthYear: 1900 })).toEqual({ birthYear: 'OUT_OF_RANGE' });
  });

  it('birthMonth must be an integer 1..12', () => {
    expect(kid({ ...child, birthMonth: 0 })).toEqual({ birthMonth: 'OUT_OF_RANGE' });
    expect(kid({ ...child, birthMonth: 13 })).toEqual({ birthMonth: 'OUT_OF_RANGE' });
    expect(kid({ ...child, birthMonth: 1 })).toEqual({});
    expect(kid({ ...child, birthMonth: 12 })).toEqual({});
    expect(kid({ ...child, birthMonth: 1.5 })).toEqual({ birthMonth: 'INVALID' });
  });
});

describe('normalizePersonInput', () => {
  it('trims strings, maps blanks to null and keeps UTF-8 intact', () => {
    expect(
      normalizePersonInput({ englishFirstName: ' Pat ', englishLastName: 'Parent', chineseName: ' 王小明 ', gender: 'F', nativeLanguage: '  ' }),
    ).toEqual({
      englishFirstName: 'Pat',
      englishLastName: 'Parent',
      chineseName: '王小明',
      gender: 'F',
      nativeLanguage: null,
      birthYear: null,
      birthMonth: null,
    });
  });
});

describe('validateAddressInput', () => {
  it('accepts a complete address', () => {
    expect(validateAddressInput(address)).toEqual({});
  });

  it('requires street, city, state, zipcode, homePhone and email', () => {
    expect(validateAddressInput({ street: ' ', city: '', state: null })).toEqual({
      street: 'REQUIRED',
      city: 'REQUIRED',
      state: 'REQUIRED',
      zipcode: 'REQUIRED',
      homePhone: 'REQUIRED',
      email: 'REQUIRED',
    });
  });

  it("zipcode is an integer string below 100000: '93012' valid, '100000' and '9301a' invalid", () => {
    expect(validateAddressInput({ ...address, zipcode: '93012' })).toEqual({});
    expect(validateAddressInput({ ...address, zipcode: ' 93012 ' })).toEqual({});
    expect(validateAddressInput({ ...address, zipcode: '100000' })).toEqual({ zipcode: 'INVALID' });
    expect(validateAddressInput({ ...address, zipcode: '9301a' })).toEqual({ zipcode: 'INVALID' });
    expect(validateAddressInput({ ...address, zipcode: '-9301' })).toEqual({ zipcode: 'INVALID' });
    expect(validateAddressInput({ ...address, zipcode: '93.01' })).toEqual({ zipcode: 'INVALID' });
  });

  it("home phone must clean to exactly 10 digits: '805-555-123' invalid, '(805) 555-1234' valid", () => {
    expect(validateAddressInput({ ...address, homePhone: '805-555-123' })).toEqual({ homePhone: 'INVALID' });
    expect(validateAddressInput({ ...address, homePhone: '(805) 555-1234' })).toEqual({});
    expect(validateAddressInput({ ...address, homePhone: '+1 805 555 1234' })).toEqual({});
    expect(validateAddressInput({ ...address, homePhone: '805555123456' })).toEqual({ homePhone: 'INVALID' });
  });

  it('cell phone is optional but, when given, must clean to 10 digits', () => {
    expect(validateAddressInput({ ...address, cellPhone: '' })).toEqual({});
    expect(validateAddressInput({ ...address, cellPhone: '805.555.9876' })).toEqual({});
    expect(validateAddressInput({ ...address, cellPhone: '555-9876' })).toEqual({ cellPhone: 'INVALID' });
  });

  it('email must be a single address', () => {
    expect(validateAddressInput({ ...address, email: ' pat@example.com ' })).toEqual({});
    expect(validateAddressInput({ ...address, email: 'not-an-email' })).toEqual({ email: 'INVALID' });
    expect(validateAddressInput({ ...address, email: 'a@example.com, b@example.com' })).toEqual({ email: 'INVALID' });
  });

  it('text fields are at most 255 characters', () => {
    expect(validateAddressInput({ ...address, street: 's'.repeat(256), city: 'c'.repeat(256) })).toEqual({
      street: 'TOO_LONG',
      city: 'TOO_LONG',
    });
    expect(validateAddressInput({ ...address, email: `${'a'.repeat(250)}@example.com` })).toEqual({ email: 'TOO_LONG' });
  });
});

describe('normalizeAddressInput', () => {
  it('trims text, stores phones as digits only, blank cell phone as null', () => {
    expect(normalizeAddressInput({ ...address, street: ' 123 Main St ', zipcode: ' 91360 ', email: ' Pat@Example.com ', cellPhone: ' ' })).toEqual({
      street: '123 Main St',
      city: 'Thousand Oaks',
      state: 'CA',
      zipcode: '91360',
      homePhone: '8055551234',
      cellPhone: null,
      email: 'Pat@Example.com',
    });
    expect(normalizeAddressInput({ ...address, cellPhone: '+1 (805) 555-9876' }).cellPhone).toBe('8055559876');
  });
});

describe('formatPhone', () => {
  it('formats 10 digits as (805) 555-1234', () => {
    expect(formatPhone('8055551234')).toBe('(805) 555-1234');
  });

  it('returns anything that is not 10 digits unchanged', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone('5551234')).toBe('5551234');
  });
});

describe('prefixErrors / validationProblem', () => {
  it('prefixes field keys for nested inputs', () => {
    expect(prefixErrors('address', { zipcode: 'INVALID' })).toEqual({ 'address.zipcode': 'INVALID' });
  });

  it('builds a 422 VALIDATION_ERROR AppError with details keyed by field, or null when there are no errors', () => {
    expect(validationProblem({})).toBeNull();
    const err = validationProblem({ 'address.zipcode': 'INVALID' });
    expect(err).toMatchObject({ status: 422, code: 'VALIDATION_ERROR', details: { 'address.zipcode': 'INVALID' } });
  });
});
