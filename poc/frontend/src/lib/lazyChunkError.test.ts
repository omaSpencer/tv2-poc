import { describe, expect, it } from 'vitest';
import { isLazyChunkLoadError, takeLazyChunkReload } from './lazyChunkError';

describe('isLazyChunkLoadError', () => {
  it('recognizes Vite, webpack and browser module-script failures', () => {
    expect(isLazyChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/Page.js'))).toBe(true);
    expect(isLazyChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isLazyChunkLoadError(new Error('Unable to preload CSS for /assets/Page.css'))).toBe(true);
    expect(isLazyChunkLoadError(Object.assign(new Error('Loading chunk 17 failed.'), { name: 'ChunkLoadError' }))).toBe(true);
  });

  it('does not treat a generic render or network error as a chunk failure', () => {
    expect(isLazyChunkLoadError(new Error('Failed to fetch'))).toBe(false);
    expect(isLazyChunkLoadError(new TypeError('Cannot read properties of null'))).toBe(false);
    expect(isLazyChunkLoadError(new Error('chunk is not defined'))).toBe(false);
    expect(isLazyChunkLoadError({ message: 'secret token=abc code=stolen' })).toBe(false);
    expect(isLazyChunkLoadError(null)).toBe(false);
  });
});

describe('takeLazyChunkReload', () => {
  it('allows one reload per pathname and build, then blocks the same pair', () => {
    expect(takeLazyChunkReload('/contents', 'build-a')).toBe(true);
    expect(takeLazyChunkReload('/contents', 'build-a')).toBe(false);
    expect(takeLazyChunkReload('/operations', 'build-a')).toBe(true);
    expect(takeLazyChunkReload('/contents', 'build-b')).toBe(true);
    expect(takeLazyChunkReload('/contents', 'build-a')).toBe(false);
  });

  it('does not store URL query, tokens or authorization codes', () => {
    takeLazyChunkReload('/auth/callback', 'build-a');
    const stored = sessionStorage.getItem('indaplay.poc.lazyChunkReload') ?? '';
    expect(stored).not.toContain('code=');
    expect(stored).not.toContain('token');
    expect(stored).not.toContain('?');
  });
});
