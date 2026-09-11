#!/usr/bin/env node
// One-shot smoke test for the HSTS middleware in backend/src/app.ts.
// Boots the built API (backend/dist) against the real DB in two modes and
// asserts Strict-Transport-Security is present only in production mode.
//
//   node scripts/hsts-smoke.mjs
//
// Needs: backend built (npm run build --prefix backend), DATABASE_URL +
// JWT_SECRET in the environment (reads backend/.env otherwise).

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const PORT = 4599;
const BASE = `http://localhost:${PORT}`;

function waitForServer(pid, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
        resolve(res);
      } catch {
        if (Date.now() - started > timeoutMs) {
          try { pid && process.kill(pid); } catch {}
          reject(new Error(`server on :${PORT} did not come up within ${timeoutMs}ms`));
        } else setTimeout(tick, 500);
      }
    };
    setTimeout(tick, 800);
  });
}

async function check(mode) {
  const env = {
    ...process.env,
    NODE_ENV: mode === 'prod' ? 'production' : 'development',
    PORT: String(PORT),
  };
  const child = spawn(process.execPath, ['dist/index.js'], { cwd: 'backend', env, stdio: 'ignore' });
  let res;
  try {
    res = await waitForServer(child.pid);
  } catch (err) {
    console.error(`✗ ${mode}: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const hsts = res.headers.get('strict-transport-security');
  const ok = mode === 'prod' ? Boolean(hsts) : hsts === null;
  console.log(`${ok ? '✓' : '✗'} ${mode}: /api/health → ${res.status}, Strict-Transport-Security = ${JSON.stringify(hsts)}`);
  if (!ok) process.exitCode = 1;
  try { child.kill(); } catch {}
  if (platform() === 'win32') {
    // child.kill() can leave the node grandchild alive on Windows — make sure the port is free.
    await new Promise((r) => setTimeout(r, 1500));
    const { execSync } = await import('node:child_process');
    try { execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`, { stdio: 'ignore' }); } catch {}
  }
  await new Promise((r) => setTimeout(r, 800));
}

console.log('HSTS smoke test (built backend, real DATABASE_URL)');
await check('prod');
await check('dev');
console.log(process.exitCode ? 'FAILED' : 'ALL GOOD');
