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
export type MeResponse = Schemas['MeView'];
export type VersionedBody = Schemas['VersionedCommandBody'];
export type SearchResponse = Schemas['CatalogSearchView'];
export type ProcessingStatus = Schemas['ProcessingStatusView'];
export type SearchIndexStatus = Schemas['SearchIndexStatus'];

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

export function isApiProblemError(error: unknown): error is ApiProblemError {
  return error instanceof ApiProblemError;
}

export function hasPermission(
  permissions: readonly string[] | undefined,
  required: AppPermission,
): boolean {
  return (permissions ?? []).includes(required);
}
