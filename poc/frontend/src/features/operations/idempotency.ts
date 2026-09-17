export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function activeActionStorageKey(kind: string): string {
  return `poc:operator-action:${kind}`;
}
