import { Outlet } from 'react-router';
import { AppNav } from './AppNav';
import { StatusBar } from './StatusBar';

export function AppShell() {
  return (
    <div className="app">
      <StatusBar />
      <AppNav />
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer muted">
        Fejlesztői playground · lásd <code className="mono">../FRONTEND.md</code>
      </footer>
    </div>
  );
}
