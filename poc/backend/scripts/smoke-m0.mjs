#!/usr/bin/env node
/**
 * M0-21 – the core smoke runner (M0 plan §5).
 *
 * Owns every process and resource it creates: an isolated Compose project (or a
 * uniquely named database on an external server), its own generated
 * configuration with a known test password, one child application per case,
 * dynamic ports, bounded waits, real asserts and a finally cleanup. It never
 * runs a global pkill, never sources an .env in a shell and never sleeps blind.
 *
 *   npm ci && npm run build && npm run smoke:m0
 *
 * Without a container registry, set SMOKE_EXTERNAL_DATABASE_URL to a PostgreSQL
 * 17 server. The runner then creates and drops its own database there and
 * simulates the outage case with a TCP gate in front of it. The report states
 * which mode ran.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = randomUUID().slice(0, 8);
const PROJECT = `indaplay-smoke-${RUN_ID}`;
const DB_NAME = `poc_smoke_${RUN_ID}_test`;
const DB_USER = 'poc';
// A known, non-production sentinel. It is never read from the developer's env.
const DB_PASSWORD = `smoke-pw-${RUN_ID}`;
const SENTINEL_TOKEN = `smoke-token-${RUN_ID}`;

const BOOT_TIMEOUT_MS = 30_000;
const CONDITION_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 2_000;

/** Only these host variables reach a child; the developer's own config cannot. */
const ALLOWED_SYSTEM_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot', 'COMSPEC'];

const results = [];
const cleanups = [];
let mode = 'compose';

function record(name, ok, reason = '') {
  results.push({ name, ok, reason });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${reason ? ` – ${reason}` : ''}\n`);
}

class AssertionFailed extends Error {}
function check(condition, message) {
  if (!condition) throw new AssertionFailed(message);
}

async function testCase(name, work) {
  const local = [];
  try {
    await work(fn => local.push(fn));
    record(name, true);
  } catch (error) {
    record(name, false, error instanceof AssertionFailed ? error.message : `unexpected failure: ${error.message}`);
  } finally {
    for (const fn of local.reverse()) {
      try { await fn(); } catch (error) { record(`${name} – cleanup`, false, error.message); }
    }
  }
}

/**
 * Compose interpolates the WHOLE file even when a single core service is
 * started, so every `${VAR:?...}` in the full profile must have a value or the
 * core smoke dies before any container exists (R03). The list is read from
 * compose.yaml instead of being hand-maintained, so a new full-profile secret
 * cannot silently break the core gate again. Values are per-run sentinels and
 * are never read from the developer's environment.
 */
async function requiredComposeVariables() {
  const text = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/\$\{([A-Z0-9_]+):\?/g)) names.add(match[1]);
  return [...names].sort();
}

function systemEnv() {
  const env = {};
  for (const key of ALLOWED_SYSTEM_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function waitFor(description, probe, timeoutMs = CONDITION_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      last = 'condition false';
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new AssertionFailed(`timed out waiting for ${description} (${last})`);
}

async function http(url, path, options = {}) {
  const response = await fetch(url + path, { ...options, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  const text = await response.text();
  let body = null;
  try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
}

/* ------------------------------------------------------------------ database */

function compose(args, options = {}) {
  return spawnSync('docker', ['compose', '-p', PROJECT, '-f', join(ROOT, 'compose.yaml'),
    '--env-file', options.envFile ?? join(ROOT, '.smoke.env'), ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env }, ...options,
  });
}

async function startComposeDatabase(envFile) {
  const up = compose(['up', '-d', '--wait', 'postgres'], { envFile });
  check(up.status === 0, `docker compose up failed: ${(up.stderr || '').trim().slice(0, 300)}`);
  cleanups.push(async () => {
    const down = compose(['down', '-v', '--remove-orphans'], { envFile });
    check(down.status === 0, `docker compose down failed for project ${PROJECT}`);
  });
  const port = compose(['port', 'postgres', '5432'], { envFile });
  check(port.status === 0, 'docker compose port failed');
  const hostPort = port.stdout.trim().split(':').pop();
  check(Boolean(hostPort), 'could not read the published PostgreSQL port');
  return `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${hostPort}/poc`;
}

/** External mode: our own database on a server we did not create. */
async function startExternalDatabase(base) {
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await client.end();
  }
  cleanups.push(async () => {
    const drop = new pg.Client({ connectionString: admin.toString() });
    await drop.connect();
    try { await drop.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); }
    finally { await drop.end(); }
  });
  const target = new URL(base);
  target.pathname = `/${DB_NAME}`;
  return target.toString();
}

/**
 * A TCP gate in front of PostgreSQL. Closing it makes the database unreachable
 * for the application exactly as a stopped container would.
 */
async function startGate(upstream) {
  const target = new URL(upstream);
  let open = true;
  const live = new Set();
  const server = createServer(socket => {
    if (!open) { socket.destroy(); return; }
    const forward = connect(Number(target.port), target.hostname);
    live.add(socket).add(forward);
    const drop = () => { live.delete(socket); live.delete(forward); };
    forward.on('error', () => { drop(); socket.destroy(); });
    socket.on('error', () => { drop(); forward.destroy(); });
    socket.on('close', drop);
    socket.pipe(forward).pipe(socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const gated = new URL(upstream);
  gated.port = String(server.address().port);
  gated.hostname = '127.0.0.1';
  return {
    url: gated.toString(),
    // An outage drops the connections already checked out of the pool too,
    // otherwise an idle connection would keep answering.
    close: () => {
      open = false;
      for (const socket of live) socket.destroy();
      live.clear();
    },
    reopen: () => { open = true; },
    stop: () => new Promise(resolve => { for (const socket of live) socket.destroy(); server.close(resolve); }),
  };
}

/* ----------------------------------------------------------------- app child */

async function startApp(config, { expectListening = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), `smoke-${RUN_ID}-`));
  const envFile = join(directory, 'app.env');
  await writeFile(envFile, `${Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
  const child = spawn(process.execPath, [join(ROOT, 'dist/main.js')], {
    cwd: ROOT,
    env: { ...systemEnv(), ENV_FILE: envFile, ...(config.__envFileOverride ? { ENV_FILE: config.__envFileOverride } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const outcome = await new Promise(resolve => {
    const timer = setTimeout(() => resolve({ timedOut: true }), BOOT_TIMEOUT_MS);
    child.on('error', error => { clearTimeout(timer); resolve({ error }); });
    child.on('exit', code => { clearTimeout(timer); resolve({ exit: code }); });
    child.stdout.on('data', () => {
      for (const line of output.split('\n')) {
        if (!line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.event === 'listening') { clearTimeout(timer); resolve({ url: parsed.url }); }
        } catch { /* partial line */ }
      }
    });
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    // Force only this child, never a pattern match across the machine.
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  };
  const dispose = async () => { await stop(); await rm(directory, { recursive: true, force: true }); };

  if (expectListening) {
    check(!outcome.timedOut, 'the application did not report a listening port within 30s');
    check(outcome.url !== undefined, `the application exited before listening (code ${outcome.exit}); output: ${output.slice(0, 300)}`);
  }
  return { ...outcome, envFile, directory, child, stop, dispose, output: () => output };
}

const baseConfig = databaseUrl => ({
  NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info', DATABASE_URL: databaseUrl,
  FEATURE_IDENTITY: 'off', FEATURE_OUTBOX_RELAY: 'off', FEATURE_SEARCH: 'off', FEATURE_MEDIA: 'off',
});

/* ---------------------------------------------------------------------- main */

async function main() {
  check(existsSync(join(ROOT, 'dist/main.js')), 'dist/main.js is missing; run npm run build first');

  const external = process.env.SMOKE_EXTERNAL_DATABASE_URL;
  let databaseUrl;
  let composeEnvFile = null;
  if (external) {
    mode = 'external';
    databaseUrl = await startExternalDatabase(external);
  } else {
    composeEnvFile = join(tmpdir(), `smoke-compose-${RUN_ID}.env`);
    const explicit = {
      COMPOSE_PROJECT_NAME: PROJECT,
      POSTGRES_USER: DB_USER,
      POSTGRES_PASSWORD: DB_PASSWORD,
      POSTGRES_DB: 'poc',
      POSTGRES_PORT: '0',
    };
    const lines = Object.entries(explicit).map(([key, value]) => `${key}=${value}`);
    for (const name of await requiredComposeVariables()) {
      if (name in explicit) continue;
      lines.push(`${name}=smoke-only-${RUN_ID}`);
    }
    lines.push('');
    await writeFile(composeEnvFile, lines.join('\n'));
    cleanups.push(() => rm(composeEnvFile, { force: true }));
    databaseUrl = await startComposeDatabase(composeEnvFile);
  }
  process.stdout.write(`${JSON.stringify({ event: 'smoke_started', project: PROJECT, mode })}\n`);

  const migrate = (url) => spawnSync('npx', ['drizzle-kit', 'migrate'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url },
  });
  const appliedCount = async (url) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const rows = await client.query('select count(*)::int as count, max(created_at) as latest from drizzle.__drizzle_migrations');
      return rows.rows[0];
    } finally { await client.end(); }
  };

  await testCase('5.1 core start, migration, health and OpenAPI', async register => {
    const first = migrate(databaseUrl);
    check(first.status === 0, `first migration failed: ${(first.stderr || '').trim().slice(0, 200)}`);
    const afterFirst = await appliedCount(databaseUrl);
    check(afterFirst.count >= 2, `expected the baseline and the M1 migration, found ${afterFirst.count}`);
    const second = migrate(databaseUrl);
    check(second.status === 0, 'second migration run failed');
    const afterSecond = await appliedCount(databaseUrl);
    check(afterSecond.count === afterFirst.count, 'the migrator applied a file twice');
    check(String(afterSecond.latest) === String(afterFirst.latest), 'the migration journal changed on a repeat run');

    const app = await startApp(baseConfig(databaseUrl));
    register(app.dispose);
    const live = await http(app.url, '/health/live');
    check(live.status === 200 && live.body.status === 'ok', 'health/live did not answer 200 ok');
    const ready = await http(app.url, '/health/ready');
    check(ready.status === 200 && ready.body.details.postgres.status === 'up', 'health/ready did not report postgres up');
    const docs = await http(app.url, '/docs-json');
    check(docs.status === 200 && docs.body.info?.title?.length > 0, '/docs-json has no info title');
    check(Boolean(docs.body.paths['/health/ready']), '/docs-json does not document health/ready');
    check(Boolean(docs.body.paths['/admin/contents']), '/docs-json does not document the admin routes');
    check(Boolean(docs.body.paths['/catalog/contents/{id}']), '/docs-json does not document the public route');

    // R10: the document must describe the bodies, not only the route names.
    const schemas = docs.body.components?.schemas ?? {};
    for (const name of ['CreateContentBody', 'PatchContentBody', 'VersionedCommandBody',
      'AdminContentView', 'PublicContentView', 'ProblemDocument']) {
      check(Boolean(schemas[name]), `/docs-json has no ${name} schema`);
    }
    const create = docs.body.paths['/admin/contents'].post;
    check(
      create.requestBody?.content?.['application/json']?.schema?.$ref === '#/components/schemas/CreateContentBody',
      'POST /admin/contents has no CreateContentBody request schema',
    );
    check(
      create.responses?.['201']?.content?.['application/json']?.schema?.$ref === '#/components/schemas/AdminContentView',
      'POST /admin/contents 201 has no response schema',
    );
    check(
      create.responses?.['422']?.content?.['application/problem+json']?.schema?.$ref
        === '#/components/schemas/ProblemDocument',
      'POST /admin/contents 422 is not documented as problem+json',
    );
    check(schemas.CreateContentBody.required?.includes('title'), 'title is not documented as required');
    check(schemas.PatchContentBody.required?.includes('expectedVersion'),
      'expectedVersion is not documented as required on PATCH');
    check(schemas.PatchContentBody.properties?.expectedVersion?.type === 'integer',
      'expectedVersion is not documented as an integer');
    // D-M0-04b: the public view must not leak editorial fields.
    const publicProps = Object.keys(schemas.PublicContentView.properties ?? {});
    for (const leaked of ['mediaAssetId', 'createdBy', 'updatedBy', 'status', 'version']) {
      check(!publicProps.includes(leaked), `the public schema exposes ${leaked}`);
    }
    check(Object.keys(schemas.AdminContentView.properties ?? {}).includes('mediaAssetId'),
      'the admin schema is missing mediaAssetId');

    if (!external) {
      const full = compose(['--profile', 'full', 'config', '-q'], { envFile: composeEnvFile });
      check(full.status === 0, 'the full Compose definition does not validate');
    }
  });

  await testCase('5.2 negative configuration', async register => {
    const cases = [
      ['empty DATABASE_URL', { ...baseConfig(databaseUrl), DATABASE_URL: '' }, 'DATABASE_URL'],
      ['identity on without OIDC keys', { ...baseConfig(databaseUrl), FEATURE_IDENTITY: 'on' }, 'OIDC_ISSUER_URL'],
      ['outbox relay on without NATS_URL', {
        ...baseConfig(databaseUrl), FEATURE_OUTBOX_RELAY: 'on',
      }, 'NATS_URL'],
    ];
    for (const [name, config, expectedKey] of cases) {
      const app = await startApp(config, { expectListening: false });
      register(app.dispose);
      check(app.exit !== undefined && app.exit !== 0, `${name}: expected a non-zero exit, got ${JSON.stringify(app)}`);
      check(app.url === undefined, `${name}: the application listened despite invalid configuration`);
      check(app.output().includes(expectedKey), `${name}: the failure does not name ${expectedKey}`);
      check(!app.output().includes(DB_PASSWORD), `${name}: the database password appeared in the output`);
    }

    // A chosen ENV_FILE is never silently replaced by another .env.
    const directory = await mkdtemp(join(tmpdir(), `smoke-envfile-${RUN_ID}-`));
    register(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, '.env'), `DATABASE_URL=${databaseUrl}\nNODE_ENV=test\nPORT=0\nLOG_LEVEL=info\n`);
    const missing = spawn(process.execPath, [join(ROOT, 'dist/main.js')], {
      cwd: directory, env: { ...systemEnv(), ENV_FILE: join(directory, 'not-here.env') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    missing.stdout.on('data', chunk => { output += chunk; });
    missing.stderr.on('data', chunk => { output += chunk; });
    const [code] = await once(missing, 'exit');
    check(code !== 0, 'a missing ENV_FILE did not fail the startup');
    check(output.includes('ENV_FILE'), 'the missing ENV_FILE failure does not name the key');
    check(!output.includes('listening'), 'the application listened after falling back to another .env');
  });

  await testCase('5.3 database outage and recovery', async register => {
    const gate = external ? await startGate(databaseUrl) : null;
    if (gate) register(gate.stop);
    const app = await startApp(baseConfig(gate ? gate.url : databaseUrl));
    register(app.dispose);
    check((await http(app.url, '/health/ready')).status === 200, 'the application did not start ready');

    if (gate) gate.close();
    else check(compose(['stop', 'postgres'], { envFile: composeEnvFile }).status === 0, 'could not stop the smoke postgres service');

    await waitFor('readiness to report the database down', async () => {
      const ready = await http(app.url, '/health/ready');
      return ready.status === 503 && ready.body.details?.postgres?.status === 'down';
    });
    check((await http(app.url, '/health/live')).status === 200, 'liveness followed the database outage');

    if (gate) gate.reopen();
    else check(compose(['start', 'postgres'], { envFile: composeEnvFile }).status === 0, 'could not restart the smoke postgres service');

    await waitFor('readiness to recover', async () => (await http(app.url, '/health/ready')).status === 200);
  });

  await testCase('5.4 every integration disabled', async register => {
    const app = await startApp(baseConfig(databaseUrl));
    register(app.dispose);
    check((await http(app.url, '/health/ready')).status === 200, 'readiness failed with integrations off');
    await waitFor('the disabled-integration diagnostic', async () => app.output().includes('integrations_disabled'), 5_000);
    const lines = app.output().split('\n').filter(line => line.includes('integrations_disabled'));
    check(lines.length === 1, `expected one disabled-integration line, found ${lines.length}`);
    for (const name of ['identity', 'outbox', 'search', 'media']) {
      check(lines[0].includes(name), `the diagnostic does not mention ${name}`);
    }
  });

  await testCase('5.5 admin blocking without identity', async register => {
    const app = await startApp(baseConfig(databaseUrl));
    register(app.dispose);
    const id = '2ad0a7ef-bb1b-4c8e-8f4e-2e6d1f8a1b11';
    const requests = [
      ['GET', '/admin'], ['GET', '/admin/nem-letezik'], ['GET', `/admin/contents/${id}`],
      ['POST', '/admin/contents'], ['PATCH', `/admin/contents/${id}`],
      ['POST', `/admin/contents/${id}/publish`], ['POST', `/admin/contents/${id}/withdraw`],
      ['GET', '/admin/processing-status'], ['DELETE', `/admin/contents/${id}`],
    ];
    for (const [method, path] of requests) {
      const response = await http(app.url, path, {
        method,
        headers: { 'content-type': 'application/json', 'x-actor': 'publisher', 'x-test-actor': 'publisher' },
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({ expectedVersion: 1, title: 'Tiltott' }),
      });
      check(response.status === 503, `${method} ${path} answered ${response.status} instead of 503`);
      check(response.body.code === 'dependency_unavailable', `${method} ${path} did not answer dependency_unavailable`);
    }
    const publicRead = await http(app.url, `/catalog/contents/${id}`);
    check(publicRead.status === 404, 'the public catalog route is not reachable while admin is blocked');
  });

  await testCase('5.6 secret-free logging', async register => {
    const app = await startApp(baseConfig(databaseUrl));
    register(app.dispose);
    const correlationId = `smoke-${RUN_ID}`;
    const response = await http(app.url, '/health/live', {
      headers: { authorization: `Bearer ${SENTINEL_TOKEN}`, 'x-correlation-id': correlationId },
    });
    check(response.status === 200, 'the probe request failed');
    await http(app.url, '/admin/contents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: SENTINEL_TOKEN }),
    });

    const broken = await startApp({ ...baseConfig(databaseUrl), DATABASE_URL: `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:1/poc` });
    register(broken.dispose);
    await http(broken.url, '/health/ready');

    await waitFor('the request log line', async () => app.output().includes(correlationId), 5_000);
    for (const [name, child] of [['application', app], ['failing-database application', broken]]) {
      const output = child.output();
      for (const [label, secret] of [['bearer token', SENTINEL_TOKEN], ['database password', DB_PASSWORD], ['database url', databaseUrl]]) {
        check(!output.includes(secret), `the ${name} output contains the ${label}`);
      }
    }
  });

  return results.every(entry => entry.ok);
}

// A signal still runs the cleanup; an external SIGKILL cannot be caught, which
// is why the unique project name is printed at the start and the end.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write(`${JSON.stringify({ event: 'smoke_interrupted', project: PROJECT, signal })}\n`);
    process.exitCode = 1;
  });
}

let success = false;
try {
  success = await main();
} catch (error) {
  record('runner', false, error instanceof AssertionFailed ? error.message : `unexpected failure: ${error.message}`);
} finally {
  for (const fn of cleanups.reverse()) {
    try { await fn(); } catch (error) { record('cleanup', false, error.message); success = false; }
  }
}

const passed = results.filter(entry => entry.ok).length;
process.stdout.write(`${JSON.stringify({
  event: 'smoke_finished', project: PROJECT, mode, passed, total: results.length,
  cases: results,
})}\n`);
if (!success || results.some(entry => !entry.ok) || results.length === 0) {
  process.stdout.write(`Smoke failed. If a run was killed, remove only this project: docker compose -p ${PROJECT} down -v\n`);
  process.exit(1);
}
process.exit(0);
