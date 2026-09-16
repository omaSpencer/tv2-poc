import type { ContentCategory } from '../../api/types';
import { CONTENT_CATEGORIES } from '../../data/demoFixture';

export const CATALOG_PAGE_LIMITS = [10, 20, 50] as const;
export const DEFAULT_CATALOG_PAGE_LIMIT = 20;
export const MAX_CATALOG_OFFSET = 1000;

export type CatalogSearchParams = {
  q: string;
  category: ContentCategory | null;
  limit: (typeof CATALOG_PAGE_LIMITS)[number];
  offset: number;
};

const isCategory = (value: string): value is ContentCategory =>
  (CONTENT_CATEGORIES as readonly string[]).includes(value);

const isPageLimit = (value: number): value is CatalogSearchParams['limit'] =>
  (CATALOG_PAGE_LIMITS as readonly number[]).includes(value);

function singleValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

function parseOffset(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed <= MAX_CATALOG_OFFSET ? parsed : 0;
}

export function parseCatalogSearchParams(params: URLSearchParams): CatalogSearchParams {
  const rawQuery = singleValue(params, 'q');
  const rawCategory = singleValue(params, 'category');
  const rawLimit = singleValue(params, 'limit');
  const parsedLimit = rawLimit !== null && /^\d+$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : NaN;

  return {
    q: (rawQuery ?? '').trim().slice(0, 200),
    category: rawCategory !== null && isCategory(rawCategory) ? rawCategory : null,
    limit: isPageLimit(parsedLimit) ? parsedLimit : DEFAULT_CATALOG_PAGE_LIMIT,
    offset: parseOffset(singleValue(params, 'offset')),
  };
}

export function serializeCatalogSearchParams(value: CatalogSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  if (value.q) params.set('q', value.q);
  if (value.category) params.set('category', value.category);
  params.set('limit', String(value.limit));
  params.set('offset', String(value.offset));
  return params;
}

export function catalogSearchHref(value: CatalogSearchParams): string {
  return `/catalog/search?${serializeCatalogSearchParams(value).toString()}`;
}
