#!/usr/bin/env node
/**
 * Közvetlen adatbázis-próba az E2E előfeltételekhez.
 *
 *   ENV_FILE=.env.e2e node scripts/check-e2e-db.mjs
 *
 * A backend `/health/ready` csak annyit mond, hogy a postgres indikátor down.
 * Ez a szkript megmondja, hogy port, jelszó, adatbázisnév vagy hiányzó migráció
 * az ok. Jelszót soha nem ír ki.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const envFile = process.env.ENV_FILE || '.env.e2e';

function loadEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

let env;
try {
  env = loadEnvFile(envFile);
} catch (error) {
  console.error(`Nem olvasható az env fájl (${envFile}): ${error.message}`);
  process.exit(2);
}

const url = process.env.DATABASE_URL || env.DATABASE_URL;
if (!url) {
  console.error(`Nincs DATABASE_URL a(z) ${envFile} fájlban.`);
  process.exit(2);
}

const parsed = new URL(url);
console.log(`env fájl:  ${envFile}`);
console.log(`cél:       ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname} (user: ${decodeURIComponent(parsed.username)})`);

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const info = await client.query('select current_database() as db, current_user as usr, version() as version');
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  const names = tables.rows.map((row) => row.table_name);
  console.log(`KAPCSOLAT OK: ${info.rows[0].db} / ${info.rows[0].usr}`);
  console.log(`szerver:   ${String(info.rows[0].version).split(' ').slice(0, 2).join(' ')}`);
  console.log(`táblák:    ${names.length ? names.join(', ') : '(nincs – a migráció még nem futott le)'}`);
  if (!names.includes('contents')) {
    console.log('\nKÖVETKEZŐ LÉPÉS: ENV_FILE=' + envFile + ' npm run db:migrate');
    process.exitCode = 1;
  }
} catch (error) {
  const hints = {
    ECONNREFUSED: 'Nincs listener ezen a porton. Nézd meg a publikált portot: docker compose ps (a Publishers mező sorrendje: URL target published).',
    ETIMEDOUT: 'A kapcsolat elakadt; tűzfal vagy rossz hoszt.',
    '28P01': 'Jelszóhiba. A postgres volume az ELSŐ indításkor rögzíti a jelszót; ha azóta változott a POSTGRES_PASSWORD, a volume-ot újra kell építeni: docker compose down -v postgres majd up -d.',
    '28000': 'A felhasználó nem létezik ezen a szerveren (a volume más POSTGRES_USER értékkel készült).',
    '3D000': 'Az adatbázis nem létezik (a volume más POSTGRES_DB értékkel készült).',
  };
  const code = error.code || '';
  console.error(`KAPCSOLAT HIBA: ${code} ${error.message}`);
  if (hints[code]) console.error(`\nValószínű ok: ${hints[code]}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
