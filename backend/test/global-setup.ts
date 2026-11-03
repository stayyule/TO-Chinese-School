import { loadBaseline, testDatabaseUrl } from './helpers/db';

export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.MAIL_TRANSPORT = 'memory'; // AppModule boots the mail transport eagerly; tests never open SMTP sockets
  await loadBaseline();
}
