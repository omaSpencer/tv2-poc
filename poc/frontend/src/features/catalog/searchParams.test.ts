import { describe, expect, it } from 'vitest';
import {
  catalogSearchHref,
  parseCatalogSearchParams,
  serializeCatalogSearchParams,
} from './searchParams';

describe('catalog search URL model', () => {
  it('parses and serializes the complete bookmarkable model', () => {
    const parsed = parseCatalogSearchParams(new URLSearchParams(
      'q=%20%C5%91rs%C3%A9g%20&category=film&limit=50&offset=100',
    ));

    expect(parsed).toEqual({ q: 'őrség', category: 'film', limit: 50, offset: 100 });
    expect(serializeCatalogSearchParams(parsed).toString()).toBe(
      'q=%C5%91rs%C3%A9g&category=film&limit=50&offset=100',
    );
    expect(catalogSearchHref(parsed)).toContain('/catalog/search?q=');
  });

  it('normalizes repeated, unknown and out-of-range values to safe defaults', () => {
    const parsed = parseCatalogSearchParams(new URLSearchParams(
      'q=els%C5%91&q=m%C3%A1sodik&category=secret&limit=100&offset=1001&unknown=x',
    ));

    expect(parsed).toEqual({ q: '', category: null, limit: 20, offset: 0 });
    expect(serializeCatalogSearchParams(parsed).toString()).toBe('limit=20&offset=0');
  });

  it('trims and bounds a query to the backend contract', () => {
    const parsed = parseCatalogSearchParams(new URLSearchParams({ q: `  ${'a'.repeat(220)}  ` }));
    expect(parsed.q).toHaveLength(200);
    expect(parsed.q).toBe('a'.repeat(200));
  });
});
