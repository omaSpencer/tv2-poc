import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  @ApiResponse({ status: 200, description: 'Process is running' })
  live() { return { status: 'ok', info: {}, error: {}, details: {} }; }

  @Get('ready')
  @ApiOperation({ summary: 'API readiness: PostgreSQL only' })
  @ApiResponse({ status: 200, description: 'PostgreSQL is available' })
  @ApiResponse({ status: 503, description: 'PostgreSQL unavailable; health JSON, not problem+json' })
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
