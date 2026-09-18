import { describe, expect, it } from 'vitest';
import {
  browserWebStorageLeaksTokenMaterial,
  cookieHeaderLeaksTokenMaterial,
  valueLooksLikeTokenMaterial,
  webStorageLeaksTokenMaterial,
} from './storageSentinel';

describe('storage sentinel', () => {
  it('allows PKCE state without treating the verifier as a token', () => {
    sessionStorage.setItem('oidc.pkce-state', JSON.stringify({
      id: 'pkce-state',
      code_verifier: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      request_type: 'si:r',
    }));
    expect(webStorageLeaksTokenMaterial(sessionStorage)).toEqual([]);
    expect(browserWebStorageLeaksTokenMaterial()).toEqual([]);
  });

  it('flags serialized OIDC User objects and JWT-shaped values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature-signature';
    sessionStorage.setItem('oidc.user:issuer:client', JSON.stringify({
      access_token: jwt,
      refresh_token: 'refresh-secret',
      id_token: jwt,
    }));
    localStorage.setItem('stray', jwt);
    expect(webStorageLeaksTokenMaterial(sessionStorage)).toEqual(['oidc.user:issuer:client']);
    expect(webStorageLeaksTokenMaterial(localStorage)).toEqual(['stray']);
    expect(valueLooksLikeTokenMaterial(jwt)).toBe(true);
  });

  it('inspects cookies without returning their values', () => {
    expect(cookieHeaderLeaksTokenMaterial('theme=dark')).toBe(false);
    expect(cookieHeaderLeaksTokenMaterial('session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature-signature')).toBe(true);
  });
});
