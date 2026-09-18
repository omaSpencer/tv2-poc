/** Exact toolchain pin. `.nvmrc` is 24.20.0; npm 11.19.0 is the proven companion. */
export const PINNED_NODE = '24.20.0';
export const PINNED_NPM = '11.19.0';

export type RuntimeVersions = {
  node: string;
  npm: string;
};

export type RuntimeCheckResult =
  | { ok: true; node: string; npm: string }
  | { ok: false; node: string; npm: string; reason: string };

function normalizeNode(version: string): string {
  return version.trim().replace(/^v/, '');
}

export function checkRuntime(actual: RuntimeVersions): RuntimeCheckResult {
  const node = normalizeNode(actual.node);
  const npm = actual.npm.trim();
  if (node !== PINNED_NODE) {
    return {
      ok: false,
      node,
      npm,
      reason: `Nem támogatott Node ${node}; elvárt ${PINNED_NODE}.`,
    };
  }
  if (npm !== PINNED_NPM) {
    return {
      ok: false,
      node,
      npm,
      reason: `Nem támogatott npm ${npm}; elvárt ${PINNED_NPM}.`,
    };
  }
  return { ok: true, node, npm };
}

export function readNpmVersionFromUserAgent(userAgent: string): string | null {
  const match = /npm\/(\d+\.\d+\.\d+)/.exec(userAgent);
  return match?.[1] ?? null;
}
