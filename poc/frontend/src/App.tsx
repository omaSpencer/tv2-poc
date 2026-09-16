import { Navigate, Route, RouterProvider, createBrowserRouter, createRoutesFromElements } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
import { AppShell } from './components/AppShell';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { AuthPage } from './pages/AuthPage';
import { DemoPage } from './pages/DemoPage';
import { HomePage } from './pages/HomePage';
import { CatalogDetailPage } from './features/catalog/routes/CatalogDetailPage';
import { CatalogSearchPage } from './features/catalog/routes/CatalogSearchPage';
import { ContentListPage } from './features/contents/routes/ContentListPage';
import { ContentCreatePage } from './features/contents/routes/ContentCreatePage';
import { ContentDetailPage } from './features/contents/routes/ContentDetailPage';
import { ContentEditPage } from './features/contents/routes/ContentEditPage';
import { OperationsPage } from './features/operations/routes/OperationsPage';

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AppShell />}>
      <Route index element={<HomePage />} />
      <Route path="login" element={<AuthPage />} />
      <Route path="auth" element={<Navigate to="/login" replace />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="catalog/search" element={<CatalogSearchPage />} />
      <Route path="catalog/:id" element={<CatalogDetailPage />} />
      <Route path="search" element={<Navigate to="/catalog/search" replace />} />
      <Route path="catalog" element={<Navigate to="/catalog/search" replace />} />
      <Route path="contents" element={<RequirePermission permission="content:read"><ContentListPage /></RequirePermission>} />
      <Route path="contents/new" element={(
        <RequirePermission permission="content:write">
          <ContentCreatePage />
        </RequirePermission>
      )} />
      <Route path="contents/:id" element={<RequirePermission permission="content:read"><ContentDetailPage /></RequirePermission>} />
      <Route path="contents/:id/edit" element={<RequirePermission permission="content:write"><ContentEditPage /></RequirePermission>} />
      <Route path="editorial" element={<Navigate to="/contents" replace />} />
      <Route path="operations" element={<RequirePermission permission="ops:read"><OperationsPage /></RequirePermission>} />
      <Route path="processing" element={<Navigate to="/operations" replace />} />
      <Route path="demo" element={<RequireAuth><DemoPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);

export default function App() {
  return <RouterProvider router={router} />;
}
