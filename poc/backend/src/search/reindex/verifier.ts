import type { PoolClient } from 'pg';
import type { MeiliIndexAdapter } from '../meili.adapter.js';

export type VerificationResult = {
  matches: boolean;
  expected: number;
  actual: number;
  missing: string[];
  extra: string[];
  versionMismatch: string[];
};

export class ReindexVerifier {
  constructor(private readonly pageSize: number) {}

  async verify(client: PoolClient, adapter: MeiliIndexAdapter): Promise<VerificationResult> {
    const rows = await client.query<{ id: string; version: number }>(`
      select id, version from content where status = 'published' order by id
    `);
    const expected = new Map(rows.rows.map(row => [row.id, row.version]));
    const actual = new Map<string, number>();
    for (let offset = 0;; offset += this.pageSize) {
      const page = await adapter.projectionPage(adapter.indexUid, offset, this.pageSize);
      for (const document of page) actual.set(document.id, document.aggregateVersion);
      if (page.length < this.pageSize) break;
    }
    const missing: string[] = [];
    const extra: string[] = [];
    const versionMismatch: string[] = [];
    for (const [id, version] of expected) {
      if (!actual.has(id)) missing.push(id);
      else if (actual.get(id) !== version) versionMismatch.push(id);
    }
    for (const id of actual.keys()) if (!expected.has(id)) extra.push(id);
    return {
      matches: missing.length === 0 && extra.length === 0 && versionMismatch.length === 0,
      expected: expected.size,
      actual: actual.size,
      missing,
      extra,
      versionMismatch,
    };
  }
}
