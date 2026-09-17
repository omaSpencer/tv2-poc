import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, validationFailed } from './errors.js';
import { OPERATOR_ACTION_KINDS, OPERATOR_ACTION_STATES, type OperatorActionKind } from '../schema.js';

export const operatorReasonSchema = z.string().trim().min(3).max(500);
export const idempotencyKeySchema = z.uuid();

export const reindexTargetSchema = z.strictObject({
  index: z.enum(['a', 'b']),
  allowSearchOutage: z.boolean(),
  /** Persisted for the async runner, but omitted from every API view and log. */
  confirmationTarget: z.string().min(1).max(128).nullable(),
});

export const quarantineReplayTargetSchema = z.strictObject({
  sequence: z.number().int().positive(),
});

export const contentRepairTargetSchema = z.strictObject({
  contentId: z.uuid(),
  target: z.enum(['a', 'b', 'both']),
});

export const reindexResultSchema = z.strictObject({
  runId: z.uuid(),
  index: z.enum(['a', 'b']),
  snapshotStreamSequence: z.number().int().nonnegative(),
  catchUpStreamSequence: z.number().int().nonnegative(),
  expectedDocuments: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const quarantineReplayResultSchema = z.strictObject({
  sequence: z.number().int().positive(),
  quarantineId: z.uuid(),
  originalSequence: z.number().int().positive(),
  replaySequence: z.number().int().positive(),
  duplicate: z.boolean(),
});

export const contentRepairResultSchema = z.strictObject({
  contentId: z.uuid(),
  tasks: z.array(z.strictObject({
    alias: z.enum(['a', 'b']),
    taskUid: z.number().int().nonnegative(),
  })),
});

const TARGET_SCHEMAS = {
  reindex: reindexTargetSchema,
  quarantine_replay: quarantineReplayTargetSchema,
  content_repair: contentRepairTargetSchema,
} as const;

const RESULT_SCHEMAS = {
  reindex: reindexResultSchema,
  quarantine_replay: quarantineReplayResultSchema,
  content_repair: contentRepairResultSchema,
} as const;

export type OperatorActionTarget =
  | z.infer<typeof reindexTargetSchema>
  | z.infer<typeof quarantineReplayTargetSchema>
  | z.infer<typeof contentRepairTargetSchema>;

export type OperatorActionResult =
  | z.infer<typeof reindexResultSchema>
  | z.infer<typeof quarantineReplayResultSchema>
  | z.infer<typeof contentRepairResultSchema>;

export function parseIdempotencyKey(value: unknown): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw validationFailed(['Idempotency-Key']);
  return parsed.data;
}

export function normalizeReason(value: unknown): string {
  const parsed = operatorReasonSchema.safeParse(value);
  if (!parsed.success) throw validationFailed(['reason']);
  return parsed.data;
}

export function parseOperatorActionTarget(kind: OperatorActionKind, value: unknown): OperatorActionTarget {
  const parsed = TARGET_SCHEMAS[kind].safeParse(value);
  if (!parsed.success) throw new ApiError('internal_error', 'The stored operator action target is invalid.');
  return parsed.data;
}

export function parseOperatorActionResult(kind: OperatorActionKind, value: unknown): OperatorActionResult {
  const parsed = RESULT_SCHEMAS[kind].safeParse(value);
  if (!parsed.success) throw new ApiError('internal_error', 'The operator action produced an invalid result.');
  return parsed.data;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function operatorRequestFingerprint(
  kind: OperatorActionKind,
  reason: string,
  target: OperatorActionTarget,
): string {
  return createHash('sha256').update(canonical({ kind, reason, target })).digest('hex');
}

export const operatorActionKindSchema = z.enum(OPERATOR_ACTION_KINDS);
export const operatorActionStateSchema = z.enum(OPERATOR_ACTION_STATES);

const startReindexBodySchema = z.strictObject({
  index: z.enum(['a', 'b']),
  reason: operatorReasonSchema,
  allowSearchOutage: z.boolean().optional().default(false),
  confirmTarget: z.string().trim().min(1).max(128).optional(),
});

const replayBodySchema = z.strictObject({ reason: operatorReasonSchema });

const repairBodySchema = z.strictObject({
  contentId: z.uuid(),
  target: z.enum(['a', 'b', 'both']),
  reason: operatorReasonSchema,
});

function normalize<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map(issue => String(issue.path[0] ?? 'body'));
  throw validationFailed(fields);
}

export const normalizeStartReindexBody = (value: unknown) => normalize(startReindexBodySchema, value);
export const normalizeReplayBody = (value: unknown) => normalize(replayBodySchema, value);
export const normalizeRepairBody = (value: unknown) => normalize(repairBodySchema, value);

export { startReindexBodySchema, replayBodySchema, repairBodySchema };

export const QUARANTINE_LIST_LIMITS = { default: 50, min: 1, max: 100 } as const;

export function encodeQuarantineCursor(beforeSequence: number): string {
  return Buffer.from(JSON.stringify({ v: 1, beforeSequence }), 'utf8').toString('base64url');
}

export function parseQuarantineListQuery(params: URLSearchParams): { limit: number; beforeSequence: number | null } {
  const errors = new Set<string>();
  for (const key of params.keys()) if (key !== 'limit' && key !== 'cursor') errors.add(key);
  const limits = params.getAll('limit');
  const cursors = params.getAll('cursor');
  if (limits.length > 1) errors.add('limit');
  if (cursors.length > 1) errors.add('cursor');
  const rawLimit = limits[0];
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === ''
    ? QUARANTINE_LIST_LIMITS.default
    : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < QUARANTINE_LIST_LIMITS.min || limit > QUARANTINE_LIST_LIMITS.max) {
    errors.add('limit');
  }
  let beforeSequence: number | null = null;
  if (cursors[0]) {
    try {
      const decoded = JSON.parse(Buffer.from(cursors[0], 'base64url').toString('utf8')) as Record<string, unknown>;
      if (decoded.v !== 1 || !Number.isSafeInteger(decoded.beforeSequence) || Number(decoded.beforeSequence) < 1) {
        errors.add('cursor');
      } else {
        beforeSequence = Number(decoded.beforeSequence);
      }
    } catch {
      errors.add('cursor');
    }
  }
  if (errors.size > 0) throw validationFailed([...errors]);
  return { limit, beforeSequence };
}
