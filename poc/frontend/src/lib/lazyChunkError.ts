const STORAGE_KEY = 'indaplay.poc.lazyChunkReload';

/**
 * Build fingerprint for the session loop guard. The error-page module URL
 * changes with a production content-hash, so a new deploy is a new build.
 */
export const LAZY_CHUNK_BUILD_ID = import.meta.url;

const LAZY_CHUNK_MESSAGE =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|unable to preload css|loading(?: css)? chunk [\w.-]+/i;

export function isLazyChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  if (name === 'ChunkLoadError') return true;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return LAZY_CHUNK_MESSAGE.test(message);
}

function readUsed(storage: Storage): Set<string> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function fingerprint(pathname: string, buildId: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${path}\n${buildId}`;
}

/**
 * Session-level loop guard: at most one automatic full reload per
 * navigation path + build. Returns whether this failure may reload now.
 * Does not store URL query, tokens or authorization codes.
 */
export function takeLazyChunkReload(
  pathname: string,
  buildId: string = LAZY_CHUNK_BUILD_ID,
  storage: Storage = sessionStorage,
): boolean {
  const token = fingerprint(pathname, buildId);
  try {
    const used = readUsed(storage);
    if (used.has(token)) return false;
    used.add(token);
    storage.setItem(STORAGE_KEY, JSON.stringify([...used]));
    return true;
  } catch {
    return false;
  }
}

export function reloadDocument(): void {
  window.location.reload();
}
