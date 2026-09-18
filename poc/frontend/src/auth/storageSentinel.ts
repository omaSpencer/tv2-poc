/**
 * Detects token-shaped material in browser storage without echoing secrets.
 * PKCE state/verifier JSON is allowed; serialized OIDC User and JWTs are not.
 */
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const TOKEN_FIELDS = /"(access_token|refresh_token|id_token)"\s*:/;

export function valueLooksLikeTokenMaterial(value: string): boolean {
  return JWT_LIKE.test(value) || TOKEN_FIELDS.test(value);
}

export function webStorageLeaksTokenMaterial(storage: Storage): string[] {
  const leaks: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const raw = storage.getItem(key) ?? '';
    if (valueLooksLikeTokenMaterial(key) || valueLooksLikeTokenMaterial(raw)) leaks.push(key);
  }
  return leaks;
}

export function cookieHeaderLeaksTokenMaterial(header = document.cookie): boolean {
  if (!header) return false;
  return valueLooksLikeTokenMaterial(header);
}

export async function indexedDbLeaksTokenMaterial(): Promise<string[]> {
  if (typeof indexedDB === 'undefined') return [];
  const leaks: string[] = [];
  const databases = typeof indexedDB.databases === 'function'
    ? await indexedDB.databases()
    : [];
  for (const info of databases) {
    const name = info.name ?? '';
    if (name && valueLooksLikeTokenMaterial(name)) leaks.push(name);
  }
  return leaks;
}

export function browserWebStorageLeaksTokenMaterial(): string[] {
  const leaks = [
    ...webStorageLeaksTokenMaterial(window.localStorage).map(key => `localStorage:${key}`),
    ...webStorageLeaksTokenMaterial(window.sessionStorage).map(key => `sessionStorage:${key}`),
  ];
  if (cookieHeaderLeaksTokenMaterial()) leaks.push('document.cookie');
  return leaks;
}
