---
title: "Reviewer Email-Persist Fix Plan (S317)"
domain: reviewers
kind: plan
status: active
summary: "Reviewer Invite-tab no-email fix: B1 (applicant-promote persists vetted email) SHIPPED; A (reconciliation backstop) DESIGNED; B2 (partial-return) DEFERRED."
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

## A — Backstop reconciliation — DESIGNED

A cron/admin sweep that automates this session's manual recovery for BOTH paths.
Codex-named changes vs the first draft:

- **Data source:** `listForRequest` returns only active/excluded/allNames, NOT the
  saved candidate blobs [VERIFIED via lib/services/reviewer-roster-store.js:186-203];
  A needs a NEW store query over `status='saved'` (and active), returning the blob.
- **Anchor:** match roster→suggestion on `candidate.suggestionId` (id anchor), never
  the normalized name (folds Hamit/Harmit) [VERIFIED via reviewer-name-match.js
  normalizer]. For rows without a `suggestionId`, skip or alert — never guess.
- **Repoint guard:** `(person, request)` uniqueness is load-bearing; the guard must
  reject a keeper that has ANY suggestion on the request, selected or not
  [VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:242 —
  findByPotentialReviewerAndRequest has no selected filter].
- **Idempotency:** re-read Dataverse live before writing (the roster lags in both
  directions — Silva was roster-empty/Dataverse-had-it).
- **Actions:** ownerless email → write; single sibling owner + no colliding
  suggestion → repoint; else → alert for manual merge.

Ships as a registered, gated route (`check:api-routes`). The one-off session scripts
(`scripts/fix-roster-email-recovery.mjs`, `scripts/fix-walsh-repoint-1003020.mjs`)
are the proven procedure to port.

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

Enrichment completes but no tier surfaces an email that exists (8 prominent PIs in
90d). Not addressed here; needs a stronger discovery step (e.g. the resolved
faculty-page email tier). Tracked separately.
