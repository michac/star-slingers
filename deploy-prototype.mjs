/**
 * deploy-prototype.mjs — ship the prototype shelf to /prototype/ on GitHub Pages.
 *
 * Purpose: an AUTOMATED path for pushing review artifacts (the prototype/ pages)
 * while Michael is remote, so he can review from his phone without being local.
 *
 * How it differs from deploy.mjs (the careful game-deploy flow):
 *   - It stages + commits ONLY prototype/** itself (deploy.mjs refuses to commit
 *     at all). So an agent can run it end-to-end with no human commit step.
 *   - It TOLERATES other dirty files (e.g. game src mid-edit): they're left
 *     uncommitted and simply don't ship. Only prototype/** goes out.
 *
 * Everything still lands in one Pages artifact — the game at / and the shelf at
 * /prototype/ deploy together off main's deploy-pages.yml workflow.
 *
 * Usage:  npm run deploy:prototype                       (from the repo root)
 *         npm run deploy:prototype -- -m "glow round 5"  (commit message)
 *         npm run deploy:prototype -- --skip-build
 */
import { execSync, spawnSync } from 'node:child_process';

const WORKFLOW = 'deploy-pages.yml';
const FALLBACK_URL = 'https://unwiredrevolution.github.io/star-slingers/';
const argv = process.argv.slice(2);
const skipBuild = argv.includes('--skip-build');
const mIdx = argv.findIndex((a) => a === '-m' || a === '--m');
const message = mIdx >= 0 ? argv[mIdx + 1] : null;

// --- tiny shell helpers ---------------------------------------------------
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const shOrNull = (cmd) => { try { return sh(cmd); } catch { return null; } };
const step = (m) => console.log(`\n▸ ${m}`);
const die = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const liveUrl = () => shOrNull('gh api repos/{owner}/{repo}/pages --jq .html_url') || FALLBACK_URL;

// --- 1. prerequisites -----------------------------------------------------
if (!shOrNull('git rev-parse --is-inside-work-tree')) die('Not inside a git repository.');
if (spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', shell: true }).status !== 0)
  die('GitHub CLI is not authenticated. Run:  gh auth login');

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') die(`On branch "${branch}", not main. Deploys go from main.`);

// --- 2. stage + commit just the prototype shelf ---------------------------
step('Staging prototype/ …');
spawnSync('git', ['add', '--', 'prototype'], { stdio: 'inherit' });

const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet', '--', 'prototype']).status !== 0;
if (hasStaged) {
  const msg = message || `prototype: update shelf (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
  step(`Committing prototype changes — "${msg}"`);
  if (spawnSync('git', ['commit', '-m', msg], { stdio: 'inherit' }).status !== 0)
    die('git commit failed.');
} else {
  console.log('No new prototype/ changes to commit.');
}

// --- 3. anything to push? -------------------------------------------------
step('Fetching origin…');
if (spawnSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'inherit' }).status !== 0)
  die('git fetch failed (offline?).');

const head = sh('git rev-parse HEAD');
if (Number(sh('git rev-list --count origin/main..HEAD')) === 0) {
  console.log(`\nNothing to push — origin already has it. Shelf: ${liveUrl()}prototype/`);
  process.exit(0);
}

// --- 4. build pre-flight (fail before reddening main) ---------------------
if (!skipBuild) {
  step('Build pre-flight (npm run build)…');
  if (spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true }).status !== 0)
    die('Local build failed — fix it before pushing (or rerun with --skip-build).');
}

// --- 5. push --------------------------------------------------------------
step('Pushing to origin/main…');
if (spawnSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' }).status !== 0)
  die('git push failed.');

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
if (!runId) die(`Timed out waiting for the run. Check:  gh run list --workflow ${WORKFLOW}`);

step(`Watching run ${runId}…`);
if (spawnSync('gh', ['run', 'watch', String(runId), '--exit-status'], { stdio: 'inherit', shell: true }).status !== 0)
  die(`Deploy failed. Inspect:  gh run view ${runId} --log-failed`);

// --- 7. done --------------------------------------------------------------
const shelf = `${liveUrl()}prototype/`;
step(`Verifying ${shelf} …`);
try {
  const res = await fetch(shelf, { cache: 'no-store' });
  console.log(res.ok ? `HTTP ${res.status} ✔` : `HTTP ${res.status} — published, CDN may lag a moment.`);
} catch {
  console.log('Could not reach it just now (CDN lag?) — the deploy itself succeeded.');
}
console.log(`\n✔ Prototype shelf deployed. Review: ${shelf}`);
