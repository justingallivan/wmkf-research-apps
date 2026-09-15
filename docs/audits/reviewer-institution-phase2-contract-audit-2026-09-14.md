---
title: Reviewer Institution Auto-Resolution Phase 2 Contract Audit
domain: reviewer-identity
kind: audit
status: complete
summary: "Current identity outputs do not bind one person strongly enough for institution auto-resolution; a dormant server-side evaluator core now applies hardened provider rules, while authoritative loading/persistence and complete additional-affiliation COI inputs remain unwired."
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
the current providers can ever tell us, but no existing evidence output as
wired binds one person strongly enough for the institution auto-clear
population. PubMed and OpenAlex expose inputs that can support an
affiliation-independent decision only after a new evaluator recomputes them
under stricter person-binding rules. The stop rule in the implementation plan
is therefore **not triggered**, but no current anchor may be promoted directly.

The current runtime contract cannot safely authorize institution
auto-resolution. It reduces several different evidence paths to
`confirmed`/`probable`, the retained roster shape does not prove whether
affiliation contributed, and the existing affiliation-free-looking paths do
not fully cluster the cited works to one person. A bare status or current
anchor must remain insufficient. A dormant `independent-identity/v1` evaluator
core now implements the closed rules below through a required server-loader
boundary, but it has no runtime caller, roster projection, or receipt. Complete
additional-affiliation COI screening also remains absent at both save
boundaries. No flag or authority should change before those contracts are wired
and pass the frozen identity regressions.

A post-implementation adversarial review run through Claude CLI with first-party
OAuth found live-shape gaps in the first core draft. The corrected core now
checks raw OpenAlex bylines as well as normalized cluster names, rejects
truncated PubMed author pools, uses an unwindowed PubMed identity query, requires
proposal-citation or staff-entered source-work lineage, binds a hard ID to the
candidate's own exact-work authorship, rejects legacy boolean policy inputs,
checks future dates, wall-clock expiry, execution-context binding, and evidence
digest integrity, and treats malformed or incomplete coverage as partial. The
remaining OpenAlex merged-cluster limitation is the explicit
contract tradeoff described below: one complete full-forename cluster qualifies;
ORCID corroboration is not mandatory for that method.

## Independent-identity finding

The relevant question is whether the source author and intended candidate can
be bound as the same person after removing every contribution from the
affiliation under adjudication. No current output meets that test as wired.
Two existing provider paths contain the raw inputs for a new evaluator, with
the following required hardening:

1. **PubMed multi-work author verification.** Its query and status calculation
   do not use institution agreement, but initial-only bylines currently count
   toward the distinct-work minimum, and one full-forename article can promote
   the pooled set. PubMed supplies no parsed author identifier, so same-name
   works are not clustered to one person; affiliation extraction pools every
   matching byline as well. **[VERIFIED via
   `lib/services/discovery/name-matching.js:137-176,181-215`,
   `lib/services/discovery/affiliation.js:48-76`, and
   `lib/services/discovery/verification.js:134-170,194-261`]** The v1 method
   must count only works whose byline fully agrees with the candidate forename,
   bind affiliation assertions to those exact PMIDs, and bind all counted
   PMIDs to one OpenAlex author cluster or one ORCID works identity. Without
   that final cluster, the evidence is supporting rather than sufficient.
2. **Work-grounded author resolution.** The current exact-work resolver accepts
   initial-only byline matches and starts from `candidate.publications[0]`,
   which may be browser-carried or drawn from a same-name pooled result. The
   legacy full-forename rescue runs only after a failed affiliation/topic
   selection and searches a ten-record OpenAlex pool without treating a larger
   `totalCount` as an ambiguity gate. **[VERIFIED via
   `lib/services/reviewer-work-author-resolver.js:37-45,86-125` and
   `lib/services/reviewer-identity-evidence.js:510,528-579`]** The v1 method
   must run independently of the affiliation-selection branch, require full
   forename agreement, use only a server-held work with proposal-citation or
   staff-entered lineage, abstain when the reported
   result count exceeds the fetched pool, and digest the work ID, authorship
   index, author cluster ID, pool size, and total count. Track B discovery is
   currently disabled, so its resolver is a regression source rather than
   current production coverage. **[VERIFIED via
   `pages/api/reviewer-finder/discover.js:6-10`]**

An exact email or ORCID match can identify a stored CRM person, but the cited
strict re-read helper applies only to referred seeds. **[VERIFIED via
`lib/services/reviewer-finder/save-candidates-service.js:620-656`]** The general
save lookup has different semantics, and a CRM ORCID may itself have been
persisted from affiliation-dependent identity evidence. **[VERIFIED via
`lib/services/reviewer-finder/save-candidates-service.js:1043,1102-1146`]** A
hard-ID join can support `independent-identity/v1` only when the source side is
byline-asserted or its ORCID works list contains the exact work, and the CRM
identifier is staff-entered or carries its own independent receipt. Email has
no affiliation-free source-author path today and is `not_evaluable` in v1.
The dormant evaluator accepts only `staff_entered` CRM lineage until the later
receipt design can prove that an `independent_receipt` came from a disjoint
source rather than feeding the same evidence back into itself.

### Anchor audit

| Current signal | Affiliation dependence | `independent-identity/v1` treatment |
|---|---|---|
| Current PubMed full-forename/distinct-work verifier result | Affiliation-independent in its status calculation, but not person-binding because initial-only and namesake-pooled works can contribute | Supporting only. New v1 computation is `sufficient` only when every counted work has a full-forename byline, its PMID-bound affiliation is retained, and all counted works bind to one OpenAlex author or ORCID works identity |
| Current `authorship_grounded` anchor | Intended to be affiliation-independent, but it can accept an initial-only byline, consume an untrusted or pooled first publication, and miss candidates outside the fetched OpenAlex pool | `not_evaluable` as carried. New v1 computation is `sufficient` only with full-forename agreement, a server-held exact work, bound work/authorship/author-cluster identifiers, unconditional grounding, and a completely examined result pool |
| Exact CRM reviewer match by email or ORCID | Identifies the stored person; source and CRM lineage may still depend on affiliation | Email is `not_evaluable` in v1. ORCID is sufficient only when the source identifier is byline-asserted or its works list contains the exact work and the CRM identifier is staff-entered or independently receipted |
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
| Staff identity confirmation | Server-bound human authority, but institution mismatch can trigger the confirmation and the confirmation binds the affiliation string | Continue honoring it under the existing human-confirmation path; v1 returns `not_evaluable` and never labels it `excludesAffiliation=true` |

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
result: sufficient | insufficient | contradicted | not_evaluable
excludesAffiliation: true
method: pubmed_multi_work_author | exact_work_unique_author | forename_work_grounding | hard_id_join
resolverVersion: <closed allowlisted version>
requestBinding: <server-bound request>
candidateKey: <exact immutable roster key>
identityInputDigest: <name + source work/author/hard-id inputs>
evidenceDigest: <provider-derived method evidence only>
evaluatedAt: <server timestamp>
providerObservedAt: <server timestamp for the underlying provider evidence>
expiresAt: <no later than 14 days after the provider observation>
providerState: complete | partial | failed
```

`sufficient` is available only for the hardened automated methods above and
requires `providerState=complete`. `insufficient` means complete evidence did
not meet a sufficient rule without affirmatively disproving identity.
`contradicted` means evidence such as incompatible hard identifiers or a
conservative full-forename contradiction affirmatively indicates
a different person; it maps to the reject path rather than the confirm-identity
remedy. Missing lineage, an unknown evaluator version, partial or failed
provider work, a generic status, email-only evidence, or a staff confirmation
becomes `not_evaluable`.

Every v1 claim is mandatory: request binding, immutable candidate key, separate
server-input and provider-evidence digests, closed method and resolver versions, provider state,
evaluation time, and expiry. Undefined claims never compare as matches. Expiry
is tied to the provider observation and may not exceed the existing 14-day
attestation lifetime. The evaluator must make and account for its own provider
calls; any per-query failure makes `providerState=partial`. It must recompute
from provider responses fetched by the server or from a server-written roster
projection. Name, publications, ORCID, OpenAlex author ID, identity status, and
other browser-originating values are deny-only evidence.

## Where proof is lost today

| Boundary | Current behavior | Consequence |
|---|---|---|
| Discovery verification | Produces PubMed verification fields or typed identity anchors, but pools initial-only/same-name works and does not bind them to one person | Provider inputs exist, but no current output is sufficient for v1 |
| General contact enrichment | Produces a full nested identity decision and mints a request-bound signed attestation | The full decision can be server-bound for the current request |
| Applicant enrichment result | Projects only `contactEnrichment.identity.status` for a resolved candidate | Anchor types and lineage are removed before roster persistence |
| Roster pruning | Keeps status plus at most compact anchor `type`, `canonicalKey`, `sourceUrl`, and `verifier`; drops weight, verdict, parser output, top-level `identityEvidence`, `identityAnchors`, `nameEvidence`, and `verificationSource` | A reload cannot reconstruct whether affiliation contributed |
| Roster POST | Strips client copies of server authority, verifies the signed attestation, and may create an identity-only server receipt | Existing binding is useful, but it binds the generic identity decision rather than a separate affiliation-free result; the stored receipt has no expiry, and the JWT verifier permits missing roster-candidate and eligibility claims plus a base-digest fallback, so v1 cannot inherit those optional semantics |
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
The current receipt expiry and optional-claim behavior is verified in
`lib/services/reviewer-candidate-attestation.js:17,120-135,216-252` and
`lib/services/reviewer-finder/save-candidates-service.js:839-848`.

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
not invent one. ORCID `current` means only that no end date is recorded; the
dated-currentness policy must treat that interval as unbounded rather than as
proof observed at the current institution. **[VERIFIED via
`lib/services/orcid-service.js:274-283`]**

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

1. **Core implemented, integration pending:** the pure, total
   `independent-identity/v1` evaluator has only the closed sufficient methods
   above plus an explicit `contradicted` result. Its PubMed
   path uses an unwindowed query, counts only full-forename bylines, and clusters
   all counted PMIDs to one person. Its work-grounding path runs unconditionally,
   requires proposal-citation or staff-entered source-work lineage, and abstains
   unless the fetched OpenAlex pool is complete and contains no exact-name
   alternate cluster. Its hard-ID path
   excludes email, binds the source ORCID to the candidate's own exact-work
   authorship, and currently requires staff-entered CRM ORCID lineage. Test
   affiliation-only evidence, mixed evidence, common-name/initial-only cases,
   incomplete result pools, contradictory identity, source failures, unknown
   versions, stale or tampered digests, future-dated receipts, and all branches
   where lineage is missing. The
   implementation and focused tests are in
   `lib/services/independent-reviewer-identity.js` and
   `tests/unit/independent-reviewer-identity.test.js`; there is no runtime
   caller yet.
   The exported input-digest helper hashes only server inputs; provider-derived
   method evidence has its own digest so a later loader can detect source-input
   drift without copying authority from the stored receipt.
2. Compute the result on the server at the point where complete source evidence
   exists. The evaluator owns provider-state accounting, and `sufficient`
   requires a complete run. Treat all browser-originating identity fields and
   staff confirmations as deny-only for v1. Preserve a bounded projection
   through applicant output, general enrichment, roster storage, reload, and
   both saves; make every binding claim mandatory and expire the result no later
   than 14 days after the underlying provider observation.
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
7. Correct the stale comments that say `affiliationHistory` is screened by the
   current COI path in `lib/services/discovery/affiliation.js`,
   `lib/services/deduplication-service.js`, and
   `lib/services/discovery/verification.js` when implementing the actual
   history consumer.

No migration, feature-flag enablement, Preview deployment, or runtime authority
change was part of this audit.
