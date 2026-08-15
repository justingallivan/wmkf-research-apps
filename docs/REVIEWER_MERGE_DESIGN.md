---
title: "Reviewer Record Merge — Build Plan & Design (v1)"
domain: reviewer-workbench
kind: spec
status: active
summary: "Chunks 1–3 (adapters, lib/services/reviewer-merge.js, the pages/api/reviewer-finder/merge-candidates route) are committed and tested."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-merge-altkey-ordering.mjs
  - scripts/probe-akoya-potentialreviewer-slot-navprops.mjs
  - lib/services/reviewer-merge.js
  - tests/unit/candidate-edit-modal-merge.test.js
---

# Reviewer Record Merge — Build Plan & Design (v1)

status: v1 backend BUILT (chunks 1–3, S289 2026-06-25, Codex post-impl folded); UI merge mode BUILT (chunk 4, S290 2026-06-25, 2 Codex pre-impl + 1 post-impl passes folded, 13 tests green); ordering probe BUILT + PROD-CONFIRMED (chunk 5, S290, `scripts/probe-merge-altkey-ordering.mjs`; `--run` settled O8 — sub-probes A/B/C all pass — and caught + fixed a real prod bug in the 409 `conflictingRecordId` derivation, commit a19b934f); applicant-slot repoint BUILT (S307 2026-06-29, Codex pre-impl folded — the v1 `loser_in_applicant_slot` BLOCK was LIFTED: executeMerge Step 5 now repoints `wmkf_potentialreviewer1..5` loser→keeper, clearing keeper-duplicate slots, with a provenance-gated junction collision-union; nav props verified via `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`)
owner: reviewer-finder

> Chunks 1–3 (adapters, `lib/services/reviewer-merge.js`, the
> `pages/api/reviewer-finder/merge-candidates` route) are committed and tested.
> Chunk 4 (the `CandidateEditModal` UI merge mode + recovery, S290) is BUILT with
> tests (`tests/unit/candidate-edit-modal-merge.test.js`); the Codex post-impl review
> is folded (stale-async guards on enter/swap, re-plan-failure withholds retry,
> recovery always refreshes on exit). Chunk 5 (the live-ordering probe
> `scripts/probe-merge-altkey-ordering.mjs`) is BUILT and PROD-CONFIRMED
> (the `--run` settled O8 — sub-probes A/B/C all pass — and caught a real prod bug in the
> 409 `conflictingRecordId` derivation, since fixed: commit a19b934f). Build follows the project's
> design → Codex pre-impl → implement+tests → commit → Codex post-impl loop
> (`project-codex-design-pre-impl-iteration`). This v1 design was twice-reviewed by
> Codex + an internal aggressive review + a live probe (chunk 4 got two more Codex
> pre-impl passes); see "How we got here" at the end.

## Problem

On the Workbench **Candidates** tab, editing a saved candidate's email
(`CandidateEditModal` → `PATCH /api/reviewer-finder/my-candidates`) to an address
another `wmkf_potentialreviewers` row already owns hits a 412 on the
`wmkf_emailaddress_unique` alternate key. `translateDuplicateKeyError`
(`my-candidates.js:600`) turns it into a 409 telling staff the two records "need to
be merged" — with no way to do it. The API already returns `conflictingRecordId`
(the row owning the email), unused by the client today.

Goal: a real **field-by-field merge** so staff can collapse two duplicate person
records into one — a genuine data-tidying tool (reviewers move institutions /
change emails; records go back decades).

## v1 scope (evidence-backed) — merge a PRE-ENGAGEMENT loser only

A live read-only probe (`scripts/probe-reviewer-duplicates.js`, S289) measured the
real duplicate population: 4,294 active person rows; **28 ORCID-duplicate clusters**
(the precise mergeable signal) of which **27 are fully pre-engagement and 0 have
≥2 engaged members**; only **3 of 4,294 rows are promoted to a contact at all**.
The dangerous cases the original design spent the most engineering on (both-sides
engaged on the same request; two-contact merge) **do not occur in live data**.

So v1 deliberately handles ONLY the case that actually exists and is safe:

- **Merge is allowed only when the LOSER is fully pre-engagement** (predicate below),
  re-checked at execute time from live source, fail-closed.
- **Any engaged or contact-bearing loser → BLOCK with an explainer** (which record
  is engaged on which request, what to do). Same dead-end-avoidance the feature is
  about, but never risks corrupting a live reviewer engagement.

This removes — from v1 — the durable journal, tombstone, collision-survivor logic,
contact-merge, and BILL reconciliation: all of them are unreachable once an engaged
or promoted loser is blocked. Deferred-to-v2 list at the end; v2 is justified only
if a future probe shows the engaged-loser case is real.

## The block predicate (comprehensive — the load-bearing safety rule)

The merge is REFUSED (returns `blocked` with reasons, mutates nothing) unless the
**loser** is fully pre-engagement. **Defined fail-closed as a positive whitelist,
NOT a blacklist** (so a future lifecycle field defaults to *blocking* the merge,
never silently passing — per `feedback-scrutinize-exemptions-and-fallthrough`): a
loser suggestion row is **inert** only if it is a never-outreached curated
candidate — it carries NO outreach, response, intake, token, honorarium, or
reviewer-supplied signal whatsoever. The loser is **ineligible** (blocked) if
EITHER:

- the loser PERSON has a `_wmkf_contact_value` (promoted to a CRM contact — O3),
  OR
- ANY loser suggestion row — including soft-deleted/removed (`wmkf_selected=false`)
  rows — is non-inert, i.e. has any of these set (non-exhaustive; the rule is "any
  lifecycle/outreach/intake stamp blocks", these are the known ones — FINAL-1,
  all present in `FIELD_SELECT` `reviewer-suggestion.js:23-68` and preserved by
  `softDelete`):
  - **outreach:** `wmkf_invited`, `wmkf_emailsentat`, `wmkf_materialssentat`,
    `wmkf_remindersentat`, `wmkf_respondremindersentat`, `wmkf_thankyousentat`,
    any live/issued token (`wmkf_externaltokenissued`, even if revoked — an invite
    WAS sent), `wmkf_proposalfirstaccessed`;
  - **response/intake:** `wmkf_accepted`, `wmkf_declined`, non-null
    `wmkf_responsetype`, `wmkf_responsereceivedat`, `wmkf_reviewreceivedat`,
    `wmkf_reviewfilename`, `wmkf_reviewsharepointfolder`, any rating field
    (`wmkf_reviewerimpact`/`risk`/`overallrating`), any stage-2a reviewer-supplied
    field (`wmkf_declinereason`, `wmkf_honorariumoptout`, reviewer name/email/orcid);
  - **finance/disposition:** non-null `_wmkf_honorariumrequest_value`,
    `wmkf_applicantdisposition` = excluded.

  Implementation note: read the row's full lifecycle field set and block if ANY
  non-inert field is populated; do not maintain only the literal list above.

Two enumeration rules that make this correct (verified):
- The removed marker is **`wmkf_selected = false`, NOT `statecode`** — any
  "loser's suggestions" query must NOT filter on `selected eq true`, or it misses
  removed rows that still occupy the (person,request) key and may still carry a
  honorarium link (`softDelete` clears `selected/accepted/declined/responsetype/
  reviewstatus/heldat` only — `reviewer-suggestion.js:971-980` — it does NOT null
  the FKs or clear reviewfile/honorarium). (O2)
- The predicate is evaluated at **execute time from live source**, not trusted from
  the plan response. The point-in-time probe is then irrelevant to safety: even if
  the population shifts, an engaged loser is blocked at the moment of merge. The
  one fatal way to get this wrong is a too-narrow predicate that passes an engaged
  loser through — hence the explicit full list above. (O1)

## Execute flow (no journal — pre-engagement loser is recoverable on tear)

Because the loser carries no live engagement, a torn merge leaves both rows present
and is simply re-planned from live state; no durable journal/tombstone is needed.
Resolve ALL chosen literal values BEFORE any clear/mutate (O6), then:

1. **Plan (read-only).** Read both persons (a merge-only wide select incl. wave6
   fields), enumerate ALL loser suggestions (incl. `selected=false`, paginated via
   `queryAllRecords`), enumerate `akoya_request` applicant slots holding the loser.
   Evaluate the block predicate. If ineligible → return `blocked`, mutate nothing.
2. **Re-validate at execute** (re-read persons + all loser suggestions; re-evaluate
   the block predicate). Abort if anything changed since planning.
3. **Reconcile person fields onto keeper** per `fieldChoices` (resolved literals).
   Identity/ORCID fields follow the non-downgrade rule (below), not the picker.
4. **Loser suggestions:** for each request the keeper has NO row for → repoint
   loser's row to keeper (`wmkf_PotentialReviewer@odata.bind`, `If-Match`). For a
   request the keeper already has a row for (collision) → the loser's row is
   un-engaged by predicate, so conditional-delete it (`If-Match`, new helper) to
   free the (person,request) key; keep keeper's row.
5. **Applicant slots — REPOINT loser → keeper (S307; the S289–S306 block was lifted).**
   S289 shipped a conservative **block** (`loser_in_applicant_slot`) instead of the
   repoint the original design called for. S307 implemented the repoint and removed
   the block: `executeMerge` Step 5 (after the suggestion reference work, before the
   non-retryable email window and before deactivate) PATCHes each
   `akoya_request.wmkf_PotentialReviewer<N>@odata.bind` loser → keeper. When the
   keeper would otherwise occupy two slots (it already holds a slot on that request,
   OR the loser holds more than one slot) the extra loser slot is CLEARED via a
   `$ref` disassociate (`DynamicsService.disassociate`) rather than repointed — the
   applicant's recommendation stays represented by exactly one keeper slot, matching
   the by-person dedup the ingestion route already applies on read. Conflict handling
   mirrors the suggestion repoint (412/409 → retryable replan; 404/400 hard-fail).
   Nav-property names verified live (`wmkf_PotentialReviewer1..5`,
   `scripts/probe-akoya-potentialreviewer-slot-navprops.mjs`); clear-via-`$ref`-delete
   mirrors the proven `scripts/reset-request-reviewers.mjs --include-slots` path.
   Provenance: the authoritative slot is preserved by the repoint; for a colliding
   junction row, Step 4 first transplants applicant-recommended intent onto the
   keeper's surviving row (gated on `hasApplicantProvenance`, fail-closed if the
   keeper row is applicant-excluded) before deleting the loser row.
6. **Email (only if the surviving email differs from keeper's current email):**
   clear loser email, THEN set keeper email (alt-key forces clear-before-set), and
   stamp keeper `wmkf_emailsource='manual'`. The clear→set window is the ONE tear
   point not reconstructible from live Dataverse alone (FINAL-2); per the resolved
   decision below (Option B), a tear here leaves the keeper without the email and
   the UI's weak-proxy recovery prompts staff to re-enter it — no durable email log.
   With keeper defaulting to the edited record (§Keeper selection), this email move
   is the COMMON path in the trigger case; only the tear itself is rare (needs a 500
   in the clear→set window).
7. **Re-verify the loser is dereferenced, THEN deactivate** (statecode=1; email
   already blanked if it moved). Hard delete only if proven reference-free.
   The re-read (S423) is load-bearing, not belt-and-braces: the plan's enumeration
   is a snapshot from Step 1 and Steps 3-6 are many sequential round-trips, so a
   reference created in that window is never repointed — and the `If-Match` here
   CANNOT catch it, because it carries the loser PERSON's ETag while a new
   suggestion row or slot binding writes a different record. Verified against
   production: creating a child row does not bump the parent's `versionnumber`
   (`scripts/probe-etag-parent-bump.js`, 2026-08-13). Steps 4-5 repoint or delete
   every enumerated row, so both reference reads must now come back empty;
   anything present is new and fails closed to a retryable replan. A capped slot
   read is a terminal 400 at plan time but a replan here, since Steps 3-6 have
   already written and the modal treats 400 as non-retryable.
   Still open: the slot-binding half of the ETag question is unverified (Dataverse
   records no binding timestamp), and the cascade remains non-transactional — a
   failure after the Step 4 hard delete leaves a half-merged state with no
   compensation.

No contact step: a loser WITH a contact is blocked (§block predicate), so there is
never a contact to move and no BILL `reviewer_contact_id` to reconcile (O4 — that
step was a misframed no-op and is gone).

## Keeper selection (O5 — do NOT default to the email owner)

`conflictingRecordId` is the record that already OWNS the email — i.e. the record
the staffer is NOT editing. Defaulting it to keeper would deactivate the row the
staffer just curated. v1: **keeper is staff-selectable in the merge UI via a Swap
control**, defaulting to **the edited record** (the row the staffer just curated),
NOT the email owner. (The earlier draft said default to the "more-engaged / fresher"
record, but `planMerge` returns no engagement/recency signal — S289 chunk-4 pre-impl
Q1 — so v1 defaults to the curated record and relies on Swap + the server block
predicate to correct a wrong orientation rather than widening the plan response.)
The picker clearly labels which record survives. (If the chosen keeper is the
engaged one and the loser pre-engagement, the block predicate is satisfied; if the
staffer picks the engaged record as the *loser*, the merge is blocked — that's
correct, and Swap fixes it.)

## Field-picker semantics

- Picker covers **human-facing contact/identity-display fields only**: name,
  affiliation, email, website, h-index. Each shows keeper value vs loser value;
  staff choose per field. Email choice drives step 6. **When the surviving email
  differs from the keeper's current email, the merge MUST also set the keeper's
  `wmkf_emailsource` to `manual`** (a human is asserting this address) — otherwise
  the keeper carries stale provenance and the invite-confidence gate
  (`reviewer-invite.js:82-102`, which reads `wmkf_emailsource` AND
  `wmkf_identitystatus`) mis-grades the new address. This mirrors the existing
  manual-email stamp in `my-candidates.js:567` (FINAL-4).
- **Identity-verdict + ORCID + bibliometric fields are NOT in the picker.** They
  follow an explicit **non-downgrade** rule: a `confirmed` identity on either record
  is preserved; the merge never overwrites a `confirmed` keeper with a loser's
  weaker resolver verdict (mirror `researcher.js`'s no-automated-downgrade
  protection; the invite-confidence gate reads `wmkf_identitystatus`,
  `reviewer-invite.js:72-112`). A human can't adjudicate "which ORCID wins," so we
  don't ask them to. **Where the LOSER is `confirmed` and the keeper is not, the
  merge BLOCKS (`loser_confirmed_identity`)** rather than transplanting the loser's
  identity bundle onto the keeper — staff re-run with the verified record as keeper.
  Fail-closed; no human attestation is silently discarded (S289 post-impl).
- Per-request descriptive fields (`wmkf_matchreason`/`wmkf_sources`/
  `wmkf_relevancescore`, which live on the suggestion, not the person) are NOT
  reconciled; the surviving suggestion's values stand. Stated so it isn't a surprise.

## Email-move atomicity (FINAL-2) — RESOLVED: Option B (no new storage)

The clear-loser-email → set-keeper-email window can tear, and the chosen email
literal isn't reconstructible from live state afterward. It matters when the
**surviving email differs from the keeper's current email**. With keeper defaulting
to the **edited record** (§Keeper selection) and the email-field picker defaulting
to the conflict target (the address the staffer was setting, which lives on the
loser), the **canonical trigger case DOES run step 6** — the staffer's address moves
from the loser onto the keeper. (This corrects the earlier draft, which assumed
keeper defaulted to the email owner and so claimed email moves were rare and step 6
usually skipped — S289 chunk-4 pre-impl additional flag. Email moves are the common
path; the tear stays rare because it needs a 500 inside the narrow clear→set window.)

**Decision (S289): Option B — explicit re-edit UX, no durable email log.** Accept
the tear as a rare, bounded inconsistency. A tear surfaces as a **500 on confirm**:
`clearEmail(loser)` succeeds, then `update(keeper,{email})` throws
(`reviewer-merge.js` step 6), so the conflict-target address is now blanked on the
loser and never landed on the keeper — **orphaned from both rows**, while the keeper
keeps its OLD email. The recovery therefore must NOT proxy on "keeper has no email"
(a false negative — the keeper still has its old address); it detects the actual
orphan signature (S289 chunk-4 pre-impl pass 2): on a confirm 500, re-plan and test
whether the staffer's target address is still owned by either side. If it is →
ordinary transient failure, generic error + retry allowed. If it is NOT → the tear
orphaned the address; show an explicit repair prompt naming the address ("…was
removed mid-merge — open this record from the Candidates list and set its email"),
refresh, and do NOT offer a plain retry (a retry would complete the merge WITHOUT
restoring it — on the retry plan the loser email is empty and `resolvePersonUpdates`
refuses to write an empty loser value, `reviewer-merge.js:202`, so the loser would
be deactivated with the address permanently lost). If the recovery re-plan ITSELF
fails (the 500's live state can't be re-read), withhold retry too and tell staff to
reopen the record and confirm the email is still set before trying again — an
unverifiable state must not be treated as safe-to-retry (S290 post-impl Q1). A
benign sibling case — confirm returns 200 but the surviving keeper has no email at
all — shows the "add it from the list" note. No inline re-entry (the surviving keeper suggestion id isn't
reliably available to the modal when the loser's known suggestion collided and was
hard-deleted). No new table, no migration; cost is a documented manual-repair path,
kept consistent with the journal cut the probe justified.

(Rejected — Option A: a tiny single-purpose Postgres table holding the resolved
survivor email written before the clear, deleted after the set, for true idempotent
resume. Cleaner but re-introduces a migration; not warranted given the tear itself
(a 500 inside the clear→set window) is rare and Option B's manual re-entry covers it.)

## Chunked build plan

Each chunk gets a Codex pre-impl + post-impl review; catches folded in a follow-up
commit (not amended). Target ≤ ~1100 net lines per chunk.

- **Chunk 1 — Adapter plumbing (behavior-neutral).**
  - `potential-reviewer.js`: a merge-only wide-select read incl. wave6 — a NEW
    select constant, NOT a widening of the shared `FIELD_SELECT` (widening changes
    every `getByEmail`/`getById` caller and can trip
    `DynamicsService.checkRestriction`, `dynamics-service.js:218-245`);
    `clearEmail`; `deactivate` (statecode).
  - `dynamics-service.js`: a conditional-delete helper (`deleteRecord` + `If-Match`
    — none exists today, `dynamics-service.js:923`). Used ONLY for the rare
    un-engaged colliding loser row (step 4).
  - `reviewer-suggestion.js`: `findAllByPotentialReviewer(personId)` via
    `queryAllRecords` (MUST include `selected=false` rows);
    `repointToPotentialReviewer(suggestionId, keeperId, {ifMatch})`.
  - Unit tests per helper.
- **Chunk 2 — Merge service (new `reviewer-merge` service).**
  - `planMerge({keeperId, loserId})` → read-only diff + block-predicate evaluation
    + which suggestions repoint/delete + applicant-slot block check.
  - `executeMerge({keeperId, loserId, fieldChoices})` → re-validate, ordered,
    literals-first, idempotent (re-runnable from live state). Identity non-downgrade.
    Re-run safety: refuses an already-inactive loser (`statecode != 0`), and
    `fieldChoices` never null out a keeper value with an empty loser one (S289).
  - Unit tests: block predicate (each ineligible trigger incl. a removed row with a
    honorarium link), collision-delete branch, repoint branch, email-move ordering.
- **Chunk 3 — API route (new `pages/api/reviewer-finder/merge-candidates`).**
  - Authz = **same as my-candidates**: `requireAppAccess(req, res, 'reviewer-finder',
    'reviewers')`. (S289 decision, supersedes O7's superuser proposal.) Rationale:
    the fail-closed block predicate ALREADY restricts a regular user to merging a
    loser that is pre-engagement AND not promoted to a contact — i.e. exactly the
    low-risk misspelled-duplicate case. The high-blast-radius scenarios
    (engaged/promoted loser) are *refused by the predicate*, not permission-gated,
    so a superuser gate would mostly just stop the person who hit the bug from
    fixing it. Most potential-reviewers live on old, unrevisited proposals; a
    pre-engagement PR-side correction there is very low risk. GUID-validate BOTH ids
    (trust-boundary gate). Route is **POST-only**: `POST {keeperId, loserId}` returns
    the read-only plan; `POST {…, fieldChoices, confirm:true}` executes. Register in
    `docs/API_ROUTE_SECURITY_MATRIX.md`. Route tests.
  - **Authorization: org-open, accepted by-design (owner decision 2026-08-15).**
    The S289 choice above is deliberate: its block predicate limits the *loser
    record's data eligibility*, and app-level access is the merge boundary. The
    route receives no `requestId` and checks no request membership — and that is
    intended, because **no technical request/data ownership exists in Dataverse**
    to scope against, so there is no meaningful tighter fence. The data-only
    predicate is the safety mechanism; merge affordances may rely on app-level
    access. See `.claude-memory/project-merge-candidates-authorization-gap.md`.
- **Chunk 4 — UI merge mode (`CandidateEditModal`).**
  - On a 409 carrying `conflictingRecordId` (saved-Candidates PATCH only — guard on
    `candidate.potentialReviewerId` + `!onApply && !confirmMode`), switch to merge
    mode: fetch the plan with keeper = the edited record / loser = `conflictingRecordId`,
    show the keeper Swap control (default = the edited record, not the email owner),
    the field-by-field picker, and — if `blocked` — the explainer with no confirm
    (Swap stays available). Confirm → execute → refresh.
  - **Email-field default is orientation-aware (S289 chunk-4 pre-impl Q2):** the
    email pick defaults to whichever record currently OWNS the conflict-target value,
    recomputed on every (re)plan incl. after Swap — so it realizes the staffer's
    original edit and never silently transplants the edited row's OLD email onto an
    email-owner keeper.
  - **Half-done email recovery (Option B):** on a confirm 500, re-plan and detect the
    tear by its true signature — the staffer's target address is no longer owned by
    EITHER side (not "keeper has no email", which is a false negative since the keeper
    keeps its old address). If orphaned → explicit repair prompt naming the address,
    no plain retry; if still owned → generic transient error + retry. Benign sibling:
    confirm 200 with the surviving keeper holding no email → "add it from the list".
    No inline re-entry (no reliable survivor suggestion id). Closes the FINAL-2 tear
    without durable storage. (See §Email-move atomicity for the full rationale.)
  - **Stale-async guard:** plan/swap/confirm/recovery responses that land after the
    modal closes or the candidate identity changes must not write state.
- **Chunk 5 — Non-mocked ordering probe (O8). BUILT S290.**
  - A guarded integration probe that exercises the real alt-key ordering (email +
    (person,request) key) against PRODUCTION Dataverse on throwaway rows, because
    mocked adapters reproduce neither key enforcement nor the 412 precondition
    (`dynamics-service.js:823`) — the exact bug class the two Codex passes caught.
  - Built as `scripts/probe-merge-altkey-ordering.mjs` (prod-write, reversible;
    mirrors `scripts/smoke-test-candidate.mjs`'s safety model). The sandbox isn't
    wired for `DynamicsService`, so the probe runs against prod on synthetic
    throwaway rows (marker `ZZZ Merge Probe (DELETE)`, `@example.invalid` emails) on
    the dedicated test request 1002788. Plan-only by default; `--run` executes three
    sub-probes (A email alt-key + `translateDuplicateKeyError` round-trip; B
    (person,request) repoint collision vs free; C end-to-end `executeMerge`) then
    auto-cleans in a `finally` (marker-gated teardown; `--keep` opts out). To remove
    drift, `translateDuplicateKeyError` was extracted to `lib/dataverse/duplicate-key.js`
    and is shared by the probe and `my-candidates.js`.
  - **PROD-CONFIRMED S290:** the `--run` against prod settled O8 — sub-probes A (email
    alt-key + `translateDuplicateKeyError` round-trip), B ((person,request) collision
    vs free), and C (end-to-end `executeMerge`) all PASS, with marker-gated cleanup
    verified (no probe rows left). The run also caught a real prod bug the mocked tests
    missed: the 409 path derived `conflictingRecordId` from the 412 body, which carries
    the record being WRITTEN plus its `modifiedby` systemuser — NOT the existing owner —
    so it surfaced a systemuser GUID and broke merge-mode entry. Fixed by resolving the
    owner from the duplicate email via `potentialReviewerAdapter.findByEmailCandidates`
    (fail-closed on `statecode`); `lib/dataverse/duplicate-key.js` returns field/value
    only. Codex pre-impl + post-impl both folded. Commit a19b934f; pinned regression
    test `tests/unit/duplicate-key.test.js`.

## Red gates in scope

`check:api-routes` + self-test and `check:trust-boundary-guid` + self-test
(Chunk 3), `check:status-enum-parity` if any new status map, and the full
`npm test`. The Atlas pages for `wmkf_potentialreviewers` and
`wmkf_appreviewersuggestion` need a merge-behavior note (Chunk 2). No new Postgres
table in v1 (Option B), so no migration/Atlas-table gate.

## Out of scope for v1 (deferred, with rationale)

- **Engaged-loser merge** (collision-survivor logic, durable journal, tombstone,
  conditional survivor pick). Probe: 0 live ≥2-engaged clusters; revisit only if a
  future probe shows it's real.
- **Two-contact merge** (merging two CRM contacts + their downstream refs). Probe:
  3/4,294 rows promoted. A loser with a contact is blocked in v1.
- **Other entry points** (Find-card local editor / `upsertByEmail` /
  `save-candidates`) — merge is the saved-Candidates editor only in v1.
- **Bulk/auto dedup sweep** — staff-initiated, one pair at a time.

## How we got here (review trail)

design doc → Codex pre-impl (Q1–Q8, reshaped collision/ordering/journal) → folded →
Codex review of the consolidated plan (6 more catches: excluded-disposition,
tombstone, conditional-delete, concurrency, merge-only select, journal schema) →
folded → internal aggressive review (8 observations incl. the scope challenge) →
live probe (settled the scope) → Codex correctness adjudication (O1–O8: 5 RIGHT,
3 needs-qualification, scope cut endorsed with the comprehensive-predicate
condition) → this v1.
