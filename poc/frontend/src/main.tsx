import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { handleSilentCallback, isSilentCallbackPath } from './auth/oidc';
import { NotificationProvider } from './components/NotificationProvider';
import { frontendConfig } from './config/env';
import { createQueryClient } from './lib/queryClient';
import './index.css';

if (isSilentCallbackPath(window.location.pathname)) {
  void handleSilentCallback(frontendConfig);
} else {
  const queryClient = createQueryClient();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
