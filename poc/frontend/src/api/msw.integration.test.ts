import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { searchCatalog } from './search';
import { isApiProblemError } from './types';
import { problemFixture } from '../test/fixtures/api';
import { server } from '../test/server';

describe('MSW HTTP contract boundary', () => {
  it('parses a typed search success through the real API client', async () => {
    const response = await searchCatalog('teszt', { limit: 20, offset: 0 });
    expect(response.status).toBe(200);
    expect(response.correlationId).toBe('test-search');
    expect(response.data.items).toEqual([]);
  });

  it('preserves exact problem status, code, fields and correlation id', async () => {
    server.use(http.get('*/api/catalog/search', () => HttpResponse.json(
      problemFixture(422, 'validation_failed', ['q']),
      { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
    )));
    const error = await searchCatalog('x').catch((caught: unknown) => caught);
    expect(isApiProblemError(error)).toBe(true);
    if (!isApiProblemError(error)) return;
    expect(error.problem).toMatchObject({ status: 422, code: 'validation_failed', fields: ['q'] });
    expect(error.correlationId).toBe('test-validation_failed');
  });

  it('keeps a network failure distinct from a problem response', async () => {
    server.use(http.get('*/api/catalog/search', () => HttpResponse.error()));
    const error = await searchCatalog('x').catch((caught: unknown) => caught);
    expect(isApiProblemError(error)).toBe(false);
    expect(error).toBeInstanceOf(TypeError);
  });
});
