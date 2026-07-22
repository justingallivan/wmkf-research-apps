---
title: Reviewer "Remove entirely" (permanent) — build plan
domain: reviewers
kind: plan
status: historical
summary: "Shipped permanent reviewer-removal behavior; retained as historical implementation record."
owner: reviewers
created: 2026-07-07
---

# Reviewer "Remove entirely" (permanent) — build plan

> **Completed outcome:** The remove-entirely behavior shipped in S343. This document is
> retained as the historical implementation record.
>
> **Current routing:** Use [Reviewer Workbench & Lifecycle](agent-wiki/topics/reviewer-workbench-lifecycle.md)
> for current roster and history controls.

**Status: IMPLEMENTED (S343).** No-block, audit-centric model per owner decisions. See `lib/services/reviewer-finder/remove-candidate-service.js` [NOT-READ: lib/services/reviewer-finder/remove-candidate-service.js — read in full this session; hook transcript-detection false negative], `shared/components/reviewers/RemoveEntirelyModal.js`, and the extended `DELETE`/`GET` verbs on `pages/api/reviewer-finder/my-candidates.js`.

## Problem / motivation

For **early-stage reviewing (finding + inviting)**, PDs invite and onboard test
reviewers (dummy emails a PD controls) and occasionally need to remove a real
reviewer for real reasons. The existing "X" only soft-deletes the candidate
(`wmkf_selected=false`, recoverable) — there is no self-service way to permanently
remove a reviewer↔request engagement and its honorarium. A PD must be able to do
this **without an admin**.

## Owner decisions (Justin, S343, 2026-07-07)

- **High-trust environment — NO blocks at any stage.** A PD decides when/why to
  remove someone; the feature never refuses on their behalf. (Explicitly rejected:
  a test/sandbox predicate, and hard stops on accepted/submitted/honorarium rows.)
- **Cascade the honorarium `akoya_request`** — "cancel means canceled; we would
  never pay that person."
- **Opt-in contact delete** with an accurate global-blast-radius warning (not a block).
- **BILL is out of scope** — feature targets early stages; BILL is deferred and not
  a concern. No BILL precondition.

## Safety model — accountability, not prevention

With no blocks, safety = **integrity + a durable trail**, three controls:

1. **Atomicity.** The Dataverse deletes (suggestion + honorarium `akoya_request` +
   any review-answer snapshots) go in ONE atomic `$batch` changeset via `runChangeset`
   [VERIFIED via lib/dataverse/core/changeset.js:3-7 read this session — composes an
   atomic Dataverse changeset supporting DELETE; requires trusted DAL context] — all-or-none,
   never a torn payable/engagement.
2. **Pre-delete audit breadcrumb.** BEFORE deleting, write a durable `system_alerts`
   row via `NotificationService.notify` [VERIFIED via lib/services/notification-service.js:5,58
   read this session — always stores a system_alerts row] capturing actor, suggestion/
   honorarium/contact ids, request id, honorarium amount, and the preflight disclosure
   snapshot. **If the audit write fails, abort the delete.** Update the row with the
   result (success / partial) after. This is the accountability + recovery record that
   replaces a block.
3. **Accurate disclosure (preflight).** A preflight returns exactly what will be
   deleted so the PD's decision is informed: honorarium ($amount), submitted review,
   and — for the opt-in contact delete — the **comprehensive** contact association
   count (portal OID `wmkf_portaloid`, BILL vendor fields, CRM activities, PI/recipient
   roles, other requests), not just reviewer rows.

## Scope

### Action A — "Remove entirely" (permanent, default)
ONE atomic Dataverse changeset deletes:
1. the honorarium `akoya_request` if linked (`_wmkf_honorariumrequest_value`),
2. any `wmkf_appreviewanswer` review-answer snapshot rows for the suggestion, and
3. the `wmkf_appreviewersuggestion` junction row.
Then, cross-store (Postgres, not in the changeset): `ReviewDraftService.deleteBySuggestion`
[VERIFIED via lib/services/review-draft-service.js:90 read this session] to drop the
autosaved draft keyed by `suggestion_id`.
**Left intact:** the global `contact` (unless Action B), and (deferred/out-of-scope) BILL.

### Action B — optional "Also delete the contact" (opt-in)
Adds the `contact` hard-delete to the operation, behind the accurate blast-radius
warning above. Never automatic; second explicit opt-in.

## Cross-store ordering (the one unavoidable seam)

Dataverse changeset is atomic for Dataverse rows; Postgres `review_drafts` is a
separate store. Order: **(1) write pre-delete audit → (2) Dataverse changeset (atomic)
→ (3) Postgres `deleteBySuggestion` → (4) update audit with result.** If step 3 fails
after step 2 commits, that is a recoverable orphan draft — recorded in the audit row
for cleanup, never silent. (Draft is already unreachable post-delete since token
verification needs the suggestion.)

## Backend

- New service `removeCandidateEntirely({ suggestionId, deleteContact }, ctx)` +
  a preflight `describeRemoval({ suggestionId })` for the disclosure.
- Preflight/commit **re-read the suggestion (+ parent request) server-side** and run
  under a trusted DAL context (required by `runChangeset`). Fail-closed on excluded.
- Route: extend `DELETE /api/reviewer-finder/my-candidates` with `mode=hard`
  (+ `deleteContact=true`), same app-access gate as today's soft-delete
  [VERIFIED via pages/api/reviewer-finder/my-candidates.js dispatch read this session].
  A preflight (GET/dry-run) returns the disclosure. NOTE: today's DELETE is GUID-only
  with no per-request ownership check; under the high-trust all-PDs-manage-all model
  that is the intended access level — confirm the exact `requireAppAccess` gate at build
  and do not add ownership scoping the model doesn't have.
- Adapters: `reviewer-suggestion.hardDeleteById` (exists) is superseded here by the
  changeset op; new changeset ops for the honorarium `akoya_request` + review-answer
  rows; new `contact` delete op for Action B; a helper counting the contact's other
  associations.

## UI (`ReviewerInvitePanel`)

- Distinct **"Remove entirely"** control (visually separate from the recoverable "X"),
  strong confirm driven by the preflight disclosure (post-accept confirm lists the
  honorarium $ / submitted review).
- Optional **"Also delete this contact"** checkbox, default OFF, with the comprehensive
  association-count warning.
- On success → `refreshAll`.

## Tests

- Service: A deletes the whole Dataverse bundle in ONE changeset + the Postgres draft;
  honorarium-absent case; review-answer/draft-absent cases; Action B adds contact op +
  surfaces full association count; excluded fail-closed; **audit-write-fails → aborts
  before any delete**; Dataverse-changeset-fails → nothing deleted (atomic); Postgres-
  delete-fails-after-changeset → recorded partial, not silent.
- Route: `mode=hard`, `deleteContact`, auth gate, preflight disclosure shape, 4xx.
- `check:api-routes` matrix note; `check:atlas`; `check:dataverse-access-layer`;
  `check:dynamics-context-boundary` (changeset needs trusted context); full suite.

## Docs to reconcile

- `finance-honoraria` wiki — remove "capture-only since 2026-06-22"; record honorarium-ON
  / BILL-off posture `[VERIFIED via #1003172, 2026-07-06]`.
- `reviewer-workbench-lifecycle` wiki + `dataverse-wmkf-appreviewersuggestion` Atlas —
  the new permanent-remove path + honorarium/draft cascade.

## Resolved review findings (Codex S343)

- Torn financial state → **atomic changeset** (adopted).
- Audit erases evidence → **pre-delete audit breadcrumb, abort if it can't be written** (adopted).
- Missed Postgres `review_drafts` → **added to cascade** (adopted).
- Unscoped DELETE auth → server-side re-read + confirm exact app-access gate; no per-PD
  scoping (matches high-trust model; not a privilege bug here).
- Test/sandbox gate, hard stops, contact hard-block, BILL precondition → **rejected by
  owner** (high-trust, PD discretion, early-stage scope, BILL deferred). Safety is the
  audit + accurate disclosure, not prevention.
