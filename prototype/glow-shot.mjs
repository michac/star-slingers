/**
 * glow-shot.mjs — headless screenshot of the Glow Lab prototype.
 * Run the dev server, then:  node prototype/glow-shot.mjs
 * Override the URL with LAB_URL (e.g. a deployed /prototype/glow-lab.html).
 * Writes prototype/glow-lab.png (gitignored).
 */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pwRoot = join(process.env.LOCALAPPDATA, 'ms-playwright');
const chromeDir = readdirSync(pwRoot).filter((d) => d.startsWith('chromium-')).sort().pop();
const exe = ['chrome-win64', 'chrome-win'].map((s) => join(pwRoot, chromeDir, s, 'chrome.exe')).find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 360, height: 720 }, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const url = process.env.LAB_URL ?? 'http://localhost:5176/prototype/glow-lab.html';
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#game canvas', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(here, 'glow-lab.png') });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
