import { loadBaseline, testDatabaseUrl } from './helpers/db';

export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = testDatabaseUrl();
  await loadBaseline();
}
