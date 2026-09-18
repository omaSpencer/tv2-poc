import { execSync } from 'node:child_process';
import { checkRuntime, PINNED_NODE, PINNED_NPM, readNpmVersionFromUserAgent } from '../src/config/runtimePin.ts';

function detectNpmVersion() {
  const injected = process.env.RUNTIME_CHECK_NPM?.trim();
  if (injected) return injected;
  const fromAgent = readNpmVersionFromUserAgent(process.env.npm_config_user_agent ?? '');
  if (fromAgent) return fromAgent;
  return execSync('npm -v', { encoding: 'utf8' }).trim();
}

const node = process.env.RUNTIME_CHECK_NODE?.trim() || process.versions.node;
const npm = detectNpmVersion();
const result = checkRuntime({ node, npm });

if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

console.log(JSON.stringify({
  event: 'runtime_check',
  node: result.node,
  npm: result.npm,
  pinned: { node: PINNED_NODE, npm: PINNED_NPM },
}));
