# Session 290 Prompt: Reviewer-merge UI (Chunk 4) + step-2 linker

## ⚠️ Top-of-session must-knows (S289)

1. **FOUR commits are UNPUSHED and the user has NOT approved a push.** Justin's
   standing instruction this session was *"No pushing until I approve."* Do NOT
   `git push` until he explicitly says so. Unpushed (oldest→newest):
   `612efee5`, `be7f624f`, `1a3b8c40`, `c41b7539`.
2. **`scripts/probe-rabinowitz-conflict.js` is UNTRACKED on purpose and must STAY
   untracked.** It hardcodes a real reviewer's email (`joshr@princeton.edu`) — the
   names-stay-local norm. Never `git add -A` it in. (`git add -A` staged it twice
   this session; both times it was unstaged before commit.)

## Session 289 Summary

Built the **reviewer-record merge** feature (v1 backend) to fix a prod dead-end a
colleague hit: editing a candidate's email to an address another
`wmkf_potentialreviewers` row already owns 412s on the `wmkf_emailaddress_unique`
alternate key, and the error told staff to "merge" the records with no way to do
it. v1 is a real **field-by-field merge** of two duplicate person records, scoped
to the safe case and fail-closed everywhere else.

### The three distinct problems (don't conflate them)

This session repeatedly untangled three different "duplicate" problems. v1 only
solves #1:

1. **`wmkf_potentialreviewers` ↔ `wmkf_potentialreviewers`** — duplicate reviewer
   person rows (the misspelled-email bug). **Built this session.**
   `docs/REVIEWER_MERGE_DESIGN.md`.
2. **`wmkf_potentialreviewers` ↔ `contacts`** — linking a reviewer to its CRM
   contact (the payment identity) and keeping them consistent. **Designed, not
   built.** `docs/REVIEWER_CONTACT_LINKER_DESIGN.md`.
3. **`contacts` ↔ `contacts`** — duplicate CRM contacts. **Connor owns this** via
   native Dynamics merge. Handoff + open questions:
   `docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md`.

### What Was Completed

1. **Probed the real duplicate population** (read-only prod probes, point-in-time):
   `scripts/probe-reviewer-duplicates.js` — 4,294 active person rows; 28
   ORCID-duplicate clusters, 27 fully pre-engagement, **0 with ≥2 engaged members**;
   only 3 of 4,294 promoted to a contact (all test rows). The dangerous cases the
   original design over-engineered (both-sides engaged on one request; two-contact
   merge) **do not occur in live data** → v1 deliberately handles only the safe case.
   The Rabinowitz conflict itself: two pre-engagement rows ("Joshua Ravinowitz"
   owns the email, "Joshua Rabinowitz" has 1 selected suggestion, neither engaged,
   different requests, **no collision**) — v1 handles it cleanly.

2. **v1 merge backend (chunks 1–3), `be7f624f`:**
   - `lib/services/reviewer-merge.js` (NEW) — `planMerge()` (read-only diff +
     fail-closed block predicate + repoint/collision plan) and `executeMerge()`
     (re-validates, resolves literals up front, then ordered: reconcile person
     fields → repoint non-colliding loser suggestions → conditional-delete
     collisions → email move → deactivate loser). Adapters are dependency-injected
     for testing (mirrors the honorarium orchestrator).
   - `lib/dataverse/adapters/potential-reviewer.js` — `MERGE_FIELD_SELECT`
     (wide read incl. wave6 biblio/identity), `getByIdForMerge`, `clearEmail`,
     `deactivate`.
   - `lib/dataverse/adapters/reviewer-suggestion.js` — `MERGE_PREDICATE_SELECT`,
     `findAllByPotentialReviewer` (NO `selected` filter — removed rows still hold
     the (person,request) key), `repointToPotentialReviewer`, `hardDeleteById`.
   - `lib/services/dynamics-service.js` — `deleteRecord` now takes optional
     `ifMatch` (conditional delete) + `.status` on the error.
   - `pages/api/reviewer-finder/merge-candidates.js` (NEW) — POST-only. POST
     `{keeperId, loserId}` → `{plan}`; POST `{…, fieldChoices, confirm:true}` →
     `{success, summary}`. `requireAppAccess(req,res,'reviewer-finder','reviewers')`
     (same as my-candidates — the **block predicate, not a permission gate**, keeps
     merge to the low-risk case so the colleague who hit the bug can fix it),
     GUID-validates both ids, `bypassDynamicsRestrictions`. 400/409/500 mapping.
   - Registered in `docs/API_ROUTE_SECURITY_MATRIX.md` + `docs/CANONICAL_COUNTS.md`
     (79 requireAppAccess endpoints / 134 route files) + `.claude-memory/`.

3. **Step-2 + Connor design capture (`612efee5`, `1a3b8c40`):** the linker design
   doc (capabilities A seen-before / B consistency-diff / C guarded PD contact-edit
   with the `akoya_requeststatus='Active'` active-award predicate, fail-closed /
   D idempotent linker) and the Connor contact-dedup handoff (Q1 reparent cascade,
   Q2 1:1 collision, Q3 loser→master GUID map for Postgres
   `bill_onboarding_state.reviewer_contact_id`, Q4 shared-inbox exclusions).

4. **Codex post-impl review folded (`c41b7539`).** Codex confirmed all four of my
   self-traced findings and surfaced two I missed. Folded as a follow-up commit
   (not an amend), full suite green (251 suites / 3185 tests):
   - **ITEM-3 empty-overwrite (P0):** `resolvePersonUpdates` wrote a null/empty
     loser value over a populated keeper value whenever the field "differed"
     (true for keeper-has / loser-empty). Worst case nulled the keeper's email.
     Fixed: `isSet()` guard on the resolver + the `emailMoves` gate; `isSet` now
     trims strings (whitespace-only = empty); hIndex 0 stays a real value.
   - **ITEM-1 double-submit (P0):** `executeMerge` was not idempotent — after run 1
     deactivated the loser, run 2's plan was no longer blocked and (with ITEM-3)
     could corrupt the keeper. Fixed: added `statecode` to `MERGE_FIELD_SELECT`
     (Codex wrongly assumed it was already there — it was NOT), surface
     `plan.loser.statecode`, refuse an already-inactive loser before any mutation.
   - **IND-A block-predicate gap (P1):** `wmkf_completedat`, COI/AI acks,
     selective-decline, revoked token, and reviewer-supplied stage-2a identity
     fields were absent from the engagement signal list. Added (fail-closed).
   - **ITEM-5 identity non-downgrade (P1):** instead of transplanting a loser's
     identity bundle, **block** (`loser_confirmed_identity`) when the loser is
     human-`confirmed` and the keeper is not — respects `researcher.js`'s
     sticky-confirmed invariant. Staff re-run with the verified record as keeper.
   - **Applicant-slot drift:** the code **blocks** when the loser sits in an
     `akoya_request` applicant slot; the original design said *repoint*. Kept the
     conservative block for v1 (Rabinowitz has no slot refs) and reconciled the
     design doc to match.

### Commits (all UNPUSHED — see top of file)

- `612efee5` - Add reviewer-merge v1 design, Connor contact-dedup handoff, dedup probes
- `be7f624f` - Reviewer merge v1 backend + route (chunks 1-3) — pre-engagement-loser merge
- `1a3b8c40` - Add reviewer<->contact linker design doc (S289 step-2 capture)
- `c41b7539` - Reviewer merge: fold Codex S289 post-impl review catches

## Potential Next Steps

### 1. Chunk 4 — UI merge mode in `CandidateEditModal` (the natural next build)
Backend is done and tested; the feature is not usable until the UI lands. On a 409
carrying `conflictingRecordId` (from `PATCH /api/reviewer-finder/my-candidates`),
switch the modal to merge mode: POST the plan, show the keeper selector
(default = more-engaged/fresher, **NOT** the email owner — see design §Keeper
selection), the field-by-field picker (keeper value vs loser value per field),
and — if `blocked` — the reasons explainer with no confirm button. Confirm →
`POST {…, confirm:true}` → refresh. Also handle **half-done email recovery**
(Option B): if a merge tore between clear-loser-email and set-keeper-email, the
keeper lacks an email; detect and prompt staff to re-enter. Spec: chunk 4 in
`docs/REVIEWER_MERGE_DESIGN.md`.

### 2. Deferred Codex P2 backend hardening (optional, design-doc'd)
From the post-impl review, not yet built (Justin's call whether any precede the UI):
- map mid-merge Dataverse 409/412 conflicts to a retryable 409 (currently 500);
- trim suggestion/request IDs out of the plan response if the UI doesn't need them;
- add an audit breadcrumb (`wmkf_notes` / timestamp) on keeper+loser at deactivate;
- **Chunk 5** — a non-mocked alt-key ordering probe against staging Dataverse on
  throwaway rows (mocked adapters reproduce neither alt-key enforcement nor 412).

### 3. Step-2 reviewer↔contact linker (BLOCKED on inputs — do not start cold)
`docs/REVIEWER_CONTACT_LINKER_DESIGN.md`. Blocked on: Connor's answers to Q1–Q4
(`CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md`), and a short probe of which
contact→request link fields count as "associated with an active award" before the
guard predicate (capability C) is finalized. Capabilities A/B (seen-before +
consistency-diff) are independent and could land earlier.

### 4. Carried from S288 (separate track — verify before acting)
- **Record real-replay human sign-off** (optional): set `humanReview.pass=true` in
  the private artifact and/or note in `docs/MODEL_CHANGE_STRATEGY.md` that the
  real-replay requirement was met 2026-06-24 (req 1002836, opus-4-8, 12/12, no
  fallback). `reviewer-finder` is already pinned to `claude-opus-4-8` in prod.
- **Logged-in Admin Models visual smoke** (still open): confirm the effective
  `reviewer-finder` row shows `claude-opus-4-8` / `cap ok` / `price ok`.

### 5. Historical carryovers from S285/S286 (UNVERIFIED — probe live state first)
Have ridden forward several sessions without re-verification; do NOT act before
probing: request `1002788` test-data triage/status revert; E2E of Restore Removed
Candidates + PD identity override; reviewer-portal review-upload design decision;
optional auto-on-award abstract cron.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-merge.js` | Core merge: `planMerge` (diff + fail-closed block predicate) + `executeMerge` (ordered, literals-first, re-run-safe). DI adapters. |
| `lib/dataverse/adapters/potential-reviewer.js` | `MERGE_FIELD_SELECT` (incl. `statecode`), `getByIdForMerge`, `clearEmail`, `deactivate`. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `MERGE_PREDICATE_SELECT`, `findAllByPotentialReviewer` (no selected filter), `repointToPotentialReviewer`, `hardDeleteById`. |
| `pages/api/reviewer-finder/merge-candidates.js` | POST-only plan/confirm route. |
| `docs/REVIEWER_MERGE_DESIGN.md` | v1 design; status = backend built (chunks 1-3), UI (4) + ordering probe (5) pending; Codex catches folded. |
| `docs/REVIEWER_CONTACT_LINKER_DESIGN.md` | Step-2 reviewer↔contact linker design (not built). |
| `docs/CONNOR_CONTACT_MERGE_AND_REVIEWER_LINKING.md` | Connor contact-dedup handoff + Q1–Q4. |
| `tests/unit/reviewer-merge-{service,adapters,route}.test.js` | 36 tests (incl. empty-overwrite, statecode re-run guard, confirmed-identity block). |
| `scripts/probe-rabinowitz-conflict.js` | UNTRACKED, names-local — the live conflict probe. Do not commit. |

## Testing

```bash
# Merge unit tests (36):
npx jest tests/unit/reviewer-merge-service.test.js tests/unit/reviewer-merge-adapters.test.js tests/unit/reviewer-merge-route.test.js

# Full suite (green this session: 251 suites / 3185 tests):
npm test

# Gates touched this session (all green):
npm run check:build-claim-freshness && npm run check:doc-symbol-refs \
  && npm run check:trust-boundary-guid && npm run check:fact-consistency
```

Known recurring local noise unchanged: the two known-red suites
`tests/unit/bill.test.js` and `tests/unit/discovery-verification-status.test.js`
(only these — confirm before chasing any red).

## Gotchas / Continuity

- **Push is gated on Justin's approval** (top of file). Pushing deploys the merge
  backend + route to Vercel prod; the feature has no UI yet, so the route is live
  but unreferenced by the client until Chunk 4 ships — harmless but inert.
- The merge **route is reachable** once pushed (POST-only, GUID-gated, block
  predicate fail-closed). It mutates nothing on a plan request; an execute is
  refused unless the loser is fully pre-engagement and not contact-promoted.
- The block predicate is the **load-bearing safety rule**, defined as a positive
  whitelist (a future lifecycle field defaults to *blocking*, never silently
  passing). Read the design's "block predicate" section before touching it.
- Email moves stamp keeper `wmkf_emailsource='manual'` → the invite-confidence gate
  reads that as **low** confidence (forces re-verification). Intentional.
