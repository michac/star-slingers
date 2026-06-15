import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const protoDir = resolve(root, 'prototype');
const refDir = resolve(protoDir, 'reference');

/** *.html in `dir` (except the gallery index), sorted. [] if the dir is absent. */
function htmlPages(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.html') && f !== 'index.html')
      .sort();
  } catch {
    return [];
  }
}

/** Open experiments (prototype/*.html) vs locked references (prototype/reference/*.html). */
const protoPages = (): string[] => htmlPages(protoDir);
const refPages = (): string[] => htmlPages(refDir);

/** Pull a page's <title> for its gallery label (falls back to the filename). */
function pageTitle(dir: string, file: string): string {
  try {
    const m = readFileSync(resolve(dir, file), 'utf8').match(/<title>([^<]*)<\/title>/i);
    return (m?.[1] ?? file).trim();
  } catch {
    return file;
  }
}

/** Auto-list experiments + locked references into prototype/index.html at dev +
 *  build time, so dropping a new page makes it appear with no edits. */
function prototypeGallery(): Plugin {
  const list = (dir: string, hrefBase: string, files: string[]): string =>
    files.map((f) => `<li><a href="${hrefBase}${f}">${pageTitle(dir, f)}</a></li>`).join('\n    ');
  return {
    name: 'prototype-gallery',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const isGallery = ctx.filename.replace(/\\/g, '/').endsWith('prototype/index.html');
        if (!isGallery) return html;
        const experiments = list(protoDir, './', protoPages());
        const references = list(refDir, './reference/', refPages());
        const built = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
        return html
          .replace('<!--EXPERIMENTS-->', experiments || '<li class="empty">(nothing on the shelf yet)</li>')
          .replace('<!--REFERENCES-->', references || '<li class="empty">(none yet)</li>')
          .replace('<!--BUILT-->', built);
      },
    },
  };
}

export default defineConfig({
  // Relative base so a built bundle works from any static folder.
  base: './',
  plugins: [prototypeGallery()],
  // Expose on the LAN so the Pixel 6 can hit http://<PC-IP>:5173 during dev.
  server: { host: true },
  build: {
    rollupOptions: {
      // Multi-page: the game (root) + the prototype gallery + every experiment +
      // every locked reference. Each HTML keeps its source path in dist.
      input: [
        resolve(root, 'index.html'),
        resolve(protoDir, 'index.html'),
        ...protoPages().map((f) => resolve(protoDir, f)),
        ...refPages().map((f) => resolve(refDir, f)),
      ],
    },
  },
});
