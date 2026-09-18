import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../api/types';
import { ROLE_PERMISSIONS, can } from './permissions';

describe('role permission matrix', () => {
  it('matches the E2E publisher contract, including ops:write', () => {
    expect(ROLE_PERMISSIONS.publisher).toEqual([
      'content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write',
    ]);
  });

  it('keeps viewer identity-only and editor without ops or publish', () => {
    expect(ROLE_PERMISSIONS.viewer).toEqual([]);
    expect(ROLE_PERMISSIONS.editor).toEqual(['content:read', 'content:write']);
  });

  it('uses can() as the single permission helper', () => {
    const me = {
      sub: 'publisher-1',
      roles: ['publisher'] as MeResponse['roles'],
      permissions: [...ROLE_PERMISSIONS.publisher],
      expiresAt: '2030-01-01T00:00:00.000Z',
    };
    expect(can(me, 'ops:write')).toBe(true);
    expect(can({ ...me, permissions: [...ROLE_PERMISSIONS.editor] }, 'ops:write')).toBe(false);
  });
});
