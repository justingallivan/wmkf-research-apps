---
title: Reviewer Affiliation and Existing-Contact Reconciliation Plan
domain: reviewer-finder
kind: plan
status: historical
summary: "Completed reconciliation implementation; retained as the historical design and evidence record."
canonical: false
owner: product-engineering
related:
  - docs/REVIEWER_DATA_MODEL.md
  - docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/postgres-reviewer-find-roster.md
---

# Reviewer Affiliation and Existing-Contact Reconciliation Plan

> **Completed outcome:** The affiliation and existing-contact reconciliation shipped in
> `3f0ff88b`. This document is retained for its implementation evidence.
>
> **Current routing:** Use [Reviewer Identity](agent-wiki/topics/reviewer-identity.md)
> for live identity/contact behavior and [Reviewer Workbench & Lifecycle](agent-wiki/topics/reviewer-workbench-lifecycle.md)
> for staff-facing behavior.

## Objective

Make reviewer cards answer two staff questions that the current search leaves
unclear:

1. Do we already know this person in Dataverse?
2. What kind of evidence supports the institution shown on the card?

The change must reduce verification work without turning stale Dataverse fields,
historical publication affiliations, or same-name matches into current identity
claims.

## Verified problem statement

The following production observations were made for Request `1002907` on
2026-07-21:

- Michael Jewett's card showed a Northwestern publication affiliation while the
  enriched email and suggested institution pointed to Stanford. Dataverse also
  contains conflicting institution fields across his records. `[VERIFIED via
  read-only production roster and Dataverse probes]`
- Ahmad S. Khalil's card showed Harvard but retained a Boston University email;
  Dataverse contains two potential-reviewer rows with the same ORCID, one old BU
  record and one current Harvard record. `[VERIFIED via read-only production
  roster and Dataverse probes]`
- David Weitz has an active Dataverse contact with the exact email displayed on
  the card, but the search card did not say that he was already known.
  `[VERIFIED via read-only production roster and Dataverse probes]`
- Stanford lists Michael Jewett as faculty, Harvard lists Ahmad (Mo) Khalil, and
  Harvard SEAS lists David Weitz with the same email found by the resolver.
  `[VERIFIED via first-party institutional pages]`

The code explains the behavior:

- Discovery initializes candidate affiliation from publication evidence, and
  contact enrichment labels that default `pubmed_recency`.
  `[VERIFIED via lib/services/contact-enrichment-service.js]`
- Only identity-trusted ORCID or OpenAlex evidence can replace that affiliation;
  unresolved identities keep the publication affiliation.
  `[VERIFIED via lib/services/contact-enrichment/tiers.js]`
- Search-time enrichment does not perform a general Dataverse contact lookup.
  Its existing persistence path checks only for a potential-reviewer row with
  the enriched email and does not expose the result to the card.
  `[VERIFIED via lib/services/contact-enrichment/persistence.js]`
- The full ORCID → email → name Dataverse identity lookup currently runs at
  referred-seed/manual/save boundaries, not for ordinary enriched search cards.
  `[VERIFIED via lib/services/reviewer-identity-lookup.js,
  pages/api/reviewer-finder/discover.js, and
  lib/services/reviewer-finder/save-candidates-service.js]`
- The card labels ORCID/OpenAlex pins as current, while the ordinary PubMed
  default carries no visible provenance. `[VERIFIED via
  shared/components/reviewers/ReviewerSearchSection.js]`

## Safety invariants

1. A name-only Dataverse match must never produce a “known contact” badge,
   alter an email, alter an affiliation, or affect selectability.
2. Search-time reconciliation is read-only. It must not create, link, merge, or
   update Dataverse records.
3. Duplicate exact keys, ORCID/email splits, name inconsistency, and reverse-link
   collisions are review evidence, never auto-selection instructions.
4. Dataverse affiliation fields are evidence, not an automatic current-
   affiliation override. The live Jewett and Khalil records demonstrate why.
5. Existing save-time identity resolution and linking remain authoritative and
   unchanged.
6. A reconciliation failure is fail-open for search availability and fail-closed
   for the badge: the card receives no “known” claim when the lookup fails.
7. Roster persistence must retain the compact evidence required to render the
   same card after reload, without persisting raw Dataverse rows or granting new
   save authority.
8. Existing time-budget abort behavior, result ordering, COI recomputation, and
   partial enrichment behavior must remain intact.
9. An ORCID from an unresolved OpenAlex author may reveal a possible duplicate,
   but it must never create a `known` claim. Only identity-trusted exact keys may
   do that.

## Proposed implementation

### 1. Add an exact-key-only mode to the existing identity lookup

Extend `lookupReviewerIdentity` with an optional policy that disables the final
name-search fallback. The default remains unchanged for manual-add, referred-seed,
and save-time callers.

The search reconciliation caller may pass:

- the enriched email, when present; and
- an identity-trusted ORCID; or
- a provisional OpenAlex ORCID for conflict detection only.

If neither exact key exists, skip reconciliation. If exact-key lookup returns
candidate ambiguity or a conflict, preserve that outcome as review evidence.
Never continue to `searchByName` in this mode. A provisional ORCID can map only
to `review_required` or `none`, even if it finds a single name-consistent row;
it can never map to `known`.

The status mapping is fixed, not heuristic:

- `known` if and only if the lookup outcome is `confident` and the winning exact
  key is identity-trusted;
- `review_required` for `candidates`, `conflict`, or any provisional-ORCID hit;
- `none` for a completed exact-key miss; and
- `unavailable` for an operational failure or deadline skip.

### 2. Reconcile enriched candidates before the response is signed

After contact enrichment and COI recomputation, but before sending the SSE
completion event, run a read-only, sequential Dataverse reconciliation pass
inside `withDalContext`. `[VERIFIED: withDalContext is the canonical post-auth
wrapper over bypassDynamicsRestrictions in lib/dataverse/core/context.js; no raw
bypass import is needed in the route.]`

Sequential execution is deliberate: reviewer searches already create bursty
external traffic, and the new pass must not turn one result set into a parallel
Dataverse spike. It also keeps the original candidate order intact.

The pass receives the route's `AbortSignal`. It checks `signal.aborted` before
every candidate, performs no further Dataverse reads after abort, and is skipped
entirely when enrichment already returned `partial`/`timeout`. Skipped candidates
receive bounded `unavailable` evidence. The identity lookup itself does not
currently make its Dataverse reads abortable, so the contract is cancellation
between candidates, not mid-request.

Attach a compact `contactEnrichment.dataverseContactEvidence` object to each
enriched candidate:

- `status`: `known`, `review_required`, `none`, or `unavailable`
- `matchKey`: `email` or `orcid` when an exact key was evaluated
- `recordKinds`: bounded values such as `contact` and `potential_reviewer`
- `nameConsistent`: boolean when supplied by the identity lookup
- `institutions`: bounded, de-duplicated evidence entries from matching
  potential-reviewer records, preserving field provenance (`staff_confirmed`
  from `wmkf_maininstitution`, `primary_affiliation` from
  `wmkf_primaryaffiliation`, or `organization` from `wmkf_organizationname`)
- `reason`: a bounded enum for ambiguity/conflict; no raw error text
- `checkedAt`: the reconciliation timestamp, so a roster-reloaded card does not
  imply a live Dataverse read

Extend the existing lookup's additive context/reference projection to retain
those three institution fields separately. Do not expose the raw Dataverse row.
This is required to reveal within-record disagreements such as Jewett's; the
current lookup collapses the fields to one affiliation value.

Do not send Dataverse record IDs, raw rows, or this evidence into the automated
identity attestation. It is staff-facing context, not authority for a save.

### 3. Preserve evidence through merge and roster reload

Nest the compact evidence inside `contactEnrichment`, where existing input-size
bounds and `mergeEnrichment`'s safe spread already apply. Add it to:

- `mergeEnrichment`, so it reaches live cards;
- `pruneCandidateForRoster`, with strict field and array bounds; and
- the existing opaque roster persistence path, so prior-search cards render the
  same evidence after reload.

No schema or migration is required because the roster candidate is JSON.

### 4. Make affiliation provenance honest and visible

Change card wording without changing ranking or COI policy:

- `pubmed_recency`: `publication affiliation`
- `orcid_current`: `current (per ORCID)`
- `openalex_current`: `last known (per OpenAlex)`
- legacy `scholar_current`: `reported by Scholar` (do not strengthen the legacy
  claim)
- staff/manual sources: `staff confirmed` where that provenance is already real

When exact-key Dataverse evidence contains multiple institution values, show a
compact note that lists the bounded values and sources and says they may reflect
co-affiliations or history. Do not assert an identity error, choose one value as
current, or block selection solely because affiliation sources differ.

When `status=known`, show “Known in Dataverse by exact email/ORCID,” with the
`checkedAt` date available as “checked during this search.” When the exact key is
ambiguous, conflicting, or provisional, show “Dataverse identity needs review.”

### 5. Keep correction and deduplication out of this change

This implementation will not automatically merge the two Khalil records, replace
old emails, or rewrite Jewett's affiliations. Those are data-curation operations
with a different authorization and rollback surface. The new evidence will make
those cases visible and prevent the UI from silently presenting one stale source
as settled truth.

## Caller → persistence → consumer trace

1. `ReviewerSearchSection.runSearch` calls
   `/api/reviewer-finder/enrich-contacts` for all retained candidates.
2. `ContactEnrichmentService.enrichCandidates` produces one ordered enriched
   result per input candidate.
3. The route recomputes institution COI, then performs exact-key Dataverse
   reconciliation unless the run is partial/timed out. The reconciliation field
   is outside the existing automated identity-attestation projection and grants
   no save authority.
4. The browser's `mergeEnrichment` promotes the compact evidence to the card.
5. `pruneCandidateForRoster` stores only the bounded render DTO in
   `reviewer_find_roster.candidate`.
6. Roster GET returns the same compact DTO; `CandidateCard` renders identical
   provenance and known-contact state after reload.
7. `save-candidates-service` still performs its own authoritative identity
   lookup and write/link logic. Search evidence does not bypass that gate.

## Tests and verification

### Unit and route tests

- Exact-key-only identity lookup does not call either adapter's `searchByName`.
- Default lookup behavior still falls back to name for existing callers.
- Exact email contact match maps to `known` without exposing record IDs.
- Exact email/ORCID ambiguity or split maps to `review_required`.
- Name-inconsistent exact match never maps to `known`.
- Missing keys skip Dataverse calls.
- Per-candidate lookup failure maps to `unavailable` and does not fail the SSE
  result set.
- A partial/timed-out enrichment performs no reconciliation reads.
- An aborted reconciliation stops before the next candidate and issues no
  post-deadline reads.
- A provisional ORCID hit can only map to `review_required`, never `known`.
- Duplicate provisional ORCID rows reproduce the Khalil-shaped review signal.
- Reconciliation preserves result order and runs sequentially.
- Merge/prune/reload preserves only the bounded compact evidence.
- Separate staff-confirmed, primary-affiliation, and organization values survive
  the compact projection; raw rows and record IDs do not.
- Card source labels distinguish publication, ORCID-current, and OpenAlex-last-
  known evidence.
- Card displays known/contact-review and institution-disagreement states.

### Regression gates

- Focused identity-lookup, enrich-route, reviewer-search-logic, roster, and card
  tests
- `npm run check:dataverse-access-layer`
- `npm run check:route-service-boundary`
- `npm run check:api-routes`
- `npm run lint`
- `npm run build`

### Live verification (after deliberate production promotion)

Re-run Request `1002907` and confirm:

- David Weitz is visibly known by exact email.
- Michael Jewett's publication affiliation is no longer implied to be current,
  and the Stanford/Northwestern evidence disagreement is visible.
- Ahmad Khalil's Harvard/BU evidence disagreement is visible; duplicate exact
  identity evidence is not auto-merged or silently resolved.

## Definition of done

- All safety invariants above are covered by tests.
- Claude's adversarial review (`docs/audits/reviewer-affiliation-contact-
  reconciliation-adversarial-2026-07-21.md`) has been reconciled into this plan
  before code is written.
- The implementation passes focused tests and relevant gates.
- A fresh post-implementation adversarial review finds no unresolved blocking or
  high-severity issue.
- No production data is mutated and no production cutover occurs without a
  separate explicit approval.

## Implementation outcome — 2026-07-21

Implemented on `codex/reviewer-affiliation-reconciliation` with the reviewed
safety constraints:

- exact-key-only lookup preserves default name fallback for existing callers but
  disables it for search-card reconciliation;
- a trusted ORCID must be named by an accepted identity anchor; every other
  enriched/OpenAlex ORCID is review-only;
- the reconciliation pass is sequential, deadline-aware, partial-run-aware, and
  fail-open for search availability;
- compact evidence contains no Dataverse IDs or raw rows and remains outside the
  attestation/save-authority projection;
- PubMed, OpenAlex, ORCID, Scholar, and staff affiliation labels now state the
  strength and currency each source actually supports; and
- multiple Dataverse institution values are presented as possible co-affiliation
  or history, not asserted to be an identity error.

Verification completed locally:

- 113 focused tests passed across identity lookup, reconciliation, enrich route,
  roster pruning/merge, and card rendering;
- the full Jest suite passed (499 suites, 5,906 tests); an existing metrics unit
  test was made provider-independent so it no longer performs live PubMed retries;
- Dataverse access-layer gate + self-test passed;
- route/service boundary gate + self-test passed;
- API-route security gate + self-test passed;
- docs catalog regenerated and passed;
- lint passed with existing warnings only; and
- production build passed.

The planned live Request `1002907` verification remains a post-deployment step;
this branch has not been pushed, merged, or deployed.
