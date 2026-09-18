import type { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../src/config.js';
import { ApiError } from '../src/contracts/errors.js';
import {
  localTimeoutStatement,
  MAX_LOCAL_TIMEOUT_MS,
} from '../src/database/local-timeout.js';
import { ApiExceptionFilter, requestBoundary } from '../src/http.js';
import { canonicalIssuer, OidcDiscovery } from '../src/identity/oidc.js';
import { dependencyRead } from '../src/ops/dependency-read.js';
import { startupFailure } from '../src/startup-failure.js';

describe('BE-F2 trust-boundary helpers', () => {
  it('S3 formats only allowlisted, bounded PostgreSQL local timeouts', () => {
    expect(localTimeoutStatement('lock_timeout', 1)).toBe("set local lock_timeout = '1ms'");
    expect(localTimeoutStatement('statement_timeout', MAX_LOCAL_TIMEOUT_MS))
      .toBe(`set local statement_timeout = '${MAX_LOCAL_TIMEOUT_MS}ms'`);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1, MAX_LOCAL_TIMEOUT_MS + 1]) {
      expect(() => localTimeoutStatement('lock_timeout', invalid)).toThrow(RangeError);
    }
  });

  it('S5 applies one trailing-slash issuer rule without changing origin or path', () => {
    expect(canonicalIssuer('https://id.example/application/o/poc'))
      .toBe('https://id.example/application/o/poc/');
    expect(canonicalIssuer('https://id.example/application/o/poc///'))
      .toBe('https://id.example/application/o/poc/');
    expect(canonicalIssuer('https://ID.example/application/o/poc'))
      .not.toBe(canonicalIssuer('https://id.example/application/o/poc'));
    expect(canonicalIssuer('https://id.example/application/o/other'))
      .not.toBe(canonicalIssuer('https://id.example/application/o/poc'));
  });

  it('S5 exposes only a stable diagnostic category for a real issuer mismatch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      issuer: 'https://evil.example/application/o/poc/',
      jwks_uri: 'https://id.example/application/o/poc/jwks',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const discovery = new OidcDiscovery(new ConfigService({
      OIDC_ISSUER_URL: 'https://id.example/application/o/poc/',
      OIDC_AUDIENCE: 'poc-backend-api',
      OIDC_CLOCK_TOLERANCE_S: 30,
      OIDC_HTTP_TIMEOUT_MS: 1000,
    }));
    try {
      await expect(discovery.document()).rejects.toMatchObject({
        code: 'dependency_unavailable', category: 'issuer_mismatch',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('S6 emits allowlisted bootstrap categories and never serializes raw error details', () => {
    const secret = 'postgresql://admin:secret@db.internal/private';
    const address = Object.assign(new Error(`listen failed at ${secret}`), { code: 'EADDRINUSE' });
    const unknown = new Error(`token=${secret}`);
    expect(startupFailure(address)).toEqual({
      event: 'startup_failed', code: 'bootstrap_failed', category: 'listen_address_in_use',
    });
    expect(startupFailure(unknown)).toEqual({
      event: 'startup_failed', code: 'bootstrap_failed', category: 'unknown',
    });
    expect(startupFailure(new ConfigurationError(['DATABASE_URL']))).toEqual({
      event: 'startup_failed', code: 'invalid_configuration', keys: ['DATABASE_URL'],
    });
    expect(JSON.stringify([startupFailure(address), startupFailure(unknown)])).not.toContain(secret);
  });

  it('C2 maps recognized connection failures but preserves programming errors', async () => {
    await expect(dependencyRead(async () => {
      throw Object.assign(new Error('socket failed'), { code: 'ECONNREFUSED' });
    })).rejects.toMatchObject({ code: 'dependency_unavailable' });

    const bug = new TypeError('cannot read property from undefined');
    await expect(dependencyRead(async () => { throw bug; })).rejects.toBe(bug);
    await expect(dependencyRead(async () => {
      throw new ApiError('search_unavailable', 'Search is unavailable.');
    })).rejects.toMatchObject({ code: 'search_unavailable' });
  });

  it('C2 shapes an escaped programming error as internal_error', () => {
    let document: unknown;
    const response = {
      locals: { correlationId: 'program-error-test' },
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn((value: unknown) => { document = value; }),
    } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ path: '/admin/search/reindex-preflight' } as Request),
        getResponse: () => response,
      }),
    } as ArgumentsHost;
    new ApiExceptionFilter().catch(new TypeError('synthetic bug'), host);
    expect(document).toMatchObject({ code: 'internal_error', status: 500, correlationId: 'program-error-test' });
  });

  it('O2 logs only the allowlisted request metadata', () => {
    const info = vi.fn();
    let finish: (() => void) | undefined;
    const response = {
      locals: {},
      statusCode: 204,
      setHeader: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'finish') finish = listener;
      }),
    } as unknown as Response;
    const request = {
      method: 'POST',
      path: '/catalog/search',
      originalUrl: '/catalog/search?q=secret-query',
      headers: {
        'x-correlation-id': 'safe-correlation',
        authorization: 'Bearer secret-token',
      },
      body: { password: 'secret-password' },
    } as unknown as Request;
    const next = vi.fn();

    requestBoundary({ info } as unknown as Logger, { blockAdmin: false })(request, response, next);
    finish?.();

    expect(next).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith({
      event: 'http_request', correlationId: 'safe-correlation', method: 'POST', status: 204,
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toMatch(/catalog|secret-query|authorization|secret-token|password|secret-password/i);
  });
});
