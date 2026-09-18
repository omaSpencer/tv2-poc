/**
 * BE-F1 S4 + S7 + O1 – the checked-in runtime posture.
 *
 * These are configuration invariants, not a substitute for the container smoke:
 * the smoke proves the image starts and answers, this file proves the
 * configuration cannot silently drift back — a port published on every
 * interface, a production overlay that forgets its master key, or a runtime
 * stage that ends up running as root.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

/** Every `- "…:port"` entry under a `ports:` block, in file order. */
function publishedPorts(compose: string): string[] {
  const entries: string[] = [];
  let inPorts = false;
  for (const line of compose.split('\n')) {
    if (/^\s*ports:\s*(\[\])?\s*$/.test(line)) {
      inPorts = !line.includes('[]');
      continue;
    }
    const item = /^\s*-\s*"([^"]+)"\s*$/.exec(line);
    if (inPorts && item) {
      entries.push(item[1]);
      continue;
    }
    if (!/^\s*#/.test(line) && line.trim().length > 0 && !item) inPorts = false;
  }
  return entries;
}

describe('S4 dependency host exposure', () => {
  it('publishes every dependency port on the loopback bind address only', async () => {
    const compose = await read('compose.yaml');
    const ports = publishedPorts(compose);
    expect(ports.length).toBe(6);
    for (const entry of ports) {
      expect(entry.startsWith('${HOST_BIND_ADDRESS:-127.0.0.1}:')).toBe(true);
    }
  });

  it('keeps container-to-container discovery on service names', async () => {
    const compose = await read('compose.yaml');
    // Authentik reaches its own database and cache by service name, not by a
    // published host port; loopback binding must not have changed that.
    expect(compose).toContain('AUTHENTIK_POSTGRESQL__HOST: authentik-postgres');
    expect(compose).toContain('AUTHENTIK_REDIS__HOST: authentik-redis');
    expect(compose).not.toContain('AUTHENTIK_POSTGRESQL__HOST: 127.0.0.1');
  });

  it('documents the loopback default in the sample environment', async () => {
    expect(await read('.env.example')).toContain('HOST_BIND_ADDRESS=127.0.0.1');
  });
});

describe('S7 Meilisearch posture', () => {
  it('keeps the local profile in development mode by default', async () => {
    const compose = await read('compose.yaml');
    expect(compose).toContain('MEILI_ENV: ${MEILI_ENV:-development}');
    expect(compose).not.toContain('MEILI_ENV: production');
  });

  it('forces production mode with a mandatory master key in the overlay', async () => {
    const overlay = await read('compose.prod.yaml');
    expect(overlay.match(/MEILI_ENV: production/g)).toHaveLength(2);
    expect(overlay).toContain('MEILI_MASTER_KEY: ${MEILI_A_KEY:?set MEILI_A_KEY in the env file}');
    expect(overlay).toContain('MEILI_MASTER_KEY: ${MEILI_B_KEY:?set MEILI_B_KEY in the env file}');
  });

  it('keeps every production credential a placeholder in the sample', async () => {
    const sample = await read('.env.production.example');
    for (const key of ['MEILI_A_KEY', 'MEILI_B_KEY', 'POSTGRES_PASSWORD', 'AUTHENTIK_SECRET_KEY']) {
      expect(sample).toContain(`${key}=REPLACE_ME`);
    }
  });
});

describe('O1 application image', () => {
  it('builds in stages and ships production dependencies only', async () => {
    const dockerfile = await read('Dockerfile');
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(3);
    expect(dockerfile).toContain('ARG NODE_IMAGE=node:24.20.0-alpine3.23');
    expect(dockerfile).toContain('npm ci --omit=dev');
    // The compiled output is copied from the build stage; the runtime stage
    // never compiles and therefore never needs a dev dependency.
    expect(dockerfile).toContain('COPY --from=build --chown=root:root /build/dist ./dist');
  });

  it('runs unprivileged and probes its own liveness', async () => {
    const dockerfile = await read('Dockerfile');
    const userLine = dockerfile.indexOf('\nUSER node');
    const cmdLine = dockerfile.indexOf('\nCMD ');
    expect(userLine).toBeGreaterThan(-1);
    expect(cmdLine).toBeGreaterThan(userLine);
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('scripts/container-healthcheck.mjs');
    expect(dockerfile).toContain('--chmod=0555 scripts/container-healthcheck.mjs');
    expect(dockerfile).not.toContain('USER root');
  });

  it('keeps secrets out of the build context and the image layers', async () => {
    const ignore = await read('.dockerignore');
    expect(ignore).toContain('.env\n');
    expect(ignore).toContain('.env.*');
    const dockerfile = await read('Dockerfile');
    for (const forbidden of ['PASSWORD', 'SECRET', 'TOKEN', '_KEY']) {
      expect(dockerfile).not.toContain(forbidden);
    }
  });

  it('stays out of the dependency profile CI starts', async () => {
    const overlay = await read('compose.prod.yaml');
    const backend = overlay.slice(overlay.indexOf('  backend:'), overlay.indexOf('  meilisearch-a:'));
    expect(backend).toContain('profiles: ["app"]');
    expect(backend).not.toContain('"full"');
    expect(backend).toContain('read_only: true');
    expect(backend).toContain('cap_drop: ["ALL"]');
    expect(backend).toContain('no-new-privileges:true');
    // The container listener binds every interface; the host publication does not.
    expect(backend).toContain('HOST: 0.0.0.0');
    expect(backend).toContain('"${HOST_BIND_ADDRESS:-127.0.0.1}:${BACKEND_PORT:-3000}:3000"');
  });

  it('is not started by the plain dependency profile', async () => {
    expect(await read('compose.yaml')).not.toContain('backend:');
  });
});
