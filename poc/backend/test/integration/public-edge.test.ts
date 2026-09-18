/**
 * BE-F1 S1 + S2 – the public HTTP edge against a live database.
 *
 * S1: the two public catalog routes carry a configurable limit, the refusal is
 * a stable `rate_limited` problem document with `Retry-After`, and normal
 * traffic at the shipped default is untouched.
 * S2: the API is same-origin by contract. A cross-origin browser call gets no
 * CORS grant from this process, and no preflight is answered.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TEST_RATE_LIMIT, type TestApp } from '../support/test-app.js';
import { testDatabaseUrl, truncateAll } from '../support/database.js';

const url = testDatabaseUrl();
const unknownId = () => `/catalog/contents/${randomUUID()}`;

let limited: TestApp;
let shipped: TestApp;

beforeAll(async () => {
  process.env.DATABASE_URL = url;
  await truncateAll(url);
  limited = await createTestApp(null, { rateLimit: { max: 3, windowMs: 60_000, trustedProxyHops: 0 } });
  shipped = await createTestApp(null);
});

afterAll(async () => {
  await limited.close();
  await shipped.close();
});

describe('S1 public catalog limit', () => {
  it('refuses the request past the limit with the documented 429 contract', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await limited.request('GET', unknownId())).status).toBe(404);
    }
    const refused = await limited.request('GET', unknownId(), { correlationId: 'be-f1-s1-limit' });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    expect(refused.body).toMatchObject({
      code: 'rate_limited',
      status: 429,
      type: 'urn:indaplay:poc:error:rate_limited',
      correlationId: 'be-f1-s1-limit',
    });
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // The problem document carries names and codes only, never a value.
    expect(JSON.stringify(refused.body)).not.toContain(url);
  });

  it('gives the search route its own budget instead of sharing the detail route budget', async () => {
    // The detail budget above is already spent for this app.
    expect((await limited.request('GET', unknownId())).status).toBe(429);
    const search = await limited.request('GET', '/catalog/search?q=hir');
    expect(search.status).not.toBe(429);
  });

  it('never meters health or admin routes', async () => {
    expect((await limited.request('GET', '/health/live')).status).toBe(200);
    expect((await limited.request('GET', '/health/ready')).status).toBe(200);
    // Admin stays an identity decision, not a rate decision.
    expect((await limited.request('GET', '/admin/contents', { actor: null })).status).toBe(401);
  });

  it('leaves normal traffic untouched at the shipped default', async () => {
    expect(TEST_RATE_LIMIT.max).toBe(120);
    const statuses = new Set<number>();
    for (let index = 0; index < 30; index += 1) {
      statuses.add((await shipped.request('GET', unknownId())).status);
    }
    expect([...statuses]).toEqual([404]);
  });
});

describe('S2 same-origin contract', () => {
  it('grants no cross-origin access to a browser call', async () => {
    const response = await fetch(`${shipped.url}/catalog/contents/${randomUUID()}`, {
      headers: { origin: 'https://evil.example' },
      signal: AbortSignal.timeout(8000),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary') ?? '').not.toContain('Origin');
  });

  it('answers no preflight', async () => {
    const response = await fetch(`${shipped.url}/catalog/search?q=hir`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
      signal: AbortSignal.timeout(8000),
    });
    expect(response.status).not.toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-methods')).toBeNull();
    expect(response.headers.get('access-control-allow-headers')).toBeNull();
  });

  it('keeps the shipped bootstrap free of any CORS enablement', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('enableCors');
    expect(source.toLowerCase()).not.toContain('access-control-allow-origin');
  });
});
