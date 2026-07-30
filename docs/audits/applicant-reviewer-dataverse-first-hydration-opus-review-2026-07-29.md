---
title: Applicant Reviewer Dataverse-First Hydration — Claude Opus Adversarial Review
domain: reviewer-identity
kind: audit
status: complete
summary: "Read-only Claude Opus review of the first hydration-plan draft; verdict NEEDS REWORK with three P0 blockers and eight additional named changes."
canonical: false
cataloged: 2026-07-29
owner: product-engineering
related:
  - docs/APPLICANT_REVIEWER_DATAVERSE_FIRST_HYDRATION_PLAN.md
  - docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md
---

# Applicant Reviewer Dataverse-First Hydration — Claude Opus Adversarial Review

## Review contract

- **Reviewer:** Claude Opus
- **Effort:** high
- **Mode:** read-only; no file edits
- **Date:** 2026-07-29
- **Subject:** first draft of
  `docs/APPLICANT_REVIEWER_DATAVERSE_FIRST_HYDRATION_PLAN.md`
- **Requested focus:** exact GUID anchoring, duplicate risk, persisted-contact
  authority, shared contact projection and attestation, email action, stored vs.
  enriched contact, identity/COI non-bypass, partial SSE behavior, stale UI
  state, cache versioning, schema/docs/gates, and fall-through cases.

## Verdict

**NEEDS REWORK.**

Opus confirmed the core exact-GUID hydration thesis but found that the first
draft's authority representation and several claimed prerequisites were unsafe
or false in current source.

## Findings

### P0

1. **Changing the shared contact projection would invalidate in-flight v3
   attestations.**
   `contactAttestationProjection` hashes `projectReviewerContact`; the v3 digest
   is verified for receipts with a 14-day TTL. Adding a serialized
   `contactAuthority` value to the default projection could make existing
   receipts fail `claim_mismatch`.
   Evidence:
   `lib/services/reviewer-candidate-attestation.js:17-20,100-122,167-217`.

2. **The applicant-ingestion GET lacked a stale-request guard.**
   `runIngestion` wrote state after its await without checking
   `requestIdRef.current`. A request-A response could render richer applicant
   contact data under request B after navigation.
   Evidence:
   `shared/components/reviewers/ReviewerFindPanel.js:107-120`.

3. **The proposed evidence field and badge collided with an existing contract.**
   `contactEnrichment.dataverseContactEvidence` and “Known in Dataverse by
   exact email/ORCID” already mean a search-time exact-key reconciliation, not
   exact applicant-slot linkage.
   Evidence:
   `lib/services/reviewer-contact-reconciliation.js:101-171`;
   `shared/components/reviewers/ReviewerSearchSection.js:298-307`;
   `shared/components/reviewers/reviewer-search-logic.js:638`.

### P1

1. `contactAuthority` and the proposed known-person field were absent from the
   roster allowlist, while the existing top-level prune could preserve an
   address without its canonical stored source. Evidence:
   `shared/components/reviewers/reviewer-search-logic.js:591-741`.
2. Calling `emailConfidence(person)` directly could classify a Dataverse row
   with an omitted null email attribute as `quick_check`. The caller must pass
   an explicit normalized `email:null`. Evidence:
   `lib/utils/reviewer-invite.js:159-201`.
3. Blocking `research_only` at promotion was a new restriction, not preserved
   behavior. Current promotion checks only email presence; send blocks later.
   Evidence:
   `lib/services/workbench/promote-applicant-reviewer-service.js:293-315`;
   `lib/services/reviewer-finder/send-emails-service.js:447-450`.
4. When person reads become load-bearing, the existing
   `suggestions.length === 0` branch could emit a false clean empty completion
   if all reads fail. Existing SSE progress frames also lacked per-row
   identifiers. Evidence:
   `lib/services/workbench/enrich-recommended-service.js:287-314`.

### P2

1. Changing shared contact-projection semantics would affect
   `save-candidates`, attestation, applicant backfill, the email reconciler,
   and repair/backfill scripts—not only this applicant path.
2. `findByEmailCandidates` may return one inactive row as `result.one` when
   there is no active owner. A caller must inspect `row.statecode`, not treat
   `one` as active. Evidence:
   `lib/dataverse/adapters/potential-reviewer.js:112-129`.
3. Hydration must occur outside the existing suggestion-materialization
   `try/catch`; otherwise a successful write followed by a read failure is
   falsely classified as materialization failure. Evidence:
   `lib/services/workbench/applicant-reviewers-service.js:105-128`.

### P3

The gate list needed:

- unconditional `check:dataverse-access-layer`;
- contact-attestation compatibility coverage;
- roster prune/read round-trip coverage; and
- reconciliation of `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`.

## Confirmed decisions

- Exact applicant-slot person GUID is the only reuse anchor.
- A distinct persisted-person reuse decision is necessary because
  `emailPersistAllowed` governs new automated writes.
- Source-null email remains `quick_check` and may promote under current
  semantics; the send acknowledgement remains authoritative.
- Stored/new email disagreement must not overwrite or relabel the shared
  person.
- Identity and current-request COI remain mandatory.
- Incrementing the applicant enrichment cache version is appropriate when
  Phase 3 changes roster semantics.
- No schema, migration, new route, or new Atlas entity is required.

## Required changes supplied by Opus

1. Preserve or version the attestation-bound shared projection.
2. Represent applicant persisted-contact authority outside the default shared
   projection.
3. Add the missing GET request-switch guard before returning richer data.
4. Rename the evidence field and badge.
5. Preserve the applicant email/source pair through roster prune/read.
6. Normalize null email explicitly before `emailConfidence`.
7. Specify and fix the all-person-read-failed SSE behavior.
8. Declare or avoid the new `research_only` restriction.
9. Place hydration outside the materialization `try/catch`.
10. Inspect inactive `statecode` after an email-owner lookup.
11. Make the DAL gate unconditional and update the enforcement-contract doc.

## Disposition

The plan was revised in place rather than appending contradictory correction
notes. It now uses:

- an applicant-specific canonical-contact projection;
- unchanged shared contact/attestation behavior;
- `applicantKnownReviewer` and “Existing linked reviewer record”;
- bounded roster persistence for the stored email/source pair;
- explicit null normalization and inactive-state checks;
- current `research_only` promotion semantics with unchanged send blocking;
- structured per-row SSE failure results; and
- the missing request-switch, attestation, roster, gate, and documentation
  requirements.

No implementation was performed as part of the review.
