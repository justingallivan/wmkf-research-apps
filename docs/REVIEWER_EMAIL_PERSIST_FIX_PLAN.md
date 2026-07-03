---
title: "Reviewer Email-Persist Fix Plan (S317)"
domain: reviewers
kind: plan
status: active
summary: "Reviewer Invite-tab no-email fix: B1 (applicant-promote persists vetted email) + A (reconciliation cron backstop) SHIPPED; B2 (partial-return) DEFERRED."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/workbench/promote-applicant-reviewer.js
  - lib/services/reviewer-roster-store.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/reviewer-finder/enrich-contacts.js
---

# Reviewer Email-Persist Fix Plan (S317)

Fixes reviewers landing on the workbench **Invite Reviewers** tab with an empty
email when the enrichment-discovered address existed but never reached Dataverse.
Design reviewed by Codex (adversarial pass, S317); the named changes below are
folded in. Status labels: **SHIPPED** / **DESIGNED** / **DEFERRED**.

## Problem

The Invite tab reads `person.wmkf_emailaddress` directly
[VERIFIED via pages/api/reviewer-finder/my-candidates.js:217]; render/send read the
same column [VERIFIED via pages/api/review-manager/render-emails.js:179,
send-emails.js:330] — so an empty person email = "no email — can't invite" and no
separate invite email field exists.

The enrichment email lives durably in the Postgres roster
(`reviewer_find_roster.candidate` blob, `emailPersistAllowed=true`) but can fail to
reach Dataverse via either save path:

- **Find-discovered → `save-candidates`.** Enrichment runs inside `runSearch`,
  awaited; on failure `enriched = kept` (no email) yet phase still → results
  [VERIFIED via shared/components/reviewers/ReviewerSearchSection.js:668-722]. A
  LATER re-run can find the email and update the roster
  (`recordSurfaced`, keyed by normalized name) [VERIFIED via :729-742] while the
  already-saved suggestion is never re-saved.
- **Applicant-recommended → `promote-applicant-reviewer`.** `enrich-recommended`
  writes the discovered email only through `researcherAdapter.upsertByPotentialReviewer`,
  whose contract has no email param [VERIFIED via lib/dataverse/adapters/researcher.js:94],
  so the address never reaches the person. Promote historically only flipped
  `wmkf_selected=true` + persisted a MANUAL correction
  [VERIFIED via pages/api/workbench/promote-applicant-reviewer.js:61-64 (pre-B1)].

Empirically (90d, S317 probes): ~4% of selected reviewers had no email; 6 were the
"roster has email, Dataverse empty" class (all `emailPersistAllowed=true`); these
plus the 1003020 orphaned pair were recovered by hand this session.

`wmkf_lastchecked` is stamped on every upsert; only `wmkf_metricsupdatedat` proves
enrichment produced metrics [VERIFIED via lib/dataverse/adapters/researcher.js:144-146,204-206].

## B1 — Applicant-promote persists the auto-enriched email — SHIPPED

`promote-applicant-reviewer`, when no manual email was given, reads the roster
candidate blob **server-side keyed by `requestId + suggestionId`** (an exact id
anchor via `reviewer-roster-store.findCandidateBySuggestion` — NOT a normalized
name, NOT client-supplied) and persists the email through the same gates
`save-candidates` uses.

| Invariant | Enforcement |
|---|---|
| Read is server-side + id-anchored (no client trust, no name match) | `findCandidateBySuggestion(requestId, suggestionId)`; `candidate->>'suggestionId'` |
| Persist only a vetted email | `emailPersistAllowed===true` (top-level or `contactEnrichment`) |
| Never persist a namesake's email | skip if `needsIdentification` / `identityStatus`=`unresolved` / `verificationStatus`=`unresolved` |
| Idempotent; manual correction always wins | skip if `savedFields` already has `email`; skip if `getById` shows a non-empty `wmkf_emailaddress` |
| Source is the vetted provenance, not forged 'manual' | write the roster `emailSource` to `wmkf_emailsource` |
| Duplicate-email collision is non-fatal | `translateDuplicateKeyError` → `contactError` `email_conflict`; promotion stands |
| Legacy rows without a `suggestionId` anchor | `findCandidateBySuggestion` returns null → skip, never name-fallback |

Tests: `tests/unit/promote-applicant-reviewer-contact.test.js` (B1 describe). Matrix
updated + `check:api-routes` green.

## A — Backstop reconciliation — SHIPPED; Find path anchor fix added

Cron `/api/cron/reviewer-email-reconcile` (`verifyCronSecret`) →
`lib/services/reviewer-email-reconciler.js` automates this session's manual recovery
off the roster blob + linked suggestion. The reconciler itself is intentionally
id-anchored, not name-matching: it scans only roster blobs that already carry
`candidate.suggestionId`. All Codex-named changes folded in:

- **Data source:** `reviewer-roster-store.findReconcilableCandidates(limit)` — a NEW
  query over `status IN ('active','saved')` with a `suggestionId` + persistable-email
  DB pre-filter (`listForRequest` returns no saved blobs). The vetted gate
  (`pickVettedEmail`, shared with B1) is authoritative.
- **Anchor:** id-anchored on `candidate.suggestionId`; rows without it are excluded by
  the query — never a normalized-name match.
- **Repoint guard:** `findByPotentialReviewerAndRequest(keeperId, requestId)` rejects a
  keeper with ANY suggestion on the request (selected or not) → ALERT instead.
- **Idempotency:** every mutation is gated by LIVE Dataverse reads — `getById`
  (email-empty) and `findByEmailCandidates` (ownership) — never the roster blob.
- **Actions:** ownerless → `update` + vetted `emailSource`; single ACTIVE keeper +
  no collision → `repointToPotentialReviewer`; ambiguous / inactive / colliding →
  `NotificationService` alert (`reviewer_email_reconcile_needs_merge`).
- **Safety:** best-effort per row (a row error is recorded, non-fatal); `?dryRun=1`
  mutates nothing; `?maxBatch=N` (default 200) bounds the scan.

Tests: `tests/unit/reviewer-email-reconciler.test.js` (12 cases). Ports the proven
one-off scripts (`scripts/fix-roster-email-recovery.mjs`,
`scripts/fix-walsh-repoint-1003020.mjs`). Matrix + `check:api-routes` +
`CANONICAL_COUNTS` (api-route-file-count 137→138) refreshed.

**Find-path anchor gap fixed after initial Fix A review.** Find-discovered roster
rows are first recorded at search time, before `save-candidates` creates/reuses the
Dataverse suggestion, so their pruned blobs historically had `suggestionId:null`.
That meant the reconciler correctly refused to scan them. `save-candidates` now
stamps `suggestionId` plus `potentialReviewerId` back onto the matching roster row
after `potentialReviewerAdapter.upsertByEmail` and `reviewerSuggestionAdapter.upsert`
succeed; the roster update is best-effort and non-fatal. Existing Find rows are
handled by `scripts/backfill-reviewer-roster-suggestion-anchors.mjs`, dry-run by
default, which stamps only when exactly one selected suggestion on the same request
matches the roster row's normalized name. This creates the missing exact-id anchor
without loosening the reconciler's `suggestionId IS NOT NULL` filter.

## B2 — Timeout partial-return + save-gate — DEFERRED

`enrichCandidates` throws on abort before returning partial results
[VERIFIED via lib/services/contact-enrichment-service.js:1247]; `/enrich-contacts`
then emits an error, not partial `complete` results
[VERIFIED via pages/api/reviewer-finder/enrich-contacts.js:195]. Returning the
partial array (merged by index) would preserve computed enrichment.

**Deferred** pending frequency data. Scope boundary (Codex): A recovers only emails
that REACHED the roster — it does **not** cover a timeout that discarded enrichment
entirely, which is B2's class. Do not claim A covers timeout-discard damage.

## Cause #2 (separate track)

Enrichment completes but no invitable email is surfaced. An earlier 90d probe
counted 8 prominent PIs; an S320 re-measure over 120d found 5 true Cause #2 cases
(482 selected, 11 no-email) [VERIFIED via scripts/probe-no-email-breakdown.mjs + live
OpenAlex probes, S320]. **Corrected root cause:** it is NOT primarily a weak
discovery step — in 4 of 5, a *correct* institutional email was found and then
discarded by a gate (`verified_domain_contradiction` trusting a single OpenAlex
last-known-institution domain; `name_mismatch` on the correct domain). The resolved
faculty-page fetch tier could not rescue the domain-contradiction cases (its fetch
was bound to the same wrong domain). **RESOLVED (S321):** the strategy review ran
(`docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` →
`docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`, revision 2 after an adversarial Codex
round) and the redesign is IMPLEMENTED — two-tier domain vindication, the
`search_contested` LOW-confirm lane, per-recipient invite confirm, and the fetch
tier re-bound to the anchored domain set. Re-measure with
`scripts/probe-no-email-breakdown.mjs` after the next enrichment cycles.
