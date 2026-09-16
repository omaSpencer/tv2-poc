import type { AppPermission, MeResponse } from '../api/types';

export function can(
  me: MeResponse | null | undefined,
  permission: AppPermission,
): boolean {
  return (me?.permissions ?? []).includes(permission);
}
