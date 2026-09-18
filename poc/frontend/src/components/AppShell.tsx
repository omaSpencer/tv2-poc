import { Outlet } from 'react-router';
import { AppNav } from './AppNav';
import { StatusBar } from './StatusBar';

export function AppShell() {
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Ugrás a fő tartalomra</a>
      <StatusBar />
      <AppNav />
      <main id="main-content" className="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer muted">
        Fejlesztői kipróbálófelület · lásd <code className="mono">../FRONTEND.md</code>
      </footer>
    </div>
  );
}
