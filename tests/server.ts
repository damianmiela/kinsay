// The server for the browser and load tests: the real app (createServer) with a throwaway
// database and a fake speech service, so no test ever reaches Soniox or real data. Every second of
// audio a stream answers with a numbered sentence: "Sentence 3." as heard (in English), and for a
// stream that translates, "[pl] Sentence 3." as its translation.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EUR, HEARD } from '@translate/shared';
import type { SpeechConnect } from '../apps/server/src/engine';
import { createServer } from '../apps/server/src/server';

const env = process.env;
const work = mkdtempSync(join(tmpdir(), 'translate-test-'));
const SECOND = 16_000 * 2;

const fakeSpeech: SpeechConnect = (target, events) => {
  let bytes = 0;
  let n = 0;
  let open = true;
  return {
    send(chunk) {
      if (!open) return;
      bytes += chunk.length;
      while (bytes >= SECOND) {
        bytes -= SECOND;
        n++;
        const heard = {
          text: ` Sentence ${n}.`,
          language: 'en',
          translation_status: target === HEARD || target === 'en' ? 'none' : 'original',
        };
        events.tokens([
          heard,
          ...(target === HEARD || target === 'en'
            ? []
            : [{ text: ` [${target}] Sentence ${n}.`, translation_status: 'translation' }]),
          { text: '<end>' },
        ]);
      }
    },
    end() {
      if (!open) return;
      open = false;
      setTimeout(() => events.closed(), 10);
    },
  };
};

const server = await createServer({
  adminPassword: env.E2E_PASSWORD ?? 'e2e-admin-password',
  secret: 'test-session-secret-'.repeat(3),
  dbFile: join(work, 'translate.db'),
  speech: fakeSpeech,
  streams: Number(env.E2E_STREAMS ?? 5),
  defaults: { pricePerHour: 0.2 * EUR, monthlyLimit: 5 * EUR, globalLimit: 20 * EUR },
  trustProxy: env.TRUST_PROXY === 'true',
  clientDist: resolve(import.meta.dirname, '../apps/client/dist'),
});
await server.app.listen({ port: Number(env.E2E_PORT ?? 3297), host: '127.0.0.1' });
const bye = () => {
  void server.close().finally(() => {
    rmSync(work, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
