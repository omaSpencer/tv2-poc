#!/usr/bin/env node
/**
 * BE-F1 O1 – container healthcheck.
 *
 * The runtime image has no curl or wget, and adding one would widen it for no
 * reason: Node can probe its own listener. Exit 0 only on a 2xx from the
 * requested path, and never print the response body, so an unhealthy container
 * cannot leak payload into the daemon log.
 */
const path = process.argv[2] ?? '/health/live';
const port = process.env.PORT ?? '3000';
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS ?? 2000);

try {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000),
  });
  process.stdout.write(`${JSON.stringify({ event: 'healthcheck', path, status: response.status })}\n`);
  process.exit(response.ok ? 0 : 1);
} catch {
  process.stdout.write(`${JSON.stringify({ event: 'healthcheck', path, status: null })}\n`);
  process.exit(1);
}
