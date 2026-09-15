---
title: Reviewer Institution Phase 2 Adversarial Review of d1c91ea6
domain: reviewer-identity
kind: audit
status: complete
summary: "Read-only adversarial review of commit d1c91ea6 on codex/ror-measurement-runs: one high (browser-asserted proposal-citation lineage), four medium, one red gate; verdict NEEDS REWORK before merge for the flag-off write deviations and the gate."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md
  - docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md
  - lib/services/reviewer-institution-evidence-attestation.js
  - lib/services/reviewer-independent-identity-runtime.js
  - lib/services/reviewer-institution-coi-screen.js
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/workbench/promote-applicant-reviewer-service.js
  - pages/api/reviewer-finder/discover.js
  - pages/api/workbench/reviewer-roster.js
---

# Adversarial review of d1c91ea6 (`Add dormant reviewer institution evidence flow`)

Reviewed diff: `git diff e2ea770e..d1c91ea6` on branch `codex/ror-measurement-runs`
(worktree `WMKF_Apps-codex`). Reviewer: Claude Fable 5.1, 2026-09-14, read-only,
`/contract-reconcile` Mode A. No files other than this report were written.
The plan and the Phase 2 contract audit were treated as requirements to verify,
not as evidence.

## Verdict

**NEEDS REWORK before merge** for findings 2, 3, and 6 (live flag-off behavior
changes and a red gate). Findings 1, 4, and 5 block flag enablement and the
Phase 3 claims but do not block merging a dormant path.

## Evidence base

- All eight touched Jest suites pass (209 tests) [VERIFIED via command].
- Scratch round-trip test (deleted afterward; worktree clean): a JWT minted on a
  raw discovery candidate still verifies after `pruneCandidateForRoster`, and a
  25th affiliation assertion is silently dropped [VERIFIED via command].
- Every `check:*` gate and self-test ran sequentially in the worktree: 64 runs,
  one red (finding 6) [VERIFIED via command].
- Migration 048 and `lib/db/migrations-manifest.json` are untouched by the diff
  [VERIFIED via `git diff --stat`]. "Not applied" is [ASSUMED per plan and
  runbook]; production Postgres was not read.
- Only `lib/services/reviewer-institution-evidence-attestation.js:41-43` reads
  `REVIEWER_INSTITUTION_PHASE2`, exact `'on'` only [VERIFIED via grep].

## Blocking defects

### 1. HIGH. Browser-asserted provenance becomes `proposal_citation` lineage

- **Files:** `lib/services/reviewer-independent-identity-runtime.js:34-42,54-57`;
  `lib/utils/reviewer-provenance.js:100-108,140-144,161`;
  `lib/services/discovery/verification.js:277`;
  `pages/api/reviewer-finder/discover.js:133-139`.
- **Scenario:** the discover request body's `analysisResult.reviewerSuggestions[i]`
  is spread verbatim into the verified candidate. `buildReviewerProvenance`
  returns a supplied `provenance` object unchanged, and `source: 'cited_reference'`
  reaches the same kind with `groundingWorkIds` falling back to the server-fetched
  publication ids. No server producer emits `cited_reference` today
  [VERIFIED via grep of `lib`, `pages`, `shared`]. The only way a discover
  candidate acquires that lineage is from the browser, and the adapter then
  labels it `proposal_citation`. The evaluator re-fetches the work and checks
  the byline, so a forged `sufficient` is not possible, but the browser chooses
  which namesake's work anchors the author cluster and earns a lineage label the
  service catalog says is "reconstructed server-side". This falsifies
  "browser-carried fields never gain identity authority".
- **Why tests miss it:** `tests/unit/reviewer-independent-identity-runtime.test.js`
  constructs `provenance` directly and treats it as server-owned. No
  discover-route test posts a suggestion carrying `provenance` or `source`.
- **Smallest safe fix:** have the adapter return `sourceWork: null` until a
  server-only marker exists (for example a field set through `origin.force` in
  `withReviewerProvenance` that the body spread cannot supply). Stripping
  `provenance` at the body boundary is the alternative but touches incumbent
  card labeling.

### 2. MEDIUM. Flag-off roster writes change shape through the COI-drop ledger

- **Files:** `pages/api/reviewer-finder/discover.js:59-72,260,392,493` versus
  the exact-off strip at `685-691`;
  `shared/components/reviewers/reviewer-search-logic.js:1159-1164`.
- **Scenario:** with the flag unset, `recordInstitutionCoiDrops` prunes and
  persists candidates before the exact-off strip runs. Producers now always
  emit `affiliationAssertions`, and the prune keeps them, so `coi_dropped`
  roster rows gain the new field today. The Atlas sentence "Exact-off omits
  these fields" is false for those rows. This falsifies "with the flag off,
  writes remain incumbent behavior".
- **Why tests miss it:** the exact-off discover test inspects only the `ranked`
  event.
- **Smallest safe fix:** apply `stripDormantInstitutionEvidence` inside
  `recordInstitutionCoiDrops` when the flag is off.

### 3. MEDIUM. PATCH paths persist browser evidence fields regardless of flag

- **Files:** `pages/api/workbench/reviewer-roster.js:145-158` (strip removes
  only the receipt), `459-468` (exclude), `239-262` (preserve passes browser
  fields through when no stored receipt exists), `296-325` (staff-authority
  re-prune keeps them).
- **Scenario:** a browser PATCH `exclude` carrying `independentIdentity`,
  `affiliationAssertions`, and the raw `institutionEvidenceAttestation` string
  writes all three into the roster row. No authority is gained because no
  receipt is minted, but this is a flag-independent durable write of unverified
  browser claims, and the Atlas "browser-authored POST/exclude blobs have staff
  authority stripped" statement is false for these fields.
- **Why tests miss it:** no PATCH test sends institution fields.
- **Smallest safe fix:** extract the POST destructure at `reviewer-roster.js:412-416`
  into a helper and call it in every PATCH path after
  `stripClientRosterAuthority`. POST must keep verifying against the pre-strip
  `compact`, so do not move the fields into `stripClientRosterAuthority`.

### 4. MEDIUM. Ordinary-save hold is bypassable through the legacy payload path

- **Files:** `lib/services/reviewer-finder/save-candidates-service.js:770-771,1119`.
- **Scenario:** under exact-on, a payload that omits both `candidateKey` and
  `automatedIdentityAttestation` is not roster-managed, so it never reaches
  `institution_evidence_required` or `institution_coi_incomplete`. The
  applicant path has no such exemption. This falsifies "ordinary and applicant
  saves enforce equivalent institution rules before any Dataverse mutation".
  The incumbent COI screen still runs on that path.
- **Why tests miss it:** no exact-on legacy-payload test exists.
- **Smallest safe fix:** under exact-on, reject non-roster-managed payloads
  with `institution_evidence_required`.

### 5. MEDIUM. Assertion cap truncates silently and reports clear

- **Files:** `lib/services/reviewer-institution-evidence-attestation.js:19,123`;
  `shared/components/reviewers/reviewer-search-logic.js` (`pruneAffiliationAssertions`
  slice); `lib/services/deduplication-service.js:238-240` (merge concatenates
  without dedupe).
- **Scenario:** a merged group with more than 24 assertions drops the extras.
  A current PI-institution assertion at position 25 never reaches the matcher
  and `additionalCoi` returns `clear` [VERIFIED via command].
- **Why tests miss it:** no over-cap test.
- **Smallest safe fix:** dedupe by source type, normalized text, and source
  reference in the merge, and mark the projection incomplete when the input
  exceeds the cap.

### 6. RED GATE. `check:drain-table-mentions`

- **File:** `docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md:217`
  names a drained reviewer-domain Postgres table without a same-line context
  annotation. The line predates d1c91ea6 (present at e2ea770e), but the
  reviewed commit edited that file and left the gate red. `main` is green.
- **Smallest safe fix:** add a same-line drain or historical context
  annotation to that sentence.

## Residual rollout prerequisites (not blocking merge of a dormant path)

- **Exact-on ordinary saves cannot succeed today.** No producer emits
  `currentness: 'current'` (`lib/services/discovery/affiliation.js:141` is always
  `unknown`; `lib/services/discovery/provenance.js:41` yields `historical` or
  `unknown`). Every candidate with author-specific assertions holds as
  incomplete, and every candidate without evidence has no receipt. The
  `REVIEWER_INSTITUTION_PHASE2` runbook entry should say that enabling the flag
  is an ordinary-save outage until the currentness policy lands. No positive
  exact-on save test exists.
- **Future ORCID end year is classified historical** (`provenance.js:41`),
  making a current appointment with a recorded future end date COI-inert.
  Compare `endYear` to the current year.
- **Assertions with `authorSpecific: 'unknown'`** are neither screened nor
  counted as incomplete (`lib/services/reviewer-institution-coi-screen.js:63-66`;
  `deduplication-service.js:790-792`). No producer emits that value today.
- **Applicant parity gap:** the applicant screen passes only the
  applicant-known reviewer's affiliation
  (`lib/services/workbench/promote-applicant-reviewer-service.js:481`), while
  ordinary save re-reads matched CRM reviewer affiliations.
- **Serial provider evaluation** in discover under exact-on runs one evaluator
  per ranked candidate against the deadline signal.
- **Test bypasses:** the promote test mocks the entire screen and flag modules;
  the save test mocks the receipt check; the roster test mocks JWT
  verification. None exercise the real store row mapping, though
  `candidateFromRow` does place the fields at top level
  [VERIFIED via `lib/services/reviewer-roster-store.js:48-62`].

## Invariants verified as holding

- The JWT binds request, candidate key, and a digest over the identity claims
  (request binding, candidate key, input digest, evidence digest, observation
  time, expiry) plus assertions
  [VERIFIED via `reviewer-institution-evidence-attestation.js:74-119,180-240`].
  Tampering, cross-request replay, expiry, and key replacement fail closed; the
  roster route compares against the final bound key
  [VERIFIED via `reviewer-roster.js:396-398`].
- The outer receipt cannot rebind an identity issued for another request or
  candidate [VERIFIED via `reviewer-institution-evidence-attestation.js:172-178,185,221,253`].
- Historical assertions never enter the signal set
  [VERIFIED via `deduplication-service.js:788-792`]. Unknown currentness holds
  at both save paths.
- Partial batch: each failure carries name, candidate key, and index and the
  loop continues [VERIFIED via `save-candidates-service.js:1119-1131,1165-1177`].
- Discover and enrich response DTOs are stripped or gated when the flag is off
  [VERIFIED via `discover.js:685-691,750-758`; `enrich-recommended-service.js:365-390,1211-1219,1268-1276`].

## Documentation overstatements

- `docs/SERVICE_AND_UTILITY_CATALOG.md`: the runtime adapter "reconstructs only
  proposal-citation lineage from server-produced candidates" (finding 1).
- `docs/atlas/postgres-reviewer-find-roster.md`: "Exact-off omits these fields"
  and "browser-authored POST/exclude blobs have staff authority stripped"
  (findings 2 and 3).
- Plan item 10 and audit follow-up item 5: "both save paths hold missing
  evidence" (finding 4).

## Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Null source work until a server marker exists | No server producer emits `cited_reference` | Yes, adapter line 54 | grep of producers | Any producer setting the kind server-side | VERIFIED |
| Strip in the COI-drop ledger when off | Strip helper exists at `discover.js:47` | Yes | Code-order read | Result event already stripped (it is) | VERIFIED |
| Strip helper in PATCH paths | Destructure exists at `reviewer-roster.js:412-416` | Yes | Code read | Stored receipt overriding browser fields (only when present) | VERIFIED |
| Reject legacy payloads under exact-on | `rosterManaged` derived at line 770 | Yes | Code read | NOT TESTED at runtime | ASSUMED |
| Dedupe and overflow flag | Merge at `deduplication-service.js:238` | Yes | Scratch cap test | None | VERIFIED |
