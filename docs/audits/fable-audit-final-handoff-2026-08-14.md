# Fable Audit — Final Handoff (2026-08-14)

Point-in-time handoff for the Fable Production Audit, Security, and Refactor exercise
(`docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md`). Branch
`fable/audit-refactor-planning-2026-08-14` off `origin/main` @ `f8a606e6`.

## 1. Architecture verdict

**Measure/observability-first, then an in-service read merge — NOT the full Request Workbench Data
Plane (deferred, not rejected).** Three strongest pieces of evidence:
1. Zero per-dependency timing instrumentation exists in the staff path (grep-verified) — no measured
   basis for any caching/data-plane refactor; observability is the precondition.
2. The redundant-read pattern is source-certain (`wmkf_potentialreviewers` ×6 across 3 routes,
   suggestions ×3, request ×2 per reviewer-tab action; DAL context has no memoization).
3. The broad post-mutation refreshes are deliberate fixes for prior correctness bugs (S213/S400/S401),
   so incremental slices behind seams beat a Workbench rewrite.

Opus adversarial review corrected the *mechanism*: a request-scoped cache dedupes none of the reads
(3 separate route scopes, concurrent disjoint `$select`), so Stage 2 is now a local sibling-query
merge (6→3 person queries), and Stage 1 targets the real transport `lib/services/dynamics/http.js:24`
(the `dynamics-service.js` facade has no `fetch`) with a PII-redaction rule and a second-egress
follow-up. Plan: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`.

## 2. Immediate-risk verdict

- **T1 — reviewer merge has no caller/request-scope authorization** (confirmed; write reach has widened
  to `akoya_request` applicant slots). **[NEEDS OWNER]** trust model (S207 org-open vs request-scoped);
  pending since S414. Not a schedulable stage until decided.
- **T2 — automatic reminder crons skip the `selected`/`revoked` eligibility the manual path enforces,
  and the cron is LIVE-SCHEDULED daily (`dryRun` default false)** — a potentially-live exposure, not a
  hold. Repair specified (null-safe filter). Owner should decide whether to ship Stage 4 promptly.
- **Enforcement gap — `check:trust-boundary-guid` and `check:status-enum-parity` have no CI backstop**
  (Claude-Code commit-hook only; bypassed by any other tool). Worth a CI-wiring fix independent of the
  refactor.
- Lower: D2 (cron non-constant-time compare), D3 (bare `requireAuth` skips `is_active`), D4 (app-level
  guard on record-scoped review-file download — **[NEEDS OWNER]** intent), untracked secret-rotation
  surface, Security Operating Plan materially drifted (queue for `/sweep`).

## 3. Production truth

Not probed — standing rule bars self-authorized prod Dataverse reads. Seven owner-executed read-only
probes prepared (`fable-current-state-evidence-2026-08-14.md`), incl. T2 exposure sizing. The
architecture verdict does not depend on them. Resolved from source instead: drain lease protection
PRESENT, 8 new routes all in the security matrix, multi-llm egress via `safeFetch`, migration runner
has no checksum, DAL context has no memoization.

## 4. Plan readiness

Opus verdict: `changes required` → all 9 findings accepted and folded in. Contract-reconcile Mode A:
**READY WITH NAMED CHANGES** (changes already applied). Plan is a draft **not authorized for
implementation**.

## 5. Artifacts and branch

Branch `fable/audit-refactor-planning-2026-08-14`. Artifacts: task ledger, three evidence docs, Opus
review, disposition, this handoff (all `docs/audits/fable-*-2026-08-14.md`) + the staged plan
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`. Commits `7785f4a`..`HEAD`.

## 6. Verification

All `/start` gates green at branch point. Doc gates (docs-catalog, fact-consistency, doc-symbol-refs,
build-claim-freshness, memory-router, drain/prompt-storage) green after each artifact commit. No red
gates. Production probes: not run (owner-gated), listed as incomplete by design.

## 7. Next authorization requested

**One precise next action:** owner decides the two pending items — (a) the reviewer-merge trust model
(unblocks T1), and (b) whether to authorize implementation of Stage 1 (observability seam) and/or the
T2 reminder-eligibility repair. Also useful but non-blocking: the current campaign window/release
posture, and running the 7 read-only production probes. No implementation, deployment, merge, or push
to `main` is authorized by this exercise.

## Follow-ups surfaced (not acted on — avoid scope accretion)

- `/sweep` the Security Operating Plan (drifted ~12 controls) and the `project-reviewer-lifecycle-automation`
  memory (frames the now-shipped reminder cron as a forward goal).
- Doc deltas: `DATA_ACCESS_LAYER_MIGRATION_PLAN.md` says 19 adapters (now 20); `CANONICAL_COUNTS.md`
  re-derive against 157 routes / 20 adapters / 29 migrations / 19 crons.
