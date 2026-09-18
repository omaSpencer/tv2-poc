import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) {
  throw new Error('Refusing to run admin-search evidence outside an explicit *_test database.');
}

const count = 100_000;
const needle = 'w4selective774';
const client = new Client({ connectionString: databaseUrl });

function collectPlanNodes(node, target = []) {
  target.push({
    nodeType: node['Node Type'],
    indexName: node['Index Name'] ?? null,
    planRows: node['Plan Rows'],
    actualRows: node['Actual Rows'],
    actualTotalTime: node['Actual Total Time'],
  });
  for (const child of node.Plans ?? []) collectPlanNodes(child, target);
  return target;
}

await client.connect();
try {
  await client.query('begin');
  await client.query(`
    insert into content (
      id, slug, title, summary, category, media_asset_id, tags, status, version,
      created_at, updated_at, published_at, withdrawn_at, created_by, updated_by
    )
    select
      ('f4' || lpad(to_hex(series), 30, '0'))::uuid,
      case when series = 1776 then 'w4selective774-slug' else 'w4-item-' || series end,
      case when series = 774 then 'W4 selective w4selective774 title' else left(repeat('W4 synthetic catalogue entry ', 8) || series, 200) end,
      repeat('Deterministic W4 evidence summary ', 14),
      case when series % 6 = 0 then 'film' else 'sorozat' end,
      'w4-media-' || series,
      array['w4', 'synthetic', 'group-' || (series % 20)],
      'draft', 1,
      clock_timestamp() - (series || ' milliseconds')::interval,
      clock_timestamp() - (series || ' milliseconds')::interval,
      null, null, 'w4-evidence', 'w4-evidence'
    from generate_series(1, $1) as series
  `, [count]);
  await client.query('analyze content');

  const explain = await client.query(`
    explain (analyze, buffers, format json)
    select id, title, slug, category, status, version, updated_at, updated_by, published_at
    from content
    where status = 'draft'
      and category = 'film'
      and (title ilike $1 escape '\\' or slug ilike $1 escape '\\')
      and (updated_at < $2::timestamptz or (updated_at = $2::timestamptz and id < $3::uuid))
    order by updated_at desc, id desc
    limit 21
  `, [`%${needle}%`, '2999-01-01T00:00:00.000Z', 'ffffffff-ffff-4fff-bfff-ffffffffffff']);

  const report = explain.rows[0]['QUERY PLAN'][0];
  const nodes = collectPlanNodes(report.Plan);
  const indexNames = nodes.map(node => node.indexName).filter(Boolean);
  const accepted = nodes.some(node => node.nodeType === 'BitmapOr')
    && indexNames.includes('content_admin_title_trgm_idx')
    && indexNames.includes('content_admin_slug_trgm_idx');
  const output = {
    measuredAt: new Date().toISOString(),
    database: databaseName,
    rowsInserted: count,
    queryShape: 'title ILIKE OR slug ILIKE + status/category/cursor + updated_at/id order + limit',
    planningTimeMs: report['Planning Time'],
    executionTimeMs: report['Execution Time'],
    planNodes: nodes,
    accepted,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!accepted) throw new Error('Production-shaped admin query did not use both trigram indexes through BitmapOr.');
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end();
}
