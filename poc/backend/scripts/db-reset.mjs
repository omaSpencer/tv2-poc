#!/usr/bin/env node
/**
 * D-M0-02 – rebuild an explicitly disposable test database and migrate it.
 *
 * The target comes from TEST_DATABASE_URL only. A normal DATABASE_URL is never
 * an implicit target, and the database name must carry a `_test` marker, so a
 * mistyped variable cannot drop a demo or development database.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const TEST_DATABASE_PATTERN = /_test(_[a-z0-9-]+)?$/;

function fail(message) {
  process.stderr.write(`${JSON.stringify({ event: 'db_reset_refused', reason: message })}\n`);
  process.exit(1);
}

const target = process.env.TEST_DATABASE_URL;
if (!target) fail('TEST_DATABASE_URL is required; db:reset never targets DATABASE_URL.');
if (process.env.DATABASE_URL && process.env.DATABASE_URL === target) {
  fail('TEST_DATABASE_URL must differ from DATABASE_URL.');
}

let url;
try {
  url = new URL(target);
} catch {
  fail('TEST_DATABASE_URL is not a valid URL.');
}
const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!TEST_DATABASE_PATTERN.test(database)) {
  fail('The target database name must end with a _test marker.');
}

const maintenance = new URL(target);
maintenance.pathname = '/postgres';

const client = new pg.Client({ connectionString: maintenance.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${database}"`);
} finally {
  await client.end();
}

const migrate = spawnSync('npx', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: target },
});
if (migrate.status !== 0) {
  fail('The migrator failed on the freshly created test database.');
}
process.stdout.write(`${JSON.stringify({ event: 'db_reset_done', database })}\n`);
