import { NavLink } from 'react-router';
import { useAuth } from '../auth/authContext';
import { can } from '../auth/permissions';

export function AppNav() {
  const { me, isAuthenticated } = useAuth();
  const links = [
    { to: '/', label: 'Kezdőlap', end: true, visible: true },
    { to: '/catalog/search', label: 'Katalógus', end: false, visible: true },
    { to: '/contents', label: 'Tartalmak', end: false, visible: can(me, 'content:read') || can(me, 'content:write') },
    { to: '/operations', label: 'Operations', end: false, visible: can(me, 'ops:read') },
    { to: '/demo', label: 'Demo', end: false, visible: isAuthenticated },
    { to: '/login', label: isAuthenticated ? 'Profil' : 'Belépés', end: false, visible: true },
  ];

  return (
    <nav className="app-nav" aria-label="Elsődleges navigáció">
      {links.filter((link) => link.visible).map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
