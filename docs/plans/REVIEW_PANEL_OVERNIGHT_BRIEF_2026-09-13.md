---
title: Review Panel Phase A — Overnight Build Brief (2026-09-13)
domain: virtual-review-panel
kind: brief
status: in-progress
summary: "Running log of the autonomous overnight Phase A build (Sonnet builds, Opus reviews, Codex adversarial review, Fable orchestrates). Per-slice status, unresolved findings, decisions made on the owner's behalf, and the owner-side commands needed before a smoke run."
cataloged: 2026-09-13
owner: product-engineering
last_verified: 2026-09-13
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/plans/EXECUTOR_PROVIDER_SEAM_CODEX_BRIEF_2026-09-12.md
---

# Review Panel Phase A — Overnight Build Brief

> Snapshot log, not ship state. Branch: `feature/review-panel-foundation` (worktree
> `../WMKF_Apps-codex`), cut from `main` at 262f3322 after A0 (PR #280) merged. Nothing here is
> merged to `main`; no Vercel env var, cron entry, migration, or Dataverse seed has been applied.

## 1. Orchestration rules in force

- Sonnet builds one slice at a time in the worktree; Opus reviews each slice against the plan's
  §5 contracts; only **blocking** findings (fail-open, data leak past the input DTO, cost recorded
  as known when unknown, lease/CAS race, decorative test) re-enter the loop. Max two Opus rounds per
  slice, max two Codex rounds total. A finding that recurs after one fix, or that relitigates a
  `[DECIDED]` row in plan §1, is logged in §3 below and not chased.
- Prohibited for every agent: any live Postgres or Dataverse connection (`.env.local` points at
  production), `apply-migrations.js`, seed scripts with `--execute`, rehearsal scripts, `vercel env`,
  `vercel.json` cron edits, merges to `main`.

## 2. Slice status

| Slice | Scope (plan §5) | Status | Commits |
|---|---|---|---|
| 1 | A.5 migration 047 / block v49, store + seat-attempt ledger with both fences, A.4 input DTO, A.2 rollout gates, executor budgets | started 2026-09-13 | — |
| 2 | A.3 prompt seeds + question-set projection (D7), generation service + snapshot builder, A.6 worker + drain route | pending | — |
| 3 | A.1 registry/routes/matrix, A.7 editions in the D11 store + download route, A.8 page, spend-check/admin-stats ledger queries, A.9 docs | pending | — |
| Gates + PR | full gate set sequentially, PR opened, CI watched | pending | — |
| Codex adversarial review | after Opus is satisfied with the whole | pending | — |

## 3. Unresolved findings for the owner

(none yet)

## 4. Decisions made on the owner's behalf

(none yet)

## 5. Owner-side steps before a smoke run

Filled in at the end of the build: migration command, prompt seed command, Blob store provisioning,
`! vercel env add` lines, `vercel.json` cron line, `VRP_ALLOWED_PROVIDERS` update.
