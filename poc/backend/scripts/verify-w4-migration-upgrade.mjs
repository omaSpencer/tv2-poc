import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const { Client, Pool } = pg;
const sourceUrl = process.env.TEST_DATABASE_URL;
if (!sourceUrl) throw new Error('TEST_DATABASE_URL is required.');
const parsed = new URL(sourceUrl);
const sourceName = parsed.pathname.slice(1);
if (!sourceName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name an explicit *_test database.');
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const targetName = `${sourceName.replace(/_test$/, '')}_w4_${suffix}_test`;
if (!/^[a-z0-9_]+_test$/.test(targetName)) throw new Error('Unsafe upgrade evidence database name.');

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${targetName}`;
const migrations = fileURLToPath(new URL('../migrations', import.meta.url));
const staged = await mkdtemp(join(tmpdir(), 'w4-migrations-'));
const stagedMeta = join(staged, 'meta');
await mkdir(stagedMeta);

const journal = JSON.parse(await readFile(join(migrations, 'meta/_journal.json'), 'utf8'));
const preW4 = { ...journal, entries: journal.entries.filter(entry => entry.idx <= 5) };
await writeFile(join(stagedMeta, '_journal.json'), `${JSON.stringify(preW4, null, 2)}\n`);
for (const entry of preW4.entries) {
  await cp(join(migrations, `${entry.tag}.sql`), join(staged, `${entry.tag}.sql`));
}

const admin = new Client({ connectionString: adminUrl.toString() });
let pool;
let adminConnected = false;
try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database "${targetName}"`);

  pool = new Pool({ connectionString: targetUrl.toString() });
  const database = drizzle(pool);
  await migrate(database, { migrationsFolder: staged });
  await pool.query(`
    insert into content (
      id, slug, title, summary, category, media_asset_id, tags, status, version,
      created_at, updated_at, published_at, withdrawn_at, created_by, updated_by
    ) values (
      'f4000000-0000-4000-8000-000000000001', null, 'Upgrade survivor', null,
      null, null, '{}', 'draft', 1, now(), now(), null, null, 'w4', 'w4'
    )
  `);

  await migrate(database, { migrationsFolder: migrations });
  const beforeRepeat = await pool.query(`
    select count(*)::int as count, max(created_at)::text as latest
    from drizzle.__drizzle_migrations
  `);
  await migrate(database, { migrationsFolder: migrations });
  const afterRepeat = await pool.query(`
    select count(*)::int as count, max(created_at)::text as latest
    from drizzle.__drizzle_migrations
  `);
  const indexes = await pool.query(`
    select indexname from pg_indexes
    where schemaname = 'public'
      and indexname in ('content_admin_title_trgm_idx', 'content_admin_slug_trgm_idx')
    order by indexname
  `);
  const extension = await pool.query(`select exists(select 1 from pg_extension where extname = 'pg_trgm') as present`);
  const survivor = await pool.query(`select title from content where id = 'f4000000-0000-4000-8000-000000000001'`);
  const result = {
    database: targetName,
    baselineMigrations: preW4.entries.length,
    upgradedMigrations: afterRepeat.rows[0]?.count,
    repeatWasNoOp: beforeRepeat.rows[0]?.count === afterRepeat.rows[0]?.count
      && beforeRepeat.rows[0]?.latest === afterRepeat.rows[0]?.latest,
    extensionPresent: extension.rows[0]?.present === true,
    indexes: indexes.rows.map(row => row.indexname),
    existingRowPreserved: survivor.rows[0]?.title === 'Upgrade survivor',
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.upgradedMigrations !== 7
    || !result.repeatWasNoOp
    || !result.extensionPresent
    || result.indexes.length !== 2
    || !result.existingRowPreserved) {
    throw new Error('W4 migration upgrade evidence failed.');
  }
} finally {
  await pool?.end().catch(() => undefined);
  if (adminConnected) {
    await admin.query(`drop database if exists "${targetName}" with (force)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  await rm(staged, { recursive: true, force: true });
}
