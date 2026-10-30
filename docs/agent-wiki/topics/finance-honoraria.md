---
agent_wiki: topic
status: active
last_verified: 2026-09-16
stale_after_days: 90
owner: finance-ops
source_files:
  - pages/api/review-manager/send-emails.js
  - pages/api/external/review/[token]/respond.js
  - lib/services/external-review/respond-service.js
  - lib/services/reviewer-acceptance-drain.js
  - lib/bill/honorarium-onboard-orchestrator.js
  - lib/services/reviewer-engagement/terminal-transition.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - scripts/probe-honorarium-link-population.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
  - docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md
watch_paths:
  - pages/api/external/review/**
  - pages/api/review-manager/**
  - lib/dataverse/**
update_triggers:
  - honorarium request creation changes
  - payment field semantics changes
  - banking/PII handling changes
---

# Finance & Honoraria

Use this page for BILL, honoraria, payment semantics, and the no-banking/PII
constraint. When a flow can trigger external payment automation, verify with
source, Atlas, and the Power Automate owner before testing against production.

## Durable Memory

- BILL/honoraria integration: `project-bill-honorarium-integration`.
- Field semantics/nomenclature: `akoya-request-honorarium-nomenclature`, `akoya-payment-field-semantics`.
- Firm data constraint: `project-no-banking-pii-in-dataverse`.
- External accept automation hazard: `project-reviewer-accept-prod-automation`.

## Honorarium Request Creation And BILL Deferral

### Closeout contract and recorded rollout

**Owner decision 2026-09-04, present in repository source:** a Program Director
records `eligible`, `not_eligible`, or `not_applicable` on a received review when
closing it. For a linked honorarium without opt-out, Yes means `eligible`; No means
`not_eligible` and requires a nonblank request-scoped reason. Opt-out/missing-link
cases record `not_applicable`. Thank-you acknowledges receipt rather than completion.
The application does not write `akoya_request.wmkf_authorizationtoremitpaymentflag`;
Operations/Finance retains final authority.

**Historical chronology:** September 4 recorded the branch source build with
deployment pending. Session 479 in `DEVELOPMENT_LOG.md` later recorded runtime/UI
`5e101861` in Ready Production deployment `dpl_2uJJQxY9TN4KcfHJGLRS2dW1QVge`.
This wiki's September 8 record associated follow-on `d0a5fc07` with deployed closeout.
These later records supersede the old pending-deployment statement, but do not
establish today's serving version.

The September 4 read-only metadata/runtime probe found the nullable local
`wmkf_honorariumeligibility` Picklist published/readable with no default and exact
values `Eligible=100000000`, `Not eligible=100000001`, `Not applicable=100000002`.
The description lacked the Finance-authority warning. All 159 exact honorarium
requests had final-remit false, while 87 broader Research requests were true.
Those are dated observations, not current counts or metadata verification.
Operations' view was built but not surfaced in that record; the owner accepted
its visibility as a follow-up. Current view/description status remains unverified.
Contract: `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md`.

**OWNER DECISION 2026-07-12: the BILL API integration is TABLED for several
months, possibly permanently.** Reviewer onboarding will instead use the
reviewer's address plus existing foundation systems. Do not build on or propose
the BILL API pipeline without a new owner decision; the BILL code stays dormant,
not deleted (`BILL_ENABLED` unset in every Vercel environment — verified
2026-07-12). Detail: `project-honorarium-payment-landscape` memory. The
no-BILL target below remains the owner decision; actual configuration requires
fresh verification.

### Historical BILL deferral incident and probes

The following observations describe the July/August incident. Counts, flag values,
alert outcomes, and deployments are bounded to their recorded dates.

**`BILL_ONBOARDING_DEFERRED` misconfiguration, 2026-07-02 → 2026-08-10 (fixed
S414).** The flag was present in Production and Preview since ~2026-06-10 but its
stored value was not the literal string `'true'`; `onboardReviewer()` tests it
with strict `===` `[VERIFIED via lib/bill/onboard-reviewer-service.js:90]`. The
bug was inert until honorarium go-live on 2026-07-02 opened the path, so every
reviewer accept from that same day fell through to the `BILL_ENABLED !== 'true'`
branch and wrote a `bill_manual_onboarding` warning alert
`[VERIFIED via :94-96, :544-566]`. **61 alerts accumulated**, first
`2026-07-02 17:48 UTC`, last `2026-08-10 19:52 UTC`, before the flag was
overwritten to exactly `true` on Production and Preview and production redeployed
`[VERIFIED via read-only system_alerts census, 2026-08-11; denominator is
COUNT(*) over all statuses, not the 29+32 split]`. All 61 were recorded resolved at that census.

**No BILL API call had fired through that probe** `[VERIFIED via three disconfirming checks,
2026-08-11]`: `BILL_ENABLED` is unset (second lock); zero
`bill_unavailable` / `bill_unhandled_error` / `bill_invalid_input` alerts exist,
and all three are reachable only past the `BILL_ENABLED` gate; and
`bill_onboarding_state` holds **0 rows**, though reservation precedes any BILL
side effect, so a row would exist had the flow gone further.

Two follow-ons recorded then. The flag was changed to **non-sensitive**, making
its value readable so this class of drift could be detected — it was previously Sensitive,
which is why a wrong value went unnoticed for five weeks. And the "no new alerts"
half of the fix is confirmed only by observing an accept *after* the redeploy, so
that post-redeploy outcome remained **[ASSUMED]** in the incident record. This
cleanup does not close it without a later census.

**Timestamp trap when querying `system_alerts`:** `created_at` is
`timestamp without time zone` holding UTC `[VERIFIED via information_schema,
2026-08-11]`. The JS Postgres client re-reads it as local time, shifting every
value by the local offset (+7h here) — so `MIN`/`MAX` read back through the
driver are wrong by that much. Compare and render with `to_char(...)` in SQL, not
in JS. The admin panel renders Pacific, so a `19:52 UTC` row displays as
`12:52 PM`.

### Owner target and historical July rollout

**2026-07-01 decision; recorded go-live 2026-07-02:** full BILL.com onboarding
remains deferred, but the portal is the sole creator of reviewer honorarium
`akoya_request` rows for reviewers who come through it. Use
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` as the current source of truth for
the no-BILL cycle. **This posture WENT LIVE in Production 2026-07-02** (GUIDs set,
`HONORARIUM_ONBOARDING_DEFERRED` removed from Production / kept `true` on Preview,
BILL still deferred, prod redeployed). Honorarium-ON / BILL-off was observed
then; those values were not re-probed in this cleanup. A real honorarium `akoya_request` was created
`[VERIFIED via #1003172, 2026-07-06]`. The owner-approved configuration target is:

- set the three honorarium discriminator GUIDs;
- unset `HONORARIUM_ONBOARDING_DEFERRED` so `ensureHonorariumOnboarding()` mints
  the honorarium request;
- set `BILL_ONBOARDING_DEFERRED=true` so `onboardReviewer()` silently skips BILL;
- redeploy/restart after the env update, because the discriminator env vars are
  read when the server module loads;
- keep payment offline by check until the person-payee/BILL tail is separately
  approved and verified.

Reviewer portal self-withdrawal is available only before materials release and
before any review receipt; after that the response endpoint locks changes and
routes the reviewer to the PD. Before review receipt, a PD can separately record
**Withdrew** in Track Reviewers, subject to the staff transition guards.
Both remove that engagement's exact linked honorarium `akoya_request`
automatically in the same Dataverse changeset that flips the suggestion to
declined and revokes portal access. The reviewer/contact and suggestion history
remain. The staff action also cancels unlocked acceptance jobs; the drain
re-checks after honorarium creation and compensates for a concurrent withdrawal,
so a late worker cannot leave or recreate an honorarium for an unfulfilled
review obligation. The staff-cleanup behavior shipped in merge `70f51f45`,
production deployment `dpl_9r2FYkAXhRqSXiJVCwevrXFZ5SzH`, on 2026-07-24.

Foundation-initiated **Release from assignment** is deliberately different.
When sufficient reviews have already been received, the source-built release
path retains the exact linked honorarium `akoya_request`, changes an open,
unpaid, unauthorized `Pending` row to `Withdrawn`, and stamps
`wmkf_datewithdrawalreceived` in the same ETag-guarded Dataverse changeset as
the reviewer release. An honorarium that is paid, authorized, unreadable,
non-versioned, or in another status blocks the reviewer transition; an already
`Withdrawn` row is retained unchanged. Acceptance-job race compensation uses
the same retain-and-withdraw rule. **Historical September 16 snapshot:** source
was built and the two Production release-email defaults were verified, with
runtime promotion then pending. Implementation commits `1abc097a8` and `87af339b3`
are ancestors of current HEAD (checked 2026-10-22). Git ancestry establishes
repository inclusion, not a hosted deployment or today's setting values.

The 2026-06-22 production lock was capture-only:
`HONORARIUM_ONBOARDING_DEFERRED=true` with the discriminator GUIDs unset. Treat
that as the safety/off state before the config flip, not the target operating
state for the no-BILL creation cycle.

### Acceptance response versus follow-up (source checked 2026-10-22)

`respond-service.js` stages a durable `reviewer_acceptance_jobs` row before a
fresh Dataverse accept PATCH, then returns after the accept. The leased
`reviewer-acceptance-drain.js` worker re-reads engagement state and performs
contact/honorarium follow-up, notifications, and acceptance confirmation. The
response does not establish that these side effects completed. Failed follow-up
can retry or reach a terminal failure independently of the accepted state.
The queue does not suppress Dataverse-triggered external automation; retain the
human-supervised production-testing restriction.

Two independent deferral gates sit on that post-accept honorarium pipeline:

- **`HONORARIUM_ONBOARDING_DEFERRED=true`** (or discriminator GUIDs unset) →
  `ensureHonorariumOnboarding()` returns `status: 'deferred'` **before** minting
  the `akoya_request` or calling BILL. It captures the contact + mailing address
  upstream; address-copy failures are returned separately. The acceptance drain
  picks the alert posture from the
  deferred result, in priority order:
  - `addressCaptureError` set (the address PATCH failed → no downstream copy) →
    emailing **warning** `honorarium_capture_failed`, deduped per suggestion, on
    every accept until resolved (keeps address-copy failure visible — Codex S274 P1).
  - `partialDiscriminatorConfig` (some-but-not-all GUIDs, no explicit flag → likely
    a botched go-live) → emailing **warning** `honorarium_discriminator_partial_config`,
    deduped to one recurring alert (Codex S274 P2).
  - otherwise → ONE non-emailing `honorarium_capture_only` notice (`info`,
    `emailAdmins:false`) per fresh accept.
  Use only for capture-only/off mode. Note: the explicit flag is checked FIRST,
  so enabling request creation needs all three GUIDs **and** the flag unset.
- **`BILL_ONBOARDING_DEFERRED=true`** → one step LATER: the `akoya_request` IS
  created, but `onboardReviewer()` returns `status: 'deferred'` (no BILL, no
  alert). This is the target no-BILL creation posture.

Both are reversible env gates. Source:
`lib/bill/honorarium-onboard-orchestrator.js`,
`lib/bill/onboard-reviewer-service.js`; current strategy:
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`; older design banners:
`docs/BILL_CHUNK_4_DESIGN.md` + `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

The historical capture-only rollout included a cycle-scoped backfill procedure.
Do not infer a remaining population from that old plan: the July 2 sweep found no
real reviewer needing it (`project-honorarium-payment-landscape`). If a newly
verified missing-record cohort warrants separately authorized backfill, use
`scripts/backfill-honorarium-capture-only.mjs --cycle <CODE>` (dry-run by default;
cycle-scoped so it can't sweep older cohorts; drives the same idempotent
`ensureHonorariumOnboarding`; refuses to run while still deferred). The two
readiness hardening edits are LANDED (S316): the backfill applies the same
required-address completeness AND validity checks as fresh accept — the shared
`missingRequiredAddressFields` + `validateAddress` in
`lib/external/required-address.js` — and includes `akoya_title` in its request
reload, so historical rows can no longer mint with partial/unnormalized stale
contact addresses (e.g. a full-name country) or generic proposal titles.

### Honorarium → proposal self-lookup (DONE 2026-07-02)

A honorarium and a proposal are both `akoya_request` rows, and `akoya_request` had no
native self-referential lookup (65 lookup fields, none targeted `akoya_request`). To
give each app-created honorarium a structured, queryable link to the proposal it
reviews, a custom self-lookup on `akoya_request` → `akoya_request` was created via the
Dataverse Web API on 2026-07-02 (into the Default Solution; default publisher prefix
is `wmkf`). Authoritative names read back from the relationship metadata:
- lookup logical name: **`wmkf_reviewedproposal`**
- **Referencing** nav property (honorarium → proposal, the one our create binds):
  **`wmkf_ReviewedProposal`** (casing confirmed by a read-only `$expand`, 200)
- **Referenced** collection nav (proposal → its honoraria, for a dashboard subgrid):
  `wmkf_akoya_request_reviewedproposal`
- cascade `Delete = RemoveLink` (referential — deleting a proposal only clears the link)

The create body in `lib/bill/honorarium-onboard-orchestrator.js` binds it
(`'wmkf_ReviewedProposal@odata.bind': /akoya_requests(<proposalId>)`, guarded on
`request.akoya_requestid`). Our app populates the FK but does NOT surface the field
in its own UI. Connor surfaces it in an AkoyaGO dashboard and
may add the component to `wmkfResearchReviewAppSuite`. The proposal is also still
conveyed by the honorarium title (Option C) and derivable via the
`wmkf_appreviewersuggestion` junction (`wmkf_HonorariumRequest` + `wmkf_Request`).
Detail: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §8/§9.

`[VERIFIED via GET-only production census 2026-07-27]`: 40/40 portal-era
honoraria carry the direct proposal lookup, all 40 are referenced by a suggestion
junction, and every direct lookup agrees with the proposal on that junction.
There are no orphan portal-era honoraria or mismatches. The 87 historical
GoApply-origin honoraria remain outside this portal-link guarantee. Re-run
`node scripts/probe-honorarium-link-population.js` before quoting a later count.

### Honorarium Grant Cycle link (meeting-date retirement step 4; branch only)

**[SOURCE-BUILT ON BRANCH `claude/invite-expiry-honorarium-cycle-link`; NOT
DEPLOYED]** New honoraria join the parent proposal's Grant Cycle (owner,
2026-10-29, `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md` §7 Q5). The
orchestrator re-reads the parent's link at create time (`readParentGrantCycle`;
the acceptance-job `request` snapshot no longer supplies a date, so jobs queued
before deploy still resolve), binds `wmkf_GrantCycle`, and writes
`wmkf_meetingdate` and `akoya_fiscalyear` ("December 2026") from the linked
row's calendar Board date. A parent with no cycle (no link or a historical code)
or no Board date throws `honorarium_no_grant_cycle`: the drain alerts
(`honorarium_onboard_failed`) and retries, and the accept still succeeds, as
with the old `honorarium_no_meeting_date`. Existing honoraria are unchanged; the
app-made ones from 2026 carry no link (`docs/CONNOR_DATA_CLEANUP_QUESTIONS.md`
DC5, parked).

## Standard Probe

```bash
rg -n "honorarium|Bill|BILL|payment|bank|akoya_request" lib pages docs tests
node scripts/probe-honorarium-link-population.js
```
