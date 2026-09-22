#!/usr/bin/env node
// Fallback oxlint launcher: spawns the standalone binary in .tools/ when the
// npm package's native binding can't load (e.g. Windows Application Control
// blocks .node modules). Passes all args through to the binary.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exe = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tools', 'oxlint.exe');
if (!existsSync(exe)) {
  console.error(`oxlint binary not found at ${exe}.`);
  console.error('Download it: https://github.com/oxc-project/oxc/releases (oxlint-x86_64-pc-windows-msvc.zip)');
  process.exit(1);
}
const res = spawnSync(exe, process.argv.slice(2), { stdio: 'inherit' });
process.exit(res.status ?? 1);
