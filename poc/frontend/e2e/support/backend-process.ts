import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { e2eConfig } from './env';

const BACKEND_ROOT = resolve(process.cwd(), '..', 'backend');
const READY_TIMEOUT_MS = 30_000;
type OwnedBackend = ChildProcessByStdio<null, Readable, Readable>;
let backend: OwnedBackend | null = null;
let recentOutput = '';

function remember(chunk: Buffer): void {
  recentOutput = `${recentOutput}${chunk.toString('utf8')}`.slice(-8000);
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (backend === null || backend.exitCode !== null || backend.signalCode !== null) {
      throw new Error(`Az E2E backend idő előtt leállt. Utolsó kimenet:\n${recentOutput}`);
    }
    try {
      const response = await fetch(`${e2eConfig.backendOrigin}/health/ready`);
      if (response.ok) return;
    } catch {
      // Az indulás alatt elvárt.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Az E2E backend nem lett ready ${READY_TIMEOUT_MS} ms alatt. Utolsó kimenet:\n${recentOutput}`);
}

export async function startOwnedBackend(): Promise<void> {
  if (backend !== null) throw new Error('Az E2E backend folyamat már fut.');
  recentOutput = '';
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, ENV_FILE: resolve(BACKEND_ROOT, '.env.e2e') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend = child;
  child.stdout.on('data', remember);
  child.stderr.on('data', remember);
  await waitForReady();
}

async function waitForExit(child: OwnedBackend, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolvePromise => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });
}

export async function crashOwnedBackend(): Promise<void> {
  const child = backend;
  if (child === null) throw new Error('Nincs megszakítható E2E backend folyamat.');
  child.kill('SIGKILL');
  if (!(await waitForExit(child, 10_000))) throw new Error('Az E2E backend SIGKILL után sem állt le.');
  backend = null;
}

export async function stopOwnedBackend(): Promise<void> {
  const child = backend;
  if (child === null) return;
  child.kill('SIGTERM');
  if (!(await waitForExit(child, 10_000))) {
    child.kill('SIGKILL');
    await waitForExit(child, 5000);
  }
  backend = null;
}
