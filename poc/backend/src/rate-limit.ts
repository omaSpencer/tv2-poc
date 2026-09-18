/**
 * BE-F1 S1 – rate limiting for the public catalog edge.
 *
 * The limiter lives in the application, not in a reverse proxy, because the
 * PoC ships without one and a limit that only exists in a deployment document
 * cannot be tested. It is deliberately narrow: only the two routes the route
 * matrix marks as publicly reachable (`GET /catalog/search` and
 * `GET /catalog/contents/:id`) are counted. Admin routes stay behind the
 * identity boundary and health stays unmetered so a probe can never be
 * throttled out of its own readiness check.
 *
 * Counting is a fixed window per client key, held in this process only. Two
 * application instances therefore allow up to twice the configured rate; that
 * is the documented limitation of an in-process limiter and the reason the
 * production ingress may add its own edge limit on top.
 *
 * Client key and proxy assumption: by default the key is the transport peer
 * address (`req.socket.remoteAddress`), which is the only value an untrusted
 * client cannot forge. `X-Forwarded-For` is read *only* when
 * `RATE_LIMIT_TRUSTED_PROXY_HOPS` is greater than zero, and then the address is
 * taken that many entries from the right of the chain — the one the outermost
 * trusted proxy observed. A chain shorter than the configured hop count falls
 * back to the peer address instead of trusting a partial chain.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { problem } from './http.js';

/** Route matrix entries this limiter covers. Asserted against ROUTE_MATRIX in tests. */
export const RATE_LIMITED_ROUTES = ['GET /catalog/search', 'GET /catalog/contents/:id'] as const;

const CATALOG_SEARCH_PATH = '/catalog/search';
const CATALOG_CONTENT_DETAIL = /^\/catalog\/contents\/[^/]+$/;

export type RateLimitedRoute = (typeof RATE_LIMITED_ROUTES)[number];

/**
 * The route template a request belongs to, or `null` when the route carries no
 * limit. Counting per template rather than per client alone keeps one route
 * from spending the other's budget. Express matches paths case-insensitively
 * by default, so the check does too.
 */
export function rateLimitedRoute(method: string, path: string): RateLimitedRoute | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const normalized = (path.length > 1 ? path.replace(/\/+$/, '') : path).toLowerCase();
  if (normalized === CATALOG_SEARCH_PATH) return 'GET /catalog/search';
  if (CATALOG_CONTENT_DETAIL.test(normalized)) return 'GET /catalog/contents/:id';
  return null;
}

/** `::ffff:127.0.0.1` and `127.0.0.1` are the same client; count them once. */
function normalizeAddress(value: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  return mapped ? mapped[1] : value;
}

export function clientKey(req: Pick<Request, 'headers' | 'socket'>, trustedProxyHops: number): string {
  const peer = normalizeAddress(req.socket?.remoteAddress ?? '') || 'unknown';
  if (trustedProxyHops <= 0) return peer;
  const header = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  const index = chain.length - trustedProxyHops;
  // A chain shorter than the trusted hop count means the request did not come
  // through the expected proxy layer: fall back to the peer, never to a value
  // the client could have written itself.
  if (index < 0 || index >= chain.length) return peer;
  return normalizeAddress(chain[index]);
}

export type RateLimitSettings = {
  /** Requests allowed per client key inside one window. */
  max: number;
  windowMs: number;
  /** Number of reverse proxies in front of the application. 0 = none trusted. */
  trustedProxyHops: number;
  /** Upper bound on tracked client keys; keeps the counter map bounded. */
  maxTrackedClients?: number;
  /** Injected in tests so window expiry is deterministic. */
  now?: () => number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export const DEFAULT_MAX_TRACKED_CLIENTS = 10_000;

/**
 * Fixed-window counter. Memory is bounded by `maxTrackedClients`. Map insertion
 * order is also expiry order because every new window has the same duration;
 * this lets us remove expired entries from the front in amortized O(1) time.
 * When every tracked window is still active, previously unseen keys are denied
 * until the oldest window expires. Active counters are never evicted, so key
 * pressure cannot reset another client's budget.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly maxTrackedClients: number;
  private readonly now: () => number;

  constructor(settings: RateLimitSettings) {
    this.max = settings.max;
    this.windowMs = settings.windowMs;
    this.maxTrackedClients = settings.maxTrackedClients ?? DEFAULT_MAX_TRACKED_CLIENTS;
    this.now = settings.now ?? Date.now;
  }

  get size(): number {
    return this.windows.size;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    const current = this.windows.get(key);
    if (current === undefined) {
      const capacityRetry = this.retryWhenFull(now);
      if (capacityRetry !== null) return capacityRetry;
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1 };
    }
    if (current.resetAt <= now) {
      // Delete before reinserting so the renewed window moves to the back and
      // insertion order remains identical to expiry order.
      this.windows.delete(key);
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1 };
    }
    if (current.count >= this.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, remaining: this.max - current.count };
  }

  private retryWhenFull(now: number): RateLimitDecision | null {
    if (this.windows.size < this.maxTrackedClients) return null;

    // Only expired entries are visited. Since every entry is inserted and
    // removed once, cleanup is amortized O(1), including under key floods.
    for (const [key, window] of this.windows) {
      if (window.resetAt > now) break;
      this.windows.delete(key);
    }
    if (this.windows.size < this.maxTrackedClients) return null;

    const oldest = this.windows.values().next().value as { resetAt: number } | undefined;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(((oldest?.resetAt ?? now + this.windowMs) - now) / 1000)),
    };
  }
}

/**
 * The 429 is written here rather than thrown, for the same reason the admin
 * prefix guard answers inline: a limit must not depend on a controller, a guard
 * or the exception filter having been reached.
 */
export function publicRateLimit(settings: RateLimitSettings, limiter = new FixedWindowRateLimiter(settings)) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const route = rateLimitedRoute(req.method, req.path);
    if (route === null) {
      next();
      return;
    }
    const decision = limiter.check(`${route}|${clientKey(req, settings.trustedProxyHops)}`);
    if (decision.allowed) {
      next();
      return;
    }
    const correlationId = (res.locals.correlationId as string | undefined) ?? randomUUID();
    res.setHeader('Retry-After', String(decision.retryAfterSeconds));
    res
      .status(429)
      .type('application/problem+json')
      .json(problem('rate_limited', correlationId, 'Too many requests for this public route.', req.path));
  };
}
