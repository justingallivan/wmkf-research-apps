---
title: Memory Routine Audit — 2026-08-21
summary: "First routine audit under the canonical runbook; dieted the router below its trigger and dispositioned every health finding."
canonical: false
owner: product-engineering
last_verified: 2026-08-21
---

Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.

Repo baseline: `main` @ merge commit `0013933196c8` (Fable memory-hygiene
branch merged at full branch head `800eb8e4`).

## Scope

Routine audit per `docs/MEMORY_HYGIENE_RUNBOOK.md` §6 plus the triggered
router diet in §10. In scope: the complete router, all three health findings,
five leaf samples, the missing runbook route, and metrics recording. No memory
file deletion, live external probe, checker/threshold change, or deep semantic
audit was authorized or needed. The handoff's R4/R5 owner decisions and all
early-warning expansion remain out of scope.

## Commands run

- `npm run check:memory-router`: `9040` B / `66` lines / `248` leaves; gate
  green with the expected `8192` B routine-audit notice.
- `npm run check:memory-health -- --json`: `3` files flagged / `248` scanned.
- `npm run check:memory-drift:no-write`: `5` committed-report findings, zero
  blockers/collisions/probe errors; report older than 24 hours and not
  regenerated.
- Router composition: `63` unique leaf refs / `41` unique hub refs.
- Status census: `222` active, `19` closed, `4` superseded, `3` stale.
- `git log --diff-filter=A --name-status ...`, complete-file reads, and
  CodeGraph-first source checks supplied the five-leaf sample evidence below.

## Findings

### Health findings — 3 flagged / 3 dispositioned

| File | Classification | Evidence | Disposition |
|---|---|---|---|
| `feedback-clear-jest-cache-in-shared-worktrees.md` (`no-recall-rule`) | hygiene-debt | Whole-file read found a substantive incident lesson but no executable recall boundary. | Added a discriminative recall rule that preserves the uncertainty: source-impossible failure first, cache clear second, recurrence treated as real. Its direct route was removed as part of the Git/release hub collapse; the leaf remains tracked. |
| `project-dynamics-explorer-socal-campaign.md` (`weak-basis`, `oversize-routed`) | accepted hygiene-debt | CodeGraph/source confirmed the request-lifecycle writer, request/round propagation, normalized provider stop reason, and correlated `api_usage_log` writer. The leaf also carries dated owner/live-probe history that this routine audit did not re-probe. `weak-basis` is a known metadata-shaped measurement artifact here, not evidence that the dated body claims are false. | Keep active and routed because its SoCal vocabulary/probe hazards remain discriminative. Queue any structural split for a Dynamics-focused deep audit; do not fake-refresh `last_verified`. |
| `project-prompt-governance.md` (`oversize-routed`) | accepted hygiene-debt | `seedPromptRow` currently refuses any pre-existing row by default and force-publishes `max(version)+1`, flips prior current rows with fresh ETags, then asserts exactly one current row. Live prompt-v4 state was not re-probed. | Keep active and routed because create-only/version-preserving prompt governance is a high-consequence task boundary. Consider a prompt-domain split only in a future deep audit. |

### Five-leaf sample

| Leaf | Sample basis | Recall-rule quality | Consequential spot-check | Verdict |
|---|---|---|---|---|
| `feedback-corrections-decay-unless-mechanized.md` | recent addition | Discriminative correction trigger with per-act Do/Do-not actions and named deterministic mechanisms. | Current `scope-claim-reminder.js` blocks unresolved-plan-count leakage; `scripts/lib/canonical-facts.js` derives bounded facts for the consistency gate; the merged hook suite passed. Historical incident counts were not promoted as live state. | AGREE |
| `project-dynamics-explorer-socal-campaign.md` | recent addition | Concrete Dynamics Explorer/SoCal/telemetry trigger; decision boundary is explicit. | Current chat, `LLMClient`, request-telemetry, and usage-logger source preserve request/round and stop-reason correlation. Dated production rows/deployments remain probe history, not freshly verified state. | AGREE WITH EXPLICIT LIVE-EVIDENCE BOUNDARY |
| `project-prompt-governance.md` | routed-and-old | Concrete seed/admin/prompt trigger and Atlas authority pointer. | Current `lib/services/prompt-seed.js` matches the create-only and version-preserving-force invariant. | AGREE |
| `project-reviewer-verify-fail-dangerous.md` | routed-and-old | Concrete verification/name/ORCID/COI trigger with complement cases. | Current name matching distinguishes full-forename from initial-only evidence; the identity resolver blocks explicit contradictions while allowing initial-only promotion only with independent anchors. | AGREE |
| `project-memory-router-trap-prevention.md` | router mechanism reference | Concrete router-edit trigger, terse actions, explicit source/gate authority. | Current thresholds module, gate, write guard, SessionStart/Stop code, and the passed standalone hook suite agree with its three-layer contract. | AGREE |

## Router diet

Nineteen direct routes were removed after complete-router review. No leaf was
deleted or rewritten for size. Generic guardrail/review routes were collapsed
under the retained collaboration, CI, memory-hygiene, dev-environment, and
working-norm hubs; project routes were collapsed under their security, prompt,
reviewer, or release hubs.

Removed direct refs:

- `feedback-author-adversarial-pass-first.md`, `feedback-cite-ground-truth.md`,
  `feedback-dont-self-certify-convergence.md`,
  `feedback-green-requires-full-test-suite.md`,
  `feedback-review-panel-tone.md`,
  `feedback-self-review-before-delegating-review.md`,
  `feedback-share-codex-verbatim.md`,
  `feedback-stakeholder-email-tone.md`,
  `feedback-surface-full-review-findings.md`,
  `feedback-thoroughness-default.md`,
  `feedback-truncation-is-breakage-not-completion.md`, and
  `feedback-verify-additive-carryover-not-just-destructive.md`.
- `feedback-clear-jest-cache-in-shared-worktrees.md`,
  `project-app-access-control.md`, `project-cache-hit-rate-review.md`,
  `project-commit-directly-to-main.md`,
  `project-merge-candidates-authorization-gap.md` (already `closed`),
  `project-reviewer-find-usage-cadence-blocks-observation-windows.md`, and
  `project-reviewer-upload-dormant-not-deleted.md`.

Added routes: the canonical `docs/MEMORY_HYGIENE_RUNBOOK.md` and the active
`project-memory-router-trap-prevention.md` hazard leaf. Four status narratives
were removed from routing lines; current status remains owned by the linked
plans, queue, handoff, and wiki surfaces.

## Falsification

- Disconfirming content-loss check: the fix pass contains no deleted memory
  file; all 19 de-routed leaves still exist with their original status. The
  Jest-cache leaf gained the substantive recall rule described above; no
  existing leaf content was removed.
- Disconfirming closed-leaf check: the only closed task leaf directly routed
  before the diet (`project-merge-candidates-authorization-gap.md`) is still
  linked by its owning security/design surfaces, not a live router task line.
- Disconfirming stale-status check: router text no longer asserts `LIVE`,
  `RESOLVED`, production-smoke completion, or accepted-by-design status.
- Disconfirming sample checks used current source rather than the leaf as
  evidence; no external row/deployment claim received a refreshed verification
  label.

## Fixes applied

- Router: `9040` B → `5911` B; `66` → `60` lines; `63` → `45` unique leaf
  refs; `41` → `39` unique hub refs.
- Health: added one substantive recall rule; expected close-out is `2` flagged
  files, both dispositioned accepted hygiene debt.
- Metrics: appended this audit to the canonical runbook §18 table.
- Commit: this report and fix pass are committed together; use the commit
  containing this file as the exact receipt.

## Unknowns and owner decisions

- The committed drift report is older than 24 hours. No session claim relied
  on it being fresh, so the owner-only live regeneration was not run.
- Best-practices-review recommendations R4/R5 remain owner decisions and out of
  scope, exactly as directed by the Fable handoff.
- No production Dataverse, Postgres, Vercel, or SharePoint probe was run.

## Metrics row

`2026-08-21 | routine | 9,040→5,911 B | 66→60 lines | 63→45 unique leaf
refs | 248 leaves | 222/248 active | 3→2 health flagged | >24 h drift report`

## Verdict

**RECONCILED WITH EXPLICIT UNKNOWNS**, bounded to this routine audit. The
router is below the notice trigger and the approximately 6 KiB diet target;
all checker findings and all five sampled leaves have recorded dispositions.
