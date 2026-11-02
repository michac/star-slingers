import { expect, test, type Page } from '@playwright/test';

/**
 * Service-worker check (#10), run by `npm run test:pwa` against the production
 * build on `wrangler dev`, once per engine (Chromium + WebKit).
 *
 * The rule it enforces: `public/sw.js` must never cache a redirected response.
 * Cloudflare redirects `/index.html` → `/` and `x.html` → `x`, and WebKit (every
 * iPhone browser) refuses a page the service worker answers with a redirected
 * response ("Response served by service worker has redirections"), while Chrome
 * shrugs it off. That's what broke the card-games prototype's iPhone install.
 */

/** Every cached response that came through a redirect, as "<url>" strings. */
async function redirectedInCache(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const bad: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (res?.redirected) bad.push(req.url);
      }
    }
    return bad;
  });
}

/** How many cached entries share this URL's path, whatever their query string. */
async function cachedVariants(page: Page, path: string): Promise<number> {
  return page.evaluate(async (url) => {
    let n = 0;
    for (const name of await caches.keys()) {
      n += (await (await caches.open(name)).matchAll(url, { ignoreSearch: true })).length;
    }
    return n;
  }, path);
}

/** Wait until the game has booted and drawn its canvas. */
async function expectGameBooted(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!document.querySelector('canvas') &&
      !!(window as unknown as { __game?: { isBooted: boolean } }).__game?.isBooted,
    null,
    { timeout: 30_000 },
  );
}

test('service worker survives redirects and boots the game offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await test.step('boot / and let the service worker take control', async () => {
    await page.goto('/');
    await expectGameBooted(page);
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  });

  await test.step('reload / through the service worker', async () => {
    await page.reload();
    await expectGameBooted(page);
  });

  // Each redirect is asserted, so the check fails loudly if the server ever stops
  // redirecting (say, swapped for `vite preview`) instead of silently losing coverage.
  await test.step('/index.html redirects to /', async () => {
    await page.goto('/index.html');
    await expect(page).toHaveURL('/');
    await expectGameBooted(page);
  });

  await test.step('/prototype/ shelf loads', async () => {
    await page.goto('/prototype/');
    await expect(page).toHaveTitle(/Prototype Shelf/);
  });

  await test.step('/prototype/glow-lab.html redirects to /prototype/glow-lab', async () => {
    await page.goto('/prototype/glow-lab.html');
    await expect(page).toHaveURL('/prototype/glow-lab');
    await expect(page).toHaveTitle(/Glow Lab/);
  });

  // Every query variant is the same static HTML, so the SW keeps one entry per path:
  // a stale `/?boss` copy can never shadow the fresh `/` offline.
  await test.step('/?boss then / leaves one cached entry for /', async () => {
    await page.goto('/?boss');
    await expectGameBooted(page);
    await page.goto('/');
    await expectGameBooted(page);
    expect(await cachedVariants(page, '/')).toBe(1);
  });

  // The test's context is discarded afterwards, so it never has to go back online.
  await test.step('offline: reload / and the game still boots', async () => {
    await page.goto('/');
    await expectGameBooted(page);
    await context.setOffline(true);
    await page.reload();
    await expectGameBooted(page);
  });

  // Never visited online, so only the SW's navigation fallback can answer it.
  await test.step('offline: an uncached query URL (/?controls=v2) still boots the game', async () => {
    await page.goto('/?controls=v2');
    await expect(page).toHaveURL('/?controls=v2');
    await expectGameBooted(page);
  });

  // Offline fetches fail before anything is cached, so this one check covers the
  // online visits above too.
  await test.step('no cached response came through a redirect', async () => {
    expect(await redirectedInCache(page)).toEqual([]);
  });

  // A page never visited online has nothing cached. The browser must show its own
  // offline error, not the game shell, whose relative ./assets/ URLs would break
  // under /prototype/. The browser logs that failed load, so this step's console
  // errors are expected and dropped. Last, because the error page has no caches API.
  await test.step('offline: a never-visited /prototype/ page fails to load', async () => {
    const before = errors.length;
    await expect(page.goto('/prototype/boss-command-lab')).rejects.toThrow();
    errors.length = before;
  });

  expect(errors).toEqual([]);
});
