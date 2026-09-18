/**
 * PostgreSQL does not accept bind parameters in SET LOCAL, so timeout values
 * have to be formatted into the statement. Keep the allowed setting names
 * closed and validate the number before interpolation.
 */
export const MAX_LOCAL_TIMEOUT_MS = 3_600_000;

export type LocalTimeoutSetting = 'lock_timeout' | 'statement_timeout';

export function localTimeoutStatement(setting: LocalTimeoutSetting, timeoutMs: number): string {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_LOCAL_TIMEOUT_MS) {
    throw new RangeError(`Local PostgreSQL timeout must be an integer from 1 to ${MAX_LOCAL_TIMEOUT_MS} ms.`);
  }
  return `set local ${setting} = '${timeoutMs}ms'`;
}
