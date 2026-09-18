import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CONTENT_CATEGORIES } from '../schema.js';
import {
  normalizeCatalogSearchQuery, SEARCH_QUERY_LIMITS, type CatalogSearchView,
} from '../contracts/search.js';
import { jsonResponse, problemResponse, rateLimitedResponse } from '../contracts/openapi.js';
import { SearchService } from './search.service.js';

/**
 * GET /catalog/search (M4-06). Public, like the catalog detail route: readable
 * without a login, and it grants no playback right. A present but invalid
 * Authorization header still fails with 401 — that rule belongs to the identity
 * boundary and applies to every route, public ones included.
 *
 * The query object is taken as `unknown` on purpose. `normalizeCatalogSearchQuery`
 * is the single validator, exactly as `normalize*Command` is for request bodies;
 * a DTO class here would be a second rule set that could drift from it.
 */
@ApiTags('catalog')
@Controller('catalog')
export class CatalogSearchController {
  constructor(@Inject(SearchService) private readonly service: SearchService) {}

  @Get('search')
  @ApiOperation({ summary: 'Public full-text search over currently published content' })
  @ApiQuery({
    name: 'q',
    required: true,
    schema: { type: 'string', minLength: SEARCH_QUERY_LIMITS.qMin, maxLength: SEARCH_QUERY_LIMITS.qMax },
    description: 'Search term; trimmed, 1–200 characters.',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    schema: { type: 'string', enum: [...CONTENT_CATEGORIES] },
    description: 'Optional exact category match, re-checked against the database.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: SEARCH_QUERY_LIMITS.limitMin,
      maximum: SEARCH_QUERY_LIMITS.limitMax,
      default: SEARCH_QUERY_LIMITS.limitDefault,
    },
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    schema: {
      type: 'integer',
      minimum: SEARCH_QUERY_LIMITS.offsetMin,
      maximum: SEARCH_QUERY_LIMITS.offsetMax,
      default: SEARCH_QUERY_LIMITS.offsetDefault,
    },
  })
  @ApiResponse({
    status: 200,
    ...jsonResponse(
      'CatalogSearchView',
      'Public fields read from PostgreSQL in index relevance order. '
      + 'estimatedTotalHits is the index estimate and may exceed the number of items returned.',
    ),
  })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated: a present Authorization header failed verification') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed with the offending query parameter names') })
  @ApiResponse({ status: 429, ...rateLimitedResponse() })
  @ApiResponse({ status: 503, ...problemResponse('search_unavailable, or dependency_unavailable when the database is down') })
  async search(@Query() query: unknown): Promise<CatalogSearchView> {
    return this.service.search(normalizeCatalogSearchQuery(query));
  }
}
