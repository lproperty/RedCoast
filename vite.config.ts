/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { handleRequest, type Env } from './relay/src/handler.ts';

/**
 * Serves the relay at /relay inside `vite dev` and `vite preview`, running the exact
 * Worker code in Node. Local development gets live data without deploying anything.
 * OpenSky credentials, if you have them, go in .env.local (OPENSKY_CLIENT_ID/SECRET).
 */
function devRelay(env: Record<string, string>): Plugin {
  const relayEnv: Env = {
    DEV: '1',
    OPENSKY_CLIENT_ID: env.OPENSKY_CLIENT_ID,
    OPENSKY_CLIENT_SECRET: env.OPENSKY_CLIENT_SECRET,
  };
  const middleware: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    handleRequest(new Request(url, { method: req.method, headers }), relayEnv, {
      waitUntil: (p) => void p.catch(() => undefined),
    })
      .then(async (r) => {
        res.statusCode = r.status;
        r.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await r.arrayBuffer()));
      })
      .catch((err: unknown) => {
        res.statusCode = 502;
        res.end(String(err));
      });
  };
  return {
    name: 'redcoast-dev-relay',
    configureServer(server) {
      server.middlewares.use('/relay', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/relay', middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // Relative asset paths: works at lproperty.github.io/RedCoast/ and anywhere else.
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: [devRelay(env)],
    server: { host: true },
    preview: { host: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 700,
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
