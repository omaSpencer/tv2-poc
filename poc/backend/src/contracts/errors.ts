/**
 * D-M0-09 – the shared error vocabulary. Every business failure leaves the
 * application as an `ApiError`; the HTTP filter is the only place that turns
 * one into a problem+json body. Values never travel back to the client, only
 * field names and the stable code.
 */
export const ERROR_CODES = {
  invalid_json: 400,
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  content_not_found: 404,
  not_found: 404,
  version_conflict: 409,
  content_already_published: 409,
  content_not_published: 409,
  content_not_editable: 409,
  slug_conflict: 409,
  idempotency_conflict: 409,
  reindex_already_running: 409,
  quarantine_schema_invalid: 409,
  payload_too_large: 413,
  rate_limited: 429,
  validation_failed: 422,
  target_confirmation_required: 422,
  operation_not_found: 404,
  quarantine_not_found: 404,
  internal_error: 500,
  dependency_unavailable: 503,
  search_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Extra members allowed in a problem document. Names and numbers only. */
export type ProblemExtras = {
  fields?: string[];
  expectedVersion?: number;
  actualVersion?: number;
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly detail: string,
    readonly extras: ProblemExtras = {},
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ApiError';
    this.status = ERROR_CODES[code];
  }
}

export const validationFailed = (fields: string[]) =>
  new ApiError('validation_failed', 'One or more fields are invalid.', {
    fields: [...new Set(fields)].sort(),
  });

export const versionConflict = (expectedVersion: number, actualVersion: number) =>
  new ApiError('version_conflict', 'The expected version does not match the stored version.', {
    expectedVersion,
    actualVersion,
  });

export const contentNotFound = () => new ApiError('content_not_found', 'No content exists for the given id.');

export const slugConflict = () => new ApiError('slug_conflict', 'The slug is already taken by another content.');
