// Kinsay's icons from one source (logo approved 2026-11-14: mockups kinsay-2, no. 7: Nunito Black's
// k in a speech bubble). Writes the web icons (apps/client/public/icons), the Windows app's icon
// (desktop/win/kinsay.ico) and the brand sheet (docs/brand). The k is Nunito Black's outline (SIL
// Open Font License), so no font is needed here.   node scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEAL = '#0b6e79';
const BUBBLE =
  'M176 96h160a80 80 0 0 1 80 80v128a80 80 0 0 1-80 80h-84l-92 64 22-64h-6a80 80 0 0 1-80-80V176a80 80 0 0 1 80-80z';
const K =
  'M208 348Q195.4 348 188.5 341.1Q181.7 334.3 181.7 321.1V158.9Q181.7 145.7 188.5 138.9Q195.4 132 208 132Q220.8 132 227.8 138.9Q234.8 145.7 234.8 158.9V257.5H235.4L271.9 213.3Q279.4 204.3 285.8 200Q292.2 195.6 303.3 195.6Q314.3 195.6 320.3 201Q326.3 206.4 326.6 214.5Q326.9 222.5 320 230.6L280.6 277.2V258.7L324.8 314.2Q331.3 322.6 330.1 330.5Q329 338.4 322.5 343.2Q316.1 348 306.2 348Q294.3 348 287.1 343.7Q280 339.3 272.8 330.1L235.4 284.1H234.8V321.1Q234.8 348 208 348Z';

/** `rounded`: the app icon's own corners; `bleed`: a full square (iOS and Android round it); `scale`: the bubble's size. */
const svg = ({ rounded = true, scale = 1, bg = TEAL } = {}) => {
  const t =
    scale === 1 ? '' : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512"${
    rounded ? ' rx="116"' : ''
  } fill="${bg}"/><g${t}><path d="${BUBBLE}" fill="#fff"/><path d="${K}" fill="${TEAL}"/></g></svg>`;
};

const icons = join(root, 'apps/client/public/icons');
const brand = join(root, 'docs/brand');
mkdirSync(brand, { recursive: true });
writeFileSync(join(icons, 'icon.svg'), svg() + '\n');
writeFileSync(join(brand, 'kinsay-icon.svg'), svg() + '\n');

const font = readFileSync(
  join(
    root,
    'node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2',
  ),
).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
/** One picture: `html` drawn at w × h, transparent around it. */
async function png(html, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>@font-face{font-family:A;src:url(data:font/woff2;base64,${font})}html,body{margin:0;background:transparent}
     svg{display:block;width:${w}px;height:${h}px}</style>${html}`,
  );
  await page.evaluate(() => globalThis.document.fonts.ready);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const at = (s, o) => png(svg(o), s, s);

// the website's icons (the manifest's, the tab's, iOS's)
for (const [name, size, o] of [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512, { rounded: false, scale: 0.78 }],
  ['apple-touch-icon.png', 180, { rounded: false }],
]) {
  writeFileSync(join(icons, name), await at(size, o));
}

// the Windows app's icon: every size Windows asks for, as PNGs inside one .ico
const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
const pngs = [];
for (const s of sizes) pngs.push(await at(s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, e);
  head.writeUInt8(s === 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync(join(root, 'desktop/win/kinsay.ico'), Buffer.concat([head, ...pngs]));

// the brand sheet: the logo with its name, light and dark, and every size side by side
const word = (ink, bg) =>
  `<div style="display:flex;align-items:center;gap:36px;padding:48px 64px;background:${bg};width:900px;height:300px;box-sizing:border-box">
     ${svg().replace('<svg ', '<svg style="width:200px;height:200px" ')}
     <span style="font:700 120px A;color:${ink};letter-spacing:-1px">Kinsay</span></div>`;
writeFileSync(
  join(brand, 'kinsay-wordmark-light.png'),
  await png(word('#18222d', '#ffffff'), 900, 300),
);
writeFileSync(
  join(brand, 'kinsay-wordmark-dark.png'),
  await png(word('#ffffff', '#121016'), 900, 300),
);
writeFileSync(
  join(brand, 'kinsay-wordmark.png'),
  await png(word('#18222d', 'transparent'), 900, 300),
);
for (const s of [64, 128, 256, 512, 1024])
  writeFileSync(join(brand, `kinsay-icon-${s}.png`), await at(s));
const cell = (label, inner) =>
  `<figure style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:10px;font:700 18px A;color:#4d5a68">${inner}<figcaption>${label}</figcaption></figure>`;
const img = (o, s, extra = '') =>
  svg(o).replace('<svg ', `<svg style="width:${s}px;height:${s}px;${extra}" `);
const sheet = `<div style="background:#f6f8fa;width:1400px;height:900px;box-sizing:border-box;padding:56px;font-family:A">
  <div style="font:700 44px A;color:#18222d;margin-bottom:36px">Kinsay: the logo and its sizes</div>
  <div style="display:flex;gap:44px;align-items:flex-end;margin-bottom:56px">
    ${cell('App icon, 512', img({}, 220))}
    ${cell('Android (maskable)', img({ rounded: false, scale: 0.78 }, 160, 'border-radius:50%'))}
    ${cell('iPhone', img({ rounded: false }, 160, 'border-radius:36px'))}
    ${cell('192', img({}, 96))}${cell('64', img({}, 64))}${cell('32', img({}, 32))}${cell('16', img({}, 16))}
  </div>
  <div style="display:flex;gap:28px">
    <div style="border-radius:24px;overflow:hidden;width:630px;height:210px">${word('#18222d', '#ffffff').replace('width:900px;height:300px', 'width:900px;height:300px;transform:scale(.7);transform-origin:0 0')}</div>
    <div style="border-radius:24px;overflow:hidden;width:630px;height:210px">${word('#ffffff', '#121016').replace('width:900px;height:300px', 'width:900px;height:300px;transform:scale(.7);transform-origin:0 0')}</div>
  </div></div>`;
writeFileSync(join(brand, 'kinsay-sheet.png'), await png(sheet, 1400, 720));
await browser.close();
console.log('icons written');
