/** Vite dev-proxy target only. Never a production browser secret or runtime API origin. */
export const DEFAULT_DEV_BACKEND_ORIGIN = 'http://127.0.0.1:3000';

export type DevProxyEnv = {
  VITE_BACKEND_ORIGIN?: string;
};

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the Vite `/api` proxy target.
 * Missing origin → documented local default. Explicit garbage → fail-fast.
 */
export function resolveDevProxyOrigin(env: DevProxyEnv = {}): string {
  const explicit = env.VITE_BACKEND_ORIGIN?.trim();
  if (!explicit) return DEFAULT_DEV_BACKEND_ORIGIN;
  if (!validHttpUrl(explicit)) {
    throw new Error('VITE_BACKEND_ORIGIN nem érvényes HTTP(S) URL.');
  }
  return explicit.replace(/\/$/, '');
}
