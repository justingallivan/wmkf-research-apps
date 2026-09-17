---
title: Ops meeting 2026-09-16 outcomes — Codex Brief (2026-09-17)
domain: site-visit-materials
kind: plan
status: active
summary: "Codex brief: record the 2026-09-16 operations-meeting outcomes (reminder cron schedule still open; manual-reminder race already guarded in S507; other-upload stays hidden; Cycle Dossier drain cron to every 5 minutes) on branch codex/ops-meeting-2026-09-16."
cataloged: 2026-09-17
last_verified: 2026-09-17
owner: product-engineering
related:
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
  - docs/CYCLE_DOSSIER_PILOT_DESIGN.md
---

Branch: `codex/ops-meeting-2026-09-16` in `../WMKF_Apps-codex` (from `origin/main` at `86746473`).
Committed here so the brief is recoverable from any machine (memory `feedback-codex-worktree-owner-runs-it`).

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch `codex/ops-meeting-2026-09-16` (cut from `origin/main` at `86746473`). Run `/start`. Stay on this branch and in this directory: another agent is in the main checkout (`/Users/gallivan/Code/WMKF_Apps`). Do not check out other branches, do not touch the main checkout, and never push to `main`.

## Goal

Record the outcomes of the owner's 2026-09-16 operations meeting and apply the one config change it produced. Scope is small: one `vercel.json` line, two dated doc subsections, one memory correction, and doc reconciliation for the cadence change. Do not grow it.

Agenda source: `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` (six items). Owner outcomes, item by item:

1. **Reminder cron schedule (`/api/cron/site-visit-materials-reminders`): UNRESOLVED.** The owner still needs to talk with the team. Do not add a `vercel.json` entry, do not change any doc claim about this route's schedule, and leave this as the only open line in the memory. Memory stays `status: active`.
2. **Effects definition: record only.** No decision needed beyond what `lib/services/site-visit-materials/reminder-sweep.js` already documents.
3. **PC manual-reminder race: owner chose "guard it", but the guard is ALREADY BUILT.** Commit `90641978` (S507) made `remindMaterialsContributors` in `lib/services/site-visit-materials/collection-service.js` claim before sending via `claimManualReminder` in `collection-store.js`. Verify against source and the tests in `tests/unit/site-visit-materials-collection-store.test.js` and `tests/unit/site-visit-materials-collection-service.test.js`, then correct the memory line as done with that commit as evidence. No code change.
4. **Optional "other" upload: stays hidden this cycle.** Ops confirmed. Plan §16.5 already holds the owner decision; record the ops confirmation only.
5. **Per-user Dataverse role gap: record only.** No ops action.
6. **Cycle Dossier drain cron (`/api/cron/drain-cycle-dossiers`): every 5 minutes.** Change only that line in `vercel.json` from `* * * * *` to `*/5 * * * *`. Do NOT touch the adjacent `drain-review-panels` line or any other cron entry. Note for the record: `CYCLE_DOSSIER_ENABLED=true` is live in Production smoke mode (`docs/CYCLE_DOSSIER_PILOT_DESIGN.md:63`), so the memory's "invoked while disabled" framing is stale. Each tick claims one run and processes at most three queued entries (`lib/services/cycle-dossier-worker.js` `drainCycleDossiers`), so this cadence lengthens a dossier's wall-clock time, not only its start delay. State that consequence in the design-doc entry.

## Where the decisions go

- Items 1–5: a new dated subsection `### 16.6 2026-09-16 ops meeting` in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`, following the shape of §16.5. Item 1 is recorded as open.
- Item 6: the Cycle Dossier design doc `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` (its line 63 lists the cadence as an open owner decision; update it). Not the materials plan.
- Memory `.claude-memory/project-ops-meeting-2026-09-16-agenda.md`: mark items 2–6 as decided/recorded with evidence pointers, correct item 3 as already built, leave item 1 open, keep `status: active`. Follow `.claude/rules/durable-docs.md`.

## Reconciliation for item 6 (grep, then fix each live restatement)

- `docs/API_ROUTE_SECURITY_MATRIX.md` row for `/api/cron/drain-cycle-dossiers` (check whether it states a cadence).
- `docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md:328` cites "per-minute drain cron" as the dossier precedent.
- `docs/CURRENT_WORK_QUEUE.md` row 11 (Cycle Dossier pilot) if it mentions the cadence.
- Anything else `grep -rn 'drain-cycle-dossiers\|per-minute\|every minute' docs .claude-memory` turns up that describes the dossier cron.

## Guardrails

- Derive every fact from source or the Atlas; never fabricate identifiers, commits, or literals.
- Do not edit `SESSION_PROMPT.md`, `CLAUDE.md`, or `.claude-memory/MEMORY.md` (the main checkout owns them this session; a branch edit conflicts on merge).
- No new API routes, no code changes, no schema changes. If something looks like it needs code, stop and report instead.
- Do not modify anything under `lib/` or `pages/`.

## Gates (each with its self-test, sequentially, never in parallel)

```bash
npm run check:reviewer-reminder-hold && npm run check:reviewer-reminder-hold:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:memory-drift
npm run check:docs-catalog
npm run check:types
```

## Finish

Commit to this branch with descriptive messages, then `git push -u origin codex/ops-meeting-2026-09-16`. Pushing the feature branch is safe and does not deploy; only `main` deploys. Do not merge. Report: files changed, the exact `vercel.json` diff, every doc restatement you reconciled, and anything you left open.
