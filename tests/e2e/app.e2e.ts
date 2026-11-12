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
  for (const path of ['/', '/signin', '/join', '/admin']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect((await smallestText(page)).px, path).toBeGreaterThanOrEqual(16);
  }
  expect(elsewhere).toEqual([]);
});
