// Load test: one host and N readers (each its own address, like N phones) on a session in three
// languages, against the real app with the test server's fake speech service (tests/server.ts: a
// numbered sentence per second of audio). The host sends audio in real time for a while; measured:
// how long until a sentence reaches the readers (from the moment its last audio left the host),
// sentences lost, connections refused, and what the session cost.
//
//   npm run test:load            (200 readers; LOAD_READERS=500 npm run test:load for more)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';

const ROOT = resolve(import.meta.dirname, '../..');
const READERS = Number(process.env.LOAD_READERS || 200);
const SECONDS = Number(process.env.LOAD_SECONDS || 20);
const PASSWORD = `load-test-${Math.random().toString(36).slice(2)}`;
const LANGS = ['pl', 'es', 'de'];

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

const port = await freePort();
const URL = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'tests/server.ts'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      E2E_PORT: String(port),
      E2E_PASSWORD: PASSWORD,
      TRUST_PROXY: 'true',
      E2E_STREAMS: '5',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
let failed;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${URL}/health`)).ok) break;
    } catch {
      // not yet
    }
    await sleep(200);
  }
  const post = async (path, body, cookie = '') => {
    const r = await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: URL, cookie },
      body: JSON.stringify(body),
    });
    return { json: await r.json(), cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const admin = (await post('/admin/login', { password: PASSWORD })).cookie;
  const person = (await post('/admin/api/invite', { name: 'Load Host' }, admin)).json.person;
  const code = (await post('/admin/api/signin-code', { id: person.id }, admin)).json;
  const hostCookie = (await post('/api/signin/code', { digits: code.digits })).cookie;

  const connect = (opts) =>
    new Promise((ok, no) => {
      const s = io(URL, { transports: ['websocket'], forceNew: true, ...opts });
      s.once('connect', () => ok(s));
      s.once('connect_error', (e) => no(e));
    });
  const host = await connect({ extraHeaders: { origin: URL, cookie: hostCookie } });
  const state = await new Promise((ok) => host.once('state:session', ok));
  const started = await host.timeout(5000).emitWithAck('session:start', { lang: LANGS[0] });
  if (!started.ok) throw new Error(`start: ${started.error}`);

  // the readers, each from its own address, a third per language
  const got = new Map(); // `${reader}:${n}` -> time
  let refused = 0;
  const readers = [];
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: READERS }, async (_, i) => {
      const lang = LANGS[i % LANGS.length];
      try {
        const r = await connect({
          extraHeaders: {
            origin: URL,
            'x-forwarded-for': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
          },
          auth: { code: state.code },
        });
        r.on('captions', (u) => {
          for (const line of u.texts[lang]?.lines ?? []) {
            const n = /Sentence (\d+)\./.exec(line)?.[1];
            if (n && !got.has(`${i}:${n}`)) got.set(`${i}:${n}`, Date.now());
          }
        });
        if (i % LANGS.length) {
          const a = await r.timeout(10_000).emitWithAck('session:lang', { lang });
          if (!a.ok) throw new Error(a.error);
        }
        readers.push(r);
      } catch {
        refused++;
      }
    }),
  );
  const joinMs = Date.now() - t0;

  // the host's audio: 100 ms chunks in real time; when each second's last chunk left
  const sentAt = new Map();
  for (let k = 1; k <= SECONDS * 10; k++) {
    host.emit('host:audio', new Uint8Array(3200).buffer, {
      age: 0,
      seq: k,
      stream: 'mic-loadtest',
    });
    if (k % 10 === 0) sentAt.set(k / 10, Date.now());
    await sleep(100);
  }
  await sleep(3000);

  const delays = [];
  let lost = 0;
  for (let i = 0; i < READERS; i++) {
    if (!readers[i]) continue;
    for (let n = 1; n <= SECONDS; n++) {
      const at = got.get(`${i}:${n}`);
      if (at === undefined) lost++;
      else delays.push(at - sentAt.get(n));
    }
  }
  await host.timeout(5000).emitWithAck('session:stop');
  const st = await (await fetch(`${URL}/admin/api/state`, { headers: { cookie: admin } })).json();

  console.log(`readers: ${READERS} (${refused} refused), joined in ${joinMs} ms`);
  console.log(
    `a sentence reached the readers in: median ${pct(delays, 50)} ms, 95% ${pct(delays, 95)} ms, slowest ${Math.max(...delays)} ms`,
  );
  console.log(`sentences lost: ${lost} of ${readers.length * SECONDS}`);
  console.log(
    `the session cost: €${(st.month / 1e6).toFixed(4)} (${SECONDS} s × ${LANGS.length} streams at €0.20 an hour)`,
  );
  failed = refused > 0 || lost > 0 || pct(delays, 95) > 1000;
  for (const r of readers) r.close();
  host.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  server.kill();
}
console.log(failed ? 'LOAD TEST FAILED' : 'load test passed');
process.exit(failed ? 1 : 0);
