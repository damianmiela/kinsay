// The app's one server: Fastify serves the built pages and the API, Socket.IO the captions.
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { routes } from './http';
import { Store, type Settings } from './db';
import type { SpeechConnect } from './engine';
import { attachRealtime, type Realtime } from './realtime';

export interface Config {
  adminPassword: string;
  secret: string;
  dbFile: string;
  speech: SpeechConnect | null;
  /** Soniox streams this app may hold at once (they are counted per Soniox organization). */
  streams: number;
  defaults: Settings;
  trustProxy: boolean;
  clientDist?: string;
  now?: () => number;
  logger?: boolean;
}

/** The pages (the client picks the screen by its path). */
const PAGES = new Set(['/', '/join', '/signin', '/account', '/admin']);

export async function createServer(c: Config) {
  const app = Fastify({ logger: c.logger ?? false, trustProxy: c.trustProxy, bodyLimit: 16_384 });
  const store = new Store(c.dbFile, c.defaults, c.now);
  // (the routes need the realtime part, which needs the HTTP server ready first)
  const rt: { now?: Realtime } = {};

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    // only the app's own code runs (the microphone's worklet comes from a blob)
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (request.url.startsWith('/api/') || request.url.startsWith('/admin/')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  routes(app, {
    store,
    realtime: () => rt.now!,
    adminPassword: c.adminPassword,
    secret: c.secret,
    trustProxy: c.trustProxy,
    now: c.now,
  });

  app.get('/health', () => ({ ok: true }));

  const dist = c.clientDist && existsSync(c.clientDist) ? resolve(c.clientDist) : undefined;
  if (dist) {
    await app.register(fastifyStatic, {
      root: dist,
      index: false,
      cacheControl: false,
      setHeaders: (reply, path) => {
        const top = relative(dist, path).replace(/\\/g, '/').split('/')[0];
        reply.header(
          'Cache-Control',
          top === 'assets' ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }
  const indexHtml = dist ? readFileSync(resolve(dist, 'index.html'), 'utf8') : undefined;

  // the pages get index.html (routes of their own: the static server would answer "/" as a folder)
  if (indexHtml) {
    for (const page of PAGES) {
      app.get(page, (_, reply) =>
        reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml),
      );
    }
  }
  // anything else a plain 404 (never the raw URL in a log)
  app.setNotFoundHandler((_, reply) => reply.code(404).send({ ok: false, error: 'not-found' }));

  await app.ready();
  const realtime = attachRealtime(app.server, {
    store,
    speech: c.speech,
    streams: c.streams,
    trustProxy: c.trustProxy,
    now: c.now,
    warn: (m) => app.log.warn(m),
  });
  rt.now = realtime;

  return {
    app,
    store,
    realtime,
    async close() {
      realtime.close();
      await app.close();
      store.close();
    },
  };
}
