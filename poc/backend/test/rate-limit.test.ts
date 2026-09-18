/**
 * BE-F1 S1 – unit coverage for the public edge limiter: which routes it
 * covers, how a client is identified behind a proxy, and how the fixed window
 * behaves at and past its limit.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TRACKED_CLIENTS,
  FixedWindowRateLimiter,
  RATE_LIMITED_ROUTES,
  clientKey,
  rateLimitedRoute,
} from '../src/rate-limit.js';
import { ERROR_CODES } from '../src/contracts/errors.js';
import { ROUTE_MATRIX } from '../src/contracts/permissions.js';

const peer = (address: string, headers: Record<string, string | string[]> = {}) =>
  ({ headers, socket: { remoteAddress: address } }) as never;

describe('S1 limited route set', () => {
  it('covers exactly the publicly reachable catalog routes of the route matrix', () => {
    const publicCatalog = ROUTE_MATRIX
      .filter(rule => rule.access === null && rule.path.startsWith('/catalog'))
      .map(rule => `${rule.method} ${rule.path}`)
      .sort();
    expect([...RATE_LIMITED_ROUTES].sort()).toEqual(publicCatalog);
  });

  it('maps a request to its route template', () => {
    expect(rateLimitedRoute('GET', '/catalog/search')).toBe('GET /catalog/search');
    expect(rateLimitedRoute('GET', '/CATALOG/Search/')).toBe('GET /catalog/search');
    expect(rateLimitedRoute('GET', '/catalog/contents/8f0b2f2e-0000-4000-8000-000000000000'))
      .toBe('GET /catalog/contents/:id');
    expect(rateLimitedRoute('HEAD', '/catalog/search')).toBe('GET /catalog/search');
  });

  it('leaves every other route unmetered', () => {
    expect(rateLimitedRoute('POST', '/catalog/search')).toBeNull();
    expect(rateLimitedRoute('GET', '/catalog/contents')).toBeNull();
    expect(rateLimitedRoute('GET', '/catalog/contents/abc/extra')).toBeNull();
    expect(rateLimitedRoute('GET', '/health/ready')).toBeNull();
    expect(rateLimitedRoute('GET', '/admin/contents')).toBeNull();
    expect(rateLimitedRoute('OPTIONS', '/catalog/search')).toBeNull();
  });

  it('keeps 429 a stable code in the shared error vocabulary', () => {
    expect(ERROR_CODES.rate_limited).toBe(429);
  });
});

describe('S1 client identification', () => {
  it('ignores X-Forwarded-For when no proxy hop is trusted', () => {
    expect(clientKey(peer('203.0.113.7', { 'x-forwarded-for': '198.51.100.9' }), 0)).toBe('203.0.113.7');
  });

  it('normalises an IPv4-mapped IPv6 peer', () => {
    expect(clientKey(peer('::ffff:127.0.0.1'), 0)).toBe('127.0.0.1');
  });

  it('takes the address the outermost trusted proxy observed', () => {
    const headers = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7, 10.0.0.1' };
    expect(clientKey(peer('10.0.0.2', headers), 1)).toBe('10.0.0.1');
    expect(clientKey(peer('10.0.0.2', headers), 2)).toBe('203.0.113.7');
  });

  it('falls back to the peer when the chain is shorter than the trusted hop count', () => {
    expect(clientKey(peer('10.0.0.2', { 'x-forwarded-for': '198.51.100.9' }), 3)).toBe('10.0.0.2');
    expect(clientKey(peer('10.0.0.2'), 1)).toBe('10.0.0.2');
  });
});

describe('S1 fixed window', () => {
  const settings = (now: () => number) => ({ max: 3, windowMs: 1000, trustedProxyHops: 0, now });

  it('allows the configured number of requests and then refuses with a retry hint', () => {
    let clock = 10_000;
    const limiter = new FixedWindowRateLimiter(settings(() => clock));
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 0 });
    clock = 10_400;
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('rounds the retry hint up to whole seconds and never below one', () => {
    let clock = 0;
    const limiter = new FixedWindowRateLimiter({ max: 1, windowMs: 5000, trustedProxyHops: 0, now: () => clock });
    limiter.check('a');
    clock = 1;
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 5 });
    clock = 4999;
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('starts a fresh window once the previous one expired', () => {
    let clock = 0;
    const limiter = new FixedWindowRateLimiter(settings(() => clock));
    for (let index = 0; index < 3; index += 1) limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);
    clock = 1000;
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 2 });
  });

  it('counts each key on its own budget', () => {
    const limiter = new FixedWindowRateLimiter(settings(() => 0));
    for (let index = 0; index < 3; index += 1) limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('keeps the tracked client map bounded', () => {
    let clock = 0;
    const limiter = new FixedWindowRateLimiter({
      max: 3, windowMs: 1000, trustedProxyHops: 0, maxTrackedClients: 8, now: () => clock,
    });
    for (let index = 0; index < 200; index += 1) {
      clock += 1;
      limiter.check(`client-${index}`);
    }
    expect(limiter.size).toBeLessThanOrEqual(8);
    expect(DEFAULT_MAX_TRACKED_CLIENTS).toBe(10_000);
  });

  it('fails closed for new keys at capacity without resetting active budgets', () => {
    let clock = 0;
    const limiter = new FixedWindowRateLimiter({
      max: 2, windowMs: 1000, trustedProxyHops: 0, maxTrackedClients: 2, now: () => clock,
    });
    expect(limiter.check('client-a')).toEqual({ allowed: true, remaining: 1 });
    clock = 100;
    expect(limiter.check('client-b')).toEqual({ allowed: true, remaining: 1 });

    expect(limiter.check('overflow-1')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.check('overflow-2')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.size).toBe(2);

    expect(limiter.check('client-a')).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check('client-a')).toEqual({ allowed: false, retryAfterSeconds: 1 });

    clock = 1000;
    expect(limiter.check('client-c')).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.size).toBe(2);
    expect(limiter.check('client-b')).toEqual({ allowed: true, remaining: 0 });
  });
});
