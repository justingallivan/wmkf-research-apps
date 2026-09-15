---
title: Reviewer Institution Auto-Resolution Phase 2 Contract Audit
domain: reviewer-identity
kind: audit
status: complete
summary: "Independent person identity is computable for bounded existing evidence paths, but the proof and complete additional-affiliation COI inputs do not yet survive to both save boundaries."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md
  - docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
  - lib/services/reviewer-identity-resolver.js
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/workbench/promote-applicant-reviewer-service.js
  - shared/components/reviewers/reviewer-search-logic.js
---

# Reviewer institution auto-resolution Phase 2 contract audit

## Decision

**[VERIFIED via the source trace below]** The project is not limited by what
the current providers can ever tell us. Existing source paths can establish the
same person without credit from the institution being compared. The stop rule
in the implementation plan is therefore **not triggered**.

The current runtime contract still cannot safely authorize institution
auto-resolution. It reduces several different evidence paths to
`confirmed`/`probable`, and the retained roster shape does not prove whether
affiliation contributed to that result. A bare status must remain
insufficient. The correct next implementation is a separate, server-computed
`independent-identity/v1` projection plus complete additional-affiliation COI
screening at both save boundaries. No flag or authority should change before
those two contracts exist and pass the frozen identity regressions.

## Independent-identity finding

The relevant question is whether the source author and intended candidate can
be bound as the same person after removing every contribution from the
affiliation under adjudication. Two existing automated evidence classes meet
that test in principle:

1. **PubMed multi-work author verification.** The verifier filters retrieved
   articles to the named author, requires the configured minimum number of
   distinct works, requires a full-forename match, and applies the namesake
   guard. Institution mismatch is calculated separately and is not included in
   `demotionReasons`; the resulting `verificationStatus` therefore does not
   depend on institution agreement. **[VERIFIED via
   `lib/services/discovery/verification.js:134-170,194-261`]**
2. **Work-grounded author resolution.** The Track B resolver locates one known
   work by external identifier or exact title, requires exactly one matching
   author on that work, and emits the strong `authorship_grounded` anchor. The
   resolver already classifies that anchor alone as `probable`. **[VERIFIED via
   `lib/services/reviewer-work-author-resolver.js:43-50,86-149,152-183` and
   `lib/services/reviewer-identity-resolver.js:262-269`]** The legacy spine also
   has an affiliation-free rescue that requires full-forename agreement, topic
   overlap in the selected author's works, and a unique grounded candidate.
   **[VERIFIED via `lib/services/reviewer-identity-evidence.js:223-295,399-409`]**
   Track B discovery is currently disabled, so its exact-work path is an
   available contract and regression source rather than current production
   coverage. **[VERIFIED via `pages/api/reviewer-finder/discover.js:6-10`]**

An exact email or ORCID match to an existing reviewer is also affiliation
independent as a CRM identity lookup. The ordinary save path already re-reads
the exact reviewer and accepts only a confident email/ORCID match to that
reviewer ID. **[VERIFIED via
`lib/services/reviewer-finder/save-candidates-service.js:620-656`]** It can
support `independent-identity/v1` only when the source-author assertion is bound
to the same email/ORCID. A CRM match by itself identifies the stored person; it
does not prove that a publication byline belongs to that person.

### Anchor audit

| Current signal | Affiliation dependence | `independent-identity/v1` treatment |
|---|---|---|
| PubMed full-forename, distinct-work verifier result | Independent; institution mismatch is a separate output | `sufficient` when the full verifier inputs, counts, namesake result, and source references are server-bound |
| `authorship_grounded` from exact work-to-unique-author resolution or the full-forename work-grounding rescue | Independent | `sufficient` when the method-specific work inputs, unique grounding result, author ID, and resolver version are server-bound |
| Exact CRM reviewer match by email or ORCID | Independent for the stored person | Supporting evidence only; sufficient for the source author only when the same hard identifier is bound on both sides |
| `openalex_author_orcid` | The OpenAlex lookup is hard-keyed, but the claimed ORCID's upstream origin may have used affiliation | `not_evaluable` unless a bound lineage proves the claimed ORCID was independently obtained |
| `openalex_author_spine` | Inherits a prior `confirmed`/`probable` status whose evidence mix is not carried | `not_evaluable` |
| `orcid_public` | ORCID name search may use affiliation to narrow multiple matches and may use a unique public-email tie break | `insufficient` alone; `not_evaluable` as proof of an affiliation-free selection |
| `orcid_public_institution_corroborated` | Explicitly affiliation-dependent | Excluded |
| `affiliation_match` | Explicitly affiliation-dependent | Excluded |
| `orcid_employment_corroborated` | Explicitly affiliation-dependent | Excluded |
| `scholar_profile` | Its pass/fail result includes an institution-mismatch check | Excluded |
| `topic_match` | The topic comparison is independent, but OpenAlex record selection may have used affiliation; weak alone | Excluded unless regenerated inside an affiliation-free evaluator; still insufficient alone |
| `orcid_present` | Identifier presence does not prove how that identifier was selected | Supporting evidence only with bound independent lineage |
| `cross_source_orcid_agreement` | Both selected records may have been chosen through affiliation-sensitive searches | `not_evaluable` without bound selection lineage |
| `orcid_name_confirmed` | The name check is independent, but the ORCID record selection may have used affiliation | `not_evaluable` without bound selection lineage |
| Works-first `works_first_orcid`, `works_first_openalex_fragment`, DOI, and ROR bundle | The current works-first resolver first narrows by the claimed institution; its ROR anchor includes the claimed institution | Excluded as a bundle from v1, even though individual DOI/author identifiers could support a future affiliation-free resolver |
| Staff identity confirmation | Server-bound human authority, but the current confirmation does not assert that affiliation was excluded from the judgment | Continue honoring it under the existing human-confirmation path; do not label it `excludesAffiliation=true` |

The affiliation-sensitive classifications above are source facts, not guesses:

- Scholar acceptance fails on `institutionMismatch`.
  **[VERIFIED via `lib/services/reviewer-identity-resolver.js:63-102`]**
- ORCID name search narrows multiple records by affiliation and may then break a
  tie by public-email availability; institution corroboration becomes a strong
  anchor. **[VERIFIED via `lib/services/orcid-service.js:407-477`]**
- OpenAlex spine acceptance reuses a prior persistable status rather than its
  evidence lineage. **[VERIFIED via
  `lib/services/reviewer-identity-resolver.js:121-177`]**
- The works-first resolver resolves the claimed institution and retains only
  bylines at that institution before binding an ORCID cluster. **[VERIFIED via
  `lib/services/reviewer-works-first.js:302-365,382-463`]**

### Required `independent-identity/v1` result

The first implementation should be deliberately narrow:

```text
version: independent-identity/v1
result: sufficient | insufficient | not_evaluable
excludesAffiliation: true
method: pubmed_multi_work_author | exact_work_unique_author | forename_work_grounding | hard_id_join
resolverVersion: <closed allowlisted version>
requestBinding: <server-bound request>
candidateKey: <exact immutable roster key>
identityInputDigest: <name + source work/author/hard-id inputs>
evaluatedAt: <server timestamp>
expiresAt: <bounded reuse window>
providerState: complete | partial | failed
```

`sufficient` is available only for the automated evidence classes above, plus a hard-ID
join that proves the source author and CRM person share the same independently
obtained identifier. `insufficient` means the available, complete evidence did
not meet one of those closed rules. Missing lineage, an unknown evaluator
version, partial provider work, stale inputs, or a generic status becomes
`not_evaluable`. The evaluator must recompute from server-held inputs or verify
a server receipt; browser-supplied values are deny-only.

## Where proof is lost today

| Boundary | Current behavior | Consequence |
|---|---|---|
| Discovery verification | Produces PubMed verification fields or typed identity anchors | Independent evidence exists at source |
| General contact enrichment | Produces a full nested identity decision and mints a request-bound signed attestation | The full decision can be server-bound for the current request |
| Applicant enrichment result | Projects only `contactEnrichment.identity.status` for a resolved candidate | Anchor types and lineage are removed before roster persistence |
| Roster pruning | Keeps status plus at most compact anchor `type`, `canonicalKey`, `sourceUrl`, and `verifier`; drops weight, verdict, parser output, top-level `identityEvidence`, `identityAnchors`, `nameEvidence`, and `verificationSource` | A reload cannot reconstruct whether affiliation contributed |
| Roster POST | Strips client copies of server authority, verifies the signed attestation, and may create an identity-only server receipt | Existing binding is useful, but it binds the generic identity decision rather than a separate affiliation-free result |
| Candidate selection | Uses `confirmed`/`probable` and the incumbent `institutionMismatch` boolean through the shared promotion projection | No consumer can distinguish an independently resolved person from an affiliation-promoted person |
| Ordinary save | Verifies the attestation or stored receipt, then uses the same generic decision to authorize contact/identity fields | The save boundary is server-bound but still lacks the semantic fact needed by the new policy |
| Applicant save | Reads the canonical roster row and applies the generic identity predicate or stored staff confirmation | It also lacks independent-identity proof |

These transitions are verified in
`lib/services/workbench/enrich-recommended-service.js:1145-1250`,
`shared/components/reviewers/reviewer-search-logic.js:967-1050,1120-1164`,
`pages/api/workbench/reviewer-roster.js:139-150,326-379`,
`lib/services/reviewer-candidate-attestation.js:73-134,188-275`,
`shared/components/reviewers/reviewer-search-logic.js:62-67,152-215`, and
`lib/services/reviewer-finder/save-candidates-service.js:780-895,987-1112`.

## Publication and employment currentness

The providers already expose much of the needed date information, but the
affiliation assertion does not retain it through the comparison:

- PubMed articles carry `year`; `_affiliationWeightsMap` associates each
  normalized affiliation with its most recent year, but
  `collectAffiliationHistory` returns only strings. The candidate's compact
  `publications` retain years but omit author affiliations, so the date cannot
  be joined back to an assertion after reload. **[VERIFIED via
  `lib/services/discovery/affiliation.js:48-79,105-110`,
  `lib/services/discovery/verification.js:283-305`, and
  `shared/components/reviewers/reviewer-search-logic.js:1142-1145`]**
- ORCID employment entries retain `startYear`, `endYear`, and `current`; the
  identity result converts them to organization-name strings, and applicant
  enrichment does the same when assembling resolved institutions. **[VERIFIED
  via `lib/services/orcid-service.js:265-312`,
  `lib/services/reviewer-identity-evidence.js:608-614`, and
  `lib/services/workbench/enrich-recommended-service.js:104-112`]**
- Stage 2 receives one `verificationInstitution`, marks undated PubMed/OpenAlex
  publication evidence `unknown`, and sets no observation date. This is honest
  but cannot support a dated current/historical decision. **[VERIFIED via
  `lib/services/workbench/enrich-recommended-service.js:115-168,803-805`]**

The later producer change must emit one typed assertion per affiliation with
its own source reference, exact year or employment interval, and observation
date. Missing or unbound dates remain `unknown`. The numeric publication
recency threshold remains an owner-reviewed policy decision; this audit does
not invent one.

## Additional-affiliation COI trace

### Discovery and applicant enrichment

Discovery can collect multiple PubMed affiliations in `affiliationHistory`,
and the identity spine can collect multiple ORCID employments. The
deduplication merge also unions affiliation history. **[VERIFIED via
`lib/services/discovery/affiliation.js:97-110`,
`lib/services/discovery/provenance.js:142-177`, and
`lib/services/deduplication-service.js:215-251`]**

The current COI evaluator does not consume that history. Its signal list is
limited to the primary affiliation, one current ORCID affiliation, and one
OpenAlex affiliation. **[VERIFIED via
`lib/services/deduplication-service.js:728-780`]** Applicant enrichment calls
that evaluator on the candidate list, so an additional byline or ended ORCID
employment never reaches the COI matcher. **[VERIFIED via
`lib/services/workbench/enrich-recommended-service.js:658-691`]**

### Ordinary save

The ordinary save path is server authoritative for the signals it has. Before
any person, researcher, or suggestion write, it:

1. loads the PI institution union;
2. screens the candidate payload's limited primary/current signals;
3. re-reads affiliations for exact matched or reused CRM reviewer identities;
4. fails closed when those server reads fail; and
5. rejects a non-exempt match.

**[VERIFIED via
`lib/services/reviewer-finder/save-candidates-service.js:693-716,240-470,1148-1214`]**
The gap is input completeness: `affiliationHistory`, typed byline segments, and
the full ORCID employment list are absent from
`institutionSignalsForCandidate`, while the roster projection has already
dropped most of them. A clear result therefore does not mean every relevant
additional affiliation was screened.

### Applicant promotion

The applicant route re-reads the canonical suggestion and roster row, checks
eligibility, identity, address, and canonical contact, then selects the
Dataverse suggestion. It never calls the institution COI matcher and never
rejects `hasInstitutionCOI` on the server. **[VERIFIED via
`lib/services/workbench/promote-applicant-reviewer-service.js:357-460,618-700`]**
The browser normally hides the selection control when `hasInstitutionCOI` is
true, but that is not a save-boundary control. **[VERIFIED via
`shared/components/reviewers/reviewer-search-logic.js:62-67`]**

This is a pre-existing defense-in-depth gap; no Phase 1 code widened it. It
becomes release-blocking for the proposed automatic-clear slice because the
new policy explicitly requires the same server decision at both save paths.

## Required implementation before Phase 3 authority work

1. Add a pure, total `independent-identity/v1` evaluator with only the closed
   sufficient methods above. Test affiliation-only evidence, mixed evidence,
   common-name/initial-only cases, source failures, unknown versions, stale
   digests, and all branches where lineage is missing.
2. Compute the result on the server at the point where complete source evidence
   exists. Preserve a bounded projection through applicant output, general
   enrichment, roster storage, reload, and both saves.
3. Introduce a typed affiliation assertion list. Each item must bind normalized
   segments to source, author specificity, source reference, and its own date or
   employment interval. Preserve successful segments when another segment
   fails, while returning `additionalCoi=incomplete` for the whole required
   screen.
4. Extend the existing COI input adapter to evaluate every required current
   additional segment. Preserve the existing direct-match and exemption rules.
5. Call the same fail-closed COI recomputation from applicant promotion before
   any contact write or suggestion selection. A missing, stale, failed, or
   incomplete assessment must hold without a Dataverse write.
6. Run the frozen 40-case identity benchmark, the Phase 1 synthetic policy
   fixture, new extra-segment COI tests, both save-path tests, roster reload and
   tamper tests, and flag-off equality before considering Phase 3.

No migration, feature-flag enablement, Preview deployment, or runtime authority
change was part of this audit.
