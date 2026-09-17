import { ApiProblemError, type ProblemDocument } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';

export type ApiSuccess<T> = {
  data: T;
  correlationId: string;
  status: number;
};

let lastCorrelationId: string | null = null;

export function getLastCorrelationId(): string | null {
  return lastCorrelationId;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  correlationId?: string;
  auth?: boolean;
  retryAuth?: boolean;
  /** Health ready returns Terminus JSON on 503 – not problem+json. */
  acceptNonOkJson?: boolean;
  idempotencyKey?: string;
};

let currentAccessToken: string | null = null;
let recoverAuthentication: (() => Promise<boolean>) | null = null;

export function setApiAccessToken(token: string | null): void {
  currentAccessToken = token && token.trim().length > 0 ? token.trim() : null;
}

export function setAuthRecoveryHandler(handler: (() => Promise<boolean>) | null): void {
  recoverAuthentication = handler;
}

function isProblemDocument(value: unknown): value is ProblemDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return typeof doc.code === 'string' && typeof doc.status === 'number' && typeof doc.detail === 'string';
}

/**
 * Single fetch boundary: base URL, optional Bearer, correlation id, problem+json parse.
 * Does not invent actor headers – identity arrives only as Bearer after M2.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> {
  return executeRequest(path, options, false);
}

async function executeRequest<T>(
  path: string,
  options: RequestOptions,
  authRetried: boolean,
): Promise<ApiSuccess<T>> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.auth !== false && currentAccessToken) {
    headers.set('Authorization', `Bearer ${currentAccessToken}`);
  }
  if (options.correlationId) headers.set('X-Correlation-Id', options.correlationId);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const correlationId = response.headers.get('X-Correlation-Id') ?? options.correlationId ?? '';
  if (correlationId) lastCorrelationId = correlationId;

  const contentType = response.headers.get('content-type') ?? '';
  const rawText = await response.text();
  let parsed: unknown = undefined;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error(`Non-JSON response (${response.status}): ${rawText.slice(0, 200)}`);
    }
  }

  if (!response.ok) {
    if (options.acceptNonOkJson && parsed !== undefined) {
      return { data: parsed as T, correlationId, status: response.status };
    }
    if (isProblemDocument(parsed)) {
      const problem = {
        ...parsed,
        correlationId: parsed.correlationId || correlationId,
      };
      const error = new ApiProblemError(problem, problem.correlationId);
      if (
        problem.status === 401 &&
        options.auth !== false &&
        options.retryAuth !== false &&
        !authRetried &&
        recoverAuthentication
      ) {
        const recovered = await recoverAuthentication();
        if (recovered && (options.method ?? 'GET') === 'GET') {
          return executeRequest<T>(path, options, true);
        }
      }
      throw error;
    }
    throw new Error(`HTTP ${response.status}${contentType ? ` (${contentType})` : ''}: ${rawText.slice(0, 200)}`);
  }

  return { data: parsed as T, correlationId, status: response.status };
}

export function backendDocsUrl(path = '/docs'): string {
  const origin = (import.meta.env.VITE_BACKEND_ORIGIN as string | undefined) || 'http://127.0.0.1:3000';
  return `${origin.replace(/\/$/, '')}${path}`;
}

export function apiBaseLabel(): string {
  return API_BASE;
}
