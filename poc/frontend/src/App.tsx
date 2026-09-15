import { StatusBar } from './components/StatusBar';
import { CatalogLookup } from './components/CatalogLookup';
import { AdminPlaceholder } from './components/AdminPlaceholder';

export default function App() {
  return (
    <div className="app">
      <StatusBar />
      <main className="main">
        <CatalogLookup />
        <AdminPlaceholder />
      </main>
      <footer className="footer muted">
        Fejlesztői playground · lásd <code className="mono">../FRONTEND.md</code>
      </footer>
    </div>
  );
}
