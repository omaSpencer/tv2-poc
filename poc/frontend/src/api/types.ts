/** Shared API types aligned with backend contracts (read-only mirror for the playground). */

export type ProblemDocument = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  correlationId: string;
  fields?: string[];
  expectedVersion?: number;
  actualVersion?: number;
};

export type HealthBody = {
  status: string;
  info: Record<string, unknown>;
  error: Record<string, unknown>;
  details: Record<string, unknown>;
};

export type ContentCategory = 'film' | 'sorozat' | 'hir' | 'sport' | 'szorakozas' | 'egyeb';
export type ContentStatus = 'draft' | 'published' | 'withdrawn';
export type AppPermission = 'content:read' | 'content:write' | 'content:publish' | 'ops:read';
export type AppRole = 'viewer' | 'editor' | 'publisher';

/** D-M0-04b public catalog view – no actor, mediaAssetId, audit. */
export type PublicContentView = {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  category: ContentCategory | null;
  tags: string[];
  publishedAt: string | null;
};

/** Editorial view including mediaAssetId and version (M1). */
export type AdminContentView = {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  category: ContentCategory | null;
  mediaAssetId: string | null;
  tags: string[];
  status: ContentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  withdrawnAt: string | null;
  createdBy: string;
  updatedBy: string;
};

/** M2 `GET /me` – no email, groups, or raw token. */
export type MeResponse = {
  sub: string;
  roles: AppRole[];
  permissions: AppPermission[];
  expiresAt: string;
};

export type CreateContentBody = {
  title: string;
  slug?: string | null;
  summary?: string | null;
  category?: ContentCategory | null;
  mediaAssetId?: string | null;
  tags?: string[];
};

export type PatchContentBody = {
  expectedVersion: number;
  title?: string | null;
  slug?: string | null;
  summary?: string | null;
  category?: ContentCategory | null;
  mediaAssetId?: string | null;
  tags?: string[];
};

export type VersionedBody = { expectedVersion: number };

/** M4 search – fields stay loose until the backend contract is final. */
export type SearchHit = PublicContentView & {
  aggregateVersion?: number;
};

export type SearchResponse = {
  items: SearchHit[];
  total?: number;
  limit?: number;
  offset?: number;
  source?: string;
  truncatedByDbFilter?: boolean;
};

/** M3 processing-status – optional fields until the endpoint ships. */
export type ProcessingStatus = {
  outbox?: {
    pending?: number;
    oldestAgeSeconds?: number | null;
  };
  relay?: {
    status?: string;
  };
  indexes?: Record<
    string,
    {
      lag?: number | null;
      status?: string;
      rebuilding?: boolean;
    }
  >;
  [key: string]: unknown;
};

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
