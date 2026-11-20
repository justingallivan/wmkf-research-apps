---
title: Memory Routine Audit — 2026-11-20
summary: "Routine §6 audit with router diet: router 8,247→7,510 B, 21 flagged leaves dispositioned (21→18), five-leaf sample found three stale retirement-era claims, all fixed."
canonical: false
owner: product-engineering
last_verified: 2026-11-20
---
Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.
Repo baseline: main @ b535d6cc2 (diet commit); fix pass committed on top.

## Scope

- Mode: routine audit (`docs/MEMORY_HYGIENE_RUNBOOK.md` §6), triggered by router
  size (8,247 B ≥ 8,192 B) and health flags (21 ≥ 5).
- In scope: router diet, every `check:memory-health` finding, a five-leaf sample
  weighted toward the 2026-11-19 app-suite / Expertise Finder retirements.
- Excluded: live Dataverse/Postgres/Vercel/GitHub probes (not authorized during a
  documentation audit); `refresh:memory-drift` (owner-approved action only);
  checker or threshold changes (owner decisions, proposed below).
- Queued, not done: the 2026-11-19 retirements are a §5 deep-audit trigger
  (retirement touches facts memory asserts). This routine pass sampled for
  retirement exposure; it did not classify all 280 active leaves.

## Commands run

| Command | Result |
|---|---|
| `npm run check:memory-router` (before diet) | OK, 8,247 B / 74 lines / 53 unique leaf refs / 313 topic files |
| `npm run check:memory-router` (after) | OK, 7,510 B / 59 lines / 52 unique leaf refs / 313 topic files |
| §6.B composition one-liner (after diet, before trigger restore) | 7,343 B, 52 unique leaf refs, 37 unique hub refs |
| §6.C status census | active 280, closed 25, stale 4, superseded 4 (313) |
| `npm run check:memory-health -- --json` before | 21 flagged: 11 shadow-atlas, 7 weak-basis, 1 no-recall-rule, 3 oversize-routed (overlapping) |
| `npm run check:memory-health -- --json` after | 18 flagged: 10 shadow-atlas, 5 weak-basis, 0 no-recall-rule, 3 oversize-routed |
| `npm run check:memory-drift` | Committed report dated 2026-08-23 (stale, not regenerated). Not cited as "drift clean". |

## Findings

21 flagged / 21 dispositioned.

Common cause for five weak-basis flags: the 2026-10-22 reconciliation commits
(`9becccb3b`, `cb18820d0`, `9e178c911`, `55ed80a60`) deliberately replaced
`[VERIFIED]` labels with dated "observed"/"unknown" wording. The checker now
reports honest uncertainty. Those flags are accurate, not artifacts.

| File | Flag(s) | Classification | Disposition |
|---|---|---|---|
| `env-broken-git-autogc.md` | shadow-atlas | Accepted lexical false positive | Only match is the repo path `WMKF_Apps` hitting `wmkf_[a-z]+` case-insensitively. |
| `feedback-centralize-over-pd-specific-settings.md` | shadow-atlas | Real structural claim, ungrounded → fixed | Names `wmkf_grantcycle` as the central cycle-date home. Checked against `docs/atlas/dataverse-wmkf-grantcycle.md` (operations-grant-cycle adapter; cycle-calendar-service save). Added that Atlas pointer; flag cleared. |
| `feedback-consistency-over-preview-rationale.md` | shadow-atlas | Accepted (carried forward) | Unchanged since its 2026-10-17 acceptance. |
| `feedback-fixtures-return-raw-transport-shape.md` | shadow-atlas | Accepted (carried forward) | Unchanged since the 2026-10-17 acceptance commit `498cbc4ef`. |
| `feedback-keep-the-owners-named-input-source.md` | shadow-atlas | Accepted (carried forward) | Unchanged since `498cbc4ef`. |
| `feedback-orchestrator-checks-builds-before-review.md` | shadow-atlas | Accepted (carried forward) | Unchanged since `498cbc4ef`. |
| `feedback-owner-review-burden-must-shrink.md` | shadow-atlas | Accepted lexical false positive | "Rows" are review-workbook rows the owner judges, not database rows. |
| `feedback-question-the-rehearsal-venue.md` | shadow-atlas | Accepted lexical false positive (re-read; changed 2026-11-02) | New text is the owner's Production-test-request default. `wmkf_istestrequest` is a real field [VERIFIED via `lib/dataverse/client.js`]; no structural state claim. |
| `feedback-scale-safety-machinery-to-usage.md` | shadow-atlas | Accepted lexical false positive | "Migration" is a generic planning trigger word. |
| `feedback-staff-ui-never-shows-internal-ids.md` | shadow-atlas | Accepted (carried forward) | Unchanged since its 2026-10-05/10-17 acceptance. |
| `project-peer-review-executor-migration.md` | shadow-atlas | Accepted; claims verified (re-read; changed 2026-11-19) | `pages/api/process-peer-reviews.js` is a 410 `APP_RETIRED` stub with the original archived [VERIFIED]; `review-synthesis.generate` is live in `shared/config/prompts/review-synthesis.js`. "Prompt rows" refers to preserved prompt versions. |
| `project-grantee-deliverable-email-voice.md` | oversize-routed | Accepted size debt (carried forward) | Unchanged since the 2026-10-22 acceptance. |
| `project-site-visit-materials-planning-handoff.md` | oversize-routed | Accepted size debt (carried forward) | Unchanged since the 2026-10-22 acceptance. |
| `project-j27-cycle-page-redesign-pending.md` | weak-basis, oversize-routed | Real defect → fixed; size debt queued | Current-voice stale text ("Next session writes a plan", "not promoted"). Added a verified current-shape line [`WorkbenchViewsNav.js` `J27_VIEWS` vs legacy `VIEWS`], moved the still-binding terminology and Initial Assessment rules above an explicit History boundary. No content removed. Weak-basis cleared; still oversize (8.7 KB). Split/rename queued. |
| `project-j27-review-workbook-reflects-cso-intent.md` | no-recall-rule | Hygiene debt → fixed | Added a §11 recall rule (trigger, do, do-not, boundary). The leaf is now routed from the intake-portal wiki page, not the router (diet). |
| `project-sandbox-request-status-business-rules.md` | weak-basis | Hygiene debt → fixed | Added the real basis: `last_verified: 2026-11-09` from Factory batch `owner-j27-2026-11-09`, the observation the body already records. Its evidence doc is still only on branch `codex/j27-factory-scenarios` [VERIFIED: not in `origin/main` tree], as the leaf says. |
| `project-local-docker-is-colima.md` | weak-basis | Accepted — honest uncertainty | `last_verified` states current container presence is unknown and says to verify locally. Probe: `colima status; docker ps --filter name=wmkf-ledger-pg`. |
| `project-preview-rehearsal-venue-limits.md` | weak-basis | Accepted — honest uncertainty | Explicitly historical rehearsal record (2026-09-20) with "verify present" instruction. |
| `project-private-repo-ci-visibility.md` | weak-basis | Accepted — honest uncertainty | States current GitHub state is unknown. Probe: `gh repo view --json visibility` and `gh api repos/{owner}/{repo}/code-scanning/default-setup`. |
| `project-reviewer-identity-resolution-phase1.md` | weak-basis | Accepted — honest uncertainty | 2026-10-22 source re-check of the preservation contract; historical counts labeled not re-probed. |
| `project-reviewer-org-open-access-by-design.md` | weak-basis | Accepted — honest uncertainty | Owner principle plus a 2026-10-22 source review; hosted state labeled UNKNOWN. |

### Router read-through (§6.2)

The diet removed the one status narrative ("live in Production 2026-11-13 …").
A second pass restored retrieval words the merges had dropped ("cycle literals",
"GoVerify bypass", "address trust", "SoCal vernacular / telemetry/eval") and added
a router trigger for reviewer find and search follow-ups pointing at
`reviewer-find-applicant-flow.md`. That makes the search follow-ups plan reachable
by trigger words again.

### Sample (§6.3)

| Leaf | Why sampled | Spot check | Result |
|---|---|---|---|
| `project-program-field-retired-use-grant-program.md` | added 2026-11-19 | 2027+ branch in `list-snapshot-service.js:131-139` | AGREE on the rule; one wrong path (`resolveDiscoveryScope` is in `lib/services/workbench/program-scope-service.js`, not `workbenchVisibility.js`) → fixed |
| `feedback-ordered-workflows-as-one-action.md` | added 2026-11-15 | `shared/components/admin/TestRequestPrepareForReview.js` exists | AGREE |
| `project-a7-prompt-injection-hardening.md` | old, unrouted, names retired surfaces | `ls tests/unit/*-a7.test.js` | STALE: listed 5 test files, 3 exist (email-reviewer deleted 2026-09-06, expertise-finder 2026-11-19) → fixed. Coverage paragraph is dated "verified 2026-06-23" and labeled; left as dated evidence |
| `akoya-temporal-axis-encodings.md` | old, names Expertise Finder callers | `pages/expertise-finder.js` is a retirement page; `conventionalCycles` importers grepped | STALE: Finder proposals query and Batch-tab caller described as current → marked retired 2026-11-19; caller list now says check current importers |
| `project-reviewer-apps-redesign-direction.md` | names Literature Analyzer / Grant Reporting as surviving | read section boundary | AGREE as HISTORICAL: the survivor list sits under an explicit "Historical architecture direction (S195; not current build instructions)" heading |

Three of five sampled leaves needed a fix; two of those were retirement-era.
That rate supports queuing the retirement-scoped deep audit below.

## Falsification

- Weak-basis common cause: `git log -p` on the five 10-22 files shows `[VERIFIED …]`
  → `[OBSERVED …]`/"unknown" rewrites in those commits; `grep -c "\[VERIFIED"` is 0
  in each.
- Carry-forward eligibility: `git log -1` per file vs the accepting audit commit;
  the two oversize leaves' last edits are ancestors of `4720980ed` (10-22 audit).
- "First Cut"/"Semi-finalist" absent from runtime code: `grep -rlE` over `shared pages lib` returned no files.
- Post-fix: `check:memory-health` reports 0 no-recall-rule and no flag on the
  centralize, sandbox, or CSO leaves.

## Fixes applied

- Commit `b535d6cc2`: router diet (8,247→7,343 B) with three pointer relocations to
  wiki hubs.
- Fix-pass commit: router trigger restore (7,510 B), seven leaf fixes listed above,
  this report, §18 row update.

## Unknowns & owner decisions

- Queued deep audit (§5 trigger): retirement-scoped slice — every active leaf that
  names a retired app, route or the Expertise Finder (the grep in §6.3 found eight;
  three sampled). Proposal, not started.
- Queued: split `project-j27-cycle-page-redesign-pending.md` (8.7 KB) into a short
  active rules leaf plus a closed history leaf, and rename away from "pending".
- Probes named above (Colima, GitHub visibility/code scanning) are owner-local or
  external; not run.
- Drift report is from 2026-08-23. A `refresh:memory-drift` run needs owner approval.

## Metrics row

Updated the 2026-11-20 row in `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 to cover this
audit.

## Verdict

RECONCILED WITH EXPLICIT UNKNOWNS
