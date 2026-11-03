import { readFileSync } from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';
import { testDatabaseUrl } from './helpers/db';

const UNMIGRATED = [
  'jersey_numbers',
  'track_event_heats',
  'track_event_programs',
  'track_event_signups',
  'track_event_teams',
  'library_books',
  'library_book_checkouts',
];
const JOIN_MODELS = ['families_children', 'rights_roles', 'roles_users'];

const schemaText = readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
const models = [...schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => ({
  name: m[1],
  body: m[2],
  table: /@@map\("(\w+)"\)/.exec(m[2])?.[1],
}));

describe('prisma schema', () => {
  let prisma: PrismaService;
  let pg: Client;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl();
    prisma = new PrismaService();
    await prisma.onModuleInit();
    pg = new Client({ connectionString: testDatabaseUrl() });
    await pg.connect();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pg.end();
  });

  it('maps exactly the 34 tables (29 retained + 5 new from the foundation migration) and none of the 7 unmigrated ones', () => {
    const tables = models.map((m) => m.table);
    expect(tables).toHaveLength(34);
    expect(tables.every((t) => typeof t === 'string')).toBe(true);
    for (const t of UNMIGRATED) {
      expect(tables).not.toContain(t);
      expect(schemaText).not.toContain(t);
    }
  });

  it('can query every retained table', async () => {
    for (const m of models) {
      const delegate = (prisma as unknown as Record<string, { findMany(a: object): Promise<unknown[]> }>)[
        m.name.charAt(0).toLowerCase() + m.name.slice(1)
      ];
      await expect(delegate.findMany({ take: 1 })).resolves.toEqual([]);
    }
  });

  it('declares composite @@id on the id-less join tables', () => {
    for (const t of JOIN_MODELS) {
      const m = models.find((x) => x.table === t);
      expect(m).toBeDefined();
      expect(m?.body).toMatch(/@@id\(\[\w+, \w+\]\)/);
    }
  });

  it('adds no database constraints to the join tables', async () => {
    const { rows } = await pg.query(
      'SELECT conrelid::regclass::text AS t FROM pg_constraint WHERE conrelid::regclass::text = ANY($1)',
      [JOIN_MODELS],
    );
    expect(rows).toEqual([]);
  });

  it('has the columns used by Rails models but absent from schema.rb', async () => {
    const { rows } = await pg.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
       WHERE (table_name = 'school_years' AND column_name = 'early_registration_parent_and_student_class_fee_in_cents')
          OR (table_name = 'student_fee_payments' AND column_name = 'elective_class_fee_in_cents')`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_nullable === 'NO')).toBe(true);
  });
});
