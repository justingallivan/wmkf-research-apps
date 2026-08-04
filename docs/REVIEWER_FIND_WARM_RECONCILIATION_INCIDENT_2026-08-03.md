---
title: Reviewer Find Warm-Reconciliation Production Incident — 2026-08-03
domain: reviewer-workbench
kind: status
status: historical
summary: "RESOLVED BY REVERT 2026-08-03 (S396): production restored to the 94c5b9d9 baseline plus the edbe6931 GUID fix. Body is the historical open-incident assessment."
canonical: false
cataloged: 2026-08-03
owner: product-engineering
related:
  - docs/REVIEWER_FIND_PERFORMANCE_PLAN.md
  - docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md
  - docs/REVIEWER_FIND_BROWSER_TEST_PLAN.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - SESSION_PROMPT.md
---

# Reviewer Find Warm-Reconciliation Production Incident — 2026-08-03

## Resolution (2026-08-03, Session 396) — CLOSED BY REVERT

Production was restored by fast-forwarding `main` to `2fc29b82` (branch
`reviewer-find-revert-baseline`) [VERIFIED via S396 git merge/push and Vercel
inspect]. Per the S395 handoff's construction record: the runtime tree was
restored byte-for-byte to the pre-rollout baseline `94c5b9d9`, keeping only
the `edbe6931` `institution-coi-context.js` permissive-`isGuid` fix (that bug
predated the rollout), and no data migration was needed — incident-era roster
state lives inside `candidate` JSONB the baseline treats as opaque [VERIFIED
in S395 per SESSION_PROMPT handoff; not re-derived in S396]. Owner smoked a
Preview deployment and then production (`dpl_EbFDP4PpPa9K91bs9CnuH2yUviW1`,
Ready, serving all prod domains) [VERIFIED via S396 owner smoke + vercel
inspect]: Request `1002903` warm roster renders with checkboxes on selectable
rows, no reconcile/evidence-refresh controls, Ferrara correct, Rajan in the
expected pre-rollout identity-caution state (checkbox gating confirmed against
`shared/components/reviewers/ReviewerSearchSection.js:2773-2809`).
Forward-fix branch `reviewer-find-outcome-contract` is abandoned (kept for
history). Root-cause lessons:
`.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md`.
Known revert side effect: the restored `package-lock.json` reintroduced
high-severity transitive advisories (`ip-address`, `brace-expansion`)
[VERIFIED via S396 `npm audit`] — tracked in `SESSION_PROMPT.md` as
next-session work.

Everything below is the historical assessment written while the incident was
open; "current"/"live" claims in the body describe the since-reverted
`7072d52a` build.

## Executive assessment (historical)

**Incident status at write time: OPEN (since resolved by revert — see above).**

The August 2–3 Reviewer Find performance release is merged to `main`, pushed,
and deployed. It added a cached warm-read path, per-candidate stage receipts,
server-derived promotion authority, request-level reconciliation, live no-send
test tooling, and a large set of safety tests. Several concrete blockers were
found and repaired after deployment.

The release nevertheless fails the owner's core warm-revisit requirement. A
previously found candidate can still be placed in a server-action loop that the
server cannot resolve, while the UI tells staff to retry either the whole
request or the individual candidate. The production-shaped Kanaka Rajan row on
Request `1002903` demonstrates this. The implementation also retains the
per-card **Refresh contact evidence** control that the owner explicitly did not
want staff to click across an existing roster.

This is a partial recovery, not a successful performance rollout. The safest
handoff posture is to stop adding hotfixes, preserve the current evidence, and
have the next orchestrator repair the outcome contract before making further
production changes.

## Release scope and current deployment

- **[VERIFIED via Git]** `main` and `origin/main` were both at `7072d52a`
  (`Honor reviewer reconciliation stage order`) when this handoff was written.
- **[VERIFIED via Git]** the performance/reconciliation series spans 50 commits
  from `5b6757df` through `7072d52a`, touching 142 files with 30,621 insertions
  and 1,789 deletions.
- **[VERIFIED during the production rollout]** deployment
  `dpl_Au8dEjfgvZfZSvHc1sRGBiyukybg` reached Ready and was served through
  `https://applications.wmkeck.org` at `7072d52a`.
- **[VERIFIED via user screenshots and signed-in no-send browser checks]** the
  deployed UI exposes both request-level reconciliation and per-card stage
  repair controls.
- **[VERIFIED]** live checks did not select, promote, invite, or email a
  reviewer. No external-email test was authorized or performed.

## What was built

The release introduced or materially changed these connected surfaces:

1. **Cached warm roster rendering.** Reviewer Find can read the persisted
   Postgres roster before completing Dataverse/Graph reconciliation.
2. **Per-candidate stage freshness.** Stored candidates now carry bounded
   evidence/receipt state for applicant anchor, identity, institution domains,
   institution COI, coauthor COI, eligibility, contact, address trust, and
   roster persistence.
3. **Authoritative stage producers.** Server-owned producers and a closed
   `reviewer-stage-refresh` route refresh one candidate/stage under CAS and
   lease controls.
4. **Request-level reconciliation.** `POST /api/workbench/reviewer-reconcile`
   walks an exact bounded active roster, executes eligible repairs in stage
   order, and returns per-candidate terminal or continuation outcomes.
5. **Promotion preflight.** Generic and applicant promotion paths re-read
   current server authority instead of trusting the displayed candidate.
6. **Legacy evidence bridges.** Verified historical attestations and exact
   Dataverse identities can be mapped into current evidence without rerunning a
   cold reviewer search.
7. **No-send verification tooling.** Deterministic browser tests, live read-only
   observation, cold preflight, and no-email route-graph gates were added.

The key implementation files are:

- `shared/components/reviewers/ReviewerFindPanel.js`
- `shared/components/reviewers/ReviewerSearchSection.js`
- `shared/components/reviewers/reviewer-search-logic.js`
- `pages/api/workbench/reviewer-reconcile.js`
- `pages/api/workbench/reviewer-stage-refresh.js`
- `lib/services/workbench/reviewer-stage-reconciliation-service.js`
- `lib/services/workbench/reviewer-stage-refresh-service.js`
- `lib/services/workbench/reviewer-stage-producers/*`
- `lib/services/workbench/reviewer-warm-validation-service.js`
- `lib/services/reviewer-stage-freshness.js`
- `lib/services/reviewer-roster-store.js`
- `lib/services/reviewer-promotion-authority.js`
- `lib/utils/reviewer-vetted-email.js`

## Production incident chronology

### Request `1002903`

1. Existing candidates rendered without selection checkboxes, so staff could
   not promote them.
2. The first compatibility change did not repair the live roster and exposed
   per-card applicant-input refresh actions.
3. The request-level **Reconcile previously found reviewers** action was added
   so staff would not need to rerun searches or click every candidate.
4. Production then exposed multiple implementation defects, fixed in order:
   - `c4777afb`: roster reconciliation recovery;
   - `c83dad14`: stage-lease SQL typing;
   - `edbe6931`: Dataverse GUID acceptance in COI reconciliation;
   - `b1a50e73`: generic Dataverse GUID acceptance in reviewer authority; and
   - `7072d52a`: prerequisite/stage-order selection.
5. After `7072d52a`, a production no-send run reported:
   `15/15 processed · 5 current · 9 need staff action · 0 blocked · 0 rejected · 1 need retrying · 0 at work limit · 1 queued`.
6. **Katherine Ferrara recovered:** the card regained a selection checkbox and
   read-only evidence showed current address-trust/roster-persistence state.
   No promotion was attempted after that recovery.
7. **Kanaka Rajan did not recover:** **Continue reconciliation** returned the
   same one retryable/queued candidate, and the card still rendered **Refresh
   contact evidence**. Reloading only synchronized the visible state; it did
   not change the underlying classification.

### What is still broken

| Problem | Verified behavior | Impact |
|---|---|---|
| Deterministic staff action is classified as retryable | Kanaka's contact receipt is `incomplete` with `failureCode: missing_required_input`; request reconciliation returns it as retryable/queued | **Continue reconciliation** can repeat without progress |
| Per-card refresh remains visible when refresh cannot succeed | `CandidateCard` renders a refresh button for any `stageRefresh` plan | Staff are told to perform repetitive work that cannot resolve the row |
| Institution mismatch overrides stronger identity evidence | `projectReviewerContact` treats `candidate.institutionMismatch === true` as `needs_identity_confirmation`, even when identity is probable and Dataverse matched exact ORCID/name | A hierarchy/label mismatch becomes a blanket identity/contact block |
| Contact producer collapses policy action into missing input | `projectColdReviewerContactEvidence` maps `needs_identity_confirmation` to incomplete/`missing_required_input` | Reconciliation cannot distinguish “wait/retry” from “staff must decide” |
| Legacy explanatory text remains misleading | Kanaka displays `Why: Omitted — see note below.` and `100% expertise match` beside an identity/institution warning | The card mixes topical evidence with identity confidence and lacks a useful reason |
| Evidence timestamp semantics are confusing | The card's single “Evidence checked as of” is derived from the oldest applicable completed stage | A recent repair can still display an older-looking overall time |

## Source-level failure chain

The remaining Kanaka loop is not explained by Dataverse slowness alone:

1. `lib/utils/reviewer-vetted-email.js#projectReviewerContact` sets
   `needsIdentity` when `institutionMismatch === true`, even if the identity
   resolver is `confirmed`/`probable`.
2. `lib/services/workbench/reviewer-stage-producers/contact.js` converts that
   decision into an incomplete contact receipt with
   `failureCode: missing_required_input`.
3. `lib/services/workbench/reviewer-stage-reconciliation-service.js` preserves
   the failed/incomplete stage as retryable and includes the candidate in
   `continuationCandidateKeys`.
4. `shared/components/reviewers/ReviewerSearchSection.js#CandidateCard` renders
   a per-stage refresh control whenever a `stageRefresh` plan is present.
5. Repeating the request-level or per-card action re-enters the same
   deterministic condition. No transient dependency has changed, so there is
   no reason to expect progress.

The correct product classification for this shape is **action required**, not
**retryable**. The UI should expose only the relevant identity/edit-and-add
workflow unless the server can name a transient condition that a retry can
actually change.

## What appears to work

- The cached/reconciled roster route and request-level action are deployed.
- Stage execution now respects dependency order.
- Generic Dataverse GUIDs no longer fail the strict-version UUID checks that
  blocked valid production records.
- Katherine's production-shaped row recovered without a cold search.
- Reconciliation is bounded, candidate-keyed, and does not itself search,
  promote, invite, or send email.
- The no-send and warm-observation gates passed in the final hotfix cycle.

These points do **not** establish that the feature works across an existing
request roster. They are narrower properties.

## Verification performed and its limits

- Final focused run: 60 tests across reconciliation, stage refresh, and UI
  controls passed.
- Scoped ESLint passed.
- `check:reviewer-find-warm-observation` and its self-test passed.
- `check:reviewer-find-cold-no-send` and its self-test passed.
- `check:types` and `npm run build` passed.
- The last Claude Opus 4.8 adversarial review returned satisfied for the
  **stage-order hotfix only**. It was not a whole-feature or production-shaped
  review and must not be cited as one.
- Existing tests did not cover the decisive production shape: exact/name-
  consistent Dataverse identity plus institution-hierarchy mismatch plus a
  plausible institutional email, with the expected terminal outcome asserted
  as staff action rather than retry.
- Browser/auth/URI setup consumed substantial time and provided useful
  integration evidence, but it did not provide a stable reusable authenticated
  production test harness.
- The stop-workflow claim-evidence observation command was run, but reported
  that its local state could not be read; no pilot observation was inferred or
  added from that unavailable result.

## Assessment of the implementation approach

The change set became too broad for a production performance repair. Fifty
commits and more than 30,000 inserted lines combined state modeling, promotion
authority, stage producers, browser infrastructure, compatibility migration,
and live recovery. Unit and adversarial checks validated many local contracts,
but the release lacked a small production-shaped acceptance matrix proving the
actual staff outcomes before promotion to `main`.

The central modeling error was treating all incomplete stage evidence as work
that reconciliation should retry. A durable workflow needs at least four
semantically distinct outcomes:

- `current`: no work or staff action needed;
- `action_required`: retry cannot help; show the exact staff decision;
- `retryable`: a transient/provider/concurrency condition may change;
- `blocked`: policy or invariant forbids progress.

Those meanings need to be identical in the producer, receipt, planner,
reconciler, route response, continuation list, and UI. They currently are not.

## Safest next-orchestrator plan

### P0 — restore a truthful, non-looping warm UI

1. Add a production-shaped regression fixture for Kanaka's data shape. Assert
   that a persistent institution/identity decision is `action_required`, never
   retryable or queued.
2. Trace and normalize the outcome contract end to end. Do not patch only the
   button text or only `continuationCandidateKeys`.
3. Suppress per-card refresh controls whenever the server cannot name a
   transient executable repair. Render the exact staff action instead.
4. Keep request-level reconciliation for auto-repairable legacy evidence, but
   stop it on a terminal staff-action outcome without offering **Continue** for
   that candidate.
5. Decide explicitly whether Harvard Medical School ↔ Harvard University is:
   - an institution-hierarchy equivalence resolved upstream; or
   - a real staff-verification condition.
   In either case, it must not be presented as a retryable contact-provider
   failure.
6. Run deterministic tests first, then an authenticated read-only/no-send
   production check on Request `1002903`. Do not cold-search or promote.

### P1 — repair the staff-facing explanation

1. Remove the `Omitted — see note below` placeholder when there is no note.
2. Label the percentage as topical/publication match, not a general confidence
   score, or omit it on identity-review cards.
3. Clarify evidence recency per stage, or define the overall card timestamp as
   the latest completed authoritative check rather than the oldest applicable
   receipt.
4. Add telemetry for outcome transitions and repeated no-progress
   reconciliations before setting latency SLOs.

### P2 — resume performance work only after correctness

1. Measure cached-visible, first-interactive, and full-reconciliation times
   separately.
2. Preserve the hard rule that an unchanged warm revisit performs no cold
   proposal/model/publication/contact discovery.
3. Revisit durable background continuation only after the outcome taxonomy is
   trustworthy; autonomous continuation must never automate staff decisions.

## Operational cautions

- Do not tell staff to click **Refresh contact evidence** on every reviewer.
- Do not rerun cold reviewer searches to repair legacy warm evidence.
- Do not roll back individual hotfixes blindly; later commits depend on earlier
  compatibility and stage-order corrections, and a rollback can re-break
  Katherine-shaped rows.
- Do not perform promotion or email tests while diagnosing this incident.
- Request `1002914` remains the owner-designated no-send Reviewer Find fixture.
  Request `1002788` has other historical smoke duties. Request `1002903`
  should be treated as a read-only production incident case unless the owner
  grants a new, exact mutation authorization.

## Sweep evidence matrix

| Claim | Authority checked | Durable surfaces reconciled | Status |
|---|---|---|---|
| Release is on Production | Git `main`/`origin/main`, recorded Vercel Ready deployment, signed-in production UI | This incident, performance plan, producer spec, browser plan, Atlas, wiki, session prompt, development log | VERIFIED |
| Warm flow is not fully fixed | User screenshots, signed-in no-send run, production-shaped roster evidence, current source | Same surfaces | VERIFIED |
| Kanaka is deterministic staff action, not useful retry | `projectReviewerContact`, contact producer, reconciliation service, `CandidateCard`, stored stage evidence | This incident, session prompt, plan/spec current-status notes | VERIFIED |
| Katherine recovered after hotfixes | Signed-in production no-send check and read-only evidence | This incident, session prompt | VERIFIED, narrow case |
| No external email was sent | Test boundary and route/action history from the live checks | This incident, session prompt | VERIFIED for this test activity |
| Whole feature passed adversarial review | No such evidence; final Opus review covered only the stage-order patch | This incident, session prompt | REFUTED |

## Handoff state

- Branch: `main`
- Production/source head at handoff: `7072d52a`
- Worktree before documentation edits: clean
- Incident status: open
- Next owner: new orchestrator
- Required first read: this document, then `SESSION_PROMPT.md`,
  `docs/REVIEWER_FIND_PERFORMANCE_PLAN.md`, and
  `docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md`
