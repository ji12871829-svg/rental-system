#!/usr/bin/env node
// Deploy watcher — real deploy statuses without scraping the live site.
//
// Two backends, same subcommands:
//
//   1. GitHub mode (default when no RENDER_API_KEY; prefix `gh` to force):
//        node scripts/render-deploy.mjs gh <services|status|deploys|wait> …
//      Reads the repo's own GitHub deployments feed. Render's GitHub App posts
//      one deployment + statuses per deploy, and every status carries the
//      Render dashboard URL (which embeds the service id) — so deploy state
//      and service discovery work with NO Render API key. Unauthenticated
//      GitHub calls are limited to 60/h per IP; set GITHUB_TOKEN to raise the
//      limit to 5,000/h (token is never printed).
//
//   2. Render mode (prefix `render`, or implied by any bare subcommand):
//        RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs <subcommand> …
//      Talks to Render's API directly (services, URLs, full deploy objects).
//      Create a key at Render Dashboard → Account Settings → API Keys
//      (starts with `rnd_`); expose as RENDER_API_KEY, never commit it.
//
// Subcommands (both modes):
//   services|list            Distinct services seen, with ids/URLs/counts.
//   status [service|env]     Latest deploy: commit, state, timings, URL.
//                            Exit 0 = live/success, 1 = failed, 3 = pending.
//   deploys [service|env] [N]  Last N deploys (default 5) with state + commit.
//   wait <sha> [service|env] Poll until the deploy of <sha> (prefix ok) is
//                            live/success. Exit 0 = live, 1 = failed,
//                            2 = timeout (15 min).
//
// CI-friendly: every failure exits non-zero; keys are never printed.

import { setTimeout as sleep } from 'node:timers/promises';
import { execSync } from 'node:child_process';

const KEY = process.env.RENDER_API_KEY || '';
const API = 'https://api.render.com/v1';
const GH_API = 'https://api.github.com';
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const TERMINAL_OK = new Set(['live']);
const TERMINAL_BAD = new Set(['build_failed', 'deploy_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Render API mode
// ---------------------------------------------------------------------------

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json', ...(opts.headers || {}) },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    die(`network error talking to Render API: ${e.message}`);
  }
  if (res.status === 401) die('Render API rejected the key (401 Unauthorized) — is RENDER_API_KEY valid and not revoked?');
  if (res.status === 429) die('Render API rate limit hit (429) — wait a minute and retry.');
  if (!res.ok) die(`Render API ${res.status} on ${path}`);
  return res.json();
}

async function findService(matcher) {
  const items = await api('/services?limit=50&includeDefaultEnvVars=false');
  const services = items.map((i) => i.service || i).filter((s) => s.type === 'web_service');
  if (!services.length) die('No web services found under this API key.');
  let svc;
  if (!matcher) {
    svc = services.length === 1 ? services[0] : services.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    if (services.length > 1) console.error(`(multiple web services — using most recently updated: ${svc.name})`);
  } else {
    svc =
      services.find((s) => s.id === matcher || s.name === matcher) ||
      services.find((s) => (s.name || '').toLowerCase().includes(matcher.toLowerCase()));
    if (!svc) die(`No web service matches "${matcher}". Known: ${services.map((s) => s.name).join(', ')}`);
  }
  return svc;
}

function serviceUrl(svc) {
  return svc.serviceDetails?.url || `https://${svc.slug || svc.name}.onrender.com`;
}

function renderDeployRow(d) {
  const dep = d.deploy || d;
  const t = dep.createdAt ? ` ${dep.createdAt.slice(0, 16).replace('T', ' ')}` : '';
  return `${dep.id}  ${(dep.status || '?').padEnd(20)} ${dep.trigger || '?'}${t}  ${(dep.commit?.id || '').slice(0, 7)} ${(dep.commit?.message || '').split('\n')[0].slice(0, 60)}`;
}

// ---------------------------------------------------------------------------
// GitHub deployments mode (keyless)
// ---------------------------------------------------------------------------

function ghRepo() {
  if (process.env.GITHUB_REPO) {
    const m = process.env.GITHUB_REPO.trim().match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m) return { owner: m[1], repo: m[2] };
    die('GITHUB_REPO must look like owner/repo.');
  }
  let url = '';
  try {
    url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) die('Cannot infer the GitHub repo from git remotes. Set GITHUB_REPO=owner/repo.');
  return { owner: m[1], repo: m[2] };
}

async function ghApi(path) {
  let res;
  try {
    res = await fetch(GH_API + path, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'rpms-deploy-watcher',
        ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    die(`network error talking to GitHub API: ${e.message}`);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === '0' || res.status === 429) {
      const mins = reset ? Math.max(1, Math.ceil((Number(reset) * 1000 - Date.now()) / 60_000)) : '?';
      die(
        `GitHub API rate limit exhausted${GH_TOKEN ? '' : ' (unauthenticated: 60 req/h per IP)'}.` +
          ` Resets in ~${mins} min. Set GITHUB_TOKEN to raise the limit to 5,000/h.`
      );
    }
    die(`GitHub API ${res.status} on ${path}`);
  }
  if (res.status === 404) die(`GitHub API 404 on ${path} — wrong repo? (set GITHUB_REPO=owner/repo)`);
  if (!res.ok) die(`GitHub API ${res.status} on ${path}`);
  return res.json();
}

// Render's status posts carry a dashboard URL that embeds the service id.
function srvFromTarget(url) {
  const m = (url || '').match(/srv-[a-z0-9]+/);
  return m ? m[0] : null;
}

// GitHub deployment state → script exit code (mirrors Render mode semantics).
function ghExit(state) {
  if (state === 'success') return 0;
  if (state === 'failure' || state === 'error' || state === 'inactive') return 1;
  return 3; // queued / in_progress / no status yet
}

async function ghLatestStatus(dep) {
  const statuses = await ghApi(`/repos/${dep.repo.owner}/${dep.repo.repo}/deployments/${dep.id}/statuses?per_page=1`);
  return statuses[0] || null;
}

function ghDeployLine(dep, st) {
  const state = st ? st.state : 'no-status-yet';
  const t = dep.created_at ? ` ${dep.created_at.slice(0, 16).replace('T', ' ')}` : '';
  const srv = srvFromTarget(st?.target_url) || 'srv-?';
  return `${String(dep.id).padEnd(12)} ${state.padEnd(14)} ${dep.sha.slice(0, 7)} ${dep.environment} ${t}  ${srv}`;
}

async function ghListDeployments({ env, sha, perPage }) {
  const repo = ghRepo();
  const params = new URLSearchParams({ per_page: String(perPage) });
  if (env) params.set('environment', env);
  if (sha) params.set('sha', sha);
  const deps = await ghApi(`/repos/${repo.owner}/${repo.repo}/deployments?${params}`);
  return deps.map((d) => ({ ...d, repo }));
}

// --- gh subcommands --------------------------------------------------------

async function ghServices(arg1) {
  const repo = ghRepo();
  const lookback = Math.min(Number(arg1) || 15, 50);
  const deps = await ghListDeployments({ perPage: lookback });
  if (!deps.length) die(`No deployments found on ${repo.owner}/${repo.repo} — is a Render service connected to this repo?`);
  const bySrv = new Map();
  for (const dep of deps) {
    const st = await ghLatestStatus(dep);
    const srv = srvFromTarget(st?.target_url);
    if (!srv) continue;
    const entry = bySrv.get(srv) || { first: dep.created_at, last: dep.created_at, envs: new Set(), count: 0 };
    entry.count += 1;
    entry.envs.add(dep.environment);
    if (dep.created_at < entry.first) entry.first = dep.created_at;
    if (dep.created_at > entry.last) entry.last = dep.created_at;
    bySrv.set(srv, entry);
  }
  console.log(`services seen in the last ${deps.length} deployment(s) of ${repo.owner}/${repo.repo}:`);
  if (!bySrv.size) console.log('  (none — deployments exist but no status carried a Render service id)');
  for (const [srv, e] of [...bySrv.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last))) {
    console.log(`  ${srv}  deploys:${e.count}  envs:${[...e.envs].join(',')}  first:${e.first.slice(0, 16).replace('T', ' ')}  last:${e.last.slice(0, 16).replace('T', ' ')}`);
  }
  console.log('  (GitHub exposes service ids, not service URLs — use Render mode `list` for URLs)');
}

async function ghStatus(env) {
  const deps = await ghListDeployments({ env, perPage: 5 });
  if (!deps.length) die(env ? `No deployments found for environment "${env}".` : 'No deployments found for this repo.');
  const dep = deps[0];
  const st = await ghLatestStatus(dep);
  const repo = dep.repo;
  let subject = '';
  try {
    const c = await ghApi(`/repos/${repo.owner}/${repo.repo}/commits/${dep.sha}`);
    subject = (c.commit?.message || '').split('\n')[0];
  } catch {
    /* subject is cosmetic — never fail status over it */
  }
  console.log(`repo      : ${repo.owner}/${repo.repo}`);
  console.log(`environment: ${dep.environment}`);
  console.log(`service   : ${srvFromTarget(st?.target_url) || 'unknown (no status yet)'}`);
  console.log(`deploy    : ${dep.id}`);
  console.log(`commit    : ${dep.sha.slice(0, 7)} ${subject}`);
  console.log(`state     : ${st ? st.state : 'no status posted yet'}`);
  console.log(`created   : ${dep.created_at}`);
  console.log(`dashboard : ${st?.target_url || '—'}`);
  process.exit(ghExit(st?.state));
}

async function ghDeploys(arg1, arg2) {
  const repo = ghRepo();
  // `deploys 3` = last 3 deploys; `deploys "main - rpms" 5` = environment + count.
  // (Render service names can't contain spaces; GitHub environment names can.)
  const env = arg1 && /^\d+$/.test(arg1) ? undefined : arg1;
  const limit = Math.min(Number(env ? arg2 : arg1) || 5, 20);
  const deps = await ghListDeployments({ env, perPage: limit });
  if (!deps.length) die(env ? `No deployments found for environment "${env}".` : 'No deployments found for this repo.');
  console.log(`repo : ${repo.owner}/${repo.repo}`);
  let code = 3;
  for (const dep of deps) {
    const st = await ghLatestStatus(dep);
    console.log(ghDeployLine(dep, st));
    if (st && code === 3) code = ghExit(st.state);
  }
  process.exit(code); // exit code reflects the NEWEST deploy's state
}

async function ghWait(sha, env) {
  if (!sha) die('wait needs a commit sha (prefix ok).');
  sha = sha.toLowerCase();
  const repo = ghRepo();
  console.log(`waiting for the deploy of ${sha.slice(0, 7)} on ${repo.owner}/${repo.repo}${env ? ` (${env})` : ''}…`);
  // GitHub's deployments?sha= filter needs full SHAs, and a deploy can lag the
  // push, so match recent deployments client-side on the prefix instead.
  // Poll interval respects the rate budget: ~30 calls per 15-min wait without
  // a token (60/h per IP), trivial with GITHUB_TOKEN (5,000/h).
  const interval = GH_TOKEN ? 20_000 : 60_000;
  const deadline = Date.now() + 15 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const deps = await ghListDeployments({ env, perPage: 10 });
    const hit = deps.find((d) => d.sha.startsWith(sha));
    if (!hit) {
      console.log(`  no deployment for ${sha.slice(0, 7)} yet (latest: ${(deps[0]?.sha || '').slice(0, 7) || '—'})`);
    } else {
      const st = await ghLatestStatus(hit);
      const state = st ? st.state : 'no-status-yet';
      if (state !== last) {
        console.log(`  ${new Date().toLocaleTimeString()}  ${state}`);
        last = state;
      }
      if (state === 'success') {
        console.log(`DEPLOY LIVE (GitHub reports success) — dashboard: ${st?.target_url || '—'}`);
        process.exit(0);
      }
      if (state === 'failure' || state === 'error' || state === 'inactive') {
        console.log(`DEPLOY ${state.toUpperCase()} — dashboard: ${st?.target_url || '—'}`);
        process.exit(1);
      }
    }
    await sleep(interval);
  }
  console.log('timed out after 15 minutes waiting for the deploy to finish.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
let mode = 'render';
if (argv[0] === 'gh') {
  mode = 'gh';
  argv.shift();
} else if (argv[0] === 'render') {
  argv.shift();
}
const [cmd, arg1, arg2] = argv;

if (mode === 'gh') {
  switch (cmd) {
    case 'services':
    case 'list':
      await ghServices(arg1);
      break;
    case 'status':
      await ghStatus(arg1);
      break;
    case 'deploys':
      await ghDeploys(arg1, arg2);
      break;
    case 'wait':
      await ghWait(arg1, arg2);
      break;
    default:
      die(
        'Usage: node scripts/render-deploy.mjs gh <services [lookback] | status [environment] | deploys [environment|N] [N] | wait <sha> [environment]>\n' +
          'Environment names look like "main - rpms" and contain spaces — quote them.\n' +
          'GitHub mode needs no API key (60 req/h per IP unauthenticated; GITHUB_TOKEN raises it to 5,000/h).'
      );
  }
  process.exit(0); // gh mode never falls through to the Render-mode key guard
}

if (!KEY) {
  die(
    'RENDER_API_KEY is not set.\n' +
      'Keyless option: node scripts/render-deploy.mjs gh <services|status|deploys|wait> … (GitHub deployments API)\n' +
      'Or create a key at Render Dashboard → Account Settings → API Keys (starts with rnd_),\n' +
      'then: RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs <command>'
  );
}

switch (cmd) {
  case 'list': {
    const items = await api('/services?limit=50');
    for (const i of items) {
      const s = i.service || i;
      console.log(`${s.id}  ${(s.type || '').padEnd(12)} ${s.name}`);
      if (s.type === 'web_service') console.log(`    url: ${serviceUrl(s)}   updated: ${s.updatedAt}`);
    }
    break;
  }

  case 'status': {
    const svc = await findService(arg1);
    const deploys = await api(`/services/${svc.id}/deploys?limit=1`);
    const dep = deploys[0] && (deploys[0].deploy || deploys[0]);
    console.log(`service : ${svc.name} (${svc.id})`);
    console.log(`url     : ${serviceUrl(svc)}`);
    if (dep) {
      console.log(`deploy  : ${dep.id}`);
      console.log(`status  : ${dep.status}`);
      console.log(`commit  : ${(dep.commit?.id || '').slice(0, 7)} ${(dep.commit?.message || '').split('\n')[0]}`);
      console.log(`started : ${dep.startedAt || dep.createdAt || '?'}`);
      console.log(`finished: ${dep.finishedAt || '—'}`);
      process.exit(TERMINAL_OK.has(dep.status) ? 0 : TERMINAL_BAD.has(dep.status) ? 1 : 3);
    } else {
      console.log('no deploys yet');
      process.exit(3);
    }
  }

  case 'deploys': {
    const svc = await findService(arg1);
    const limit = Math.min(Number(arg2) || 5, 20);
    const deploys = await api(`/services/${svc.id}/deploys?limit=${limit}`);
    console.log(`service : ${svc.name} (${serviceUrl(svc)})`);
    for (const d of deploys) console.log(renderDeployRow(d));
    break;
  }

  case 'wait': {
    if (!arg1) die('wait needs a commit sha (prefix ok).');
    const sha = arg1.toLowerCase();
    const svc = await findService(arg2);
    console.log(`waiting for deploy of ${sha.slice(0, 7)} on ${svc.name}…`);
    const deadline = Date.now() + 15 * 60 * 1000;
    let last = '';
    while (Date.now() < deadline) {
      const deploys = await api(`/services/${svc.id}/deploys?limit=10`);
      const hit = deploys.map((d) => d.deploy || d).find((d) => (d.commit?.id || '').startsWith(sha));
      if (!hit) {
        console.log(`  no deploy for ${sha.slice(0, 7)} yet (latest: ${(deploys[0]?.deploy?.commit?.id || deploys[0]?.commit?.id || '').slice(0, 7)})`);
      } else if (hit.status !== last) {
        console.log(`  ${new Date().toLocaleTimeString()}  ${hit.status}`);
        last = hit.status;
        if (TERMINAL_OK.has(hit.status)) {
          console.log(`DEPLOY LIVE: ${serviceUrl(svc)}`);
          process.exit(0);
        }
        if (TERMINAL_BAD.has(hit.status)) {
          console.log(`DEPLOY ${hit.status.toUpperCase()} — see Render dashboard → Events for logs.`);
          process.exit(1);
        }
      }
      await sleep(15_000);
    }
    console.log('timed out after 15 minutes waiting for the deploy to finish.');
    process.exit(2);
  }

  default:
    die(
      'Usage: node scripts/render-deploy.mjs [gh] <services | status [service|env] | deploys [service|env] [N] | wait <sha> [service|env]>\n' +
        'GitHub mode (keyless): node scripts/render-deploy.mjs gh <services|status|deploys|wait> …\n' +
        'Render mode requires RENDER_API_KEY (Render Dashboard → Account Settings → API Keys).'
    );
}
