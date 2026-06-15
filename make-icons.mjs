// Build-time icon rasterizer (B12 PWA) — run manually, NOT shipped / NOT in CI.
//   node make-icons.mjs
// Reuses the same chromium discovery as smoke.mjs: loads an inline neon SVG and
// screenshots it to PNG. Echoes the in-game art — deep-purple field, 3 concentric
// shield rings (cyan -> purple -> magenta), a cyan/amber diamond rocket.
// Commit the PNG outputs in public/icons/; this script is the regenerator.
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const pwRoot = join(process.env.LOCALAPPDATA, 'ms-playwright');
const chromeDir = readdirSync(pwRoot).filter((d) => d.startsWith('chromium-')).sort().pop();
const exe = join(pwRoot, chromeDir, 'chrome-win', 'chrome.exe');

// Neon art on a 100x100 canvas. `safe` < 1 shrinks the art toward center for
// maskable icons (art kept inside the inner safe zone; background full-bleed).
const art = (safe) => `
  <g transform="translate(50 50) scale(${safe}) translate(-50 -50)">
    <circle cx="50" cy="50" r="40" fill="none" stroke="#38f6ff" stroke-width="3.5"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="#9d6bff" stroke-width="3.5"/>
    <circle cx="50" cy="50" r="20" fill="none" stroke="#ff5ec7" stroke-width="3.5"/>
    <polygon points="50,30 61,50 39,50" fill="#38f6ff"/>
    <polygon points="39,50 61,50 50,72" fill="#ffb13b"/>
    <circle cx="50" cy="47" r="3" fill="#0a0626"/>
  </g>`;
const svg = (safe) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
    <rect x="0" y="0" width="100" height="100" fill="#0a0626"/>
    ${art(safe)}
  </svg>`;

const OUTPUTS = [
  { file: 'public/icons/icon-192.png', size: 192, safe: 1 },
  { file: 'public/icons/icon-512.png', size: 512, safe: 1 },
  { file: 'public/icons/maskable-512.png', size: 512, safe: 0.8 },
  { file: 'public/icons/apple-touch-icon-180.png', size: 180, safe: 1 },
];

const browser = await chromium.launch({ executablePath: exe });
for (const { file, size, safe } of OUTPUTS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px">${svg(safe)}</body></html>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: file }); // opaque (SVG paints the bg rect) — no alpha
  await page.close();
  console.log(`wrote ${file} (${size}x${size})`);
}
await browser.close();
