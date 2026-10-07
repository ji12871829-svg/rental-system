#!/usr/bin/env node
// Deploy-drift audit — is the live Render service running what the repo says?
//
// Usage:
//   node scripts/audit-deploy-drift.mjs [baseUrl]
//
// baseUrl defaults to RPMS_BASE_URL, then https://rpms-gakt.onrender.com —
// same precedence as scripts/verify-live.mjs.
//
// What it compares (techniques from docs/RUNBOOK-deploy-gap-checks.md):
//   1. /api/health `commit`        — deployed revision vs `git rev-parse origin/main`
//   2. /api/health `apiModules`    — route modules mounted in app.ts vs what the
//                                    running build reports it mounted
//   3. Route probing (fallback)    — for builds that predate the health fields.
//                                    Probes prove PRESENCE only: 401/200 at the
//                                    prefix means a router is mounted; a 404 is
//                                    AMBIGUOUS — an unmounted prefix and a mounted
//                                    authless router with no GET route at the
//                                    prefix (e.g. /api/auth) return the identical
//                                    404. Absence is provable only via apiModules.
//                                    See RUNBOOK-deploy-gap-checks.md.
//   4. Frontend chunk inventory    — pages registered in routeChunks.ts vs the
//                                    chunk filenames embedded in the live bundle
//
// Exit codes: 0 = no definite drift (ambiguous findings do not fail the audit),
//             1 = definite drift found, 2 = audit could not run.
//
// Plain Node 18+ (global fetch, no dependencies), like verify-live.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE =
  (process.argv[2] || process.env.RPMS_BASE_URL || 'https://rpms-gakt.onrender.com').replace(/\/+$/, '');
const TIMEOUT = 30_000; // Render free-tier cold start can take ~30-60 s

const drift = []; // definite: { file, what, why }
const ambiguous = []; // cannot be decided from outside
let exitCode = 0;

const shortSha = (sha) => (sha ? sha.slice(0, 7) : '?');

function fail(message) {
  console.error(`audit aborted: ${message}`);
  process.exit(2);
}

async function get(pathname, { accept = 'text/html,application/json,*/*' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch(BASE + pathname, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { accept },
      });
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 3000)); // cold start
    }
  }
  return { unreachable: true, error: lastError };
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Repo scan — what SHOULD be live
// ---------------------------------------------------------------------------
function parseBackendModules() {
  const appTs = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/app.ts'), 'utf8');
  // import xRoutes from './routes/y';  →  var → route file
  const files = new Map();
  for (const m of appTs.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)';/g)) {
    files.set(m[1], `backend/src/routes/${m[2]}.ts`);
  }
  // mountApi('/api/x', xRoutes, 'x');  →  the single source of truth for mounts
  const modules = [];
  for (const m of appTs.matchAll(/mountApi\(\s*'([^']+)',\s*(\w+),\s*'([^']+)'\s*\)/g)) {
    modules.push({ prefix: m[1], var: m[2], name: m[3], file: files.get(m[2]) ?? null });
  }
  if (modules.length === 0) fail('no mountApi(...) calls found in backend/src/app.ts');
  return modules;
}

function parseFrontendPages() {
  const chunksTs = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/lib/routeChunks.ts'), 'utf8');
  const pages = [];
  for (const m of chunksTs.matchAll(/import\('\.\.\/pages\/([A-Za-z0-9_]+)'\)/g)) {
    pages.push({ page: m[1], file: `frontend/src/pages/${m[1]}.tsx` });
  }
  if (pages.length === 0) fail('no page imports found in frontend/src/lib/routeChunks.ts');
  return pages;
}

// ---------------------------------------------------------------------------
// Live scan — what IS live
// ---------------------------------------------------------------------------
async function fetchHealth() {
  const res = await get('/api/health', { accept: 'application/json' });
  if (res.unreachable) fail(`service unreachable at ${BASE} (${res.error?.message ?? 'network error'})`);
  if (res.status !== 200) fail(`/api/health answered HTTP ${res.status} — deploy is unhealthy; audit is moot`);
  return res.json();
}

async function fetchLiveChunkBases() {
  const index = await get('/');
  if (index.unreachable || index.status !== 200) fail('could not fetch live index.html');
  const html = await index.text();
  const bundlePath = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  if (!bundlePath) fail('live index.html references no assets/index-*.js bundle');
  const bundle = await get(`/${bundlePath}`);
  if (bundle.unreachable || bundle.status !== 200) fail(`could not fetch live bundle ${bundlePath}`);
  const js = await bundle.text();
  const bases = new Set();
  // Chunk filename = <base>-<8-char content hash>.js. The 8-char tail is
  // anchored, so greedy backtracking lands the LAST dash — base keeps any
  // inner dashes (arrow-left-Bt24H8dH.js → 'arrow-left').
  for (const m of js.matchAll(/([A-Za-z0-9][A-Za-z0-9._-]*)-([A-Za-z0-9_-]{8})\.js/g)) {
    bases.add(m[1]);
  }
  return { bundlePath, bases };
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------
function recordDrift(file, what, why) {
  drift.push({ file, what, why });
}

function recordAmbiguous(what, why) {
  ambiguous.push({ what, why });
}

async function auditBackend(modules, health) {
  const liveModules = Array.isArray(health.apiModules) ? health.apiModules : null;

  if (liveModules) {
    // Authoritative: the running build itself reports what it mounted.
    const liveNames = new Set(liveModules.map((x) => x.name));
    let live = 0;
    for (const mod of modules) {
      if (liveNames.has(mod.name)) {
        live++;
      } else {
        recordDrift(mod.file, `backend module '${mod.name}' (${mod.prefix})`,
          'mounted in app.ts but absent from live /api/health apiModules — live build predates it');
      }
    }
    const extra = liveModules.filter((x) => !modules.some((m) => m.name === x.name));
    console.log(`[backend] ${live}/${modules.length} expected modules live (via /api/health apiModules)`);
    if (extra.length > 0) console.log(`[backend] note: live also reports modules not in this checkout: ${extra.map((x) => x.name).join(', ')}`);
    return;
  }

  // Fallback for builds without the health fields. Probes prove PRESENCE
  // only — a 404 is ambiguous, never a definite miss: an unmounted prefix
  // and a mounted authless router without a GET route at the prefix (e.g.
  // /api/auth on any known-good build) return the identical 404 NOT_FOUND.
  const control = await get(`/api/__drift_audit_bogus_${Date.now()}`);
  if (control.unreachable || control.status !== 404) {
    fail(`top-level bogus probe returned HTTP ${control.unreachable ? 'network-error' : control.status}, expected the 404 NOT_FOUND guard`);
  }
  console.log('[backend] live /api/health has no apiModules (build predates the liveness fields) — probes prove presence only:');
  // Prefixes carrying more than one module: a positive probe proves the
  // prefix is mounted but not WHICH module answered, so each stays ambiguous.
  const mountsPerPrefix = new Map();
  for (const mod of modules) {
    mountsPerPrefix.set(mod.prefix, (mountsPerPrefix.get(mod.prefix) ?? 0) + 1);
  }
  let present = 0;
  for (const mod of modules) {
    const bare = await get(mod.prefix, { accept: 'application/json' });
    if (bare.unreachable) fail(`probe of ${mod.prefix} failed: ${bare.error?.message ?? 'network error'}`);
    let status = bare.status;
    if (status === 404) {
      // Bare-prefix 404: try an unknown subpath before giving up — a router
      // with router-level middleware (requireAuth) answers 401 there.
      const sub = await get(`${mod.prefix}/__drift_audit_bogus_${Date.now()}`, { accept: 'application/json' });
      if (sub.unreachable) fail(`probe of ${mod.prefix} subpath failed: ${sub.error?.message ?? 'network error'}`);
      status = sub.status;
    }
    const twin = mountsPerPrefix.get(mod.prefix) > 1;
    if (status !== 404) {
      if (twin) {
        recordAmbiguous(`backend module '${mod.name}' (${mod.prefix})`,
          `prefix is mounted (probe HTTP ${status}) but carries ${mountsPerPrefix.get(mod.prefix)} modules — cannot attribute presence to this one`);
      } else {
        present++;
      }
    } else {
      recordAmbiguous(`backend module '${mod.name}' (${mod.prefix})`,
        'probe 404 at prefix and subpath — either unmounted (drift) or mounted with no auth-free GET route at the prefix; absence is provable only via /api/health apiModules');
    }
  }
  console.log(`[backend] ${present}/${modules.length} modules confirmed present; the rest are undetermined from outside (see report)`);
}

async function auditFrontend(pages, chunkBases) {
  let live = 0;
  for (const { page, file } of pages) {
    if (chunkBases.has(page)) {
      live++;
    } else {
      recordDrift(file, `frontend page '${page}'`,
        `no ${page}-*.js chunk is referenced by the live bundle — deployed frontend predates it`);
    }
  }
  console.log(`[frontend] ${live}/${pages.length} expected route chunks live (bundle inventory)`);
}

function auditCommit(health) {
  const originMain = git(['rev-parse', 'origin/main']);
  const head = git(['rev-parse', 'HEAD']);
  const live = health.commit ?? null;

  if (!live) {
    console.log('[commit] live /api/health reports no commit (build predates the liveness field) — deployed revision unknown');
    return;
  }
  console.log(`[commit] live=${shortSha(live)} origin/main=${shortSha(originMain)} HEAD=${shortSha(head)}`);
  if (originMain && live.startsWith(originMain)) {
    console.log('[commit] live matches origin/main');
    return;
  }
  const behind = originMain ? git(['rev-list', '--count', `${live}..origin/main`]) : null;
  recordDrift(null, `deployed commit ${shortSha(live)}`,
    `origin/main is ahead by ${behind ?? '?'} commit(s) — merges after this deploy have not been promoted`);
  const subjects = originMain ? git(['log', '--format=%h %s', '-12', `${live}..origin/main`]) : '';
  if (subjects) console.log(`[commit] undeployed commits (newest first):\n${subjects}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function report() {
  console.log(`\nDeploy-drift audit — ${BASE}\n`);
  if (drift.length === 0 && ambiguous.length === 0) {
    console.log('No drift detected: live deployment matches the local repo.');
    return;
  }
  if (drift.length > 0) {
    console.log(`Missing from live deployment (${drift.length}):`);
    for (const d of drift) {
      console.log(`  ✗ ${d.file ?? '(repo)'} — ${d.what}\n      why: ${d.why}`);
    }
    exitCode = 1;
  }
  if (ambiguous.length > 0) {
    console.log(`Undetermined — needs a build with the health liveness fields (${ambiguous.length}):`);
    for (const a of ambiguous) {
      console.log(`  ? ${a.what}\n      why: ${a.why}`);
    }
  }
  console.log(`\nSummary: ${drift.length} definite drift item(s), ${ambiguous.length} undetermined.`);
  console.log('Remedies per cause: docs/RUNBOOK-deploy-gap-checks.md');
}

const health = await fetchHealth();
const modules = parseBackendModules();
const pages = parseFrontendPages();
const { bundlePath, bases } = await fetchLiveChunkBases();
console.log(`live bundle: /${bundlePath} — ${bases.size} chunks referenced`);

await auditBackend(modules, health);
await auditFrontend(pages, bases);
auditCommit(health);
report();
process.exit(exitCode);
