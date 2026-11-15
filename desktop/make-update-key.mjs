// Kinsay's update key (2026-11-15): every new Kinsay.exe is signed with it (pack-win.mjs) and the
// app installs an update only with a valid signature (Program.cs, Updater). The private key stays on
// Damian's PC, outside the repository: %USERPROFILE%\.kinsay\update-key.pem (back it up: without it
// no update can be published, and everyone would have to download the app again by hand). The public
// key goes into the app (win/UpdateKey.cs). Run once:   node desktop/make-update-key.mjs
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KEY_FILE =
  process.env.KINSAY_UPDATE_KEY ?? join(homedir(), '.kinsay', 'update-key.pem');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync(KEY_FILE)) {
    console.error(
      `A key is there already (${KEY_FILE}): a new one would stop every app from updating.`,
    );
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  const b64 = (s) => Buffer.from(s, 'base64url').toString('base64');
  const xml = `<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>`;
  writeFileSync(
    join(import.meta.dirname, 'win/UpdateKey.cs'),
    `// The public half of Kinsay's update key (desktop/make-update-key.mjs): an update must be signed\n// with its private half, which only Damian's PC holds.\nnamespace TranslateApp\n{\n    static class UpdateKey\n    {\n        public const string Public = "${xml}";\n    }\n}\n`,
  );
  console.log(`Key made. Private: ${KEY_FILE} (back it up). Public: desktop/win/UpdateKey.cs`);
}
