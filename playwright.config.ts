import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Test config for Star Slingers. Drives the game in a Pixel-6-sized
 * touch viewport and auto-starts the Vite dev server. Runner-only (no
 * toHaveScreenshot baselines — OS-AA-sensitive and the game has few static
 * frames); SMOKE_SHOTS=1 opts into manual smoke-*.png screenshots as eyeball aids.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Software-WebGL contexts are heavy; serialize the cases on one worker.
  workers: 1,
  // Generous budget for headless software-WebGL: boot is slow, and each opt-in
  // SMOKE_SHOTS screenshot is a ~7s ReadPixels render. (The cases themselves
  // step a fixed-timestep clock, so they no longer wait on asteroid drift.)
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    // Dedicated test port (5181, distinct from reflex's 5180) so both suites
    // can run without colliding, and so the suite never picks up an unrelated
    // Vite dev server already on 5173.
    baseURL: 'http://localhost:5181',
    ...devices['Desktop Chrome'],
    // Logical FIT game size, so canvas coords == page coords.
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    // Phaser boots its WebGL renderer; headless Chromium's default GL can't
    // allocate the framebuffer ("Framebuffer Unsupported" → context lost →
    // scene never starts). ANGLE-over-SwiftShader gives a working software GL
    // so the game actually renders.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: !process.env.CI,
  },
});
