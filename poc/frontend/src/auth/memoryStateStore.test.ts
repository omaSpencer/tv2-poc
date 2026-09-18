import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from './memoryStateStore';
import { valueLooksLikeTokenMaterial } from './storageSentinel';

describe('MemoryStateStore', () => {
  it('round-trips values without touching Web Storage', async () => {
    sessionStorage.setItem('probe', 'keep');
    const store = new MemoryStateStore();
    await store.set('oidc.user:issuer:client', JSON.stringify({ access_token: 'secret' }));
    expect(await store.get('oidc.user:issuer:client')).toContain('secret');
    expect(sessionStorage.getItem('probe')).toBe('keep');
    expect(sessionStorage.length).toBe(1);
    expect(await store.remove('oidc.user:issuer:client')).toContain('secret');
    expect(await store.get('oidc.user:issuer:client')).toBeNull();
    expect(await store.getAllKeys()).toEqual([]);
  });

  it('reports leaking keys without returning token values', async () => {
    const store = new MemoryStateStore();
    await store.set('oidc.user:issuer:client', JSON.stringify({ access_token: 'secret' }));
    expect(store.leakingKeys(valueLooksLikeTokenMaterial)).toEqual(['oidc.user:issuer:client']);
  });
});
