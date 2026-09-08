# Codex handover to Claude — 2026-09-08

This is the authoritative handover for Codex-owned branches visible on 2026-09-08. Tip hashes and PR state were checked against the local refs and GitHub; `CONFLICTING` means a three-way merge against `origin/main` reports overlapping changes.

## Branches

### `codex/cycle-dossier-pilot-build`
- Tip: `ad2de69b`; PR #179, **open draft**, **CONFLICTING** against `main`.
- Purpose: D26 Cycle Dossier superuser pilot implementation, including the UI, API, worker, private artifacts, and bounded generation. It is a Tier 2 pilot and must be reconciled with the current program-scope contract before activation.
- Done: source/UI/API/worker and migration 038 are present (`pages/cycle-dossier.js`, `lib/services/cycle-dossier-*.js`, `pages/api/cycle-dossier/*`, `scripts/check-cycle-dossier-rollout.js`, `lib/db/migrations/038_cycle_dossiers.sql`). Half-done: PR reconciliation and live environment preflight are pending; next, rebase against current `main`, rerun dossier/security/build gates, then obtain an owner-approved one-request smoke before any activation.
- Rollout facts: `CYCLE_DOSSIER_ENABLED` is disabled; `CYCLE_DOSSIER_REQUEST_ALLOWLIST` is not configured; `CYCLE_DOSSIER_ROLLOUT_MODE` defaults to `pilot`; `CYCLE_DOSSIER_OPERATOR_PROFILE_ID` is required only for `smoke`; `CYCLE_DOSSIER_OPERATOR_STOP` is unset by default. Migration 038 is verified applied; the dedicated private store `wmkf-cycle-dossier-private` is connected and the Development token authenticated; both prompt families are published/read back at version 1; no paid generation call, SharePoint publication, unattended cron run, deployment, or promotion has occurred.
- Recommendation: Claude should **rebase and finish**, subject to owner approval for the controlled smoke and release.

### `codex/UI-audit`
- Tip: `2055fd94`; PR #192, **closed**, **CONFLICTING** against `main`.
- Purpose: Owner-present Workbench/reviewer UI audit and polish. It contains the earlier reviewer follow-up surfacing, set-aside removal, PD line, institution fallback, and action-column iterations.
- Done: the branch is pushed and its focused reviewer tests passed locally; PR #192 was superseded by clean main-based PR #193. Half-done: the branch itself is stale and should not be promoted wholesale; next, use merged PR #193 as the source of truth and leave this branch untouched.
- Learned: the production screenshot showed duplicate/misaligned `More` because a CSS pseudo-element in `ReviewersTab.js` competed with the header label; PR #193 removed that path and merged to `main`.
- Recommendation: Claude should **ask the owner whether to abandon** this stale branch; do not rebase it for release.

### `codex/reviewer-ui-surfacing`
- Tip: `067693c0`; no PR found, **open branch**, **CONFLICTING** against `main`.
- Purpose: Reviewer Finder/workbench cycle-count and proposal-surfacing reconciliation. It carries the earlier Dataverse cycle counting and request-search changes.
- Done: implementation and handoff notes exist, and the branch has a dedicated worktree. Half-done: no current PR or release decision is recorded; next, compare its diff to `main` and the surviving reviewer contracts before any new PR.
- Learned: cycle counts must conserve duplicate-cycle and null/off-cycle proposal totals; program scope is server-resolved and must not be inferred from client input.
- Recommendation: **Ask the owner whether to abandon** unless a specific remaining finding requires it.

### `codex/compact-controls`
- Tip: `fd4ba598`; PR #183, **merged** (2026-09-08), clean against `main`.
- Purpose: Program-scoped Workbench discovery and compact control polish. It also removed Set Aside from Reviewer Follow-up and kept active-only cycle labels.
- Done: merged as PR #183 and production-deployed; no half-done work remains. Next: no action unless a new regression is reported.
- Learned: the owner chose Research as the default program and declined silent exact-match scope switching.
- Recommendation: **Do not reopen**; already merged.

### `codex/session-494-workbench-handoff`
- Tip: `9f1d8987`; PR #185, **merged** (2026-09-08), clean against `main`.
- Purpose: Session 494 documentation handoff for the Workbench scope release. It records the owner-present smoke and release state.
- Done: merged as PR #185; no implementation remains. Next: no action.
- Learned: Codex must not push `main`; production promotion uses the reviewed path.
- Recommendation: **Do not reopen**; already merged.

### `codex/ror-api-production-shadow`
- Tip: `a847b730`; PR #116, **open**, **CONFLICTING** against `main`.
- Purpose: Wire the ROR resolver into reviewer shadow mode for measurement only. It is not an authorization or write path.
- Done: shadow adapter work is present in the branch/PR. Half-done: PR is stale/dirty and needs contract review; next, rebase only if the owner still wants the experiment, then run its measurement gates.
- Learned: ROR is an enrichment signal and must remain fail-soft; it cannot override Dataverse identity or applicant authority.
- Recommendation: **Ask the owner whether to abandon** before spending time rebasing.

### `codex/c0-4-action-policy-foundation`
- Tip: `6594a758`; PR #62, **open draft**, **CONFLICTING** against `main` (base is `codex/m1-evaluation-foundation`).
- Purpose: Inert reviewer action-policy foundation and evaluation scaffolding. It deliberately does not enable runtime actions.
- Done: policy schema/scaffolding and tests are present. Half-done: draft has no release approval and is based on an old branch; next, reconcile its contract with current reviewer lifecycle policy only after owner direction.
- Learned: policy rows must remain inert until explicitly enabled; no client-supplied action authority is acceptable.
- Recommendation: **Ask the owner whether to abandon**; do not rebase automatically.

### `codex/reviewer-more-alignment-final`
- Tip: `5c78c464`; PR #193, **merged** (2026-09-08), clean against `main`.
- Purpose: Final clean main-based fix for reviewer `More`/kebab alignment. It replaces the competing pseudo-element with a real header label and centers the control wrapper.
- Done: all required gates passed and PR #193 merged; production deployment completed. Half-done: visual confirmation on the authenticated production page is still owner-run because the last screenshot showed a duplicate label before this merge; next, hard-refresh and inspect the page.
- Learned: the earlier stale branch could not merge cleanly, so the final fix was rebuilt from current `main`.
- Recommendation: **Finish the owner smoke only; otherwise no further code work.**

## Detached worktrees

- `/private/tmp/wmkf-prod-ui` — detached at `7fa7f637` (`Hide set-aside requests from reviewer follow-up`); temporary production-UI inspection worktree. Nothing unique remains; safe to remove only after confirming clean.
- `/private/tmp/wmkf-prod-ui-2` — detached at `76931966` (`Fallback to applicant institution for N/A organization`); temporary institution-fallback inspection worktree. The change is represented in branch history; nothing unique remains.
- `/private/tmp/wmkf-reviewer-more` — detached at `5c78c464` (`Align reviewer More header with action menu`); clean main-based PR #193 worktree. Its commit matters only through merged PR #193; nothing unique remains.

## Stashes

- `stash@{0}` on `main`, `codex-startup-reconciliation-report`: metadata-only `docs/RECONCILIATION_REPORT.json` reconciliation (37-line change). Do not drop or apply without the owner’s direction.
- `stash@{1}` on `codex/reviewer-promotion-remediation`, `pre-reconciliation generated report 2026-07-29`: same report artifact shape, from the pre-reconciliation state. Do not drop or apply.

## Handover decision

Claude owns follow-up from this point. Finish the Cycle Dossier only after rebase, preflight, and explicit smoke authorization; use merged PR #193 for the reviewer UI; ask the owner before abandoning or reviving any other stale draft.
