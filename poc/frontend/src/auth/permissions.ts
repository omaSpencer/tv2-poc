import type { AppPermission, AppRole, MeResponse } from '../api/types';

/** Single frontend role→permission matrix; AppPermission comes from the generated contract. */
export const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly AppPermission[]>> = {
  viewer: [],
  editor: ['content:read', 'content:write'],
  publisher: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
};

export function can(
  me: MeResponse | null | undefined,
  permission: AppPermission,
): boolean {
  return (me?.permissions ?? []).includes(permission);
}

export function permissionReason(
  me: MeResponse | null | undefined,
  permission: AppPermission,
): string | undefined {
  return can(me, permission) ? undefined : `A művelethez ${permission} jogosultság szükséges.`;
}
