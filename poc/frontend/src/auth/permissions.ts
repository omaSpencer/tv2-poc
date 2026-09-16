import type { AppPermission, MeResponse } from '../api/types';

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
