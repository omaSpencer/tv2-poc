import { ConfigurationError } from './config.js';

export type StartupFailure =
  | { event: 'startup_failed'; code: 'invalid_configuration'; keys: string[] }
  | {
    event: 'startup_failed';
    code: 'bootstrap_failed';
    category: 'listen_address_in_use' | 'listen_permission' | 'dependency_connection' | 'unknown';
  };

const DEPENDENCY_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE',
  '08000', '08001', '08003', '08004', '08006', '57P01', '57P02', '57P03', '53300',
]);

/** Convert startup failures to an allowlisted, secret-free diagnostic. */
export function startupFailure(error: unknown): StartupFailure {
  if (error instanceof ConfigurationError) {
    return { event: 'startup_failed', code: 'invalid_configuration', keys: error.keys };
  }
  const code = error !== null && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  const category = code === 'EADDRINUSE'
    ? 'listen_address_in_use'
    : code === 'EACCES' || code === 'EPERM'
      ? 'listen_permission'
      : typeof code === 'string' && DEPENDENCY_CODES.has(code)
        ? 'dependency_connection'
        : 'unknown';
  return { event: 'startup_failed', code: 'bootstrap_failed', category };
}
