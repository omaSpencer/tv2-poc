/**
 * P7-08 / E2E-04 – valódi A/B kiesés injektálása.
 *
 * A kiesést a Meilisearch konténer leállításával idézzük elő, mert a release
 * kapu valódi full-stack bizonyítékot kér. Opt-in: `E2E_DOCKER_CONTROL=true`
 * nélkül a teszt nem fut le csendes passként, hanem `skip` + indoklás.
 */
import { execFileSync } from 'node:child_process';
import { e2eConfig } from './env';

function compose(args: string[], timeoutMs = 120_000): string {
  return execFileSync(
    'docker',
    ['compose', '-f', e2eConfig.docker.composeFile, '-p', e2eConfig.docker.projectName, '--profile', 'full', ...args],
    { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export function dockerControlAvailable(): { ok: boolean; reason: string } {
  if (!e2eConfig.docker.enabled) {
    return {
      ok: false,
      reason:
        'E2E_DOCKER_CONTROL nincs bekapcsolva, ezért a suite nem állít le Meilisearch konténert. A valódi A/B kiesés bizonyítéka enélkül pending marad.',
    };
  }
  try {
    compose(['ps', '--format', 'json'], 30_000);
    return { ok: true, reason: '' };
  } catch (error) {
    return {
      ok: false,
      reason: `A docker compose nem vezérelhető: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function stopSearchInstance(which: 'a' | 'b'): void {
  compose(['stop', which === 'a' ? e2eConfig.docker.serviceA : e2eConfig.docker.serviceB]);
}

export function startSearchInstance(which: 'a' | 'b'): void {
  compose(['start', which === 'a' ? e2eConfig.docker.serviceA : e2eConfig.docker.serviceB]);
}

/** Mindkét instance visszaindítása; a teardown soha nem hagyhat leállított szolgáltatást. */
export function restoreSearchInstances(): void {
  for (const which of ['a', 'b'] as const) {
    try {
      startSearchInstance(which);
    } catch {
      // A teardown hibája nem írhatja felül a teszteredményt; a következő preflight úgyis jelzi.
    }
  }
}
