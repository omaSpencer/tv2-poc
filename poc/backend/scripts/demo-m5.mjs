#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(script, args = []) {
  const result = spawnSync('npm', ['run', script, '--', ...args], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('demo:m4');
run('search:reindex', ['--index=a']);
run('search:reindex', ['--index=b']);
process.stdout.write(`${JSON.stringify({ event: 'demo_m5_finished', identityLive: 'requires documented interactive Authentik run' })}\n`);
