/**
 * P7-04 – E2E környezet feloldása és validálása.
 *
 * Precedencia: explicit process env > `frontend/.env.e2e` > dokumentált default.
 * A betöltés soha nem dob: a hiányzó előfeltételeket a global setup gyűjti össze
 * és emberi nyelven jelenti (`support/global-setup.ts`). Titok nem kerül a
 * repóba; a `.env.e2e` a `.gitignore`-ban van.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppPermission, AppRole } from '../../src/api/types';
import { ROLE_PERMISSIONS } from '../../src/auth/permissions';

export const E2E_IDENTITIES = ['poc-viewer', 'poc-editor', 'poc-publisher'] as const;
export type E2eIdentity = (typeof E2E_IDENTITIES)[number];

export type E2eIdentityProfile = {
  identity: E2eIdentity;
  /** A backend `/me` válaszában várt szerepek. */
  roles: readonly AppRole[];
  /** A backend `/me` válaszában várt permissionök (ROLE_PERMISSIONS, backend contract). */
  permissions: readonly AppPermission[];
};

export const IDENTITY_PROFILES: Readonly<Record<E2eIdentity, E2eIdentityProfile>> = {
  'poc-viewer': { identity: 'poc-viewer', roles: ['viewer'], permissions: ROLE_PERMISSIONS.viewer },
  'poc-editor': {
    identity: 'poc-editor',
    roles: ['editor'],
    permissions: ROLE_PERMISSIONS.editor,
  },
  'poc-publisher': {
    identity: 'poc-publisher',
    roles: ['publisher'],
    permissions: ROLE_PERMISSIONS.publisher,
  },
};

export type E2eConfig = {
  /** A Vite frontend origin; az Authentik blueprint strict redirectje erre az originre szól. */
  baseUrl: string;
  /** A NestJS backend origin (a Vite `/api` proxy célpontja). */
  backendOrigin: string;
  /** Authentik publikus URL. */
  authentikUrl: string;
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** A három tesztidentitás közös jelszava (`AUTHENTIK_POC_USER_PASSWORD`). */
  userPassword: string;
  /** Indítsa-e a Playwright a Vite dev szervert (`webServer`). */
  startFrontend: boolean;
  /** Meili A/B kiesés injektálása docker compose-zal. Opt-in. */
  docker: {
    enabled: boolean;
    composeFile: string;
    projectName: string;
    serviceA: string;
    serviceB: string;
  };
};

function parseEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return values;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

const FRONTEND_ROOT = process.cwd();
const fileValues = parseEnvFile(resolve(FRONTEND_ROOT, '.env.e2e'));

function read(key: string, fallback = ''): string {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  const fromFile = fileValues.get(key)?.trim();
  if (fromFile) return fromFile;
  return fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const value = read(key).toLowerCase();
  if (!value) return fallback;
  return value === 'true' || value === '1' || value === 'on';
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildConfig(): E2eConfig {
  const baseUrl = stripTrailingSlash(read('E2E_BASE_URL', 'http://127.0.0.1:5173'));
  const authentikUrl = stripTrailingSlash(read('E2E_AUTHENTIK_URL', 'http://127.0.0.1:9000'));
  return {
    baseUrl,
    backendOrigin: stripTrailingSlash(read('E2E_BACKEND_ORIGIN', 'http://127.0.0.1:3000')),
    authentikUrl,
    // A trailing slash szándékos: az oidc-client-ts az authority alá fűzi a discovery utat.
    issuerUrl: read('E2E_OIDC_ISSUER_URL', `${authentikUrl}/application/o/poc-backend/`),
    clientId: read('E2E_OIDC_CLIENT_ID', 'poc-backend'),
    redirectUri: read('E2E_OIDC_REDIRECT_URI', `${baseUrl}/auth/callback`),
    postLogoutRedirectUri: read('E2E_OIDC_POST_LOGOUT_REDIRECT_URI', `${baseUrl}/login`),
    userPassword: read('E2E_USER_PASSWORD') || read('AUTHENTIK_POC_USER_PASSWORD'),
    startFrontend: readBoolean('E2E_START_FRONTEND', true),
    docker: {
      enabled: readBoolean('E2E_DOCKER_CONTROL', false),
      composeFile: read('E2E_COMPOSE_FILE', resolve(FRONTEND_ROOT, '..', 'backend', 'compose.yaml')),
      projectName: read('E2E_COMPOSE_PROJECT', 'indaplay-poc'),
      serviceA: read('E2E_MEILI_A_SERVICE', 'meilisearch-a'),
      serviceB: read('E2E_MEILI_B_SERVICE', 'meilisearch-b'),
    },
  };
}

export const e2eConfig: E2eConfig = buildConfig();

/** A discovery dokumentum URL-je; a global setup és a login helper is ezt használja. */
export function discoveryUrl(config: E2eConfig = e2eConfig): string {
  return `${stripTrailingSlash(config.issuerUrl)}/.well-known/openid-configuration`;
}

/** A Vite dev szervernek átadott env: a teszt futás nem ír bele a fejlesztői `.env`-be. */
export function frontendServerEnv(config: E2eConfig = e2eConfig): Record<string, string> {
  return {
    VITE_API_BASE: '/api',
    VITE_BACKEND_ORIGIN: config.backendOrigin,
    VITE_OIDC_ISSUER_URL: config.issuerUrl,
    VITE_OIDC_CLIENT_ID: config.clientId,
    VITE_OIDC_REDIRECT_URI: config.redirectUri,
    VITE_OIDC_POST_LOGOUT_REDIRECT_URI: config.postLogoutRedirectUri,
    // A valódi PKCE folyamatot mérjük; a manual token escape hatch marad kikapcsolva.
    VITE_ALLOW_MANUAL_TOKEN: 'false',
  };
}
