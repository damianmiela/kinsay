// What the browser tests share: the admin's API, a person invited and signed in on a phone.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD } from './playwright.config';

export const PHONE = { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true };

/**
 * The admin, as a signed-in API client (Playwright's request context keeps the cookie). Signed in
 * once for all the tests: the login allows 10 an address in 15 minutes.
 */
let admin: ReturnType<typeof login> | undefined;
export const adminApi = (browser: Browser, baseURL: string) => (admin ??= login(browser, baseURL));

async function login(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL });
  const r = await ctx.request.post('/admin/login', {
    data: { password: PASSWORD },
    headers: { origin: baseURL },
  });
  expect(r.status()).toBe(200);
  const post = async (path: string, data: object) => {
    const res = await ctx.request.post(path, { data, headers: { origin: baseURL } });
    return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
  };
  const get = async (path: string) =>
    (await (await ctx.request.get(path)).json()) as Record<string, unknown>;
  return { ctx, post, get };
}

let names = 0;
/** Someone invited (a fresh name each time) and signed in on a new phone with the admin's code. */
export async function signedInPhone(
  browser: Browser,
  baseURL: string,
  admin: Awaited<ReturnType<typeof adminApi>>,
  extra: Parameters<Browser['newContext']>[0] = {},
): Promise<{ ctx: BrowserContext; page: Page; id: number; name: string }> {
  const name = `Tester${++names} Example`;
  const inv = await admin.post('/admin/api/invite', { name });
  const id = (inv.json.person as { id: number }).id;
  const code = await admin.post('/admin/api/signin-code', { id });
  const ctx = await browser.newContext({
    ...PHONE,
    baseURL,
    permissions: ['microphone'],
    ...extra,
  });
  const page = await ctx.newPage();
  await page.goto('/signin');
  await page.getByLabel('Type the sign-in code').fill(String(code.json.digits));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Start live captions')).toBeVisible();
  return { ctx, page, id, name };
}

/** Picks a language with the field (the `nth` on the page), in the sheet it opens. */
export async function pickLang(page: Page, search: string, name: string, nth = 0) {
  await page.locator('.picker-field').nth(nth).click();
  await pickInSheet(page, search, name);
}

/** Picks a language in the open list: from the short list, else through "Other languages". */
export async function pickInSheet(page: Page, search: string, name: string) {
  const short = page.locator('.sheet .lang-row', { hasText: name });
  if (await short.count()) return short.first().click();
  await page.locator('.sheet').getByRole('button', { name: 'Other languages' }).click();
  await page.locator('.sheet .lang-search').fill(search);
  await page.locator('.sheet .lang-row', { hasText: name }).first().click();
}

/** No text on the page smaller than 16 px (older people read these pages). */
export async function smallestText(page: Page): Promise<{ px: number; text: string }> {
  return page.evaluate(() => {
    let min = { px: Infinity, text: '' };
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim()) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < min.px) min = { px, text: n.textContent.trim().slice(0, 40) };
    }
    return min;
  });
}
