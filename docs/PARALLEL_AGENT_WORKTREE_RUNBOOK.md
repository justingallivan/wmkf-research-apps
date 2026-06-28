# Parallel Agent Worktree Runbook

**Purpose:** Run Claude and Codex (or two agents) on this repo **simultaneously**
without stepping on each other, using a git **worktree** so each agent has its own
branch and its own physical directory. Derived from the Session 298 run where Codex
built the admin-dashboard Dataverse-info buttons while Claude worked the
honorarium-payment investigation in the main checkout.

This complements `docs/AGENT_COLLABORATION_PLAN.md` (the contract) and the
`agent-coordination` skill (the procedure). This runbook is the concrete,
command-level "how." A future session may turn it into a skill — see the last
section.

## Why a worktree (not just branches)

A single working directory **drifts** when a concurrent agent checks out a branch —
the files under you change mid-task. A worktree gives the other agent its **own
directory on its own branch** sharing the same `.git`, so its checkouts and commits
**never touch your working tree.** That is the whole win.

What a worktree isolates: files on disk, branch state (git forbids the same branch
in two worktrees), in-flight edits. What it does **not** isolate: merge-time overlap
if both branches edit the same files, the shared `.git` object store, and
per-directory untracked state (`node_modules`, `.env*`, the `.agents/` symlink).

## Preconditions (check before starting)

1. **Clean tree, on `main`, in sync:** `git status --short --branch` clean;
   `git fetch origin` then up to date. (Ran via `/start` in S298.)
2. **Disjoint file surfaces.** This is what makes it safe. Decide ownership so the
   two agents edit **different files**. Use the `agent-coordination` traffic-light:
   - **Green:** different files/branch → proceed.
   - **Yellow:** same feature, different layers → implementer/reviewer split.
   - **Red:** same file / migrations / auth / deploys / data deletion → stop and
     coordinate first.
   In S298 the split was clean: Codex owned the **entire admin surface**
   (`pages/admin.js` + `shared/components/admin/*`); Claude stayed off the admin
   page entirely (worked only `.claude-memory/**` + `docs/**`). Zero overlap → the
   merge was conflict-free.
3. **Remember `main` auto-deploys.** Keep the other agent's work on its **branch**;
   merging to `main` is a deliberate production action, done at wind-down.

## Step 1 — Coordinate & scope

Run `agent-coordination` (or read `docs/AGENT_COLLABORATION_PLAN.md`). Pin down:
active owner, branch, **file surface per agent**, and confirm the surfaces are
disjoint (green) or pick an implementer/reviewer split (yellow).

## Step 2 — Create the worktree

A sibling directory, same non-cloud-synced parent as the repo (never put `.git` or
a worktree in iCloud/OneDrive/Drive — it breaks `git fsck`/`gc`):

```bash
git worktree add -b codex/<task-slug> ../WMKF_Apps-codex main
git worktree list                      # verify both entries
```

## Step 3 — Repair per-machine state in the new worktree

Three things do **not** travel into a fresh worktree and must be fixed, or the other
agent runs stale/broken:

```bash
# 1. Codex skills symlink — gitignored, PER-MACHINE. Codex reads skills from
#    .agents/skills; without this it runs stale/missing skills.
cd ../WMKF_Apps-codex
mkdir -p .agents && ln -s ../.claude/skills .agents/skills
readlink .agents/skills            # expect: ../.claude/skills

# 2. node_modules — absent in a fresh worktree; needed for lint/build/test.
npm install

# 3. .env.local — untracked, NOT copied in. Only needed for the dev server / live
#    probes. Prefer a SYMLINK to the main repo's (auto-syncs, no stale copy; it's
#    gitignored, so the symlink is never committed):
ln -s ../WMKF_Apps/.env.local .env.local   # or `cp ../WMKF_Apps/.env.local .` for a frozen snapshot
```

Things that **do** travel automatically (no action): the tracked `AGENTS.md ->
CLAUDE.md` symlink, and `.claude-memory/**` (git-tracked, so the memory store is
present in the worktree).

## Step 4 — Hand the agent its task brief

Give Codex a self-contained brief. The S298 template that worked:

- **Where:** "You are in `../WMKF_Apps-codex` on branch `codex/<slug>`. Run
  `npm install`, then `/start`. **Stay on this branch and directory**; another agent
  is working in the main checkout — do not check out other branches or touch it."
- **Goal + scope:** name the exact file surface it owns.
- **Guardrails (the ones that mattered):**
  - Don't modify shared primitives (e.g. `shared/components/Layout.js`) — build
    standalone additions.
  - Derive any data/field facts from the **real source** (the matching
    `pages/api/**` route or Atlas) — **never fabricate identifiers**; this repo
    hard-fails on that.
  - Register + gate any new API route (`docs/API_ROUTE_SECURITY_MATRIX.md` +
    `npm run check:api-routes`) — but prefer not adding one if avoidable.
  - Commit to the branch with descriptive messages; **do not push to `main`.**

## Step 5 — Work in parallel

- One owner per surface; the other reviews read-only unless ownership is reassigned.
- Each agent commits to its **own branch**. Don't merge to `main` until wind-down.
- Treat unknown dirty files as the other agent's WIP — read around them, don't
  revert.
- Run the gates for surfaces you actually changed before calling work done.

## Step 6 — Wind down (review → verify → merge → teardown)

**Inspect what the other agent left** (run from the main checkout):

```bash
git -C ../WMKF_Apps-codex log --oneline main..codex/<slug>      # its commits
git -C ../WMKF_Apps-codex status --short                        # untracked (.codex/ is normal)
git -C ../WMKF_Apps-codex diff --stat main...codex/<slug>       # files changed vs main
```

**Review read-only — it's going to `main`, which deploys to prod.** The S298
checklist:
- In scope? (only the agreed surface; shared primitives untouched)
- Any new API route? (then matrix + gate)
- **Field/identifier mappings real?** Cross-check each against the live route/Atlas
  — `grep` the API route the card reads from and confirm the names match. (S298
  verified `wmkf_appsystemsetting`/`wmkf_settingvalue`, `wmkf_policy*`, `wmkf_ai_prompt*`
  against `pages/api/admin/*`.)

**Verify:**

```bash
cd ../WMKF_Apps-codex && npm run lint          # expect 0 errors (pre-existing warnings ok)
cd ../WMKF_Apps-codex && npm run build         # expect clean; a Turbopack sandbox panic
                                               # is an ENV failure, not the app's — escalate
```
(Optional: visual check — needs the dev server + the page's auth, e.g. superuser for
`/admin`.)

**Merge + deploy** (from the main checkout, on the owner's go — `main` deploys):

```bash
git merge --no-ff codex/<slug>                 # clean when surfaces are disjoint
git push                                        # triggers Vercel deploy
vercel inspect <url>                            # confirm deploy (don't poll-grep `vercel ls`)
```

**Then dispose of the worktree — two options:**

*Keep & reuse (preferred for a recurring workflow).* Leave the directory in place
with its `node_modules` + symlinks (`.agents/skills`, `.env.local`); just free the
merged branch by parking the worktree on `main`:
```bash
git -C ../WMKF_Apps-codex fetch origin
git -C ../WMKF_Apps-codex checkout -B codex/parked origin/main   # move off the merged branch
git branch -d codex/<slug>
# next session, from the worktree: git fetch && git checkout -B codex/<next-slug> origin/main
```

*Full teardown (one-off / reclaim disk).* Deletes the directory too:
```bash
git worktree remove --force ../WMKF_Apps-codex  # --force: clears the agent's untracked .codex/
git branch -d codex/<slug>
```

## Gotchas (consolidated)

- **`.agents/skills` symlink** is per-machine + gitignored → recreate in every
  worktree or the agent runs stale skills.
- **`node_modules` / `.env.local`** don't travel into a worktree.
- **`.codex/`** (the agent's own session dir) is untracked and **blocks
  `git worktree remove`** → use `--force`.
- **`main` auto-deploys** → keep work on the branch; merge is the deliberate deploy.
- **Cloud-synced folders** corrupt `.git` → keep repo + worktrees out of them.
- **Disjoint surfaces are the real safety** — the worktree isolates the *working
  directory*, but two branches editing the same file still conflict at merge.

## Turning this into a skill (next session)

A `parallel-agent-worktree` skill would parameterize: `<task-slug>`, the worktree
path, and the owned file surface. It should: (1) run the precondition checks, (2)
create the worktree + repair per-machine state, (3) emit the task brief from a
template, and (4) provide the wind-down review/verify/merge/teardown checklist. Keep
it subordinate to `agent-coordination` (scoping/ownership) and
`docs/AGENT_COLLABORATION_PLAN.md` (the contract); this runbook is the body of the
"how."

### Cross-machine bootstrap (must-have — repo runs on home + office machines)

The per-machine, gitignored state is the recurring friction: it does **not** travel
with git, so **every machine** needs it recreated. The skill should ship (or call) an
**idempotent bootstrap script** (safe to re-run; skip what exists; compute paths at
runtime so one script works on every machine — no hardcoded paths). Two layers:

**Layer 1 — main repo on a fresh machine** (clone first; NOT in a cloud-synced folder):
- `.agents/skills` → `.claude/skills` symlink (Codex's skills; per-machine, gitignored).
- Memory-store symlink: `~/.claude/projects/<slug>/memory` → `<repo>/.claude-memory`,
  where `<slug>` is the repo's absolute path with `/` and `_` replaced by `-`. This is
  **path-derived, so it differs per machine** — compute it from `pwd`, never hardcode.
  (Same logic the `/start` skill already runs.)
- `npm install`.
- `.env.local`: **secrets — a script must NOT embed them.** Provision separately via
  `vercel env pull` or a secure copy; see `docs/CREDENTIALS_RUNBOOK.md`. Structure
  only in the script.
- Verify with `npm run check:agent-invariants`.

**Layer 2 — the worktree** (per Steps 2–3 above): `git worktree add`, then in the
worktree recreate `.agents/skills` symlink, `.env.local` symlink → the main repo's,
and `npm install`.
