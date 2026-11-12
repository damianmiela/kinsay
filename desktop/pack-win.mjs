// Packs Translate's desktop app (desktop/win): builds it, copies only what it needs into
// out/Translate/ and zips it as out/Translate-win-x64.zip (never tracked).
// Run on Damian's PC (needs the .NET SDK): node desktop/pack-win.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
execFileSync('dotnet', ['build', '-c', 'Release'], { cwd: join(here, 'win'), stdio: 'inherit' });
const built = join(here, 'win/bin/Release/net48');
const out = join(here, 'out');
const app = join(out, 'Translate');
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
// (not the WPF part of WebView2, not the debug symbols)
for (const f of [
  'Translate.exe',
  'Translate.exe.config',
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'WebView2Loader.dll',
  'NAudio.Core.dll',
  'NAudio.Wasapi.dll',
]) {
  copyFileSync(join(built, f), join(app, f));
}
const zip = join(out, 'Translate-win-x64.zip');
rmSync(zip, { force: true });
execFileSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${app}' -DestinationPath '${zip}'`,
]);
console.log('packed', zip);
