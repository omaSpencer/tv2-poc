import { z } from 'zod';

const operationSchema = z.enum([
  'health.ready', 'auth.me', 'content.create-complete', 'content.edit', 'content.publish',
  'content.admin-read', 'content.catalog-present', 'content.search-present', 'content.withdraw',
  'content.catalog-absent', 'content.search-absent', 'content.edit-withdrawn', 'content.audit',
  'negative.create-incomplete', 'negative.publish-incomplete', 'negative.create-published',
  'negative.patch-published', 'negative.create-advanced', 'negative.patch-stale',
  'negative.invalid-payload', 'negative.oversized-payload', 'permission.admin-read',
  'permission.create', 'permission.publish', 'permission.missing-token', 'outage.processing', 'outage.search', 'outage.cms-write',
]);

const expectedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), status: z.number().int().min(100).max(599) }).strict(),
  z.object({
    kind: z.literal('problem'),
    status: z.number().int().min(400).max(599),
    code: z.string().min(1),
    fields: z.array(z.string().min(1)).optional(),
    versionRelation: z.literal('expected-less-than-actual').optional(),
  }).strict(),
  z.object({ kind: z.literal('content'), status: z.enum(['draft', 'published', 'withdrawn']), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('catalog'), present: z.boolean() }).strict(),
  z.object({ kind: z.literal('search'), containsContent: z.boolean() }).strict(),
  z.object({ kind: z.literal('identity'), roles: z.array(z.enum(['viewer', 'editor', 'publisher'])), permissions: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal('processing'), routeEligible: z.number().int().min(0).max(2), reachable: z.number().int().min(0).max(2) }).strict(),
  z.object({ kind: z.literal('audit'), sequence: z.array(z.object({ action: z.string(), version: z.number().int().positive() }).strict()) }).strict(),
]);

export const scenarioDefinitionSchema = z.object({
  id: z.enum(['S01', 'S02', 'S03', 'S04', 'S05']),
  version: z.literal(1),
  title: z.string().min(1),
  description: z.string().min(1),
  requiredPermissions: z.array(z.string()),
  preflight: z.object({ authenticated: z.boolean(), backendReady: z.boolean(), searchEnabled: z.boolean() }).strict(),
  steps: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    detail: z.string().min(1),
    mode: z.enum(['automatic', 'manual']),
    operation: operationSchema.optional(),
    expected: z.array(expectedSchema),
    timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
    instruction: z.string().min(1).optional(),
  }).strict()).min(1),
}).strict().superRefine((definition, context) => {
  const ids = new Set<string>();
  definition.steps.forEach((step, index) => {
    if (ids.has(step.id)) context.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: 'Duplicate step id.' });
    ids.add(step.id);
    if (step.mode === 'automatic' && !step.operation) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'operation'], message: 'Automatic steps require an allowlisted operation.' });
    }
    if (step.mode === 'manual' && !step.instruction) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'instruction'], message: 'Manual steps require an instruction.' });
    }
  });
});
