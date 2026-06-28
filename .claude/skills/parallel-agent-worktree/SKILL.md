---
name: parallel-agent-worktree
description: Run a second agent (typically Codex) on this repo in parallel via a git worktree, so each agent has its own branch and directory and they never step on each other. Use when handing a scoped, disjoint-surface build to another agent while you keep working in the main checkout. Covers preconditions, worktree setup, the task brief, and the wind-down review/verify/merge/teardown.
allowed-tools: Read, Bash(git status:*, git fetch:*, git log:*, git diff:*, git branch:*, git worktree:*, git merge:*, git push:*, git checkout:*, npm install, npm run:*, readlink:*, ln:*, mkdir:*, ls:*, pwd, scripts/bootstrap-machine.sh:*, vercel inspect:*)
---

# Parallel Agent Worktree

Run Claude and Codex (or two agents) on this repo **simultaneously** without
stepping on each other, using a git **worktree** so each agent has its own branch
and its own physical directory sharing one `.git`. The other agent's checkouts and
commits never touch your working tree.

## Source Of Truth

`docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md` is the full command-level "how" (and the
consolidated gotchas). This skill is the procedure over it. Stay subordinate to the
`agent-coordination` skill (scoping/ownership) and `docs/AGENT_COLLABORATION_PLAN.md`
(the contract). `scripts/bootstrap-machine.sh --worktree NAME` already does the
mechanical setup (Steps 2–3) — call it rather than hand-running the commands.

## Parameters to pin first

- **`<task-slug>`** — names the branch `codex/<task-slug>` and the worktree.
- **Worktree path** — sibling of the repo, `../<repo>-codex` (never in a
  cloud-synced folder — it corrupts `.git`).
- **Owned file surface** — the exact files/dirs the other agent may edit. This is
  the safety boundary; see Step 1.

## Step 1 — Preconditions & scope (the safety gate)

1. **Clean, on `main`, in sync:** `git status --short --branch` clean; `git fetch
   origin` then up to date. (`/start` covers this.)
2. **Disjoint file surfaces.** This is what makes parallel work safe — the worktree
   isolates the *working directory*, but two branches editing the same file still
   conflict at merge. Run `agent-coordination` and apply its traffic-light:
   - **Green** — different files/dirs → proceed.
   - **Yellow** — same feature, different layers → implementer/reviewer split.
   - **Red** — same file, migrations, auth/security, env/prod/deploys, or data
     deletion → stop and coordinate first; do not open a worktree.
3. **`main` auto-deploys.** Keep the other agent's work on its branch; merging to
   `main` is a deliberate production action done at wind-down (Step 6).

If the surfaces aren't cleanly disjoint, resolve that before going further — it is
the precondition, not a detail.

## Step 2 — Create the worktree + repair per-machine state

```bash
scripts/bootstrap-machine.sh --worktree <task-slug>
```

This creates `../<repo>-codex` on `codex/<task-slug>` from `origin/main` and repairs
the three things that do **not** travel into a fresh worktree: the `.agents/skills`
symlink (Codex reads skills there — stale without it), `.env.local` (symlinked to the
main repo's), and `node_modules` (`npm install`). Verify:

```bash
git worktree list                              # both entries present
readlink ../<repo>-codex/.agents/skills        # expect: ../.claude/skills
```

If the worktree dir already exists (e.g. the parked `codex/parked` one), **reuse it**
rather than recreating — the script will tell you the reuse command:
`git -C <path> fetch origin && git -C <path> checkout -B codex/<task-slug> origin/main`.

## Step 3 — Hand the agent its task brief

Give a self-contained brief. Template that worked in S298:

- **Where:** "You are in `../<repo>-codex` on branch `codex/<task-slug>`. Run
  `/start`. **Stay on this branch and directory** — another agent is in the main
  checkout; do not check out other branches or touch it."
- **Goal + scope:** name the exact file surface it owns (from Step 1).
- **Guardrails that mattered:**
  - Don't modify shared primitives (e.g. `shared/components/Layout.js`) — build
    standalone additions.
  - Derive every data/field/identifier fact from the **real source** (the matching
    `pages/api/**` route or the Atlas) — **never fabricate identifiers**; this repo
    hard-fails on fabricated literals.
  - Register + gate any new API route (`docs/API_ROUTE_SECURITY_MATRIX.md` +
    `npm run check:api-routes`) — but prefer not adding one if avoidable.
  - Commit to the branch with descriptive messages; **do not push to `main`.**

## Step 4 — During parallel work

- One owner per surface; the other reviews read-only unless ownership is reassigned.
- Each agent commits to its **own branch**; no merge to `main` until wind-down.
- Treat unknown dirty files as the other agent's WIP — read around them, don't revert.
- Run the gates for surfaces you actually changed before calling your part done.

## Step 5 — Wind down (review → verify → merge → teardown)

**Inspect** what the other agent left (from the main checkout):

```bash
git -C ../<repo>-codex log --oneline main..codex/<task-slug>     # its commits
git -C ../<repo>-codex status --short                            # untracked (.codex/ is normal)
git -C ../<repo>-codex diff --stat main...codex/<task-slug>      # files changed vs main
```

**Review read-only — it merges to `main`, which deploys to prod:**
- In scope? (only the agreed surface; shared primitives untouched.)
- Any new API route? (then matrix + gate.)
- **Field/identifier mappings real?** Cross-check each against the live route/Atlas —
  `grep` the API route it reads from and confirm the names match.

**Verify** (in the worktree):

```bash
cd ../<repo>-codex && npm run lint        # 0 errors (pre-existing warnings ok)
cd ../<repo>-codex && npm run build       # clean; a Turbopack sandbox panic is an
                                          # ENV failure, not the app's — escalate, don't delete .next
```

**Merge + deploy** (from the main checkout, on the owner's go — `main` deploys):

```bash
git merge --no-ff codex/<task-slug>       # clean when surfaces are disjoint
git push                                  # triggers Vercel deploy
vercel inspect <url>                      # confirm deploy (don't poll-grep `vercel ls`)
```

**Dispose of the worktree — two options:**

*Keep & reuse (preferred for a recurring workflow)* — leave the directory with its
`node_modules` + symlinks; just park it off the merged branch:
```bash
git -C ../<repo>-codex fetch origin
git -C ../<repo>-codex checkout -B codex/parked origin/main
git branch -d codex/<task-slug>
```

*Full teardown (one-off / reclaim disk):*
```bash
git worktree remove --force ../<repo>-codex   # --force clears the agent's untracked .codex/
git branch -d codex/<task-slug>
```

## Gotchas (full list in the runbook)

- `.agents/skills` symlink + `node_modules` + `.env.local` are per-machine/untracked
  → don't travel into a worktree (the bootstrap script in Step 2 handles all three).
- `.codex/` (the agent's session dir) is untracked and blocks `git worktree remove`
  → use `--force`.
- `main` auto-deploys → keep work on the branch; the merge is the deliberate deploy.
- Disjoint surfaces are the real safety; the worktree only isolates the working
  directory, not merge-time overlap on the same file.
