/**
 * deploy-preview.mjs — upload the current branch as a Cloudflare Workers PREVIEW.
 *
 * Purpose: give a long-lived branch (e.g. controls-v2) its own installable URL
 * on the phone, beside the stable game. Production (GitHub Pages and the
 * Worker's own URL) comes from deploy.mjs; a preview upload never changes
 * either. Config lives in wrangler.jsonc.
 *
 * Each branch gets a stable preview alias (its name, sanitized), so re-running
 * on the same branch updates the same URL. Every alias is its own hostname, so
 * its service worker and caches are isolated from the stable game's. Wrangler
 * prints the preview URL when the upload finishes.
 *
 * Unlike deploy.mjs it tolerates a dirty tree (prototype iteration); the
 * version message records the commit plus "-dirty" so you can tell.
 *
 * First-time setup: the Worker must exist before a version can be uploaded, so
 * run `npx wrangler deploy` once (it publishes the current dist/ as the Worker's
 * own workers.dev URL). Wrangler auth: `npx wrangler login`.
 *
 * Usage:  npm run deploy:preview                     (alias = current branch)
 *         npm run deploy:preview -- --alias spike-1  (explicit alias)
 *         npm run deploy:preview -- --skip-build
 */
import { execSync, spawnSync } from 'node:child_process';

const WORKER_NAME = 'star-slingers'; // keep in sync with wrangler.jsonc "name"
const argv = process.argv.slice(2);
const skipBuild = argv.includes('--skip-build');
const aIdx = argv.indexOf('--alias');
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Aliases become part of a hostname label (`<alias>-<worker>…`): lowercase
// letters, digits and dashes, starting with a letter, and short enough that
// alias + "-" + worker name stays within DNS's 63-character label limit.
function toAlias(raw) {
  const maxLen = 63 - WORKER_NAME.length - 1;
  const alias = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, maxLen).replace(/-+$/, '');
  if (!alias) {
    console.error(`Can't make a preview alias from "${raw}". Pass one with --alias <name>.`);
    process.exit(1);
  }
  return alias;
}

const branch = sh('git rev-parse --abbrev-ref HEAD');
const alias = toAlias(aIdx >= 0 ? argv[aIdx + 1] ?? '' : branch);
const dirty = sh('git status --porcelain --untracked-files=no') !== '';
const message = `${branch}@${sh('git rev-parse --short HEAD')}${dirty ? '-dirty' : ''}`;

if (!skipBuild) run('npm', ['run', 'build']);
console.log(`\nUploading preview "${alias}" (${message}) to Worker ${WORKER_NAME}…\n`);
run('npx', ['wrangler', 'versions', 'upload', '--preview-alias', alias, '--message', message]);
