import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';

/** backend/.env; src/config and dist/config are both two levels below the backend root. */
const DEFAULT_ENV_FILE = path.resolve(__dirname, '../../.env');

/**
 * Loads a dotenv file if present, filling only variables not already set: real environment variables win.
 * (Uses util.parseEnv + explicit assignment rather than process.loadEnvFile, which bypasses jest's env sandbox.)
 */
export function loadDotenv(file: string = DEFAULT_ENV_FILE): void {
  if (!existsSync(file)) return;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
