/**
 * Controllable proxies for M4 failure injection.
 *
 * The A/B outage cases are only worth anything if the failure is real: the
 * worker and the read path must see an actual refused connection, a real
 * timeout or a genuine 5xx body, not a stubbed client. Each application under
 * test therefore talks to its dependency through one of these proxies, and the
 * case switches the proxy's mode.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createConnection, createServer as createTcpServer, type Server, type Socket } from 'node:net';

/** How the proxy answers the next request. */
export type ProxyMode =
  | 'pass'
  /** Connection refused / reset: the dependency is gone. */
  | 'down'
  /** Accepts and never answers: the caller must hit its own timeout. */
  | 'hang'
  | 'status429'
  | 'status500'
  | 'status503'
  | 'status400'
  | 'status401';

const MEILI_ERROR_BODY: Partial<Record<ProxyMode, { status: number; body: unknown }>> = {
  status429: { status: 429, body: { message: 'Too many requests', code: 'too_many_requests', type: 'system', link: '' } },
  status500: { status: 500, body: { message: 'Internal', code: 'internal', type: 'internal', link: '' } },
  status503: { status: 503, body: { message: 'Unavailable', code: 'internal', type: 'internal', link: '' } },
  status400: { status: 400, body: { message: 'Bad request', code: 'invalid_search_filter', type: 'invalid_request', link: '' } },
  status401: { status: 401, body: { message: 'Invalid key', code: 'invalid_api_key', type: 'auth', link: '' } },
};

export type MeiliProxy = {
  url: string;
  setMode: (mode: ProxyMode) => void;
  /** Force every `GET /tasks/<uid>` to report `processing` until released. */
  holdTasks: (hold: boolean) => void;
  /** Requests forwarded or answered since the last reset, by method+path prefix. */
  readonly requests: number;
  readonly searches: number;
  resetCounters: () => void;
  close: () => Promise<void>;
};

/**
 * HTTP proxy in front of one Meilisearch instance. `holdTasks` is what makes
 * the long-running-task case testable against a real server: the task really
 * did succeed, but the worker keeps seeing `processing`, so it must keep the
 * delivery alive with `working()` instead of moving on.
 */
export async function createMeiliProxy(target: string): Promise<MeiliProxy> {
  let mode: ProxyMode = 'pass';
  let hold = false;
  let requests = 0;
  let searches = 0;
  const sockets = new Set<Socket>();

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    const path = req.url ?? '/';
    if (path.includes('/search')) searches += 1;

    if (mode === 'hang') return; // never answer; the client times out
    if (mode === 'down') {
      req.socket.destroy();
      return;
    }
    const synthetic = MEILI_ERROR_BODY[mode];
    if (synthetic) {
      res.writeHead(synthetic.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(synthetic.body));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && key !== 'host' && key !== 'connection' && key !== 'content-length') {
        headers.set(key, value);
      }
    }
    try {
      const upstream = await fetch(new URL(path, target), {
        method: req.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });
      const text = await upstream.text();
      let payload = text;
      if (hold && req.method === 'GET' && /^\/tasks\/\d+/.test(path)) {
        // Rewrite only the status: the rest of the task record stays real.
        try {
          const task = JSON.parse(text) as Record<string, unknown>;
          task.status = 'processing';
          delete task.finishedAt;
          payload = JSON.stringify(task);
        } catch { /* not a task body after all */ }
      }
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(payload);
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'proxy failure', code: 'internal', type: 'internal', link: '' }));
    }
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The Meilisearch proxy did not bind a port.');

  return {
    url: `http://127.0.0.1:${address.port}`,
    setMode: next => {
      mode = next;
      // A dependency that just went down drops its established sockets too.
      if (next === 'down') for (const socket of sockets) socket.destroy();
    },
    holdTasks: next => { hold = next; },
    get requests() { return requests; },
    get searches() { return searches; },
    resetCounters: () => { requests = 0; searches = 0; },
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

export type TcpProxy = {
  port: number;
  setMode: (mode: 'pass' | 'down') => void;
  close: () => Promise<void>;
};

/**
 * Raw TCP proxy, used to take PostgreSQL away from a running application
 * (T23) without touching the database itself.
 */
export async function createTcpProxy(targetHost: string, targetPort: number): Promise<TcpProxy> {
  let mode: 'pass' | 'down' = 'pass';
  const sockets = new Set<Socket>();

  const server: Server = createTcpServer(client => {
    if (mode === 'down') {
      client.destroy();
      return;
    }
    sockets.add(client);
    const upstream = createConnection({ host: targetHost, port: targetPort });
    sockets.add(upstream);
    const drop = (): void => {
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.on('close', drop);
    upstream.on('close', drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The TCP proxy did not bind a port.');

  return {
    port: address.port,
    setMode: next => {
      mode = next;
      if (next === 'down') for (const socket of sockets) socket.destroy();
    },
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}
