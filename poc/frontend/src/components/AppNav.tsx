import { NavLink } from 'react-router';

const LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Kezdőlap', end: true },
  { to: '/auth', label: 'Auth' },
  { to: '/editorial', label: 'Editorial' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/search', label: 'Search' },
  { to: '/processing', label: 'Processing' },
  { to: '/demo', label: 'Demo' },
];

export function AppNav() {
  return (
    <nav className="app-nav" aria-label="Playground">
      {LINKS.map((link) => (
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
