import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 5, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000,
      statement_timeout: 1000, query_timeout: 1500,
    });
    // pg emits idle-connection errors. Never log the raw connection/error object.
    this.pool.on('error', () => {});
  }
  async ready(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; }
    catch { return false; }
  }
  async onApplicationShutdown(): Promise<void> { await this.pool.end(); }
}
