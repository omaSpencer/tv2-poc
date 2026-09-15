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
