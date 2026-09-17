#!/usr/bin/env node
/**
 * A három PoC tesztidentitás állapota az Authentikban, és opcionális
 * jelszó-szinkronizálás az env fájlhoz.
 *
 *   ENV_FILE=.env.e2e node scripts/authentik-poc-users.mjs
 *   ENV_FILE=.env.e2e node scripts/authentik-poc-users.mjs --set-password
 *
 * A blueprint a jelszót a felhasználó létrehozásakor írja be. Ha az authentik
 * adatbázis-kötet egy korábbi indításból maradt, a tárolt jelszó eltérhet a
 * mostani AUTHENTIK_POC_USER_PASSWORD értéktől – a belépés ilyenkor némán
 * visszadobja a flow-t az első stage-re. Ez a szkript ezt teszi egyértelművé.
 *
 * Jelszót soha nem ír ki.
 */
import { readFileSync } from 'node:fs';

const IDENTITIES = ['poc-viewer', 'poc-editor', 'poc-publisher'];
const envFile = process.env.ENV_FILE || '.env.e2e';
const setPassword = process.argv.includes('--set-password');

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

const baseUrl = (process.env.AUTHENTIK_PUBLIC_URL || env.AUTHENTIK_PUBLIC_URL || 'http://127.0.0.1:9000').replace(/\/$/, '');
const token = process.env.AUTHENTIK_BOOTSTRAP_TOKEN || env.AUTHENTIK_BOOTSTRAP_TOKEN;
const password = process.env.AUTHENTIK_POC_USER_PASSWORD || env.AUTHENTIK_POC_USER_PASSWORD;

if (!token) {
  console.error(`Hiányzik az AUTHENTIK_BOOTSTRAP_TOKEN a(z) ${envFile} fájlból.`);
  process.exit(2);
}
if (setPassword && !password) {
  console.error(`Hiányzik az AUTHENTIK_POC_USER_PASSWORD a(z) ${envFile} fájlból.`);
  process.exit(2);
}

async function api(path, init = {}) {
  const response = await fetch(`${baseUrl}/api/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  return response;
}

console.log(`Authentik: ${baseUrl} (env: ${envFile})`);

let failed = false;
for (const username of IDENTITIES) {
  const response = await api(`/core/users/?username=${encodeURIComponent(username)}`);
  if (response.status === 403 || response.status === 401) {
    console.error(`HIBA: a bootstrap token nem fogadható el (HTTP ${response.status}). Ellenőrizd az AUTHENTIK_BOOTSTRAP_TOKEN értékét.`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`HIBA: ${username} lekérdezése HTTP ${response.status}`);
    failed = true;
    continue;
  }
  const body = await response.json();
  const user = body.results?.[0];
  if (!user) {
    console.log(`${username.padEnd(15)} HIÁNYZIK – a blueprint nem futott le ezen a példányon`);
    failed = true;
    continue;
  }
  const groups = (user.groups_obj ?? []).map((group) => group.name).join(', ') || '(nincs csoport)';
  console.log(`${username.padEnd(15)} pk=${String(user.pk).padEnd(4)} aktív=${user.is_active ? 'igen' : 'NEM'}  csoportok: ${groups}`);

  if (setPassword) {
    const result = await api(`/core/users/${user.pk}/set_password/`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (result.ok || result.status === 204) {
      console.log(`${' '.repeat(15)} jelszó beállítva az env fájl értékére`);
    } else {
      console.error(`${' '.repeat(15)} jelszóállítás HIBA: HTTP ${result.status} ${await result.text()}`);
      failed = true;
    }
  }
}

if (!setPassword) {
  console.log('\nHa a belépés jelszóhibára fut, futtasd: ENV_FILE=' + envFile + ' node scripts/authentik-poc-users.mjs --set-password');
}
process.exitCode = failed ? 1 : 0;
