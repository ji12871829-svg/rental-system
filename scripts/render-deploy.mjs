#!/usr/bin/env node
// Render deploy watcher — real deploy statuses from Render's API, so verify
// steps can stop inferring deploys from the live site's behavior.
//
// Setup: Render Dashboard → Account Settings → API Keys → Create API Key
// (starts with `rnd_`). Expose it as RENDER_API_KEY; do NOT commit it.
//
// Usage:
//   RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs list
//       All services in the workspace (id, name, URL, created date).
//
//   RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs status [service]
//       Latest deploy of a service: commit, status, timings, service URL.
//       <service> matches an id (srv-…) or name; defaults to the only/most
//       recent web service.
//
//   RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs deploys [service] [N]
//       Last N deploys (default 5): status, commit, trigger, times.
//
//   RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs wait <sha> [service]
//       Poll until the deploy of <sha> (prefix ok) is live or failed.
//       Exit 0 = live, 1 = failed/canceled, 2 = timeout (15 min).
//
// CI-friendly: every failure exits non-zero; the key is never printed.

import { setTimeout as sleep } from 'node:timers/promises';

const KEY = process.env.RENDER_API_KEY || '';
const API = 'https://api.render.com/v1';

const TERMINAL_OK = new Set(['live']);
const TERMINAL_BAD = new Set(['build_failed', 'deploy_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

if (!KEY) {
  die(
    'RENDER_API_KEY is not set.\n' +
      'Create one at Render Dashboard → Account Settings → API Keys (starts with rnd_),\n' +
      'then: RENDER_API_KEY=rnd_… node scripts/render-deploy.mjs <command>'
  );
}

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

const [cmd, arg1, arg2] = process.argv.slice(2);

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
      'Usage: node scripts/render-deploy.mjs <list | status [service] | deploys [service] [N] | wait <sha> [service]>\n' +
        'Requires RENDER_API_KEY (Render Dashboard → Account Settings → API Keys).'
    );
}
