import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { parseContentId, toPublicView, type PublicContentView } from '../contracts/http.js';
import { jsonResponse, problemResponse, rateLimitedResponse } from '../contracts/openapi.js';
import { ContentService } from './content.service.js';

/** DECISIONS D06: readable without a login. It grants no playback right. */
@ApiTags('catalog')
@Controller('catalog/contents')
export class CatalogContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Public detail of currently published content' })
  @ApiParam({ name: 'id', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({
    status: 200,
    ...jsonResponse('PublicContentView', 'Public fields only; no actor, media asset id or audit data'),
  })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found: not published or unknown id') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed when the id is not a UUID') })
  @ApiResponse({ status: 429, ...rateLimitedResponse() })
  async get(@Param('id') id: string): Promise<PublicContentView> {
    return toPublicView(await this.service.findPublished(parseContentId(id)));
  }
}
