import { cleanPhone, phonesMatch } from './phone';

describe('cleanPhone', () => {
  it.each(['(805) 555-1234', '805.555.1234', '+1 805 555 1234', '8055551234', '18055551234', '1-805-555-1234'])(
    '%s -> 8055551234',
    (input) => {
      expect(cleanPhone(input)).toBe('8055551234');
    },
  );

  it('keeps a 9-digit number as 9 digits', () => {
    expect(cleanPhone('805-555-123')).toBe('805555123');
  });

  it('only drops a leading 1 from exactly 11 digits', () => {
    expect(cleanPhone('28055551234')).toBe('28055551234');
    expect(cleanPhone('118055551234')).toBe('118055551234');
    expect(cleanPhone('1')).toBe('1');
  });

  it('returns an empty string for input without digits', () => {
    expect(cleanPhone('')).toBe('');
    expect(cleanPhone('call me')).toBe('');
  });
});

describe('phonesMatch', () => {
  it('compares cleaned values on both sides', () => {
    expect(phonesMatch('(805) 555-1234', '805.555.1234')).toBe(true);
    expect(phonesMatch('8055551234', '+1 805 555 1234')).toBe(true);
    expect(phonesMatch('(805) 555-1234', '805-555-1235')).toBe(false);
  });

  it('never matches empty or short input, even against an equally empty/short stored value', () => {
    expect(phonesMatch('', '')).toBe(false);
    expect(phonesMatch(null, '')).toBe(false);
    expect(phonesMatch('805-555-123', '805-555-123')).toBe(false);
    expect(phonesMatch('(805) 555-1234', '805-555-123')).toBe(false);
    expect(phonesMatch(null, '8055551234')).toBe(false);
  });
});
