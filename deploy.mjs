/**
 * deploy.mjs — push main and watch the GitHub Pages deploy to the finish line.
 *
 * Scope by design: push + watch + verify. Committing is a human step, so this
 * REFUSES a dirty working tree — you can never think you deployed work that
 * isn't committed (the exact confusion this script exists to prevent).
 *
 * What it does:
 *   1. sanity checks (git repo, gh auth, on main, clean tree)
 *   2. fetches origin; bails early if there's nothing to push
 *   3. warns if the pending commits are docs-only (plans/** or *.md) — the Pages
 *      workflow (deploy-pages.yml) ignores those paths, so such a push deploys
 *      nothing
 *   4. local `npm run build` pre-flight (fail fast before reddening main; skip
 *      with --skip-build)
 *   5. git push
 *   6. finds the workflow run for this commit and `gh run watch`es it
 *   7. prints + HTTP-checks the live URL
 *
 * Usage:  npm run deploy            (from the repo root)
 *         npm run deploy -- --skip-build
 */
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const WORKFLOW = 'deploy-pages.yml';
// Docs-only pushes (these paths) don't fire deploy-pages.yml — keep in sync
// with its paths-ignore filter.
const isDocsOnly = (f) => f.startsWith('plans/') || f.endsWith('.md');
const FALLBACK_URL = 'https://michac.github.io/star-slingers/';
const here = dirname(fileURLToPath(import.meta.url));
const skipBuild = process.argv.includes('--skip-build');

// --- tiny shell helpers ---------------------------------------------------
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const shOrNull = (cmd) => { try { return sh(cmd); } catch { return null; } };
const step = (m) => console.log(`\n▸ ${m}`);
const die = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- 1. prerequisites -----------------------------------------------------
if (!shOrNull('git rev-parse --is-inside-work-tree')) die('Not inside a git repository.');
if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', shell: true }).status !== 0)
  die('GitHub CLI is not authenticated. Run:  gh auth login');

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') die(`On branch "${branch}", not main. Deploys go from main.`);

if (sh('git status --porcelain'))
  die('Working tree is dirty. Commit (or stash) your changes first — deploy only ships committed work.');

// --- 2. anything to push? -------------------------------------------------
step('Fetching origin…');
if (spawnSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'inherit' }).status !== 0)
  die('git fetch failed (offline?).');

const head = sh('git rev-parse HEAD');
const ahead = Number(sh('git rev-list --count origin/main..HEAD'));
if (ahead === 0) {
  console.log('\nNothing to push — local main already matches origin.');
  console.log(`Live: ${liveUrl()}`);
  console.log(`(To force a rebuild with no new commit:  gh workflow run ${WORKFLOW})`);
  process.exit(0);
}
console.log(`${ahead} commit(s) ahead of origin/main.`);

// --- 3. will this actually deploy? ---------------------------------------
const changed = sh('git diff --name-only origin/main..HEAD').split('\n').filter(Boolean);
const triggersDeploy = changed.some((f) => !isDocsOnly(f));

// --- 4. local build pre-flight -------------------------------------------
if (triggersDeploy && !skipBuild) {
  step('Build pre-flight (npm run build)…');
  if (spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: here }).status !== 0)
    die('Local build failed — fix it before pushing (or rerun with --skip-build).');
} else if (!triggersDeploy) {
  console.log(
    '\n⚠ These commits are docs-only (plans/** or *.md) — this push will NOT trigger a Pages deploy.'
  );
}

// --- 5. push --------------------------------------------------------------
step('Pushing to origin/main…');
if (spawnSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' }).status !== 0)
  die('git push failed.');

if (!triggersDeploy) {
  console.log('\n✔ Pushed. No deploy expected (docs-only).');
  process.exit(0);
}

// --- 6. watch the run -----------------------------------------------------
step('Waiting for the Pages workflow run to register…');
let runId = null;
for (let i = 0; i < 30 && !runId; i++) {
  const json = shOrNull(
    `gh run list --workflow ${WORKFLOW} --branch main --limit 15 --json databaseId,headSha`
  );
  if (json) runId = (JSON.parse(json).find((r) => r.headSha === head) || {}).databaseId ?? null;
  if (!runId) sleep(2000);
}
if (!runId) die(`Timed out waiting for the run. Check manually:  gh run list --workflow ${WORKFLOW}`);

step(`Watching run ${runId}…`);
if (spawnSync('gh', ['run', 'watch', String(runId), '--exit-status'], { stdio: 'inherit', shell: true }).status !== 0)
  die(`Deploy failed. Inspect:  gh run view ${runId} --log-failed`);

// --- 7. verify the live URL ----------------------------------------------
const url = liveUrl();
step(`Verifying ${url} …`);
try {
  const res = await fetch(url, { cache: 'no-store' });
  console.log(res.ok ? `HTTP ${res.status} ✔` : `HTTP ${res.status} — published, but the URL didn't return OK yet (CDN lag?).`);
} catch {
  console.log('Could not reach the URL just now (CDN lag?) — the deploy itself succeeded.');
}
console.log(`\n✔ Deployed. Live: ${url}`);

// --- helpers --------------------------------------------------------------
function liveUrl() {
  return shOrNull('gh api repos/{owner}/{repo}/pages --jq .html_url') || FALLBACK_URL;
}
