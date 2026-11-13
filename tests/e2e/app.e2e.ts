// The whole app in real browsers: signing in with the admin's code, captions with and without a
// translation, face to face, a reader by code, the credits, the account, the admin. The speech
// service is the test server's fake: every second of audio a numbered "Sentence N.".
import { expect, test } from '@playwright/test';
import { adminApi, pickInSheet, pickLang, PHONE, signedInPhone, smallestText } from './helpers';

test('face to face, two-way: each half in its person’s language, the bar between them', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  // Home: Just me is the default; Face to face asks both halves' languages
  await expect(page.getByRole('radio', { name: 'Just me' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: 'Face to face' }).click();
  await pickLang(page, 'tag', 'Tagalog', 0); // the top half
  await expect(page.locator('.picker-field').nth(1)).toContainText('English'); // the app's
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // the top half turned round in Tagalog, the bottom in English, the bar between them
  await expect(page.locator('.half.across .cap-line').first()).toContainText('[tl] Sentence');
  // (English speech in the English half: as heard, no translation needed)
  await expect(page.locator('.half:not(.across) .cap-line').first()).toContainText('Sentence');
  await expect(page.locator('.half:not(.across) .cap-line').first()).not.toContainText('[');
  expect(
    await page.locator('.half.across').evaluate((el) => getComputedStyle(el).transform),
  ).toMatch(/matrix\(-1, .*-1, 0, 0\)/);
  const bar = page.locator('.dual > .cbar');
  await expect(bar).toBeVisible();
  // the bar: Start/Stop a quarter, the languages a half, Settings a quarter, one height
  const widths = await bar
    .locator('.cbar-row > .cb')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(widths[1]! / widths[0]!).toBeGreaterThan(1.8);
  expect(Math.abs(widths[0]! - widths[2]!)).toBeLessThan(3);
  await expect(bar.locator('.cb.lang .tl')).toHaveText('Tagalog');
  // no sentence explains the screen
  await expect(page.locator('.cap-note')).toHaveCount(0);
  // the languages: each half on its own, and Swap
  await bar.locator('.cb.lang').click();
  await page.getByRole('button', { name: 'Swap the halves' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.half:not(.across) .cap-line').last()).toContainText('[tl] Sentence');
  await expect(page.locator('.half.across .cap-line').last()).not.toContainText('[tl]');
  // Settings: Invite first; face to face off gives one column
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.sheet .li').first()).toContainText('Invite someone');
  await page.getByRole('switch', { name: 'Face to face' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.main-band .cap-line').last()).toContainText('Sentence');
  // the page itself never scrolls (only the captions do); every text 16 px or more
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(
    true,
  );
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
  // Stop: the words stay, the same button says Start
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.locator('.cap-line').first()).toBeVisible();
});

test('the language list: no keyboard first; Other languages has the search and A to Z', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  await page.locator('.picker-field').click();
  const rows = page.locator('.sheet .lang-row');
  // no translation, then the five; nothing to type yet
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('No translation');
  await expect(rows.nth(1)).toContainText('Polski');
  await expect(page.locator('.sheet input')).toHaveCount(0);
  await page.locator('.sheet').getByRole('button', { name: 'Other languages' }).click();
  // the whole list under letters, the search on top
  await expect(page.locator('.sheet .letter').first()).toHaveText('A');
  expect(await rows.count()).toBe(60);
  await page.locator('.sheet .lang-search').fill('hu');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(page.locator('.picker-field')).toContainText('Magyar');
  // used before: on the short list from now on
  await page.locator('.picker-field').click();
  await expect(page.locator('.sheet .lang-row', { hasText: 'Magyar' })).toContainText(
    'used before',
  );
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
});

test('the microphone: asked for with a picture the first time; blocked, the steps, then on by itself', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { ctx } = await signedInPhone(browser, baseURL!, admin);
  // (the browser's answer played by the page: "prompt" (it would ask), "denied", "granted")
  const phone = async (state: string) => {
    const page = await ctx.newPage();
    await page.addInitScript((first) => {
      const w = window as unknown as { mic: string };
      w.mic = first;
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        w.mic === 'denied' ? Promise.reject(new DOMException('no', 'NotAllowedError')) : gum(c);
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) =>
        d.name === 'microphone'
          ? Promise.resolve({ state: w.mic, onchange: null } as never)
          : query(d);
    }, state);
    await page.goto('/');
    return page;
  };
  const first = await phone('prompt');
  await first.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(first.getByText('Translate needs the microphone')).toBeVisible();
  await first.getByRole('button', { name: 'Allow the microphone' }).click();
  await expect(first.locator('.cap-line').first()).toContainText('Sentence');
  await first.getByRole('button', { name: 'Stop' }).click();
  // asked once: the next Start goes straight on
  await first.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(first.getByText('Translate needs the microphone')).toHaveCount(0);
  await first.getByRole('button', { name: 'Stop' }).click();
  await first.close();

  const blocked = await phone('denied');
  await blocked.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(blocked.getByText('The microphone is blocked')).toBeVisible();
  await expect(blocked.locator('.steps li')).toHaveCount(2); // (this browser's: Chrome's)
  await expect(blocked.locator('.steps .k').first()).toHaveText('Microphone');
  await blocked.evaluate(() => ((window as unknown as { mic: string }).mic = 'granted'));
  await expect(blocked.getByText('The microphone is blocked')).toHaveCount(0);
  await expect(blocked.locator('.cap-line').first()).toContainText('Sentence');
  await blocked.getByRole('button', { name: 'Stop' }).click();
});

test('two devices: the other says where it listens, "Use this one" moves it; Settings has Account and App language', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const android =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const { page: phone, id } = await signedInPhone(browser, baseURL!, admin, {
    userAgent: android,
  });
  // the same person on a computer
  const code = await admin.post('/admin/api/signin-code', { id });
  const pcCtx = await browser.newContext({ baseURL, permissions: ['microphone'] });
  const pc = await pcCtx.newPage();
  await pc.goto('/signin');
  await pc.getByLabel('Type the code').fill(String(code.json.digits));
  await expect(pc.getByText('Start live captions')).toBeVisible();

  await phone.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(phone.locator('.cap-line').first()).toContainText('Sentence');
  // the computer: the captions, and where it listens
  await expect(pc.locator('.cbar .strip')).toContainText('Listening on your phone');
  await expect(pc.locator('.cap-line').first()).toContainText('Sentence');
  await pc.locator('.cbar').getByRole('button', { name: 'Use this one' }).click();
  await expect(pc.locator('.cbar .strip')).toHaveCount(0);
  await expect(phone.locator('.cbar .strip')).toContainText('Listening on your computer');
  // the captions go on from the computer's microphone
  const n = await phone.locator('.cap-line').count();
  await expect.poll(() => phone.locator('.cap-line').count()).toBeGreaterThan(n);
  // the phone's Settings: the Microphone group, Account as a sheet, App language as a list
  await phone.getByRole('button', { name: 'Settings' }).click();
  await expect(phone.locator('.sheet .grp', { hasText: 'Microphone' })).toContainText(
    'your computer',
  );
  await phone.locator('.sheet .grp', { hasText: 'Account' }).locator('.li').click();
  await expect(phone.locator('.sheet .acct-bal')).toContainText('€');
  await expect(phone.getByRole('link', { name: 'History and devices' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await phone.getByRole('button', { name: 'Back' }).click();
  await phone.getByRole('button', { name: /App language/ }).click();
  await expect(phone.locator('.sheet .lang-row')).toHaveCount(5);
  await phone.keyboard.press('Escape');
  // the phone takes it back
  await phone.locator('.cbar').getByRole('button', { name: 'Use this one' }).click();
  await expect(pc.locator('.cbar .strip')).toContainText('Listening on your phone');
  await phone.getByRole('button', { name: 'Stop' }).click();
  await pcCtx.close();
});

test('no translation: what is heard; the language button says Original and picks one', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.cap-line').first()).toContainText('Sentence');
  // (one language heard: no labels on the lines)
  await expect(page.locator('.cap-label')).toHaveCount(0);
  await expect(page.locator('.cbar .cb.lang')).toHaveText(/Original/);
  await page.locator('.cbar .cb.lang').click();
  await pickInSheet(page, 'pol', 'Polski');
  await expect(page.locator('.cap-line').last()).toContainText('[pl] Sentence');
  await expect(page.locator('.cbar .cb.lang')).toHaveText(/Polski/);
});

test('a reader joins by the code: the host’s language first, then their own', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page: host, name } = await signedInPhone(browser, baseURL!, admin);
  await pickLang(host, 'pol', 'Polski');
  await host.getByRole('button', { name: 'Start', exact: true }).click();
  // Invite is the first row of Settings
  await host.getByRole('button', { name: 'Settings' }).click();
  await host.getByRole('button', { name: 'Invite someone' }).click();
  const code = (await host.locator('.sheet .invite-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  expect(code).toMatch(/[A-Z]/); // (always a letter: six digits are a sign-in code)
  await expect(host.locator('.sheet')).toContainText('Works until');
  await host.keyboard.press('Escape');

  const readerCtx = await browser.newContext({ ...PHONE, baseURL });
  // (the device's voices played by the page: a Spanish one only, each line said in 50 ms)
  await readerCtx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.SpeechSynthesisUtterance = class {
      onend: (() => void) | null = null;
      constructor(public text: string) {}
    };
    const es = { lang: 'es-ES', name: 'es', default: true, localService: true, voiceURI: 'es' };
    Object.assign(speechSynthesis, {
      getVoices: () => [es],
      speak: (u: { onend: (() => void) | null }) => setTimeout(() => u.onend?.(), 50),
      cancel: () => {},
    });
  });
  const reader = await readerCtx.newPage();
  await reader.goto('/join');
  // the one door: no button, the sixth character joins; small letters come out as capitals
  await reader.getByLabel('Type the code').fill(code.toLowerCase());
  await expect(reader.locator('.who')).toContainText(`${name.split(' ')[0]}’s captions`);
  await expect(reader.locator('.who .live')).toBeVisible();
  await expect(reader.locator('.cap-line').first()).toContainText('[pl] Sentence');
  // their own language: one more stream
  await reader.locator('.cbar .cb.lang').click();
  await pickInSheet(reader, 'span', 'Español');
  await expect(reader.locator('.cap-line').last()).toContainText('[es] Sentence');
  // a reader never sees the code or the balance, and has no Stop
  await expect(reader.locator('.balance')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  // the reader's bar: Read aloud (an icon) where the host has Start/Stop, the language in the middle
  const row = reader.locator('.cbar-row > *');
  await expect(row.nth(0)).toHaveClass(/aloud/);
  await expect(row.nth(1)).toHaveClass(/lang/);
  // Read aloud: teal while it reads; the earphones line the first time
  await reader.getByRole('button', { name: 'Read aloud' }).click();
  await expect(reader.locator('.cb.aloud.on')).toHaveAttribute('aria-pressed', 'true');
  await expect(reader.locator('.cbar .strip')).toContainText('Best with earphones');
  await reader.getByRole('button', { name: 'Read aloud' }).click();
  await expect(reader.locator('.cb.aloud')).toHaveAttribute('aria-pressed', 'false');
  // no voice for a language: said, with where to add one, until ✕
  await reader.locator('.cbar .cb.lang').click();
  await pickInSheet(reader, 'deu', 'Deutsch');
  await reader.getByRole('button', { name: 'Read aloud' }).click();
  await expect(reader.locator('.cbar .strip')).toContainText('No Deutsch voice on this device');
  await expect(reader.locator('.cb.aloud.dim')).toBeVisible();
  await reader.locator('.cbar .strip .mini.x').click();
  await expect(reader.locator('.cbar .strip', { hasText: 'voice' })).toHaveCount(0);
  await reader.getByRole('button', { name: 'Read aloud' }).click();
  // the host stops: the reader's line is no longer live, the bar says when
  await host.getByRole('button', { name: 'Stop' }).click();
  await expect(reader.locator('.who .live')).toHaveCount(0);
  await expect(reader.locator('.cbar .strip')).toContainText(/stopped at \d\d:\d\d/);
  // Leave: a page of its own; Join again comes back
  await reader.getByRole('button', { name: 'Settings' }).click();
  await reader.getByRole('button', { name: /^Leave .*captions$/ }).click();
  await expect(reader.getByText(/You left .*captions/)).toBeVisible();
  await reader.getByRole('button', { name: 'Join again' }).click();
  await expect(reader.locator('.who')).toContainText('captions');
  // six digits at the same door are a sign-in code (a wrong one here)
  const door = await readerCtx.newPage();
  await door.goto('/join');
  await door.getByLabel('Type the code').fill('000000');
  await expect(door.locator('.note.bad')).toBeVisible();
  // a wrong code
  const other = await readerCtx.newPage();
  await other.goto('/join#ZZZZZZ');
  await expect(other.getByText('No captions with this code', { exact: false })).toBeVisible();
});

test('the credits: used as the audio goes; at zero the session stops and says so', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page, id } = await signedInPhone(browser, baseURL!, admin);
  // (very little left: a correction leaves a tenth of a cent)
  await admin.post('/admin/api/grant', { personId: id, amount: -999_000, kind: 'correction' });
  await admin.post('/admin/api/settings', { pricePerHour: 3600 * 1_000_000 });
  try {
    await page.reload();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    // stopped: the bar says why, its first button says Start again
    await expect(page.locator('.cbar .strip', { hasText: 'The balance is used up' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
    // Ask for more opens Account over the captions (never a page)
    await page.locator('.cbar').getByRole('button', { name: 'Ask for more' }).click();
    await expect(page.locator('.sheet .acct-bal')).toHaveText('€0.00');
    await expect(page.locator('.cbar .strip', { hasText: 'used up' })).toBeAttached();
    await page.keyboard.press('Escape');
  } finally {
    await admin.post('/admin/api/settings', { pricePerHour: 200_000 });
  }
  // the account: the session's line, then asking for more; the admin's one tap grants it
  await page.goto('/account');
  await expect(page.getByText('Captions, No translation')).toBeVisible();
  await page.getByRole('button', { name: '€2' }).click();
  await page.getByRole('button', { name: 'Send the request' }).click();
  // the request in the history with its state
  await expect(page.locator('.li', { hasText: 'Your request, €2' })).toContainText('Waiting');
  const state = await admin.get('/admin/api/state');
  const req = (state.requests as { id: number; person_id: number }[]).find(
    (r) => r.person_id === id,
  )!;
  expect(
    (await admin.post('/admin/api/grant', { personId: id, amount: 2_000_000, requestId: req.id }))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator('.li', { hasText: 'Your request, €2' })).toContainText('Added');
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
});

test('the admin: sign in, invite, a sign-in code with its QR; an encoded address is refused', async ({
  browser,
  baseURL,
  request,
}) => {
  for (const path of ['/admin/%61pi/state', '/%61dmin/api/state']) {
    expect((await request.get(path)).status()).toBe(401);
  }
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  await page.goto('/admin');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();
  await page.getByLabel('Password').fill((await import('./playwright.config')).PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'People' }).click();
  await page.getByLabel('Name').fill('Grandpa Example');
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByRole('cell', { name: 'Grandpa Example' }).click();
  await page.getByRole('button', { name: 'Sign in a device' }).click();
  await expect(page.locator('.digits span')).toHaveCount(6);
  await expect(page.locator('.sheet .qr')).toBeVisible();
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
});

test('the pages ask nothing of any other site, and every text is 16 px or more', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({ ...PHONE, baseURL });
  const page = await ctx.newPage();
  const elsewhere: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:')) elsewhere.push(r.url());
  });
  for (const path of ['/', '/signin', '/join', '/admin', '/privacy', '/download']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect((await smallestText(page)).px, path).toBeGreaterThanOrEqual(16);
  }
  expect(elsewhere).toEqual([]);
});

test('face to face: both halves follow their newest line alike; scrolled back, "Latest" returns', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  await page.getByRole('radio', { name: 'Face to face' }).click();
  await pickLang(page, 'pol', 'Polski', 0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // (more lines than a half holds: a sentence a second)
  await expect(page.locator('.half.across .cap-line')).toHaveCount(14, { timeout: 40_000 });
  for (const half of ['.half.across', '.half:not(.across)']) {
    const box = page.locator(`${half} .cap-scroll`);
    // the newest line in sight, as far from the half's reading edge as the bottom half's is from
    // its own (the top half's is the screen's top, under the bar)
    const gap = () =>
      box.evaluate((b, turned) => {
        const lines = b.querySelectorAll('.cap-line');
        const r = lines[lines.length - 1]!.getBoundingClientRect();
        const h = b.getBoundingClientRect();
        return turned ? r.top - h.top : h.bottom - r.bottom;
      }, half === '.half.across');
    await expect.poll(gap).toBeGreaterThan(10);
    expect(await gap()).toBeLessThan(80);
    // scrolled back: "Latest"; tapped: the newest line again
    await box.hover();
    await page.mouse.wheel(0, -400);
    const latest = page.locator(`${half} .cap-latest`);
    await expect(latest).toBeVisible();
    await latest.click();
    await expect(latest).toBeHidden();
    await expect.poll(gap).toBeGreaterThan(10);
    expect(await gap()).toBeLessThan(80);
  }
});

test('the subtitles window: signed in through the person’s own browser, then its captions', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page: phone } = await signedInPhone(browser, baseURL!, admin);
  // the window (a computer, nobody signed in): it opens the browser at /app-signin
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: 760, height: 300 },
    permissions: ['microphone'],
  });
  const win = await ctx.newPage();
  await win.goto('/window');
  const [tab] = await Promise.all([
    win.waitForEvent('popup'),
    win.getByRole('button', { name: 'Sign in in the browser' }).click(),
  ]);
  const digits = (await win.locator('.lw-digits').textContent())!.replace(/\s/g, '');
  expect(digits).toMatch(/^\d{6}$/);
  expect((await smallestText(win)).px).toBeGreaterThanOrEqual(16);
  // the person's own browser (here: the signed-in phone) gets the link: the same digits, yes
  const link = tab.url();
  await tab.close();
  await phone.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(phone.locator('.app-digits')).toHaveText(`${digits.slice(0, 3)} ${digits.slice(3)}`);
  await phone.getByRole('button', { name: 'Yes, sign it in' }).click();
  await expect(phone.getByText('Done.')).toBeVisible();
  // the window carries on by itself: the start panel, then captions from the microphone
  await expect(win.getByRole('button', { name: 'Start' })).toBeVisible({ timeout: 10_000 });
  await win.getByRole('button', { name: /^Microphone/ }).click();
  await win.getByRole('button', { name: 'Start' }).click();
  await expect(win.locator('.lw .cap-line').last()).toContainText('Sentence', { timeout: 10_000 });
  expect((await smallestText(win)).px).toBeGreaterThanOrEqual(16);
  // the whole history, centred like subtitles; scrolled back, "Latest" (Damian)
  await expect(win.locator('.lw .cap-line')).toHaveCount(8, { timeout: 20_000 });
  expect(
    await win
      .locator('.lw .cap-line')
      .first()
      .evaluate((el) => getComputedStyle(el).textAlign),
  ).toBe('center');
  await win.locator('.lw .cap-scroll').hover();
  await win.mouse.wheel(0, -400);
  await expect(win.locator('.lw .cap-latest')).toBeVisible();
  await win.locator('.lw .cap-latest').click();
  await expect(win.locator('.lw .cap-latest')).toBeHidden();
  // the language list opens inside the window, never past its edge (300 px high)
  await win.getByRole('button', { name: 'Translate into' }).click();
  const drop = (await win.locator('.picker-drop').boundingBox())!;
  expect(drop.y + drop.height).toBeLessThanOrEqual(300);
  await expect(win.locator('.picker-list button').nth(3)).toBeInViewport();
  await win.keyboard.press('Escape');
  // the strip is the phone's bar: Stop, the language, Settings; a "Live" that stays
  const strip = win.locator('.lw-ctl > button');
  await expect(strip.nth(0)).toHaveClass(/stop/);
  await expect(strip.nth(1)).toHaveClass(/lang/);
  await expect(win.locator('.lw-live')).toBeVisible();
  // its Settings in groups: Invite first, then the microphone (the chosen one marked)
  await win.getByRole('button', { name: 'Settings' }).click();
  await expect(win.locator('.lw-menu .r').first()).toHaveText('Invite someone');
  await expect(win.locator('.lw-menu h6').first()).toHaveText('Microphone');
  await expect(win.locator('.lw-menu .r.sel')).toContainText('Microphone');
  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('button', { name: /Stop/ }).click();
  await expect(win.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(win.locator('.lw-live')).toHaveCount(0);
});

test('a browser that isn’t signed in signs in first, then answers the desktop app', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({ ...PHONE, baseURL });
  const page = await ctx.newPage();
  const r = await ctx.request.post('/api/app-signin/start', { headers: { origin: baseURL! } });
  const { token } = (await r.json()) as { token: string };
  await page.goto(`/app-signin#t=${token}`);
  await expect(page.getByText('the desktop app is waiting for it', { exact: false })).toBeVisible();
  // signed in with the admin's code (the code page returns to /, which goes back to the question)
  const admin = await adminApi(browser, baseURL!);
  const inv = await admin.post('/admin/api/invite', { name: 'Desk Example' });
  const code = await admin.post('/admin/api/signin-code', {
    id: (inv.json.person as { id: number }).id,
  });
  await page.goto('/signin');
  await page.getByLabel('Type the code').fill(String(code.json.digits));
  await expect(page.getByText('Sign in the desktop app?')).toBeVisible({ timeout: 10_000 });
});

test('the pages in the browser’s language (Polish here); the switch at the foot changes it', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({ ...PHONE, baseURL, locale: 'pl-PL' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByText('Napisy na żywo, w Twoim języku')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('pl');
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
  for (const path of ['/join', '/privacy', '/window']) {
    await page.goto(path);
    expect((await smallestText(page)).px, path).toBeGreaterThanOrEqual(16);
  }
  await page.goto('/');
  await page.getByLabel('Język aplikacji').selectOption('de');
  await expect(page.getByText('Live-Untertitel, in deiner Sprache')).toBeVisible();
  await page.getByLabel('App-Sprache').selectOption('en');
  await expect(page.getByText('Live captions, in your language')).toBeVisible();
});

test('the download page: the desktop app as one file, saved as a download', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: 'Windows app' }).click();
  await expect(page.getByRole('heading', { name: 'Translate for Windows' })).toBeVisible();
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download Translate' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('Translate.exe');
  const r = await ctx.request.get('/download/Translate.exe');
  expect(r.headers()['content-disposition']).toBe('attachment');
  const body = await r.body();
  expect(body.subarray(0, 2).toString()).toBe('MZ'); // (a Windows program)
  expect(body.length).toBeGreaterThan(500_000);
});

test('a phone that can’t keep its screen on by itself is asked to, while it listens', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  // (as an iPhone before iOS 16.4: no wake lock)
  await page.addInitScript(() => {
    delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Keep the screen on while it listens')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
});
