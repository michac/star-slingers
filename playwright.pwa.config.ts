import { defineConfig, devices } from '@playwright/test';

// Production-server port. Override with PWA_PORT when another worktree's
// `npm run test:pwa` may be running (5182 sits next to `npm test`'s 5181).
const PORT = Number(process.env.PWA_PORT ?? 5182);

/**
 * Playwright config for `npm run test:pwa`, the service-worker check (#10).
 * Separate from playwright.config.ts so the fast `npm test` loop never runs it.
 *
 * It drives the PRODUCTION build (the SW registers PROD-only) in Chromium and
 * WebKit, the engine every iPhone browser uses and the stricter one about
 * service workers. `wrangler dev` serves `dist/` locally with Cloudflare's real
 * html_handling, so `/index.html` and `x.html` redirect the way the preview host
 * does. `vite preview` doesn't redirect, so it can't reproduce a cached-redirect
 * failure. `npm run test:pwa` builds `dist/` first.
 */
export default defineConfig({
  testDir: './e2e-pwa',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 740 },
        hasTouch: true,
        // Same software GL as playwright.config.ts, so Phaser's WebGL renderer boots headless.
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // The inspector port is left unpinned: wrangler probes upward from 9229 for a
    // free one, so concurrent runs can't collide on it.
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --show-interactive-dev-session=false`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: a server left on this port could be serving another tree's dist/.
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
