#!/usr/bin/env node
// Git worktree helper — the supported way to get a second checkout of this
// repo. NEVER `git clone` this repo inside the workspace: that is exactly how
// a 274 MB duplicate (`rental-system/` with its own .git) appeared here once.
// A worktree is a linked checkout: it shares this repo's .git, adds only the
// source files (~no history), and every branch stays visible everywhere.
//
// Usage:
//   node scripts/worktree.mjs add <name> [branch]   create ../<name>-wt on branch (default: <name>)
//   node scripts/worktree.mjs rm <name>             remove it and delete its branch if unused
//   node scripts/worktree.mjs list                  show all worktrees
//
// Examples:
//   node scripts/worktree.mjs add hotfix         # branch hotfix checked out at ../hotfix-wt
//   node scripts/worktree.mjs add review main    # second checkout of main (read-only browsing)
//   node scripts/worktree.mjs rm hotfix

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Worktrees live OUTSIDE the repo (one level up) so git never sees them —
// belt and braces on top of the rental-system/ .gitignore guard.
const wtPath = (name) => path.join(REPO_ROOT, '..', `${name}-wt`);

function run(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

const [cmd, name, branch] = process.argv.slice(2);

try {
  if (cmd === 'add') {
    if (!name) fail('add needs a <name>');
    const br = branch || name;
    const dest = wtPath(name);
    const branches = run('git branch --list ' + JSON.stringify(br));
    const createBranch = branches === '';
    run(
      `git worktree add ${JSON.stringify(dest)} ${createBranch ? '-b ' : ''}${JSON.stringify(br)}` +
        (createBranch ? ' main' : '')
    );
    console.log(`worktree ready: ${dest} (branch ${br}${createBranch ? ', created from main' : ''})`);
    console.log('shares this repo .git — no history duplicated, branches stay in sync');
  } else if (cmd === 'rm') {
    if (!name) fail('rm needs a <name>');
    const dest = wtPath(name);
    run(`git worktree remove ${JSON.stringify(dest)} --force`);
    run('git worktree prune');
    // Delete the branch too if it was created for this worktree and is merged.
    try { run(`git branch -d ${JSON.stringify(name)}`); console.log(`branch ${name} deleted (was fully merged)`); }
    catch { /* branch kept — it has unmerged work */ }
    console.log(`worktree removed: ${dest}`);
  } else if (cmd === 'list') {
    console.log(run('git worktree list'));
  } else {
    fail(`unknown command: ${cmd ?? '(none)'}`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

function fail(msg) {
  console.error(msg + '\n' + 'Usage: node scripts/worktree.mjs <add|rm|list> [name] [branch]');
  process.exit(1);
}
