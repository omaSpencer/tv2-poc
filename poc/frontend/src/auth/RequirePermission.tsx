import type { ReactNode } from 'react';
import type { AppPermission } from '../api/types';
import { can } from './permissions';
import { useAuth } from './authContext';
import { RequireAuth } from './RequireAuth';

export function RequirePermission({
  permission,
  children,
}: {
  permission: AppPermission;
  children: ReactNode;
}) {
  const { me } = useAuth();
  return (
    <RequireAuth>
      {can(me, permission) ? children : (
        <section className="panel panel-error" role="alert">
          <h2>Nincs jogosultság</h2>
          <p>
            Ehhez az oldalhoz a <code className="mono">{permission}</code> jogosultság szükséges.
            A munkameneted érvényes maradt.
          </p>
        </section>
      )}
    </RequireAuth>
  );
}
