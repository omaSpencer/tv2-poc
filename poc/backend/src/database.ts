import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema.js';
import { ApiError } from './contracts/errors.js';

export type Database = NodePgDatabase<typeof schema>;
/** The connection a business transaction runs on; savepoints nest from here. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

/** The driver error may be wrapped by the query builder; walk the cause chain. */
function* causes(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth += 1) {
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

/** PostgreSQL unique violation; the constraint name tells the cases apart. */
export function uniqueViolation(error: unknown): string | null {
  for (const candidate of causes(error)) {
    if (candidate.code !== '23505') continue;
    return typeof candidate.constraint === 'string' ? candidate.constraint : '';
  }
  return null;
}

const CONNECTION_FAILURE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE',
  '08000', '08003', '08006', '08001', '08004', '57P01', '57P02', '57P03', '53300',
]);

/** A dependency outage is a 503, not a leaked internal error. */
export function isConnectionFailure(error: unknown): boolean {
  for (const candidate of causes(error)) {
    if (typeof candidate.code === 'string' && CONNECTION_FAILURE_CODES.has(candidate.code)) return true;
    if (typeof candidate.message === 'string' && /timeout exceeded when trying to connect|Connection terminated/i.test(candidate.message)) {
      return true;
    }
  }
  return false;
}

export function isLockTimeout(error: unknown): boolean {
  for (const candidate of causes(error)) {
    if (candidate.code === '55P03') return true;
  }
  return false;
}

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  readonly db: Database;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 10, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000,
      // Server-side only: SET LOCAL can extend the timeout for recovery operations.
      statement_timeout: 5000,
    });
    // pg emits idle-connection errors. Never log the raw connection/error object.
    this.pool.on('error', error => {
      const candidate = (error as { code?: unknown }).code;
      // Only recognized connection codes or SQLSTATEs; never arbitrary error text.
      const code = typeof candidate === 'string'
        && (CONNECTION_FAILURE_CODES.has(candidate) || /^[0-9A-Z]{5}$/.test(candidate))
        ? candidate : 'unknown';
      process.stderr.write(JSON.stringify({ event: 'pg_pool_error', code }) + '\n');
    });
    this.db = drizzle(this.pool, { schema });
  }

  async ready(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; }
    catch { return false; }
  }

  /**
   * One business transaction on one connection. Content, audit and outbox all
   * receive this handle; nothing commits separately and nothing checks out a
   * second pooled connection mid-operation.
   */
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isConnectionFailure(error)) {
        throw new ApiError('dependency_unavailable', 'The database is currently unavailable.');
      }
      if (isLockTimeout(error)) {
        throw new ApiError('dependency_unavailable', 'A recovery operation is temporarily blocking content publication.');
      }
      throw error;
    }
  }

  /**
   * A session-scoped operation. Reindex advisory locks and its repeatable-read
   * snapshot must stay on one PostgreSQL connection; a pooled query helper
   * cannot provide that guarantee.
   */
  async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> { await this.pool.end(); }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
