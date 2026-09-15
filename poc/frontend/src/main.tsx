import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthSessionProvider } from './auth/session';
import { ActiveContentProvider } from './content/activeContent';
import { createQueryClient } from './lib/queryClient';
import './index.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <ActiveContentProvider>
          <App />
        </ActiveContentProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
