import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { loadDotenv } from './load-dotenv';

describe('loadDotenv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const tmp = (content?: string): string => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'dotenv-')), '.env');
    if (content !== undefined) writeFileSync(file, content);
    return file;
  };

  it('does not throw when the file is absent', () => {
    expect(() => loadDotenv(tmp())).not.toThrow();
  });

  it('sets variables from the file', () => {
    delete process.env.TOCS_DOTENV_A;
    loadDotenv(tmp('TOCS_DOTENV_A=from-file\n'));
    expect(process.env.TOCS_DOTENV_A).toBe('from-file');
  });

  it('does not override existing environment variables', () => {
    process.env.TOCS_DOTENV_B = 'from-env';
    loadDotenv(tmp('TOCS_DOTENV_B=from-file\n'));
    expect(process.env.TOCS_DOTENV_B).toBe('from-env');
  });

  it('defaults to backend/.env (resolved from the module location)', () => {
    expect(() => loadDotenv()).not.toThrow();
  });
});
