---
title: Reviewer Identity Binding Production Smoke — Adversarial Review Handoff
domain: reviewer-identity
kind: audit
status: historical
summary: "Historical read-only review brief that led to the dedicated reviewer-binding smoke; implementation and production execution are complete."
canonical: false
cataloged: 2026-07-13
owner: product-engineering
related:
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md
  - docs/REVIEWER_DATA_MODEL.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - lib/services/reviewer-acceptance-drain.js
  - lib/services/capture-self-reported-orcid.js
  - lib/services/reviewer-identity-binding-writer.js
  - scripts/pr4-e2e.js
---

# Claude handoff: adversarial review of the deployed binding caller and smoke test

> **Historical (completed 2026-07-13):** This review brief produced the
> adversarial findings that were implemented in PR #59 and PR #60. The dedicated
> smoke passed in production with verified cleanup; see
> `docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md` for the execution record. The
> instructions below are preserved as the dated review contract, not current
> next actions.

Use this prompt in a fresh Claude session at the repository root.

## Mission

Perform a **read-only adversarial review** of both:

1. the production-deployed first caller of
   `reviewer-identity-binding-writer.js`; and
2. the existing `scripts/pr4-e2e.js` production-touching test runner, including
   whether it can safely serve as the missing positive control for the deployed
   Wave 13 binding path.

Do not assume either the deployed code or the test script is correct. Hunt for a
concrete failure in each. Try to refute every suspected issue before retaining
it, but do not soften a finding that survives.

This is **review only**. Do not implement fixes. Do not edit source, tests, docs,
memory, Atlas, or `SESSION_PROMPT.md`. Do not run `scripts/pr4-e2e.js`, its setup
or cleanup helpers, any production smoke command, or any command that writes to
Dataverse, Postgres, Blob, BILL, Graph, Vercel configuration, or another live
system. Your only permitted write is the requested review artifact under
`outputs/`.

Begin with `/start`. Then invoke `/contract-reconcile` in review mode because
this review spans an external route, a durable Postgres queue, a scheduled
worker, Dataverse state, retries, side effects, cleanup, and documentation
claims. Use CodeGraph before grep or file-by-file search when locating code or
tracing symbols. Personally read the controlling sources and produce the final
synthesis even if you use subagents for disjoint read-only inspections.

## Ownership and branch boundary

```text
Owner: Claude
Branch: main
Status: read-only adversarial review
Changed surfaces: none except the requested outputs review artifact
Pre-handoff main baseline: 53f8523607fbd4bb971b0757febd6a9eea131392
Runtime merge: 00ffb09c76531383577b5384a7882598caf8d8de (PR #57)
Runtime implementation head: 1978413b2ec793fe4e4bb128fca7c4acbd3b479f
Runtime base: 851f693b90b7ac5e544aff63d02c2dd838459f63
Runtime diff: git diff 851f693b..1978413b
Next owner/action: Justin decides whether Codex or Claude implements an accepted smoke-test design
```

Verify the branch, SHAs, and working-tree state before reviewing. Review the
current `main` behavior, not only the PR diff, because later docs-only commits
landed after the runtime merge. Treat commit messages and prior agent summaries
as navigation aids, not implementation evidence.

## Current state to verify independently

- **[VERIFIED 2026-07-13 via git]** PR #57 merged the first production caller at
  `00ffb09c`; its only runtime-file changes were
  `capture-self-reported-orcid.js` and `reviewer-acceptance-drain.js`, accompanied
  by their focused tests and durable-doc updates.
- **[VERIFIED 2026-07-13 via Vercel inspect]** production deployment
  `dpl_4YpnVVdRmDHyuzgPVSKXNcx22bKu` reached READY on the production aliases.
- **[VERIFIED dated snapshot via the tracked preflight]** all ten Wave 13 fields
  were metadata-exact, but zero person and zero suggestion rows had any Wave 13
  field populated immediately after promotion.
- **[VERIFIED dated observation]** scheduled acceptance-drain requests ran
  without an acceptance-drain error, but no first durable binding event had
  been observed.
- **[PLANNED, not approved]** a controlled synthetic smoke may be preferable to
  waiting for an organic acceptance containing a valid self-reported ORCID.

Refresh any cheap read-only evidence that may have drifted. Label live-state
claims `VERIFIED`, `PLANNED`, `ASSUMED`, or `STALE/CONFLICT`. Do not turn a dated
zero-population observation into a permanent claim.

## Controlling sources

Read these completely before reaching a verdict:

- `CLAUDE.md`
- `SESSION_PROMPT.md`
- `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
- `docs/REVIEWER_DATA_MODEL.md`
- `docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md`
- `docs/REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md`
- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
- `docs/CI_GATES_REFERENCE.md`
- `docs/atlas/postgres-infra-tables.md`
- `docs/atlas/dataverse-wmkf-potentialreviewers.md`
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`
- `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`

Then trace at least these implementation and test anchors:

- `pages/api/external/review/[token]/respond.js`
- `lib/services/external-review/respond-service.js`
- `pages/api/cron/drain-reviewer-acceptances.js`
- `lib/services/reviewer-acceptance-job-service.js`
- `lib/services/reviewer-acceptance-drain.js`
- `lib/services/capture-self-reported-orcid.js`
- `lib/services/reviewer-identity-binding-contract.js`
- `lib/services/reviewer-identity-binding-writer.js`
- `lib/dataverse/adapters/researcher.js`
- `lib/dataverse/adapters/reviewer-suggestion.js`
- `lib/services/capture-self-reported-reviewer-identity.js`
- `lib/services/sync-reviewer-name-title-to-contact.js`
- `lib/services/alert-reviewer-email-mismatch.js`
- `lib/services/alert-reviewer-affiliation-mismatch.js`
- `lib/services/reviewer-acceptance-email.js`
- `lib/services/reviewer-quota.js`
- `lib/bill/honorarium-onboard-orchestrator.js`
- `lib/db/migrations/024_reviewer_acceptance_jobs.sql`
- `scripts/pr4-e2e.js`
- `scripts/pr4-e2e-setup.js`
- `scripts/pr4-e2e-verify.js`
- `scripts/pr4-e2e-cleanup.js`
- `scripts/preflight-reviewer-identity-binding-fields.mjs`
- `tests/unit/capture-self-reported-orcid.test.js`
- `tests/unit/reviewer-acceptance-drain.test.js`
- `tests/unit/reviewer-acceptance-job-service.test.js`
- `tests/unit/reviewer-identity-binding-writer.test.js`
- `tests/integration/external-review-routes.test.js`

Enumerate every direct caller of the capture service and binding writer. Do not
accept the named list above as complete without checking the current tree.

## Part A: deployed-code adversarial review

### A1. Whole-flow trace

Trace the real fresh-accept and repeat-accept flows separately:

```text
token verification
→ response validation
→ durable job staging
→ Dataverse accept commit
→ queued marker
→ cron authentication and DAL context
→ claim lease
→ accepted-state and timestamp verification
→ self-report binding
→ contact/honorarium/identity/alert/email/quota tails
→ retry or terminal completion
```

For each hop, identify the authoritative identifier and timestamp, the persisted
state, the failure posture, and the mechanism that prevents stale or duplicate
work. Distinguish an asserted idempotency property from the unique constraint,
conditional update, lease token, step claim, or transition guard that actually
enforces it.

### A2. Binding correctness

Prove or refute all of the following:

- The acceptance job always supplies the stable `accepted_at` required to enter
  the durable writer path.
- A clean unbound person produces a coherent first `self_reported` binding.
- An already-bound replay is a true no-op rather than a restamp or version bump.
- Only the typed `legacy_classification_required` error enters the transitional
  two-write fallback.
- Every other writer failure prevents contact fill, honorarium, board identity,
  alerts, acceptance email, quota work, and job completion.
- The in-memory reviewer cannot become synthetically `confirmed` before the
  person binding commits.
- Dataverse timestamp normalization cannot turn a replay into a distinct event.
- A job retry after a partial downstream tail cannot corrupt or replace the
  committed binding.
- The writer result cannot silently imply downstream action eligibility while
  the policy-reader migration remains gated.

Inspect both the positive branch and every complement/fall-through. Treat a
missing final `else`, untyped error, missing timestamp, malformed current row,
read failure, 412, non-412 failure, and exhausted retry as first-class cases.

### A3. Queue and concurrency safety

Review the actual Postgres mechanics for:

- stage-before-Dataverse-write ordering;
- `accept_pending` grace and cancellation;
- unique `(suggestion_id, accepted_at)` reuse;
- requeue behavior for failed/cancelled versus completed jobs;
- `FOR UPDATE SKIP LOCKED`, `lease_token`, and lock expiry;
- step-level acceptance-email claims;
- retry counting, terminal failure, and loss of a lease during a long tail;
- whether cleanup or deletion of a suggestion/person can strand a live job;
- whether a synthetic job can race the normal two-minute cron in a way the test
  misclassifies as success or safely cleans up too early.

Check whether the queue has a real retention/cleanup strategy. If it does not,
decide whether a smoke-created completed job may be retained as audit evidence
or must be deleted through a narrowly guarded test-owned cleanup.

### A4. Deployed-artifact confidence

Determine what can actually be proven about the deployed artifact. A local
import of `processReviewerAcceptanceJob` proves current source behavior, not that
Vercel is executing the same artifact. Conversely, a local `/respond` request
may stage a shared production job that the deployed cron later consumes, but
only if the local environment points at the same production Postgres and
Dataverse stores.

State exactly which combination of commit SHA, Vercel deployment metadata,
production logs, job row, and persisted Dataverse result would prove that the
**deployed** caller—not merely local `main`—created the binding.

## Part B: existing test-script adversarial review

Review `scripts/pr4-e2e.js` as executable production code, not as harmless test
scaffolding. Trace every create, update, token write, API call, verification
read, cleanup action, and failure path.

At minimum, verify or refute these prior concerns:

1. The accept body appears not to supply the currently required board-identity
   fields.
2. The script appears to verify immediately after `/respond`, even though the
   accepted tail now drains asynchronously.
3. Its assertions appear limited to legacy ORCID/status fields rather than the
   six Wave 13 person-binding fields and exact lineage contract.
4. It creates and links a real contact and deliberately leaves that contact in
   production.
5. Its cleanup appears not to remove the Postgres acceptance job.
6. A failed immediate verification may enter `finally`, delete/deactivate the
   Dataverse rows, and leave the deployed cron holding a queued job whose
   referenced rows have disappeared.
7. It may exercise local route code but fail to prove that the deployed cron and
   deployed binding writer handled the event.

Look beyond this list. Check stale environment assumptions, token-secret scope,
request selection, proxy-email collision, upsert reuse, active-policy reliance,
ETag handling, fresh-versus-repeat semantics, invalid ORCID behavior, timeout
and polling behavior, signal handling, interruption cleanup, output redaction,
and whether any passing assertion could remain green while the durable writer
was bypassed through the legacy fallback.

## Part C: attack the proposed smoke-test architecture

The following is a **proposal to challenge, not a requirement to endorse**:

1. Add a new manual `smoke:reviewer-binding` script rather than silently
   repurposing the broader historical PR4 runner.
2. Require an explicit production confirmation flag and an explicitly approved
   non-live request.
3. Create a uniquely tagged clean person and suggestion, with no contact link.
4. Stage a durable acceptance job with one stable timestamp, then establish the
   matching authoritative accepted state and queue the job in the same ordering
   as the real route.
5. Use `optedOut:true` so honorarium does not run.
6. Use a deliberately synthetic `isAcceptRepeat:true` payload so the drain skips
   acceptance confirmation email and quota notification while still executing
   the binding step.
7. Supply benign board-identity values so that the normal non-fatal capture does
   not create an alert.
8. Let the scheduled production cron claim the job. Poll the exact job id until
   terminal rather than invoking the drain locally or manually draining an
   arbitrary production batch.
9. Assert that the job completed and that the person has the exact expected
   first `self_reported` Wave 13 binding: canonical anchor, stable timestamp,
   version, source, lineage, ORCID pair, and legacy compatibility decision.
10. Prove from the persisted row that the durable writer ran; a legacy-field-only
    success is a failure.
11. Capture a local result artifact, then delete only the exact test-owned
    terminal job, suggestion, and person through identifiers and a unique smoke
    key. Do not use broad source-label cleanup.
12. Rerun the read-only Wave 13 population preflight and prove the baseline was
    restored.

Attack every assumption in that proposal. In particular:

- Does marking the first synthetic event as `isAcceptRepeat:true` preserve the
  binding path while creating a misleading or impossible state elsewhere?
- Can `optedOut:true`, no contact, and repeat status mechanically guarantee no
  honorarium, email, quota, contact, or mismatch-alert side effects?
- Could board identity still write or alert in a way the proposed cleanup misses?
- Must the smoke exercise the public `/respond` route to be meaningful, or is
  staging the durable job sufficient for the narrow positive-control question?
- How can the test ensure it exercises a clean unbound writer `init`, not the
  typed legacy fallback?
- What happens if the cron claims the row before the Dataverse accept becomes
  visible, after cleanup begins, or while the script is interrupted?
- Are exact delete permissions known? If deletion is unavailable, is a
  persistent dedicated fixture safer than deactivation or raw field clearing?
- Can a supposedly non-live request still affect staff dashboards, accepted
  counts, campaign state, or reporting during the test window?
- Is deleting a completed queue row acceptable, or does it destroy required
  audit evidence?
- What is the narrowest credible test that proves deployed behavior without
  testing unrelated acceptance-email, honorarium, or quota features?

If the proposal is unsafe, recommend a different shape. Do not force a repair of
`scripts/pr4-e2e.js` if a smaller dedicated script, a persistent fixture, a
locally invoked service integration, or another approach is more truthful.
State exactly what each alternative proves and does not prove.

## Required test-quality audit

Review both existing tests and the proposed positive-control assertions for
false confidence:

- Would the test still pass if the writer import were removed?
- Would it pass through `legacy_classification_required` fallback?
- Would it pass if `bindingEventAt` were omitted and the transitional path ran?
- Would it pass if the job completed before the binding became visible?
- Would it pass if only `wmkf_identitystatus='confirmed'` and legacy ORCID fields
  were written?
- Would cleanup erase evidence before the failure could be diagnosed?
- Would a timeout leave an active job or live test rows behind?
- Are negative assertions backed by dangerous inputs that would trigger the
  excluded side effect if the guard were broken?
- Are the exact Wave 13 select projections complete in every verification path?
- Does the test distinguish `init`, `noop`, typed legacy fallback, blocked
  transition, retry, terminal failure, and cleanup failure?

Identify the smallest automated unit/integration tests needed to pin the smoke
runner's safety logic without executing live writes in CI. A production smoke
must remain manual and explicitly gated unless you prove a disposable isolated
store exists.

## Review standard

Every actionable finding must include:

1. severity (`P0`–`P3`);
2. concise title;
3. exact `file:line` evidence;
4. the violated invariant or contract;
5. a concrete caller → persistence → consumer or cleanup failure trace;
6. why existing tests or the proposed smoke would not catch it;
7. the smallest safe remediation direction, without implementing it.

Do not report style preferences, speculative features, or known deliberate
gates as defects. Do report any test design that creates false confidence,
uncontrolled live side effects, stranded durable state, or an unverifiable claim
that the deployed artifact was exercised.

For each suspected issue, actively try to disprove it. If no actionable findings
remain, say so explicitly and list the strongest verified invariants and the
residual risks that remain owner-gated.

## Permitted verification

You may run read-only git inspection, CodeGraph, source searches, syntax checks,
focused unit/integration tests that use mocks or disposable local state, and
applicable static gates. You may perform read-only production metadata/log/job
inspection only when credentials and repository policy permit it.

Do **not**:

- run any PR4 e2e/setup/cleanup script;
- create, accept, update, deactivate, or delete any live reviewer, contact,
  suggestion, request, queue job, token, or alert;
- invoke the production cron manually;
- send email or trigger honorarium/quota behavior;
- change Vercel environment or deployment state;
- commit, push, merge, or run `/stop`.

If a live fact cannot be proven read-only, label it `ASSUMED` and make it an
explicit precondition for implementation or execution.

## Required output

Write the final review to:

```text
outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md
```

Use this structure:

1. **Deployed-code verdict:** `READY`, `READY WITH FIXES`, or `NOT READY`.
2. **Current-script verdict:** `SAFE AS-IS`, `REPAIRABLE`, or `DO NOT RUN`.
3. **Smoke-architecture verdict:** `READY TO IMPLEMENT`,
   `READY WITH NAMED CHANGES`, or `NEEDS REWORK`.
4. **Scope and evidence:** branch, SHAs, deployment evidence, files/callers read,
   and commands run.
5. **Findings:** severity ordered, with no summary-only findings.
6. **Whole-flow reconciliation:** route → queue → cron → binding → side effects →
   terminal state → verification → cleanup.
7. **Confirmed invariants:** independently proven from current source/state.
8. **False-confidence analysis:** ways the test can pass without exercising the
   deployed writer.
9. **Required smoke contract:** exact setup, execution, polling, assertions,
   timeout posture, interruption behavior, cleanup guards, and final preflight.
10. **Residual owner gates:** production request/fixture choice, cleanup
    authority, whether queue audit rows may be deleted, and authorization to run.
11. **Implementation recommendation:** smallest file set, tests, and gates for
    the next owner—without making those changes.

End with one unambiguous overall verdict and a numbered list of every named
change required before anyone runs a production smoke.
