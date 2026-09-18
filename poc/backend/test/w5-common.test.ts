import { Writable } from 'node:stream';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { raceDeadline } from '../src/common/deadline.js';
import {
  D08_RETRY_DELAYS_MS, D08_RETRY_JITTER, peekRetryDelayMs, retryDelayMs,
} from '../src/common/retry.js';
import {
  managedSettingsDifferences, normalizeManagedAttributeNames, type ManagedSettings,
} from '../src/search/managed-settings.js';
import { componentLogger, createAppLogger, REDACTED } from '../src/observability/logger.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('A1 common deadline helper', () => {
  it('does not wait when the deadline is zero or negative', async () => {
    vi.useFakeTimers();
    const work = new Promise<void>(() => undefined);
    await expect(raceDeadline(work, 0)).resolves.toBeUndefined();
    await expect(raceDeadline(work, -1)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer when work resolves or rejects first', async () => {
    vi.useFakeTimers();
    await expect(raceDeadline(Promise.resolve(), 60_000)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    await expect(raceDeadline(Promise.reject(new Error('failed')), 60_000)).rejects.toThrow('failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns at the deadline without settling the work promise', async () => {
    vi.useFakeTimers();
    const result = raceDeadline(new Promise<void>(() => undefined), 250);
    await vi.advanceTimersByTimeAsync(249);
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('A1 common D08 retry helper', () => {
  it('clamps attempts to the ladder and repeats the final delay', () => {
    expect(peekRetryDelayMs(-10)).toBe(D08_RETRY_DELAYS_MS[0]);
    expect(peekRetryDelayMs(2.9)).toBe(D08_RETRY_DELAYS_MS[2]);
    expect(peekRetryDelayMs(999)).toBe(D08_RETRY_DELAYS_MS.at(-1));
  });

  it('applies deterministic plus/minus 20 percent jitter', () => {
    const base = D08_RETRY_DELAYS_MS[3];
    expect(retryDelayMs(3, D08_RETRY_DELAYS_MS, () => 0)).toBe(Math.round(base * (1 - D08_RETRY_JITTER)));
    expect(retryDelayMs(3, D08_RETRY_DELAYS_MS, () => 0.5)).toBe(base);
    expect(retryDelayMs(3, D08_RETRY_DELAYS_MS, () => 1)).toBe(Math.round(base * (1 + D08_RETRY_JITTER)));
  });

  it('refuses an empty retry ladder', () => {
    expect(() => retryDelayMs(0, [])).toThrow(RangeError);
  });
});

describe('A1 managed Meilisearch settings', () => {
  const expected: ManagedSettings = {
    searchableAttributes: ['title', 'tags', 'summary'],
    filterableAttributes: ['category'],
    displayedAttributes: ['id'],
    sortableAttributes: [],
  };

  it('treats searchable order as significant and other managed fields as sets', () => {
    const multiValueExpected: ManagedSettings = {
      ...expected,
      filterableAttributes: ['category', 'tags'],
      displayedAttributes: ['id', 'title'],
    };
    expect(managedSettingsDifferences({
      ...multiValueExpected,
      filterableAttributes: ['tags', 'category'],
      displayedAttributes: ['title', 'id'],
    }, multiValueExpected)).toEqual([]);
    expect(managedSettingsDifferences({
      ...expected,
      searchableAttributes: ['summary', 'tags', 'title'],
    })).toEqual(['searchableAttributes']);
  });

  it('preserves newer object-shaped filter settings as visible mismatches', () => {
    const normalized = normalizeManagedAttributeNames([
      'category',
      { attributePatterns: ['genre'], features: { facetSearch: true } },
    ]);
    expect(normalized[0]).toBe('category');
    expect(normalized[1]).toContain('attributePatterns');
    expect(managedSettingsDifferences({ ...expected, filterableAttributes: normalized }))
      .toEqual(['filterableAttributes']);
  });
});

describe('T2 Authentik release contract', () => {
  it('pins the silent callback and production public build arguments', async () => {
    const blueprint = await readFile(join(process.cwd(), 'authentik/blueprints/poc.yaml'), 'utf8');
    expect(blueprint).toContain('access_token_validity: minutes=5');
    expect(blueprint).toContain('refresh_token_validity: hours=1');
    expect(blueprint).toContain('url: http://127.0.0.1:5173/auth/silent-callback');

    const productionCompose = await readFile(join(process.cwd(), 'compose.prod.yaml'), 'utf8');
    for (const buildArgument of [
      'VITE_API_BASE',
      'VITE_OIDC_ISSUER_URL',
      'VITE_OIDC_CLIENT_ID',
      'VITE_OIDC_REDIRECT_URI',
      'VITE_OIDC_POST_LOGOUT_REDIRECT_URI',
      'VITE_OIDC_SILENT_REDIRECT_URI',
      'VITE_ALLOW_MANUAL_TOKEN',
    ]) {
      expect(productionCompose).toContain(`${buildArgument}:`);
    }
  });
});

describe('A2 logger topology and redaction', () => {
  it('redacts secrets in nested objects, errors and credential-bearing strings', () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const sentinel = 'W5_SENTINEL_SECRET';
    const root = createAppLogger('info', destination);

    for (const component of ['bootstrap', 'http-boundary', 'outbox-relay', 'search-service', 'token-verifier']) {
      componentLogger(root, component).info({
        event: 'redaction_probe',
        headers: { authorization: `Bearer ${sentinel}`, cookie: `sid=${sentinel}` },
        nested: { refreshToken: sentinel, api_key: sentinel },
        databaseUrl: `postgresql://user:${sentinel}@database.example/app`,
        error: new Error(`request failed for Bearer ${sentinel}`),
      });
    }

    const output = chunks.join('');
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain('postgresql://user:');
    expect(output).toContain(REDACTED);
    for (const component of ['bootstrap', 'http-boundary', 'outbox-relay', 'search-service', 'token-verifier']) {
      expect(output).toContain(component);
    }
  });

  it('keeps the only production pino construction in the logger module', async () => {
    const sourceRoot = join(process.cwd(), 'src');
    const files: string[] = [];
    async function visit(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.name.endsWith('.ts')) files.push(path);
      }
    }
    await visit(sourceRoot);
    const constructors: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\bpino\s*\(/u.test(source)) constructors.push(relative(sourceRoot, file));
    }
    expect(constructors).toEqual(['observability/logger.ts']);
  });
});
