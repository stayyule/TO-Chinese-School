import { maskPath } from './request-id.middleware';

describe('maskPath', () => {
  it('masks token-like segments only', () => {
    expect(maskPath('/api/v1/auth/invitations/abcDEF123_-xyz4567890QRS')).toBe('/api/v1/auth/invitations/:redacted');
    expect(maskPath('/api/v1/school-years/12')).toBe('/api/v1/school-years/12');
  });
});
