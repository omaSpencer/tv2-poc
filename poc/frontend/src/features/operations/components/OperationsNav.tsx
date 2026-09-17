import { NavLink } from 'react-router';
import { useAuth } from '../../../auth/authContext';
import { can } from '../../../auth/permissions';

export function OperationsNav() {
  const { me } = useAuth();
  const canWrite = can(me, 'ops:write');
  return (
    <nav className="operations-subnav" aria-label="Operátori műveletek">
      <NavLink to="/operations" end>Állapot</NavLink>
      {canWrite ? <NavLink to="/operations/reindex">Reindex</NavLink> : null}
      <NavLink to="/operations/quarantine">Karantén</NavLink>
      {canWrite ? <NavLink to="/operations/repair">Tartalomjavítás</NavLink> : null}
    </nav>
  );
}
