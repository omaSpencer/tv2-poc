import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_BACKEND_ORIGIN, resolveDevProxyOrigin } from './devProxy';

describe('resolveDevProxyOrigin', () => {
  it('defaults to the documented local backend when origin is missing', () => {
    expect(resolveDevProxyOrigin({})).toBe(DEFAULT_DEV_BACKEND_ORIGIN);
    expect(resolveDevProxyOrigin({ VITE_BACKEND_ORIGIN: '   ' })).toBe(DEFAULT_DEV_BACKEND_ORIGIN);
  });

  it('keeps an explicit valid development origin', () => {
    expect(resolveDevProxyOrigin({ VITE_BACKEND_ORIGIN: 'http://127.0.0.1:3001/' })).toBe('http://127.0.0.1:3001');
  });

  it('fails fast on an explicit invalid origin', () => {
    expect(() => resolveDevProxyOrigin({ VITE_BACKEND_ORIGIN: 'ftp://files.example' })).toThrow('VITE_BACKEND_ORIGIN');
    expect(() => resolveDevProxyOrigin({ VITE_BACKEND_ORIGIN: 'not-a-url' })).toThrow('VITE_BACKEND_ORIGIN');
  });
});
