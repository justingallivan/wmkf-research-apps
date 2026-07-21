---
title: Adversarial Review — Reviewer Affiliation and Contact Reconciliation
domain: reviewer-finder
kind: audit
status: complete
summary: "Claude found the architecture sound with material revisions for cancellation, provisional ORCID handling, per-field institution evidence, and DTO wording."
canonical: false
owner: product-engineering
related:
  - docs/REVIEWER_AFFILIATION_CONTACT_RECONCILIATION_PLAN.md
---

# Adversarial Review — Reviewer Affiliation and Contact Reconciliation

**Reviewer:** Claude Code (Opus, high effort, read-only)

**Date:** 2026-07-21

**Verdict:** `SOUND WITH MATERIAL REVISIONS`

## Verified findings

### High: preserve the enrichment deadline

The initial plan did not explicitly thread the route's deadline through the new
reconciliation loop. `lookupReviewerIdentity` has no abort parameter and its
Dataverse reads are not abortable mid-request. A post-enrichment reconciliation
pass therefore needs to skip partial/timed-out result sets, check
`signal.aborted` between candidates, and issue no further Dataverse reads after
the deadline.

Evidence: `pages/api/reviewer-finder/enrich-contacts.js`,
`lib/services/contact-enrichment-service.js`, and
`lib/services/reviewer-identity-lookup.js`.

### Medium: the original ORCID gate could hide the Khalil duplicate

An exact lookup of Khalil's old BU email can confidently find only the old row.
The duplicate is visible through ORCID, but the initial plan allowed only an
identity-trusted ORCID. If the enriched OpenAlex identity is unresolved, that
rule withholds the very signal needed to expose the duplicate.

Revision accepted: a provisional OpenAlex ORCID may be used for read-only
conflict detection, but any hit maps only to `review_required`; it can never
produce `known` or authorize a write.

### Medium: the lookup currently collapses affiliation fields

The initial plan promised separate Dataverse institution evidence without
acknowledging that `reviewer-identity-lookup.js` currently collapses
`wmkf_primaryaffiliation || wmkf_organizationname` and omits the staff-confirmed
`wmkf_maininstitution`. The implementation must extend the compact lookup
projection to retain separate, labeled values without returning raw rows.

### Medium: pin the status mapping

The implementation contract must say explicitly:

- `known` if and only if a trusted exact-key lookup returns `confident`;
- `candidates` or `conflict` maps to `review_required`;
- `none` maps to `none`; and
- operational failure maps to `unavailable`.

A name-inconsistent exact row already returns `candidates` in the lookup core;
the new mapper must not reinterpret “a row was found” as known identity.

### Low: timestamp persisted evidence and keep it inside enrichment

Roster JSON survives reload, so the badge describes a search-time observation,
not necessarily current live Dataverse state. Include `checkedAt` and word the UI
accordingly. Nest the bounded evidence inside `contactEnrichment`, where the
existing merge and input-size boundary apply.

## Confirmed-safe properties

- The lookup core is read-only.
- Duplicate exact keys already return ambiguity/candidate evidence rather than
  auto-selection.
- Save-candidates independently repeats authoritative identity resolution and
  ignores the proposed evidence.
- The identity-attestation projection excludes the proposed field, so it cannot
  become signed save authority.
- COI recomputation precedes the display-only reconciliation evidence and is not
  altered by it.
- The roster stores a pruned JSON DTO, so no migration is required.

## Finding rejected after source verification

Claude questioned whether the route should use raw
`bypassDynamicsRestrictions` instead of `withDalContext`. That concern was based
on an outdated comment in `reviewer-identity-lookup.js`. The current canonical
helper explicitly wraps `bypassDynamicsRestrictions` and is already used by the
reviewer-lookup route. The plan correctly retains `withDalContext`.

Evidence: `lib/dataverse/core/context.js` and
`pages/api/workbench/reviewer-lookup.js`.

## Case coverage after revisions

- **David Weitz:** exact email contact match should surface the checked-during-
  search known-contact badge, subject to the existing name-consistency gate.
- **Ahmad Khalil:** provisional exact ORCID evidence may expose duplicate rows as
  review-required even when the old BU email alone finds one record.
- **Michael Jewett:** honest publication/OpenAlex labels improve the card
  unconditionally; separate Dataverse institution fields expose Stanford versus
  Northwestern when an exact key reaches the record.

## Required revisions accepted

1. Deadline/partial-run cancellation contract.
2. Provisional-ORCID review-only policy.
3. Separate bounded institution-field projection.
4. Explicit status mapping.
5. Timestamped, nested evidence.

With these changes, the plan is ready for implementation and focused tests.

## Post-implementation adversarial review

Claude Code performed a second read-only Opus/high-effort review of the actual
diff and returned `READY`, confirming the exact-key boundary, provisional-ORCID
review-only behavior, bounded ID-free DTO, deadline/partial sequencing,
`withDalContext` usage, attestation isolation, affiliation wording, and neutral
co-affiliation presentation.

Two medium hardening recommendations were accepted before completion:

1. The route now catches an unexpected reconciliation setup failure and continues
   to emit the successful enrichment result.
2. A probable/confirmed candidate no longer makes every attached ORCID trusted;
   the ORCID must match an accepted identity anchor. Otherwise any hit is
   review-only.

Additional tests now cover trusted-ORCID `known`, probable identity with an
unanchored ORCID remaining review-only, bounded conflict mapping with ID details
dropped, missing-key lookup skip, fail-open route behavior, and the known/review/
multiple-affiliation card states.
