---
title: Memory Routine Audit — 2026-10-05
summary: "Router diet per MEMORY_HYGIENE_RUNBOOK §10 (8,325 → 6,863 B; 69 → 47 unique leaf refs); 25 health flags dispositioned, all recall-rule gaps fixed (25 → 15 flags)."
canonical: false
owner: product-engineering
last_verified: 2026-10-05
---

Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.
Repo baseline: main @ d7d2bb5b4

## Scope

Routine audit (runbook §6) with the router diet (§10) as the fix pass, run
during Session 576 at the owner's request while CI was blocked by a GitHub
Actions incident. Exclusions: leaf content repairs for the health findings
(recall rules, oversize splits, shadow-atlas grounding) are queued, not done,
to keep the pass inside the time-box; no drift refresh (owner-approved only).

## Commands run

- `npm run check:memory-router` → 8,325 B / 75 lines / 69 unique direct leaf refs (routine-audit notice).
- `npm run check:memory-health -- --json` → 25 flagged files (shadow-atlas 9, no-recall-rule 7, weak-basis 7, oversize-routed 6).
- `npm run check:memory-drift` → committed report read-only, stale; "5 live drift findings; 0 blockers".
- §6.B composition → 8,325 B | 69 unique leaf refs | 43 unique hub refs.
- §6.C status census → active 256, closed 24, superseded 4, stale 3 (287 files).

## Findings

### Router diet (§10)

| line / claim | classification | evidence | disposition |
|---|---|---|---|
| Delegated work (5 leaves) + Delegated builds (2 leaves) | leaf list | §10 step 2 | merged into one line routed to `dev-environment.md` Durable Memory (which already listed the Codex model and owner-runs leaves); router keeps `project-agent-worktree-base-is-main` as a live hazard |
| Environment, sandbox rehearsal, local containers, Factory ledger (7 leaves on 4 lines) | leaf list | §10 step 2 | one hub line; leaves listed under `dev-environment.md` Durable Memory; router keeps `feedback-verify-deploy-is-the-merge-build` and `feedback-postgres-url-handling-hazards` |
| Red gates: `feedback-run-harness-framing-before-handoff-commit` | leaf list | §10 step 2 | moved to `dev-environment.md` Durable Memory |
| Reviewer lifecycle program line routes `project-reviewer-lifecycle-autonomy-directive-2026-09-05` | closed leaf routed directly (§9 violation) | leaf `status: closed`; archive already indexes it | router line removed; workbench hub notes the archive entry |
| Candidate-card, stabilization, multiselect, address-trust lines | leaf list / hub duplicates | leaves and docs already listed in their wiki topics | merged into the reviewer-workbench, external-portal, and contact lines |
| Sourcing constraints, verify-fail, thinking-budget, J27, redesign-direction leaves | hub duplicates | already in reviewer-origination, reviewer-identity, prompt-executor, intake-portal, reviewer-workbench Durable Memory | dropped from the router |
| SharePoint DOCX identity, Explorer campaign, prompt governance, org-open access leaves | leaf list | §10 step 2 | moved to dataverse-dynamics, prompt-executor, security-auth Durable Memory |

Completeness: all 22 leaves removed from the router resolve from a wiki topic
or the closed-work archive (grep over `docs/agent-wiki/topics/*.md` and the
archive, 22/22). No leaf file was deleted or edited for content.

Also: `project-virtual-review-panel` (closed S573) added to the closed-work
archive (S575 handoff debt).

### Health findings — 25 flagged files / 25 dispositioned

| file | flag | classification | disposition |
|---|---|---|---|
| feedback-cap-subagent-load-in-reproduction-briefs | no-recall-rule | hygiene-debt | fixed: recall rule added (second commit) |
| feedback-one-session-runs-gates-per-worktree | no-recall-rule | hygiene-debt | fixed: recall rule added |
| feedback-operational-state-must-be-reachable-from-every-workstation | no-recall-rule | hygiene-debt | fixed: the inline "Recall rule" line became a full section with ground truth |
| project-agent-worktree-base-is-main | no-recall-rule | hygiene-debt | fixed: recall rule added |
| feedback-postgres-url-handling-hazards | no-recall-rule, shadow-atlas | hygiene-debt | fixed: full recall section; ground truth names `lib/db/ledger-registry.js` and the credentials runbook, which grounds the Postgres claims (flag cleared) |
| project-sandbox-rehearsal-bypass-allow-rule | no-recall-rule, weak-basis, shadow-atlas | hygiene-debt + real-defect | fixed: recall rule added; body said the script and design doc were "Factory branch only" — [VERIFIED 2026-10-05] both are on `main` (`git log` on each path), so the two `doc-symbol-refs:ignore` markers were removed and the working-directory note corrected; allow rule present on the owner's Mac (grep of `.claude/settings.local.json`). shadow-atlas accepted: matches the `crm.dynamics.com` sandbox URL and the repo path. weak-basis remains queued |
| project-sharepoint-property-promotion-rewrites-docx | no-recall-rule | hygiene-debt + real-defect | fixed: recall rule added; "lands on `main` with PR #336" was stale — [VERIFIED 2026-10-05] the module is on `main` (added in `9f061fe92`), ignore marker removed |
| feedback-codex-model-gpt56-sol | shadow-atlas | accepted | checker false positive: `\brows\b` matched "the thread's rows" in Codex's local log; no data-ownership claim (match context read this pass) |
| feedback-codex-worktree-owner-runs-it | shadow-atlas | accepted | false positive: `wmkf_[a-z]+` matches the repo path `WMKF_Apps` case-insensitively (re-read this pass; same disposition as 2026-09-17) |
| feedback-consistency-over-preview-rationale | shadow-atlas | accepted | narrative "concurrent Dataverse edit" and "finding-disposition table" (re-read this pass; same disposition as 2026-09-17) |
| feedback-fixtures-return-raw-transport-shape | shadow-atlas | accepted | false positive: "the fake's rows" (test-fixture rows), no state claim |
| feedback-orchestrator-checks-builds-before-review | shadow-atlas | accepted | false positive: "invariant table" (a review artifact), no state claim |
| feedback-question-the-rehearsal-venue | shadow-atlas | accepted | false positive: a pointer to "the agent-wiki Dataverse note", no state claim |
| feedback-staff-ui-never-shows-internal-ids | shadow-atlas | accepted | false positive: "unresolved rows" (UI rows), no state claim |
| project-cache-hit-rate-review | weak-basis | hygiene-debt | queued: unrouted; verify or demote |
| project-email-template-token-syntax | weak-basis | hygiene-debt | queued: dated verification of the token syntax against source |
| project-executor-thinking-budget-truncation | weak-basis | hygiene-debt | queued: verify against `shared/config/executorBudgets.js` |
| project-local-docker-is-colima | weak-basis | AGREE (this session) | Colima containers ran this session (`docker ps`, throwaway Postgres 16); queued: record the dated label |
| project-migration-numbers-claimed-off-main | weak-basis | AGREE (this session) | 067 still claimed off `main`; migration 070 chosen after a remote-branch scan this session; queued: record the dated label |
| project-preview-rehearsal-venue-limits | weak-basis, oversize-routed | hygiene-debt | queued: verify; now hub-routed, size flag no longer applies |
| project-dynamics-explorer-socal-campaign | oversize-routed | hygiene-debt | now hub-routed (flag no longer applies); split remains a deep-audit candidate |
| project-j27-doc-capture-evolution | oversize-routed | hygiene-debt | now hub-routed; split once 2026-09-17, still 7.9 KB |
| project-prompt-governance | oversize-routed | hygiene-debt | now hub-routed |
| project-reviewer-apps-redesign-direction | oversize-routed | hygiene-debt | now hub-routed; split once 2026-09-17, still 11.5 KB |
| project-site-visit-materials-planning-handoff | oversize-routed | hygiene-debt | still routed (9.2 KB); queued split |

## Falsification

- "No leaf lost reachability": disconfirming query = for every leaf in the
  pre-diet router but not the post-diet router, grep the wiki topics and the
  archive. Result: 22/22 found, 0 missing.
- "Health 25 → 21 is improvement": refuted as stated. The 4 fewer flags are
  `oversize-routed` flags that stop applying once a leaf is hub-routed, a
  measurement artifact of the diet, not a repair. No leaf content changed.

## Fixes applied

- Router diet commit: `.claude-memory/MEMORY.md`, five wiki Durable Memory
  sections (dev-environment, reviewer-workbench-lifecycle, dataverse-dynamics,
  prompt-executor, security-auth), the closed-work archive, this note, and the
  runbook §18 row.
- Before → after: 8,325 → 6,863 B; 75 → 65 lines; 69 → 47 unique leaf refs.
- Second commit: recall rules on all seven no-recall-rule leaves (two stale
  "not on main yet" statements corrected in the same pass). Health flags
  21 → 15: no-recall-rule 7 → 0, shadow-atlas 9 → 8 (one grounded); the 8
  remaining shadow-atlas flags are all accepted false positives; weak-basis 7
  and one oversize-routed leaf remain queued.

## Unknowns & owner decisions

- All seven pure shadow-atlas flags were read against `STRUCTURAL_RE`
  (`scripts/check-memory-health.js`) this pass: every one matched a generic
  word (`rows`, `table`, the repo name `WMKF_Apps`, a narrative "Dataverse").
  The two shadow-atlas flags on files that also lack recall rules are queued
  with those rules.
- Proposal for the owner (checker change, §14): the generic tokens `rows`,
  `table`, and case-insensitive `wmkf_` produce most shadow-atlas noise across
  two audits; narrowing them (case-sensitive `wmkf_[a-z]+`, drop bare
  `rows`/`table`) would leave the flag for real data-ownership claims.

## Metrics row

Appended to `docs/MEMORY_HYGIENE_RUNBOOK.md` §18.

## Verdict

RECONCILED WITH EXPLICIT UNKNOWNS — router diet complete and verified;
all no-recall-rule flags fixed; eight shadow-atlas flags accepted with read
evidence; weak-basis (7) and one oversize split queued with named
dispositions.
