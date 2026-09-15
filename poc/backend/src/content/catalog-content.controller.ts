import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { parseContentId, toPublicView, type PublicContentView } from '../contracts/http.js';
import { ContentService } from './content.service.js';

/** DECISIONS D06: readable without a login. It grants no playback right. */
@ApiTags('catalog')
@Controller('catalog/contents')
export class CatalogContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Public detail of currently published content' })
  @ApiResponse({ status: 200, description: 'Public fields only; no actor, media asset id or audit data' })
  @ApiResponse({ status: 404, description: 'Not published or unknown id' })
  async get(@Param('id') id: string): Promise<PublicContentView> {
    return toPublicView(await this.service.findPublished(parseContentId(id)));
  }
}
