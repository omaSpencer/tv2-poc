import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ConfigurationError, validateConfig } from '../src/config.js';

const base = {
  NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://poc:sentinel-password@127.0.0.1:1/poc',
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function start(extra: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tv2-base-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, '.env');
  await writeFile(file, 'FEATURE_IDENTITY=off\n');
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { PATH: process.env.PATH, ...base, ENV_FILE: file, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanup.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited; clearTimeout(timer);
  });
  let logs = '';
  child.stdout!.on('data', chunk => { logs += chunk; });
  child.stderr!.on('data', chunk => { logs += chunk; });
  const result = await new Promise<{ url?: string; exit?: number | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bootstrap timeout')), 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve({ exit: code }); });
    child.stdout!.on('data', () => {
      for (const line of logs.split('\n')) {
        try {
          const item = JSON.parse(line);
          if (item.event === 'listening') { clearTimeout(timer); resolve({ url: item.url }); }
        } catch { /* incomplete line */ }
      }
    });
  });
  return { ...result, logs: () => logs, child };
}

function get(url: string, path: string, options?: RequestInit) {
  return fetch(url + path, { ...options, signal: AbortSignal.timeout(4000) });
}

describe('M0 application base', () => {
  it('rejects invalid configuration without leaking values', () => {
    expect(() => validateConfig({ ...base, DATABASE_URL: 'secret-value' })).toThrow('DATABASE_URL');
    expect(() => validateConfig({ ...base, PORT: '0', NODE_ENV: 'production' })).toThrow('PORT');
    try { validateConfig({ ...base, DATABASE_URL: 'secret-value' }); }
    catch (error) { expect(String(error)).not.toContain('secret-value'); }
  });
  it('accepts validated config and rejects unavailable integrations', () => {
    expect(validateConfig(base).PORT).toBe(0);
    for (const flag of ['FEATURE_IDENTITY', 'FEATURE_SEARCH', 'FEATURE_MEDIA', 'FEATURE_OUTBOX_RELAY']) {
      expect(() => validateConfig({ ...base, [flag]: 'on' })).toThrow(ConfigurationError);
    }
  });
  it('boots, exposes OpenAPI and reports DB down independently of liveness', async () => {
    const app = await start();
    expect(app.url).toBeTruthy();
    expect((await get(app.url!, '/health/live')).status).toBe(200);
    const ready = await get(app.url!, '/health/ready');
    expect(ready.status).toBe(503);
    expect((await ready.json()).details.postgres.status).toBe('down');
    const spec = await (await get(app.url!, '/docs-json')).json();
    expect(spec.paths['/health/ready']).toBeDefined();
    expect(spec.info.title).toBe('IndaPlay PoC backend');
  });
  it('blocks every admin method and ignores forged actors', async () => {
    const app = await start();
    for (const [method, path] of [
      ['GET', '/admin'], ['GET', '/admin/nonexistent'], ['POST', '/admin/contents'],
      ['PATCH', '/admin/contents/id'], ['POST', '/admin/contents/id/publish'],
      ['POST', '/admin/contents/id/withdraw'], ['GET', '/ADMIN/contents'],
    ]) {
      const response = await get(app.url!, path, { method, headers: { 'x-actor': 'publisher' } });
      expect(response.status).toBe(503);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect((await response.json()).code).toBe('dependency_unavailable');
    }
  });
  it('returns correlation IDs and does not log credentials', async () => {
    const app = await start();
    const response = await get(app.url!, '/health/live?secret=sentinel-query', {
      headers: { authorization: 'Bearer sentinel-token', 'x-correlation-id': 'smoke-0001' },
    });
    expect(response.headers.get('x-correlation-id')).toBe('smoke-0001');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(app.logs()).toContain('smoke-0001');
    for (const secret of ['sentinel-token', 'sentinel-password', 'sentinel-query', base.DATABASE_URL]) {
      expect(app.logs()).not.toContain(secret);
    }
    const invalid = await get(app.url!, '/missing', { headers: { 'x-correlation-id': 'bad id' } });
    expect(invalid.status).toBe(404);
    expect(invalid.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('fails startup for missing ENV_FILE and identity without adapter', async () => {
    const missing = await start({ ENV_FILE: '/missing/tv2-env-file' });
    expect(missing.exit).not.toBe(0);
    expect(missing.logs()).toContain('ENV_FILE');
    const identity = await start({ FEATURE_IDENTITY: 'on' });
    expect(identity.exit).not.toBe(0);
    expect(identity.url).toBeUndefined();
    expect(identity.logs()).toContain('FEATURE_IDENTITY');
  });
  it.skipIf(!process.env.TEST_DATABASE_URL)('reports ready against a real PostgreSQL instance', async () => {
    const app = await start({ DATABASE_URL: process.env.TEST_DATABASE_URL! });
    const response = await get(app.url!, '/health/ready');
    expect(response.status).toBe(200);
    expect((await response.json()).details.postgres.status).toBe('up');
  });
});
