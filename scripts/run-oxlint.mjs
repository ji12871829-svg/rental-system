#!/usr/bin/env node
// Generic oxlint launcher used by `npm run lint` and the pre-commit hook.
//
// 1. If oxlint is passed explicit file/directory args, they are forwarded
//    (lint-staged passes staged file paths — never re-lint the whole repo).
// 2. With no args, lints the standard project globs (same as CI).
// 3. Runs the npm package first; if its native binding can't load (some
//    Windows hosts block .node modules via Application Control), falls back
//    to the standalone binary in .tools/oxlint.exe, which is how the binding
//    error surfaces here. Exit code and output pass straight through.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['backend/src', 'backend/tests', 'frontend/src', 'scripts', '--config=.oxlintrc.json'];

const npm = spawnSync('npx', ['--no-install', 'oxlint', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: root,
});
if (npm.error || npm.status !== 0) {
  const exe = path.join(root, '.tools', process.platform === 'win32' ? 'oxlint.exe' : 'oxlint');
  if (!existsSync(exe)) {
    console.error(`oxlint binary not found at ${exe}.`);
    console.error('Download it: https://github.com/oxc-project/oxc/releases (oxlint-x86_64-pc-windows-msvc.zip)');
    process.exit(1);
  }
  const res = spawnSync(exe, args, { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
process.exit(0);
