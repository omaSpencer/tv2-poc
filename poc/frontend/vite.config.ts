import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { resolveDevProxyOrigin } from './src/config/devProxy.ts';

/** Dev proxy: browser calls `/api/...`, Vite forwards to the NestJS origin without the `/api` prefix. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'production') {
    if (env.VITE_ALLOW_MANUAL_TOKEN === 'true') {
      throw new Error('VITE_ALLOW_MANUAL_TOKEN productionben nem engedélyezett.');
    }
    const issuer = env.VITE_OIDC_ISSUER_URL?.trim();
    const clientId = env.VITE_OIDC_CLIENT_ID?.trim();
    if (issuer || clientId) {
      for (const key of [
        'VITE_OIDC_REDIRECT_URI',
        'VITE_OIDC_POST_LOGOUT_REDIRECT_URI',
        'VITE_OIDC_SILENT_REDIRECT_URI',
      ] as const) {
        if (!env[key]?.trim()) {
          throw new Error(`Production buildhez ${key} szükséges.`);
        }
      }
    }
  }
  if (env.VITE_BACKEND_ORIGIN?.trim()) {
    resolveDevProxyOrigin(env);
  }
  const backendOrigin = mode === 'production' ? undefined : resolveDevProxyOrigin(env);

  return {
    plugins: [
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
    ],
    server: {
      port: 5173,
      watch: {
        // A Playwright trace/riport fájljai a projekt alatt keletkeznek; enélkül a
        // watcher HMR reloadot küldene a tesztelt oldalra futás közben.
        ignored: [
          '**/.git/**',
          '**/node_modules/**',
          '**/dist/**',
          '**/e2e/.artifacts/**',
          '**/e2e/.report/**',
        ],
      },
      proxy: backendOrigin
        ? {
            '/api': {
              target: backendOrigin,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
          }
        : undefined,
    },
  };
});
