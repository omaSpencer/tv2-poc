/**
 * M0-12/13/14 – the shared contracts are checked as contracts, not as prose.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  CONTENT_EVENT_V1_EXAMPLES, contentEventV1JsonSchema, contentEventV1Schema, EVENT_PAYLOAD_STATUS,
  NATS_DURABLES, NATS_QUARANTINE_STREAM, NATS_STREAM, NATS_SUBJECT,
} from '../../src/contracts/events.js';
import { ERROR_CODES } from '../../src/contracts/errors.js';
import { permissionsForRoles, ROLE_PERMISSIONS, ROUTE_MATRIX } from '../../src/contracts/permissions.js';
import { slugify, slugCandidates } from '../../src/content/slug.js';
import { DEMO_CONTENT, DEMO_SLUG } from '../fixtures/demo.js';

describe('event contract v1', () => {
  it('accepts both published examples and rejects a mismatched pair', () => {
    for (const example of CONTENT_EVENT_V1_EXAMPLES) {
      expect(contentEventV1Schema.safeParse(example).success).toBe(true);
    }
    const [published] = CONTENT_EVENT_V1_EXAMPLES;
    expect(contentEventV1Schema.safeParse({ ...published, payload: { status: 'withdrawn' } }).success).toBe(false);
    expect(contentEventV1Schema.safeParse({ ...published, schemaVersion: 2 }).success).toBe(false);
    expect(contentEventV1Schema.safeParse({ ...published, eventType: 'content.updated' }).success).toBe(false);
    expect(contentEventV1Schema.safeParse({ ...published, actorSub: 'editor-1' }).success).toBe(false);
    expect(contentEventV1Schema.safeParse({ ...published, correlationId: 'nem jó' }).success).toBe(false);
  });

  it('keeps the published JSON Schema file in sync with the runtime validator', async () => {
    const file = JSON.parse(await readFile(new URL('../../src/contracts/events.v1.schema.json', import.meta.url), 'utf8'));
    const { $id, title, examples, ...generated } = file;
    expect(generated).toEqual(contentEventV1JsonSchema());
    expect(examples).toEqual(CONTENT_EVENT_V1_EXAMPLES);
    expect($id).toBe('urn:indaplay:poc:events:content-changed:v1');
    expect(title).toContain('schema version 1');
  });

  it('fixes the transport names the M3 adapter has to create', () => {
    expect(NATS_STREAM).toBe('CONTENT');
    expect(NATS_SUBJECT).toBe('poc.content.changed.v1');
    expect(NATS_QUARANTINE_STREAM).toBe('CONTENT_DLQ');
    expect(NATS_DURABLES).toEqual(['search-a-v1', 'search-b-v1']);
    expect(EVENT_PAYLOAD_STATUS).toEqual({ 'content.published': 'published', 'content.withdrawn': 'withdrawn' });
  });
});

describe('permission contract', () => {
  it('grants exactly the documented permissions per role', () => {
    expect([...permissionsForRoles(['viewer'])]).toEqual([]);
    expect([...permissionsForRoles(['editor'])].sort()).toEqual(['content:read', 'content:write']);
    expect([...permissionsForRoles(['publisher'])].sort()).toEqual([
      'content:publish', 'content:read', 'content:write', 'ops:read', 'ops:write',
    ]);
    // Multiple groups union; an unknown group adds nothing.
    expect([...permissionsForRoles(['viewer', 'editor', 'ismeretlen'])].sort()).toEqual(['content:read', 'content:write']);
    expect(ROLE_PERMISSIONS.publisher).toContain('ops:read');
    expect(ROLE_PERMISSIONS.publisher).toContain('ops:write');
  });

  it('requires a permission for every admin route and none for the catalog', () => {
    for (const rule of ROUTE_MATRIX) {
      if (rule.path.startsWith('/admin')) expect(rule.access).not.toBeNull();
      if (rule.path.startsWith('/catalog')) expect(rule.access).toBeNull();
    }
    expect(ROUTE_MATRIX.find(rule => rule.path === '/admin/processing-status')?.access).toBe('ops:read');
  });
});

describe('error code contract', () => {
  it('maps every documented code to its documented status', () => {
    expect(ERROR_CODES).toMatchObject({
      invalid_json: 400, unauthenticated: 401, forbidden: 403, content_not_found: 404,
      version_conflict: 409, content_already_published: 409, content_not_published: 409,
      content_not_editable: 409, slug_conflict: 409, validation_failed: 422,
      internal_error: 500, dependency_unavailable: 503, search_unavailable: 503,
    });
  });
});

describe('slug rules', () => {
  it('transliterates the Hungarian demo title exactly as documented', () => {
    expect(slugify(DEMO_CONTENT.title)).toBe(DEMO_SLUG);
    expect(slugify('Őrült Űrhajósok — Első Évad')).toBe('orult-urhajosok-elso-evad');
    expect(slugify('★★★')).toBe('');
    expect(slugify('  több   szóköz  ')).toBe('tobb-szokoz');
  });

  it('offers fifty candidates that all fit the length limit', () => {
    const candidates = slugCandidates('A'.repeat(200));
    expect(candidates).toHaveLength(50);
    expect(new Set(candidates).size).toBe(50);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(80);
      expect(candidate.endsWith('-')).toBe(false);
    }
    expect(slugCandidates('★')).toEqual([]);
  });
});
