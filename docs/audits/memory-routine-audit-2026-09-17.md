---
title: Memory Routine Audit — 2026-09-17
summary: "Full §6 routine audit: router diet (8,239→6,921 B), every health finding dispositioned (21→9 flagged), five-leaf sample with one stale pointer re-pointed; no memory content deleted."
canonical: false
owner: product-engineering
last_verified: 2026-09-17
---

Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.

Repo baseline: `main` @ `86746473` (Session 518).

## Scope

Mode: full §6 routine audit, run in two commits on `main` in Session 518. Commit 1
(`c39e43ed`) was the §10 router diet; commit 2 is steps 1, 3, 4, and 5. Excluded,
deliberately: `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` is being rewritten
on the parallel branch `codex/ops-meeting-2026-09-16` (its `weak-basis` and
`no-recall-rule` flags are left for that branch); the five oversize-routed leaves are
dispositioned but not split (time-box). No leaf was deleted or demoted.

## Commands run

```
check:memory-router            before: 8239 bytes / 70 lines / 67 unique leaf refs
                               after:  6921 bytes / 67 lines / 52 unique leaf refs
§6.B composition               before: bytes 8239 | leaf 67 | hub 46
                               after:  bytes 6921 | leaf 52 | hub 41
§6.C status census             267 files: active 240, closed 20, superseded 4, stale 3
check:memory-health            before: shadow-atlas 3, weak-basis 1, no-recall-rule 12, oversize-routed 5, stale-routed 0 (21 flags / 18 files)
                               after:  shadow-atlas 2, weak-basis 1, no-recall-rule 1, oversize-routed 5, stale-routed 0 (9 flags)
check:memory-drift:no-write    clean: 5 live drift findings, 0 blockers (committed report evaluated read-only, flagged stale)
check:agent-wiki (+self-test)  OK, 13 topic pages
check:doc-symbol-refs          OK, 1740 path refs resolve
check:harness-framing          OK
```

## Findings

### Router diet (§10, commit `c39e43ed`)

| line / claim | classification | evidence | disposition |
|---|---|---|---|
| Site Visit materials line carried "SHIPPED S503; PR #252 merged; cron unscheduled; briefing page live S502" | status narrative | §10 step 1 | moved to `project-closed-work-archive.md` (Shipped features) |
| PC Meeting Tracker line carried "D1–D25 decided; live in prod S503" + two Codex build briefs | status narrative | §10 step 1 | moved to archive; router keeps the plan hub |
| Reviewer lifecycle line carried "SHIPPED S489" | status narrative (already in archive) | archive entry | router line reduced to the decision trigger |
| Reviewer Find latency incident doc + Fable assessment output | point-in-time | §10 step 1 | moved to archive; postmortem leaf stays in Working Norms |
| Environment / deployment: 8 leaves on two lines | leaf list | §10 step 2 | listed under `dev-environment.md` Durable Memory; router keeps 2 hazard leaves |
| Delegated work: 4 leaves | leaf list | §10 step 2 | listed under `dev-environment.md` Durable Memory; router keeps model + owner-runs-it |
| Reviewer product decisions: 3 leaves | leaf list | §10 step 2 | listed under `reviewer-identity.md` Durable Memory; router keeps contact-recall |
| Workbench closeout / capture mode / transient-state: 5 leaves on 4 lines | leaf list | §10 step 2 | listed under `reviewer-workbench-lifecycle.md` Durable Memory; router routes to the hub |
| `docs/atlas/dataverse-wmkf-requestdocument.md` on the Initial Assessment line | hub duplicate | linked from `docs/APPLICATION_STATE_ATLAS.md` | dropped from the router |

### Health findings — 21 flags on 18 files / 21 dispositioned

| file | flag | classification | disposition |
|---|---|---|---|
| feedback-codex-worktree-owner-runs-it | shadow-atlas | accepted | checker false positive: `wmkf_[a-z]+` matched `WMKF_Apps` (the repo name) case-insensitively; the body makes no data-ownership claim. Has a recall rule. |
| feedback-consistency-over-preview-rationale | shadow-atlas | accepted | the only structural token is "a concurrent Dataverse edit" in a narrative sentence; reasoning rule, no state claim |
| feedback-consistency-over-preview-rationale | no-recall-rule | hygiene-debt | recall rule added (fixed) |
| reference-vercel-logs-filtering | shadow-atlas | hygiene-debt | grounded: recall rule now points at `lib/dataverse/core/interlock.js` (flag cleared) |
| reference-vercel-logs-filtering | no-recall-rule | hygiene-debt | recall rule added (fixed) |
| project-ops-meeting-2026-09-16-agenda | weak-basis, no-recall-rule | deferred | file is being rewritten on `codex/ops-meeting-2026-09-16`; disposition after that branch lands |
| feedback-codex-model-gpt56-sol | no-recall-rule | hygiene-debt + real-defect | recall rule added; body said `~/.codex/config.toml` pins `gpt-6-astra` — [VERIFIED 2026-09-17] the file now pins `gpt-5.6-sol`; sentence corrected, directive unchanged |
| feedback-mutable-parameters-not-in-code | no-recall-rule | hygiene-debt | recall rule added; ground-truth paths exist [VERIFIED: `lib/services/executor-budget-service.js`, `pages/api/admin/executor-budgets.js`] |
| feedback-run-harness-framing-before-handoff-commit | no-recall-rule | hygiene-debt | recall rule added; [VERIFIED `.github/workflows/test.yml:59` runs the gate] |
| feedback-verify-deploy-is-the-merge-build | no-recall-rule | hygiene-debt | recall rule added |
| feedback-verify-vercel-env-with-env-ls | no-recall-rule | hygiene-debt | recall rule added |
| project-accepted-awaiting-materials-is-transient | no-recall-rule | hygiene-debt | recall rule added; manual path `shared/components/reviewers/ReleaseMaterialsModal.js` exists [VERIFIED]; the "no automated send" claim is carried as S490 evidence, not re-probed |
| project-invitation-link-strictness-open-decision | no-recall-rule | hygiene-debt | recall rule added; validator, both test files, and the queue entry (`docs/CURRENT_WORK_QUEUE.md:189`) exist [VERIFIED] |
| project-test-residue-cleanup-is-for-data-mining | no-recall-rule | hygiene-debt | recall rule added; inventory audit doc exists [VERIFIED] |
| reference-staleness-ack-markers-single-line | no-recall-rule | hygiene-debt | recall rule added; `hasStalenessAck` at `.claude/hooks/lib/document-guards.js:359` [VERIFIED] |
| project-dynamics-explorer-socal-campaign (6.9 KB) | oversize-routed | accepted | has a recall rule; decisions + probe results; under 7 KB, not worth a split yet |
| project-j27-doc-capture-evolution (11.7 KB) | oversize-routed | hygiene-debt, scheduled | "decision picture" narrative from S258 could move to the archive or the file-model doc; queued for the next deep audit |
| project-prompt-governance (5.2 KB) | oversize-routed | accepted | just over threshold; single decision with recall rule |
| project-reviewer-apps-redesign-direction (59 KB) | oversize-routed | hygiene-debt, scheduled | 10 sections of locked architecture, chronology, and build sequence; split "Current source-backed state" from history is the obvious cut; queued as a deep-audit item (too large for this pass) |
| project-site-visit-materials-planning-handoff (7.6 KB) | oversize-routed | hygiene-debt, scheduled | description is a ship-status narrative; the archive now carries the status, so this leaf can shrink to the owner handoff plus hazards after the ops-meeting branch lands |

### Five-leaf sample (§6 step 3)

| leaf | added | recall rule (§11) | consequential claim | result |
|---|---|---|---|---|
| feedback-feature-branch-handoff-lands-on-main | 2026-09-16 | good: discriminative trigger (`/stop` off `main`), three ordered actions | `/start` on `main` pulls `main` and cannot see branch work | AGREE [VERIFIED via `.claude/skills/start/SKILL.md` Step 1] |
| feedback-mocked-sql-hides-parameter-typing | 2026-09-10 | good: names the statement shape that triggers it | `acquireSlotLease` casts both `jsonb_build_object` args | AGREE [VERIFIED `lib/services/site-visit-materials/collection-store.js:200` has `::text` / `::double precision`] |
| feedback-red-gates-are-p0 | 2026-05-22 | good shape, but ground truth named a `CLAUDE.md` heading that no longer exists | rule lives in `CLAUDE.md` "Ground-truth requirement" | STALE pointer: no such heading in `CLAUDE.md` or `docs/CLAUDE_REMEDIATION_PLAN.md`; the rule is Universal Operating Rule 4 and `/start` Step 2. Re-pointed, `last_verified` bumped. Frame intact. |
| project-reviewer-verify-fail-dangerous | 2026-06-07 | good: names the code paths and the two-sided invariant | `verification.js` requires `hasFullForenameMatch`; resolver uses `forenameContradicts` | AGREE [VERIFIED grep: 2 hits in `lib/services/discovery/verification.js`, 6 in `reviewer-identity-resolver.js`, 1 in `reviewer-identity-evidence.js`; regression test file exists] |
| project-grantee-deliverable-email-voice | 2026-06-20 | good: names the settings keys and the tab | reminder sends as the assigned PD with `noFallback:true`; `resolveSignatureForRequest` builds the fallback | AGREE [VERIFIED `lib/services/email-signature.js` exports the resolver; `noFallback` in `lib/services/scheduled-email-service.js`; matrix row for `/api/cron/grantee-deliverable-reminders` states the same] |

Demotion: none. Justification: of five sampled leaves, one had a stale ground-truth pointer (fixed) and none had a contradicted factual frame or a lesson that no longer constrains action.

## Falsification

- Every leaf removed from the router was grepped by name in `docs/agent-wiki/topics/*.md` and the archive; all 15 resolve to at least one hub and each file exists on disk.
- The "heading no longer exists" finding was tested by grepping `CLAUDE.md` and `docs/CLAUDE_REMEDIATION_PLAN.md` for both `Ground-truth requirement` and `Red gates are P0` (0 hits).
- The Codex config claim was tested by reading `~/.codex/config.toml` line 1 (`model = "gpt-5.6-sol"`).
- `check:memory-router` reports all 267 topic files still link-resolve with a valid status; `check:doc-symbol-refs` resolves all 1,740 path references including the new recall-rule ground-truth paths.

## Fixes applied

- `c39e43ed` — router diet (router, archive, three wiki Durable Memory sections).
- This commit — 11 recall rules added; `feedback-red-gates-are-p0` ground truth re-pointed; `feedback-codex-model-gpt56-sol` config-default sentence corrected; audit note and §18 row.

## Unknowns and owner decisions

- The ops-meeting agenda leaf's two flags wait for `codex/ops-meeting-2026-09-16`.
- The committed memory-drift report is flagged stale by the read-only checker; `npm run refresh:memory-drift` is an authorized live refresh, not run here.
- Deep-audit queue: split `project-reviewer-apps-redesign-direction` (59 KB) and `project-j27-doc-capture-evolution`; shrink `project-site-visit-materials-planning-handoff` once the ops-meeting branch lands.
- Router landing point is 6.9 KiB / 52 leaves against the §10 target of ~6 KiB / ~45; the remaining leaf lists are Working Norms feedback entries with no natural wiki hub.

## Metrics row

Appended to `docs/MEMORY_HYGIENE_RUNBOOK.md` §18.

## Verdict

RECONCILED WITH EXPLICIT UNKNOWNS (ops-meeting leaf deferred to its branch; drift report not refreshed).
