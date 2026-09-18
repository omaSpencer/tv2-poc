/** Dev-only manual token. Memory, never Web Storage. */
let manualAccessToken: string | null = null;

export function resetManualAccessTokenForTests(): void {
  manualAccessToken = null;
}

export function readManualToken(allowed: boolean): string | null {
  if (!allowed) return null;
  const token = manualAccessToken?.trim();
  return token || null;
}

export function writeManualToken(allowed: boolean, token: string | null): void {
  if (!allowed) {
    manualAccessToken = null;
    return;
  }
  manualAccessToken = token?.trim() || null;
}
