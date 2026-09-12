# Git worktrees in this repo

## The rule: never `git clone` this repo inside the workspace

On Sep 11–12, 2026 a full duplicate of this repo appeared at
`rental-system/` (its own `.git`, pinned to an older commit, 274 MB). It
was created by a `git clone https://github.com/ji12871829-svg/rental-system.git`
run from the workspace root — likely while following the Neon onboarding
flow (`npm run db:setup` was executed inside the nested clone). It has
since been deleted, and `rental-system/` is gitignored as a safety net
(commit `ba333ad`), but the right tool for a second checkout is a
**worktree**, not a clone.

## What a worktree gives you

- A second working directory with its own checked-out branch
- **Shares the main repo's `.git`** — object store, refs, and history are
  common, so branches created in a worktree appear everywhere instantly
- Costs only the source files (~5 MB), not the whole history
- A commit made in the worktree is a normal commit on `main` after merge

## Using the helper

```bash
node scripts/worktree.mjs add hotfix          # ../hotfix-wt on new branch hotfix (from main)
node scripts/worktree.mjs add review main     # second checkout of main (read-only browsing)
node scripts/worktree.mjs list                # all worktrees
node scripts/worktree.mjs rm hotfix           # remove; deletes the branch if fully merged
```

Worktrees are created **one level above this repo** (e.g.
`C:\Users\Admin\Desktop\hotfix-wt`) so git never sees them from the
workspace, and their `.git` is just a pointer file into this repo.

## Manual commands (equivalent)

```bash
git worktree add ../hotfix-wt -b hotfix main
git worktree list
git worktree remove ../hotfix-wt && git worktree prune
```

## Caveats

- A branch can be checked out in **only one** worktree at a time
- `npm install` is per-worktree: run it inside a fresh worktree before
  building or testing there
- Do not run the backend dev server from two worktrees at once — they
  would fight over port 4000
