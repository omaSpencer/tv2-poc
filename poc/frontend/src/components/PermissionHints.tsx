import type { AppPermission, AppRole, MeResponse } from '../api/types';
import { ROLE_PERMISSIONS } from '../auth/permissions';

type Props = {
  me: MeResponse | null;
};

const MATRIX: { role: AppRole; label: string; perms: readonly AppPermission[] }[] = [
  { role: 'viewer', label: 'Megtekintő', perms: ROLE_PERMISSIONS.viewer },
  { role: 'editor', label: 'Szerkesztő', perms: ROLE_PERMISSIONS.editor },
  { role: 'publisher', label: 'Kiadó', perms: ROLE_PERMISSIONS.publisher },
];

export function PermissionHints({ me }: Props) {
  const granted = new Set(me?.permissions ?? []);

  return (
    <div className="permission-hints">
      <h3>Jogosultsági mátrix</h3>
      <table>
        <thead>
          <tr>
            <th>Szerep</th>
            <th>Jogosultságok</th>
            <th>Most</th>
          </tr>
        </thead>
        <tbody>
          {MATRIX.map((row) => {
            const active = me?.roles.includes(row.role) ?? false;
            return (
              <tr key={row.role} className={active ? 'row-active' : undefined}>
                <td>{row.label}</td>
                <td className="mono">
                  {row.perms.length === 0 ? '— (csak /me)' : row.perms.join(', ')}
                </td>
                <td>{active ? 'aktív' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">
        Aktív jogok:{' '}
        <span className="mono">{granted.size > 0 ? [...granted].join(', ') : 'nincs / ismeretlen'}</span>
      </p>
    </div>
  );
}
