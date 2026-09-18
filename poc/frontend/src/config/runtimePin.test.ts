import { describe, expect, it } from 'vitest';
import { checkRuntime, PINNED_NODE, PINNED_NPM, readNpmVersionFromUserAgent } from './runtimePin';

describe('checkRuntime', () => {
  it('passes the pinned Node and npm versions', () => {
    expect(checkRuntime({ node: `v${PINNED_NODE}`, npm: PINNED_NPM })).toEqual({
      ok: true,
      node: PINNED_NODE,
      npm: PINNED_NPM,
    });
  });

  it('fails deterministically on an injected different Node version', () => {
    const result = checkRuntime({ node: '22.15.1', npm: PINNED_NPM });
    expect(result).toEqual({
      ok: false,
      node: '22.15.1',
      npm: PINNED_NPM,
      reason: expect.stringContaining('22.15.1'),
    });
  });

  it('fails deterministically on an injected different npm version', () => {
    const result = checkRuntime({ node: PINNED_NODE, npm: '10.9.0' });
    expect(result).toEqual({
      ok: false,
      node: PINNED_NODE,
      npm: '10.9.0',
      reason: expect.stringContaining('10.9.0'),
    });
  });

  it('reads npm from the user agent without executing npm', () => {
    expect(readNpmVersionFromUserAgent('npm/11.19.0 node/v24.20.0 darwin arm64')).toBe('11.19.0');
    expect(readNpmVersionFromUserAgent('')).toBeNull();
  });
});
