/**
 * Claim → application role mapping (M2-06). Permissions come only from
 * Authentik group membership via ROLE_GROUPS; OAuth scopes never grant rights.
 */
import { ROLE_GROUPS, ROLES, type Role } from '../contracts/permissions.js';

const GROUP_TO_ROLE = new Map<string, Role>(
  (Object.entries(ROLE_GROUPS) as Array<[Role, string]>).map(([role, group]) => [group, role]),
);

/** Extract group names from a JWT `groups` claim. Non-lists yield []. */
export function groupsFromClaim(claim: unknown): string[] {
  if (!Array.isArray(claim)) return [];
  return claim.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Map Authentik group names to application roles in the stable ROLES order.
 * Unknown groups are ignored silently.
 */
export function rolesFromGroups(groups: readonly string[]): Role[] {
  const found = new Set<Role>();
  for (const group of groups) {
    const role = GROUP_TO_ROLE.get(group);
    if (role) found.add(role);
  }
  return ROLES.filter(role => found.has(role));
}

export function rolesFromTokenClaims(claims: { groups?: unknown }): Role[] {
  return rolesFromGroups(groupsFromClaim(claims.groups));
}
