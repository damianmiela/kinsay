// Packs Kinsay's desktop app (desktop/win): stamps its build number (win/Build.cs), builds it (one
// file: its libraries inside, see Translate.csproj), copies Kinsay.exe to
// apps/client/public/download/ (where the website serves it, /download) and signs it there for the
// apps' own updates (version.json: the build, the file's SHA-256 and the signature of both, with the
// update key from make-update-key.mjs). Run on Damian's PC (needs the .NET SDK and the key) before a
// deploy that changes the app: node desktop/pack-win.mjs
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { KEY_FILE } from './make-update-key.mjs';

const here = import.meta.dirname;
if (!existsSync(KEY_FILE)) {
  console.error(
    `No update key at ${KEY_FILE}: run node desktop/make-update-key.mjs once (or restore its backup).`,
  );
  process.exit(1);
}
// (a number that only grows: the date and time of the build, UTC)
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
writeFileSync(
  join(here, 'win/Build.cs'),
  `// Written by desktop/pack-win.mjs: this build's number (an update is a higher one).\nnamespace TranslateApp\n{\n    static class BuildInfo\n    {\n        public const long Build = ${build};\n    }\n}\n`,
);
execFileSync('dotnet', ['build', '-c', 'Release'], { cwd: join(here, 'win'), stdio: 'inherit' });
const out = join(here, '../apps/client/public/download');
mkdirSync(out, { recursive: true });
const exe = join(out, 'Kinsay.exe');
copyFileSync(join(here, 'win/bin/Release/net48/Kinsay.exe'), exe);
const sha256 = createHash('sha256').update(readFileSync(exe)).digest('hex');
const sig = sign(
  'sha256',
  Buffer.from(`${build}\n${sha256}`),
  createPrivateKey(readFileSync(KEY_FILE)),
);
writeFileSync(
  join(out, 'version.json'),
  JSON.stringify({ build: Number(build), sha256, sig: sig.toString('base64') }, null, 2) + '\n',
);
console.log('packed', exe, `${Math.round(statSync(exe).size / 1024)} KB`, 'build', build);
