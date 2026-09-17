/**
 * M0-14 – role/permission and route matrix (D-M0-08, DECISIONS D06).
 *
 * This is the contract M2 binds a verified Authentik identity to. An OAuth
 * scope alone never grants an application permission: the permission set is
 * derived from the group-backed claims listed below.
 */
export const PERMISSIONS = ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['viewer', 'editor', 'publisher'] as const;
export type Role = (typeof ROLES)[number];

/** Authentik group name → application role. M2 fills in the property mapping. */
export const ROLE_GROUPS: Readonly<Record<Role, string>> = {
  viewer: 'poc-viewer',
  editor: 'poc-editor',
  publisher: 'poc-publisher',
};

/** Multiple roles union their permissions; a viewer only proves its own identity. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  viewer: [],
  editor: ['content:read', 'content:write'],
  publisher: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
};

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role as Role] ?? []) granted.add(permission);
  }
  return granted;
}

/** `null` = reachable without a permission check. `'authenticated'` = identity only. */
export type RouteAccess = Permission | 'authenticated' | null;

export type RouteRule = { method: string; path: string; access: RouteAccess; milestone: string };

export const ROUTE_MATRIX: readonly RouteRule[] = [
  { method: 'GET', path: '/health/live', access: null, milestone: 'M0' },
  { method: 'GET', path: '/health/ready', access: null, milestone: 'M0' },
  { method: 'GET', path: '/docs-json', access: null, milestone: 'M0' },
  { method: 'GET', path: '/me', access: 'authenticated', milestone: 'M2' },
  { method: 'POST', path: '/admin/contents', access: 'content:write', milestone: 'M1' },
  { method: 'GET', path: '/admin/contents', access: 'content:read', milestone: 'M1' },
  { method: 'PATCH', path: '/admin/contents/:id', access: 'content:write', milestone: 'M1' },
  { method: 'POST', path: '/admin/contents/:id/publish', access: 'content:publish', milestone: 'M1' },
  { method: 'POST', path: '/admin/contents/:id/withdraw', access: 'content:publish', milestone: 'M1' },
  { method: 'GET', path: '/admin/contents/:id', access: 'content:read', milestone: 'M1' },
  { method: 'GET', path: '/admin/contents/:id/audit', access: 'content:read', milestone: 'M1' },
  { method: 'GET', path: '/admin/processing-status', access: 'ops:read', milestone: 'M3' },
  { method: 'GET', path: '/admin/search/reindex-preflight', access: 'ops:write', milestone: 'M5' },
  { method: 'POST', path: '/admin/search/reindex-runs', access: 'ops:write', milestone: 'M5' },
  { method: 'GET', path: '/admin/search/reindex-runs/:runId', access: 'ops:read', milestone: 'M5' },
  { method: 'GET', path: '/admin/search/quarantine', access: 'ops:read', milestone: 'M5' },
  { method: 'GET', path: '/admin/search/quarantine/:sequence', access: 'ops:read', milestone: 'M5' },
  { method: 'POST', path: '/admin/search/quarantine/:sequence/replays', access: 'ops:write', milestone: 'M5' },
  { method: 'POST', path: '/admin/search/repairs', access: 'ops:write', milestone: 'M5' },
  { method: 'GET', path: '/admin/operator-actions/:id', access: 'ops:read', milestone: 'M5' },
  { method: 'GET', path: '/catalog/contents/:id', access: null, milestone: 'M1' },
  { method: 'GET', path: '/catalog/search', access: null, milestone: 'M4' },
];
