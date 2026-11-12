// The whole app in real browsers: signing in with the admin's code, captions with and without a
// translation, face to face, a reader by code, the credits, the account, the admin. The speech
// service is the test server's fake: every second of audio a numbered "Sentence N.".
import { expect, test } from '@playwright/test';
import { adminApi, pickLang, PHONE, signedInPhone, smallestText } from './helpers';

test('a host starts with a translation: face to face, then the translation alone, the gear', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  await pickLang(page, 'tag', 'Tagalog');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.live-dot')).toHaveText('Live · Tagalog');
  // face to face: the top half turned round with the translation, the bottom what is heard
  await expect(page.locator('.half.across .cap-line').first()).toContainText('[tl] Sentence');
  await expect(page.locator('.half:not(.across) .cap-line').first()).toContainText('Sentence');
  expect(
    await page.locator('.half.across').evaluate((el) => getComputedStyle(el).transform),
  ).toMatch(/matrix\(-1, .*-1, 0, 0\)/);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.locator('.main-band .cap-line').first()).toContainText('[tl] Sentence');
  // the gear: "Show what was heard" adds its band
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Show what was heard' }).click();
  await page.getByRole('button', { name: 'Back to captions' }).click();
  await expect(page.locator('.heard-band .cap-line').first()).toContainText('Sentence');
  // the page itself never scrolls (only the captions do)
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(
    true,
  );
  expect((await smallestText(page)).px).toBeGreaterThanOrEqual(16);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Start captions')).toBeVisible();
});

test('no translation: what is heard with its language; "Translate" turns it into face to face', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page } = await signedInPhone(browser, baseURL!, admin);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.cap-line').first()).toContainText('Sentence');
  await expect(page.locator('.cap-label').first()).toHaveText('English');
  await page.getByRole('button', { name: 'Translate' }).click();
  await page.locator('.sheet .picker-drop input').fill('pol');
  await page.locator('.sheet .picker-list button', { hasText: 'Polski' }).click();
  await expect(page.locator('.half.across .cap-line').first()).toContainText('[pl] Sentence');
});

test('a reader joins by the code: the host’s language first, then their own', async ({
  browser,
  baseURL,
}) => {
  const admin = await adminApi(browser, baseURL!);
  const { page: host, name } = await signedInPhone(browser, baseURL!, admin);
  await pickLang(host, 'pol', 'Polski');
  await host.getByRole('button', { name: 'Start' }).click();
  await host.getByRole('button', { name: 'Invite' }).click();
  const code = (await host.locator('.sheet .input.code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await host.keyboard.press('Escape');

  const readerCtx = await browser.newContext({ ...PHONE, baseURL });
  const reader = await readerCtx.newPage();
  await reader.goto('/join');
  await reader.getByLabel('The code').fill(code.toLowerCase());
  await reader.getByRole('button', { name: 'Join' }).click();
  await expect(reader.locator('.live-dot')).toHaveText(`${name.split(' ')[0]}’s captions`);
  await expect(reader.locator('.cap-line').first()).toContainText('[pl] Sentence');
  // their own language: one more stream
  await reader.getByRole('button', { name: 'Settings' }).click();
  await pickLang(reader, 'span', 'Español');
  await reader.keyboard.press('Escape');
  await expect(reader.locator('.cap-line').first()).toContainText('[es] Sentence');
  // a reader never sees the code or the balance, and has no Stop
  await expect(reader.locator('.chip')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  // the host stops: the reader waits
  await host.getByRole('button', { name: 'Stop' }).click();
  await expect(reader.getByText(/Waiting for/)).toBeVisible();
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
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Out of credits', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for more' })).toBeVisible();
  } finally {
    await admin.post('/admin/api/settings', { pricePerHour: 200_000 });
  }
  // the account: the session's line, then asking for more; the admin's one tap grants it
  await page.goto('/account');
  await expect(page.getByText('Captions, No translation')).toBeVisible();
  await page.getByRole('button', { name: '€2' }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Waiting')).toBeVisible();
  const state = await admin.get('/admin/api/state');
  const req = (state.requests as { id: number; person_id: number }[]).find(
    (r) => r.person_id === id,
  )!;
  expect(
    (await admin.post('/admin/api/grant', { personId: id, amount: 2_000_000, requestId: req.id }))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.getByText('Added').first()).toBeVisible();
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
  for (const path of ['/', '/signin', '/join', '/admin', '/privacy']) {
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
  await pickLang(page, 'pol', 'Polski');
  await page.getByRole('button', { name: 'Start' }).click();
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
  await expect(win.locator('.lw-ln').last()).toContainText('Sentence', { timeout: 10_000 });
  expect((await smallestText(win)).px).toBeGreaterThanOrEqual(16);
  await win.getByRole('button', { name: /Stop/ }).click();
  await expect(win.getByRole('button', { name: 'Start' })).toBeVisible();
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
  await page.getByLabel('Type the sign-in code').fill(String(code.json.digits));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Sign in the desktop app?')).toBeVisible({ timeout: 10_000 });
});
