import type { components } from './generated/backend';

/**
 * Backend request/response shapes come from the committed OpenAPI snapshot.
 * Keep only frontend-specific helpers and narrowed convenience aliases here.
 */
type Schemas = components['schemas'];

export type ProblemDocument = Schemas['ProblemDocument'];
export type HealthBody = Schemas['HealthView'];
export type PublicContentView = Schemas['PublicContentView'];
export type AdminContentView = Schemas['AdminContentView'];
export type AdminContentListItem = Schemas['AdminContentListItem'];
export type AdminContentListView = Schemas['AdminContentListView'];
export type ContentAuditView = Schemas['ContentAuditView'];
export type ContentAuditListView = Schemas['ContentAuditListView'];
export type MeResponse = Schemas['MeView'];
export type VersionedBody = Schemas['VersionedCommandBody'];
export type SearchResponse = Schemas['CatalogSearchView'];
export type ProcessingStatus = Schemas['ProcessingStatusView'];
export type SearchIndexStatus = Schemas['SearchIndexStatus'];
export type OperatorActionView = Schemas['OperatorActionView'];
export type ReindexPreflightView = Schemas['ReindexPreflightView'];
export type ReindexRunView = Schemas['ReindexRunView'];
export type QuarantineItemView = Schemas['QuarantineItemView'];
export type QuarantineListView = Schemas['QuarantineListView'];
export type StartReindexBody = Schemas['StartReindexBody'];
export type ReplayQuarantineBody = Schemas['ReplayQuarantineBody'];
export type StartContentRepairBody = Schemas['StartContentRepairBody'];

export type ContentCategory = NonNullable<AdminContentView['category']>;
export type ContentStatus = AdminContentView['status'];
export type AppPermission = MeResponse['permissions'][number];
export type AppRole = MeResponse['roles'][number];

// The backend accepts category as a string at the JSON-schema boundary and
// applies the enum in its normalisation path. Narrow it for frontend forms.
export type CreateContentBody = Omit<Schemas['CreateContentBody'], 'category'> & {
  category?: ContentCategory | null;
};

export type PatchContentBody = Omit<Schemas['PatchContentBody'], 'category'> & {
  category?: ContentCategory | null;
};

export type SearchHit = PublicContentView;

export class ApiProblemError extends Error {
  readonly name = 'ApiProblemError';
  readonly problem: ProblemDocument;
  readonly correlationId: string;

  constructor(problem: ProblemDocument, correlationId: string) {
    super(`${problem.code}: ${problem.detail}`);
    this.problem = problem;
    this.correlationId = correlationId;
  }
}

export const API_TIMEOUT_CODE = 'request_timeout' as const;

export class ApiTimeoutError extends Error {
  readonly name = 'ApiTimeoutError';
  readonly code = API_TIMEOUT_CODE;

  constructor(message = 'A kérés időtúllépés miatt megszakadt.') {
    super(message);
  }
}

export function isApiTimeoutError(error: unknown): error is ApiTimeoutError {
  if (error instanceof ApiTimeoutError) return true;
  if (!error || typeof error !== 'object') return false;
  return (
    'name' in error
    && error.name === 'ApiTimeoutError'
    && 'code' in error
    && error.code === API_TIMEOUT_CODE
  );
}

export function isApiProblemError(error: unknown): error is ApiProblemError {
  if (error instanceof ApiProblemError) return true;
  if (!error || typeof error !== 'object' || !('problem' in error)) return false;
  const problem = error.problem;
  return Boolean(
    problem && typeof problem === 'object' && 'code' in problem && typeof problem.code === 'string'
    && 'status' in problem && typeof problem.status === 'number'
    && 'detail' in problem && typeof problem.detail === 'string'
    && 'correlationId' in problem && typeof problem.correlationId === 'string'
    && 'correlationId' in error && typeof error.correlationId === 'string',
  );
}
