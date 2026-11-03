import { assertTestDatabase } from './helpers/db';

describe('assertTestDatabase', () => {
  it('accepts a *_test database', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5433/tocs_test')).not.toThrow();
  });

  it('rejects a non-test database name', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5433/tocs_dev')).toThrow(/_test/);
  });

  it.each(['database', 'dbname'])('rejects a ?%s= query override', (param) => {
    expect(() => assertTestDatabase(`postgresql://u:p@localhost:5433/tocs_test?${param}=tocs_dev`)).toThrow(/query parameters/);
  });
});
