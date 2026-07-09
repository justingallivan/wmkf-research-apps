# Memory Code-Grounded Triage — 2026-07-08 (S348)

Status: point-in-time triage result. Re-run `npm run check:memory-health` before
acting on counts; verify any structural claim against source/Atlas/probe before
changing memory.

Repo HEAD at start: `be8c0065` (after the `check:memory-health` add).

## What this pass did

Second execution wave of the 2026-07-02 hygiene program
(`memory-hygiene-control-audit-2026-07-02.md`). That audit was mostly plan-only;
this pass (a) built the never-built Slice-5 advisory and (b) ran a code-grounded
triage of the high-risk active memories the advisory surfaced.

1. **Slice 5 shipped** — `scripts/check-memory-health.js` + `npm run
   check:memory-health` (advisory, never fails), wired into `/start`. Flags per
   active leaf memory: `shadow-atlas`, `weak-basis` (structural claim + stale/absent
   `last_verified`), `no-recall-rule`, `oversize-routed`, `stale-routed`. Commit
   `be8c0065`.
2. **Triage** — the advisory's high-risk worklist (75 files: `shadow-atlas` /
   `weak-basis` / `oversize-routed` / `stale-routed`, excluding purely behavioral
   `feedback-*`) was code-grounded across 6 domain clusters by parallel read-only
   subagents; every classification was returned with `[VERIFIED via <src>]`
   evidence. The main agent applied the edits and independently re-verified the
   drift-danger findings before writing.

## Drift metrics (advisory)

| Metric | Jul 2 | Jul 8 (start) | Jul 8 (after) |
|---|---:|---:|---:|
| Leaf files | 191 | 211 | 211 |
| `MEMORY.md` bytes | 5,941 | 8,149 | 8,149 (under 8 KB target) |
| health: files flagged | — | 129 | 124 |
| health: weak-basis | — | 81 | 77 |
| health: shadow-atlas | — | 41 | 39 |
| health: stale-routed | — | 1 | 0 |

Router diet (Slice 1) was NOT needed — `MEMORY.md` is already under the audit's
< 8 KB target and well under the gate's 11 KB warn band.

## Edits applied (11 edits / 8 files) — all independently re-verified

| File | Change | Basis |
|---|---|---|
| `project-reviewer-institution-match.md` | **status active → stale** + first-line warning | Account-matching / `parentcustomerid`-write plan was owner-reversed 2026-06-27 (`fa15ee4b`); shipped design is ALERT-ONLY. [VERIFIED via `lib/services/alert-reviewer-affiliation-mismatch.js:6`; no live code writes `contact.parentcustomerid` at promotion; `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §Increment 2a] |
| `project-prompt-legacy-audit-followup.md` | **status stale → closed** | Mislabel — the work is resolved (S344), not contradicted. Router already says "RESOLVED S344". |
| `project-reviewer-lifecycle-automation.md` | **status active → closed** | Body self-declares overtaken; automation shipped (engagement Phases 1-4), review intake is `/submit`, staff upload removed S347. |
| `project-intake-portal-pilot-decisions-2026-05-13.md` | **status active → closed** | Point-in-time meeting decisions; 1C/1D deltas shipped (verified in `lib/dataverse/schema/wave4/`). |
| `project-system-model.md` | fixed self-contradictory app count (18 **and** 16 → live is **12**), A7 count (24 → **27**), and "exactly one live Executor route" (false) → all now point to live sources | [VERIFIED: `shared/config/appRegistry.js` = 12 keys; `docs/CANONICAL_COUNTS.md#app-definition-count` = 12; `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md:73` = 27 registered; `pages/api/process-peer-reviews.js:11` imports `executePrompt` since S344] |
| `project-api-credit-monitoring.md` | fixed stale migration high-water (020 → 024, generalized to "check `lib/db/migrations/`") ×2 lines | [VERIFIED: latest migration is `024_reviewer_acceptance_jobs.sql`; no `032`] |
| `project-contact-promotion-permission.md` | fixed stale path pointer (`send-emails.js:247` → `send-emails-service.js`) ×2 (body + ground-truth) | [VERIFIED: promotion logic (`findOrCreateByEmail`/`setContactLink`) now in `lib/services/review-manager/send-emails-service.js:514-525`; route is a 106-line thin wrapper] |
| `project-reviewer-lifecycle.md` | stripped stale enumerated modal-name list (was itself out of date) | [VERIFIED via subagent: actual modals differ; principle "re-verify in `shared/components/reviewers/`, don't pin modal-name lists" retained] |

## Per-cluster disposition (subagent code-grounded)

All 75 files held up as operationally relevant — **no deletions, no supersessions**.
Distribution: the large majority **KEEP_ACTIVE** (structural claims verified against
current source/Atlas), a handful **ACTIVE_NEEDS_PROBE** (facts only a live
Dataverse/Vercel/external probe can confirm — kept active with the probe named),
plus the status corrections above.

- **Dataverse/Dynamics (12):** all KEEP_ACTIVE; `project-dynamics-sandbox-state`
  → ACTIVE_NEEDS_PROBE (sandbox schema-staleness is a live fact last confirmed
  S213). `project-dynamics-email` `last_verified` was "Session 77" (content still
  correct).
- **Reviewer identity (10):** one MARK_STALE (institution-match, applied);
  `project-reviewer-self-report-orcid-sticky-confirmed` ACTIVE_NEEDS_PROBE (its
  self-flagged code-comment/behavior discrepancy is still live — see cross-cutting).
- **Reviewer lifecycle (9):** one CLOSE_HISTORICAL + one modal-strip (applied);
  owner-ask items (`staff-review-rescue-tool`, `closeout-payability`,
  `review-output-formatting`) kept KEEP_ACTIVE.
- **Intake / finance (13):** one CLOSE_HISTORICAL + one nav-fix (applied);
  `honorarium-payment-landscape` + `virus-scanning-it-context` kept
  ACTIVE_NEEDS_PROBE (payment / external-tenant risk).
- **Grant lifecycle / strategy (12):** system-model count fixes (applied); rest
  KEEP_ACTIVE.
- **Infra / dev / CI (17):** prompt-legacy close + contact-promotion fix (applied);
  rest KEEP_ACTIVE, all code-verified. The 2 codex-named files were triaged by the
  main agent (a delegation guard blocked delegating them): both KEEP_ACTIVE, tooling
  confirmed present.

## Deferred (lower value — not applied this pass)

- **`last_verified` refreshes** on ~60 KEEP_ACTIVE files whose content verified but
  whose timestamps read "via memory-content (not re-probed)". These are honest but
  low-signal; the `check:memory-health` advisory now surfaces them continuously, so a
  mass date-bump was skipped as busywork. Refresh opportunistically when a file is
  next touched.
- **Stale file:line pointers** in `project-app-access-control.md`
  (`my-proposals.js:38`→`:28`) and `project-grant-lifecycle-states-confirmed.md`
  (`my-proposals.js:143-147`→ service) from route→service refactors. Substance
  correct; line numbers drift by nature (the reason the CANONICAL_COUNTS pointer
  pattern exists). Fix opportunistically.
- **Recall-rule normalization** (Slice 3) on prose-only actives
  (`project-reviewer-duplicate-merge`, `project-peer-review-executor-migration`,
  several `-parked` files).

## Cross-cutting findings (NOT memory fixes — surfaced for follow-up)

1. **`lib/dataverse/adapters/researcher.js` stale code comments** assert "the
   resolver never emits 'confirmed'" (~lines 227, 269), but
   `lib/services/reviewer-identity-resolver.js:261,279` DO return
   `status: 'confirmed'`. Live comment/behavior mismatch on a safety-sensitive
   identity path — a real code cleanup item (per `project-reviewer-self-report-orcid-sticky-confirmed`).
2. **`docs/STRATEGY.md` says "17 purpose-built tools"** while `appRegistry.js` /
   `CANONICAL_COUNTS.md` = 12 app definitions. Doc drift, out of memory scope.
3. **Intake memberships-admin surface / institution-search typeahead** described as
   "ongoing pilot work" in two intake memories, but no `pages/apply/admin/memberships`
   route or fuzzy-match UI found in the tree. Confirm build status or requeue.
4. **`project-spec-audit-docs-recovery-parked.md`** names 2026-07-08 (today) as the
   gate to attempt `codex/spec-audit` branch recovery on the work computer; branch
   still absent from this checkout. Surface to owner.
5. **`project-download-proxy-parked.md`** — underlying `cycle-material.js` was
   modified 2026-07-07 (one day pre-audit); park verified today, worth a diff-check
   next time it comes up.

## Non-goals honored

No memory deleted; no app structural truth moved into memory; questionable actives
were classified, not blanket re-probed; `MEMORY.md` kept a lean router.
