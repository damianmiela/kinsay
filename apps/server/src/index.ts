// Starts the server from the environment (.env in the project root; see .env.example).
import { resolve } from 'node:path';
import { EUR } from '@translate/shared';
import { sonioxConnect } from './engine';
import { brevoMailer } from './signin';
import { createServer } from './server';

const env = process.env;
const fail = (m: string) => {
  console.error(m);
  process.exit(1);
};
const adminPassword = env.ADMIN_PASSWORD ?? '';
const secret = env.SESSION_SECRET ?? '';
if (adminPassword.length < 12) fail('ADMIN_PASSWORD must be set (12 characters or more).');
if (secret.length < 32) fail('SESSION_SECRET must be set (32 characters or more).');
/** A setting in euros (the fallback in euros too), as micro-euros; -1: not set and no fallback. */
const euro = (name: string, fallback: number) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback < 0 ? -1 : Math.round(fallback * EUR);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) fail(`${name} must be a number of euros.`);
  return Math.round(n * EUR);
};
const price = euro('PRICE_EUR_PER_STREAM_HOUR', -1);
if (price < 0)
  fail('PRICE_EUR_PER_STREAM_HOUR must be set (what one stream costs per hour, in euros).');

// this app's own address: the links in emails and Google's way back
const publicUrl = env.PUBLIC_URL?.replace(/\/+$/, '') || undefined;
if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl))
  fail('PUBLIC_URL must look like https://translate.example.com');
const mail =
  env.BREVO_API_KEY && env.MAIL_FROM
    ? brevoMailer(env.BREVO_API_KEY, env.MAIL_FROM, env.MAIL_FROM_NAME || 'Translate')
    : undefined;
const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && publicUrl
    ? { clientId: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, publicUrl }
    : undefined;

const root = resolve(import.meta.dirname, '../../..');
const port = Number(env.PORT ?? 3300);
const server = await createServer({
  adminPassword,
  secret,
  dbFile: resolve(root, env.DATA_DIR ?? 'data', 'translate.db'),
  speech: env.SONIOX_API_KEY ? sonioxConnect(env.SONIOX_API_KEY) : null,
  streams: Number(env.SONIOX_STREAMS ?? 5),
  defaults: {
    pricePerHour: price,
    monthlyLimit: euro('MONTHLY_LIMIT_EUR', 5),
    globalLimit: euro('GLOBAL_LIMIT_EUR', 20),
  },
  trustProxy: env.TRUST_PROXY === 'true',
  mail,
  google,
  publicUrl,
  clientDist: resolve(root, 'apps/client/dist'),
  logger: true,
});
await server.app.listen({ port, host: env.HOST ?? '127.0.0.1' });
if (!env.SONIOX_API_KEY) server.app.log.warn('SONIOX_API_KEY is not set: no captions.');

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
