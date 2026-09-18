/**
 * Backend-compatible UUID: RFC 4122/9562 versions 1–8 with variant 8/9/a/b.
 * Rejects malformed values and the nil UUID.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
