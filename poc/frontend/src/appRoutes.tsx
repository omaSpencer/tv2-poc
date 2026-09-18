// oxlint-disable react/only-export-components -- route table, not a component module
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, createRoutesFromElements } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
import { AppShell } from './components/AppShell';
import { RootErrorPage } from './pages/RootErrorPage';

const AuthCallbackPage = lazy(async () => ({ default: (await import('./pages/AuthCallbackPage')).AuthCallbackPage }));
const AuthPage = lazy(async () => ({ default: (await import('./pages/AuthPage')).AuthPage }));
const DemoPage = lazy(async () => ({ default: (await import('./pages/DemoPage')).DemoPage }));
const HomePage = lazy(async () => ({ default: (await import('./pages/HomePage')).HomePage }));
const CatalogDetailPage = lazy(async () => ({ default: (await import('./features/catalog/routes/CatalogDetailPage')).CatalogDetailPage }));
const CatalogSearchPage = lazy(async () => ({ default: (await import('./features/catalog/routes/CatalogSearchPage')).CatalogSearchPage }));
const ContentListPage = lazy(async () => ({ default: (await import('./features/contents/routes/ContentListPage')).ContentListPage }));
const ContentCreatePage = lazy(async () => ({ default: (await import('./features/contents/routes/ContentCreatePage')).ContentCreatePage }));
const ContentDetailPage = lazy(async () => ({ default: (await import('./features/contents/routes/ContentDetailPage')).ContentDetailPage }));
const ContentEditPage = lazy(async () => ({ default: (await import('./features/contents/routes/ContentEditPage')).ContentEditPage }));
const OperationsPage = lazy(async () => ({ default: (await import('./features/operations/routes/OperationsPage')).OperationsPage }));
const ReindexPage = lazy(async () => ({ default: (await import('./features/operations/routes/ReindexPage')).ReindexPage }));
const ReindexProgressPage = lazy(async () => ({ default: (await import('./features/operations/routes/ReindexProgressPage')).ReindexProgressPage }));
const QuarantinePage = lazy(async () => ({ default: (await import('./features/operations/routes/QuarantinePage')).QuarantinePage }));
const RepairPage = lazy(async () => ({ default: (await import('./features/operations/routes/RepairPage')).RepairPage }));

function page(children: ReactNode) {
  return (
    <Suspense fallback={<section className="panel" role="status" aria-live="polite">Oldal betöltése…</section>}>
      {children}
    </Suspense>
  );
}

export const appRoutes = createRoutesFromElements(
  <Route element={<AppShell />} errorElement={<RootErrorPage />}>
    <Route index element={page(<HomePage />)} />
    <Route path="login" element={page(<AuthPage />)} />
    <Route path="auth" element={<Navigate to="/login" replace />} />
    <Route path="auth/callback" element={page(<AuthCallbackPage />)} />
    <Route path="catalog/search" element={page(<CatalogSearchPage />)} />
    <Route path="catalog/:id" element={page(<CatalogDetailPage />)} />
    <Route path="search" element={<Navigate to="/catalog/search" replace />} />
    <Route path="catalog" element={<Navigate to="/catalog/search" replace />} />
    <Route path="contents" element={page(<RequirePermission permission="content:read"><ContentListPage /></RequirePermission>)} />
    <Route path="contents/new" element={page(
      <RequirePermission permission="content:write"><ContentCreatePage /></RequirePermission>,
    )} />
    <Route path="contents/:id" element={page(<RequirePermission permission="content:read"><ContentDetailPage /></RequirePermission>)} />
    <Route path="contents/:id/edit" element={page(<RequirePermission permission="content:write"><ContentEditPage /></RequirePermission>)} />
    {/* One release cycle of bookmark compatibility; the old EditorialPage chain is gone. */}
    <Route path="editorial" element={<Navigate to="/contents" replace />} />
    <Route path="operations" element={page(<RequirePermission permission="ops:read"><OperationsPage /></RequirePermission>)} />
    <Route path="operations/reindex" element={page(<RequirePermission permission="ops:write"><ReindexPage /></RequirePermission>)} />
    <Route path="operations/reindex/:runId" element={page(<RequirePermission permission="ops:read"><ReindexProgressPage /></RequirePermission>)} />
    <Route path="operations/quarantine" element={page(<RequirePermission permission="ops:read"><QuarantinePage /></RequirePermission>)} />
    <Route path="operations/repair" element={page(<RequirePermission permission="ops:write"><RepairPage /></RequirePermission>)} />
    <Route path="processing" element={<Navigate to="/operations" replace />} />
    <Route path="demo" element={page(<RequireAuth><DemoPage /></RequireAuth>)} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>,
);
