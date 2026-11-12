// Packs Translate's desktop app (desktop/win): builds it (one file: its libraries inside, see
// Translate.csproj) and copies Translate.exe to apps/client/public/download/, where the website
// serves it (/download). Run on Damian's PC (needs the .NET SDK) before a deploy that changes the
// app: node desktop/pack-win.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
execFileSync('dotnet', ['build', '-c', 'Release'], { cwd: join(here, 'win'), stdio: 'inherit' });
const out = join(here, '../apps/client/public/download');
mkdirSync(out, { recursive: true });
const exe = join(out, 'Translate.exe');
copyFileSync(join(here, 'win/bin/Release/net48/Translate.exe'), exe);
console.log('packed', exe, `${Math.round(statSync(exe).size / 1024)} KB`);
