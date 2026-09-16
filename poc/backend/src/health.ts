import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { jsonResponse } from './contracts/openapi.js';
import { DatabaseService } from './database.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  @ApiResponse({ status: 200, ...jsonResponse('HealthView', 'Process is running') })
  live() { return { status: 'ok', info: {}, error: {}, details: {} }; }

  @Get('ready')
  @ApiOperation({ summary: 'API readiness: PostgreSQL only' })
  @ApiResponse({ status: 200, ...jsonResponse('HealthView', 'PostgreSQL is available') })
  @ApiResponse({
    status: 503,
    ...jsonResponse('HealthView', 'PostgreSQL unavailable; health JSON, not problem+json'),
  })
  async ready() {
    const up = await this.database.ready();
    const postgres = { status: up ? 'up' : 'down' };
    const body = {
      status: up ? 'ok' : 'error',
      info: up ? { postgres } : {}, error: up ? {} : { postgres }, details: { postgres },
    };
    if (!up) throw new ServiceUnavailableException(body);
    return body;
  }
}
