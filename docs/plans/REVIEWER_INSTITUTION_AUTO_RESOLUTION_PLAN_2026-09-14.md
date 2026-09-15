---
title: Reviewer Institution Auto-Resolution — Policy, Labels, and Tests Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Implement a narrow, server-authoritative institution auto-resolution slice that removes safe department and multi-affiliation holds while preserving identity, COI, current-discrepancy, and provider-failure safeguards."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
  - docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md
  - docs/audits/institution-affiliation-source-recovery-2026-09-14.md
  - docs/audits/institution-affiliation-last-cycle-baseline-2026-09-14.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - lib/services/institution-affiliation-assessment.js
  - lib/services/reviewer-institution-auto-resolution-policy.js
  - lib/services/reviewer-institution-measurement.js
  - tests/fixtures/reviewer-institution-auto-resolution/v1/policy-regression.json
---

# Reviewer institution auto-resolution — policy, labels, and tests

## Objective and owner direction

Reduce human input for institution-affiliation cases that require no judgment:
aliases, departments, and verified constituent units of the same institution,
plus multi-affiliation evidence that contains a compatible segment. Preserve
human review for uncertain identity and make genuine current discrepancies
visible with a usable correction path.

This plan does not seek to eliminate staff review. It changes which cases ask
for it.

## Current truth

1. **[VERIFIED via `lib/services/institution-affiliation-assessment.js:15-57,
   245-319,346-451`]** The versioned relationship vocabulary, source/time
   context, multi-segment comparison, and total per-consumer policy evaluator
   already exist. Stage 2 callers may use only notification and candidate-card
   projections. Candidate selectability, automated writes, and identity-anchor
   weighting remain unauthorized.
2. **[VERIFIED via `lib/services/institution-affiliation-assessment.js:322-335`]**
   The evaluator accepts a versioned identity result carrying an
   `excludesAffiliation=true` assertion. That is a contract check, not proof
   that the upstream evaluator actually excluded affiliation. No runtime caller
   currently invokes the evaluator for a high-authority consumer.
3. **[VERIFIED via `lib/services/reviewer-institution-measurement.js:66-98`]**
   The source-built prospective measurement writer trusts typed assessment
   fields only for `server_applicant` events. General discovery roster events
   are browser-returned `roster_unverified` observations and therefore cannot
   carry relationship authority.
4. **[VERIFIED via
   `lib/db/migrations/048_reviewer_institution_measurement_events.sql:1-29`]**
   The measurement schema currently enforces
   `independent_identity=not_evaluable`, `additional_coi=not_screened`, and
   `proposed_action=not_evaluable`. It cannot be interpreted as an automatic
   clear score.
5. **[VERIFIED via
   `docs/audits/institution-affiliation-source-recovery-2026-09-14.md:85-105`]**
   The byte-preserved 26-case owner exercise produced 22 same-person, two
   different-person, and two unknown labels; institution comparison produced
   19 same and seven distinct labels. The intake was deliberately varied and
   is not representative or a completed acceptance corpus.
6. **[VERIFIED via the private adjudication import]** At least one wrong-person
   case had internally consistent institution evidence for that wrong person.
   Institution agreement must therefore remain downstream of independent
   identity authority.
7. **[PLANNED]** No Stage 3 behavior change, flag enablement, migration apply,
   or enduring Preview deployment is authorized by this plan.
8. **[VERIFIED via `lib/services/workbench/enrich-recommended-service.js` and
   focused tests]** Undated PubMed/OpenAlex affiliation evidence now enters
   Stage 2 as `unknown`, not `historical`. Publication dates must be carried and
   interpreted by an explicit source policy before any dated assertion may be
   labeled current or historical.
9. **[VERIFIED via `lib/services/independent-reviewer-identity.js` and focused
   tests]** The dormant `independent-identity/v1` evaluator core now implements
   the four outcomes, closed PubMed/OpenAlex/ORCID methods, server-loader-only
   evidence intake, provider completeness, full-forename and author-cluster
   grounding, mandatory binding fields, and the 14-day maximum. It has no
   runtime caller, roster projection, receipt, or save authority.

## Change surface

- **Entry points:** server reviewer discovery/enrichment, roster upsert and
  reload, candidate-card projection, candidate selection, and the server save
  boundary.
- **Persistence:** the existing `reviewer_find_roster.candidate` server-owned
  projection and the append-only
  `reviewer_institution_measurement_events` observation table. Select the exact
  storage shape only after verifying whether migration 048 has been applied in
  any environment.
- **Consumers:** candidate card, selection controls, ordinary and
  applicant-recommended save paths, staff notification, measurement report,
  cleanup, and future identity-anchor weighting.
- **Existing behavior retained:** Stage 2 presentation, the COI matcher,
  exact-address attestation, eligibility/deceased handling, and all incumbent
  high-authority decisions while the Stage 3 flag is off.

## Policy contract

Relationship truth, person identity, currentness, and COI are independent
inputs. The system evaluates them in this order:

1. validate the server binding and source version;
2. evaluate independent person identity without affiliation evidence;
3. resolve and segment all author-specific affiliation assertions;
4. classify the organization relationship and evidence currentness;
5. screen every relevant additional affiliation for institution COI;
6. produce the institution action; and
7. combine it with eligibility, contact, address, coauthor, and other existing
   gates for the final candidate action.

| Inputs | Institution action | Final candidate effect |
|---|---|---|
| `same` from author-specific evidence | Clear the institution concern automatically | Continue only if every separate identity, COI, eligibility, contact, and address gate passes |
| Verified, unambiguous constituent `parent_child` with `parentChildKind=verified_constituent` | Clear the institution concern automatically | Same separate-gate requirement |
| Compatible segment plus additional affiliations; complete extra-affiliation COI screen is clear | Clear the institution concern and retain the additional affiliations as evidence | Continue through remaining gates |
| Compatible segment plus an additional-affiliation COI conflict | Clear the comparison mismatch but hold for COI | Show the conflicting institution and the existing COI disposition |
| Compatible relationship but identity insufficient or unavailable | Clear only the institution concern | Hold for the existing identity-confirmation remedy |
| Independent identity is `contradicted` | Do not use the affiliation comparison to rescue the candidate | Reject through the identity/eligibility path and show the different-person reason |
| Current author-specific `sibling`, `distinct`, or unresolved concurrent `related_other` | Surface a current discrepancy | Hold until staff confirms the right person/institution, records a joint appointment, corrects the record, or chooses Not a fit |
| Historical `sibling` or `distinct` | Treat as career history | Neutral when independent identity is sufficient; otherwise retain the identity hold |
| Difference with unknown time | Do not claim a current conflict | Neutral only under the existing conditional-neutrality rule; never count as an automatic institution clear |
| Provider failure or unresolved organization | Record comparison unavailable and retry | Never manufacture match/mismatch evidence; independent identity may keep the candidate otherwise usable, but this is not an institution auto-clear |
| Different person, even when institution strings agree | Reject the evidence for the intended candidate | Hold or mark ineligible through the identity/eligibility path |
| Unknown policy value, stale binding, missing required COI result, or tampered browser field | Fail closed | Hold with an operator or retry remedy |

The first live slice includes only author-specific `same` and `parent_child`
whose separate source-owned subtype is `verified_constituent`. A generic typed
parent/child edge does not establish that subtype: system-to-campus and
unclassified parent/child pairs remain held. `Sibling`, `related_other`, an
unidentifiable subunit, shared umbrella text, or a generic name fragment never
qualifies.

## Label contract

### Evidence labels

| Label | Values | Authority |
|---|---|---|
| `authorSpecific` | `true`, `false`, `unknown` | Source parser/server resolver |
| `currentness` | `current`, `historical`, `unknown` | Source-specific rule plus observation date |
| `organizationRelationship` | `same`, `parent_child`, `sibling`, `related_other`, `distinct`, `unresolved` | Existing typed relationship service |
| `parentChildKind` | `verified_constituent`, `system_campus`, `unclassified`, `not_applicable` | Source resolver; required separately because a generic parent/child edge is too broad for authority |
| `independentIdentity` | `sufficient`, `insufficient`, `contradicted`, `not_evaluable` | New server-owned evaluator result with `excludesAffiliation=true`, a closed method/version, complete binding claims, and bounded expiry |
| `additionalCoi` | `clear`, `conflict`, `incomplete`, `not_screened` | Existing server COI matcher applied to every required current additional segment |
| `providerState` | `complete`, `partial`, `failed` | New evaluator's own server-side provider orchestration; `sufficient` requires `complete` |
| `bindingState` | `current`, `stale`, `invalid` | Server receipt verification at the execution point |

`samePerson` from the owner workbook is an evaluation label. It does not enter
the runtime candidate payload and cannot authorize a write.

**[VERIFIED via `lib/services/reviewer-institution-auto-resolution-policy.js`]**
The dormant v2 policy composer now accepts the four-outcome result and maps
`contradicted` to rejection while validating its mandatory claims. It retains
the Phase 1 boolean test shape for the existing synthetic regression fixture.
Neither shape has runtime authority.

### Decision labels

Keep `institution-affiliation-assessment/v1` for relationship truth unless its
assertion/result shape changes. Preserve `institution-affiliation-policy/v1`
for the existing Stage 2 consumers. The first high-authority composition adds
complete additional-affiliation COI, parent/child subtype, and server-binding
state, so it uses `institution-affiliation-policy/v2` rather than silently
changing v1. Its institution action is separate from the final candidate
effect. `clear_institution_concern` is reserved for compatible `same` or
verified constituent evidence; `neutral_without_institution_evidence` and
`neutral_without_institution_clearance` never count as automatic clears. The
measurement projection records:

- the policy/schema/evaluator versions;
- a server-bound input digest and freshness state;
- relationship and evidence context;
- independent identity outcome;
- additional-affiliation COI completeness/outcome;
- the counterfactual institution action;
- the incumbent action and observed staff/save outcome; and
- a fixed reason code for excluded or unscorable cases.

No raw person name, institution string, request ID, candidate key, source text,
actor ID, provider payload, or error text enters the measurement table.

## Safety invariants

| Invariant | Verification |
|---|---|
| Affiliation agreement never proves person identity | Wrong-person/same-institution regression must hold before policy evaluation can clear the final candidate |
| Departments and verified constituent units can clear the institution concern without clearing other gates | Unit and full-flow tests assert separate institution and final-candidate outcomes |
| Every additional affiliation survives segmentation and reaches COI screening | Multi-affiliation tests contain a conflicting extra segment; deleting the loop must fail the test |
| Sibling institutions never collapse through a shared parent | UC sibling and synthetic sibling tests require `sibling` plus hold/surface behavior |
| Provider failure produces neither match nor mismatch | Failure and partial-resolution fixtures assert unavailable/retry semantics |
| Historical difference is not described as current conflict | Policy and UI-copy tests pin informational/neutral behavior |
| Undated publication evidence is not described as historical | Producer-level tests require `currentness=unknown`; dated currentness requires a declared source rule |
| Canonical system ids do not turn siblings into parent/child | Synthetic canonicalized-sibling regression requires `sibling` plus hold/surface behavior |
| Browser-carried fields grant no authority | Tampered relationship, identity, COI, and policy fields are ignored or rejected at roster/save boundaries |
| A stale server receipt cannot authorize a changed candidate or request | Request, candidate, input digest, policy version, and freshness mismatch tests fail closed |
| A v1 receipt cannot omit a binding claim | Missing request, candidate key, digest, method/version, provider state, observation time, or expiry fails closed |
| Identity sufficiency requires complete provider work | Any provider-call failure produces `partial` or `failed` and cannot return `sufficient` |
| A large OpenAlex result pool cannot masquerade as unique | Grounding abstains unless the fetched pool covers the provider's reported total count |
| Staff confirmation cannot validate its own institution-dependent premise | Staff-confirmed rows remain `not_evaluable` in `independent-identity/v1` and continue through the existing human-authority path |
| Independent identity expires with its evidence | Expiry is tied to provider observation and is no later than the existing 14-day attestation lifetime |
| Flag-off behavior remains incumbent behavior | Equality tests cover card projection, selectability, save response, and Dataverse call set |
| Partial batch save marks only successful rows | Mixed success test returns exact successful and failed candidate correlations and leaves failed rows retryable |
| Measurement failure never changes product behavior | Insert failure, timeout, and circuit-breaker tests preserve the original response and decision |

## Execution plan

### Phase 0 — freeze the retrospective evidence — complete

- Preserve the completed workbook byte-for-byte and store its SHA-256.
- Import every raw value before normalization.
- Record review-layer interpretations and owner clarifications separately.
- Keep all row-level material under gitignored, mode-0600 `outputs/`.
- Use only aggregate counts in tracked documentation.

This evidence supplies regression patterns and failure modes. It does not
supply a production accuracy rate, currentness labels, complete COI labels, or
observed staff actions avoided.

### Phase 1 — build the PII-free policy regression set — complete

Create a new versioned fixture derived from patterns, not identities, in the
26-case exercise. Do not copy names, request numbers, affiliations, URLs, or
case IDs. Include at least:

1. exact alias;
2. department versus parent institution;
3. verified constituent school;
4. same person with multiple compatible affiliations;
5. same person with distinct concurrent affiliations;
6. compatible primary affiliation plus a COI-conflicting extra affiliation;
7. wrong person whose stored and cited institutions agree;
8. ambiguous/common-name identity;
9. historical institution change;
10. sibling institutions sharing a system parent;
11. partial multi-segment provider resolution;
12. complete provider failure;
13. unidentifiable internal subunits; and
14. unknown enum and stale-binding inputs.

Pin relationship, institution action, final-candidate effect, reason, and
remedy independently. Call this a regression set, not a blinded acceptance
benchmark.

Implemented in the versioned 18-case synthetic fixture at
`tests/fixtures/reviewer-institution-auto-resolution/v1/policy-regression.json`
and the dormant pure v2 composer at
`lib/services/reviewer-institution-auto-resolution-policy.js`. The set adds the
adversarial canonicalized-sibling and system-to-campus cases. It contains no
retained names, request/candidate identifiers, affiliation strings, or URLs.
Producer coverage also pins undated publication currentness as `unknown`.

### Phase 2 — prove independent identity and extra-affiliation COI — evaluator core implemented; integration pending

1. Audit every identity anchor used at enrichment, roster reload, candidate
   selection, and save. Mark whether each anchor depends on affiliation.
2. Define `independent-identity/v1` from combinations that remain sufficient
   after all affiliation-derived weight is removed. A bare
   `confirmed`/`probable` string and every currently carried identity anchor are
   insufficient as-is. The new server computation has four outcomes:
   `sufficient`, `insufficient`, `contradicted`, and `not_evaluable`.
3. Bind the result to request, exact candidate key, identity input digest,
   closed method and evaluator versions, provider state, provider observation
   time, and expiry no later than 14 days after that observation. Every claim is
   mandatory. Recompute or reject after relevant input change.
4. Carry the exact publication year with each selected affiliation assertion.
   Define and review the dated-publication currentness threshold before labeling
   any publication assertion `current` or `historical`; missing or unbound dates
   remain `unknown`.
5. Pass every relevant author-specific additional affiliation to the existing
   server COI matcher. Return `incomplete` when a required resolution or screen
   fails; incomplete screening holds rather than clearing.
6. Audit `recomputeInstitutionCOI` specifically: its save-time signal set
   currently omits typed byline segments even though discovery-time logic can
   carry affiliation history.
7. Preserve the current COI relationship rule. This phase supplies more
   complete inputs; it does not weaken exemptions or create new ones.

Stop if independent identity cannot be computed without using the affiliation
being adjudicated.

The 2026-09-14 contract audit and adversarial review did not trigger that stop,
but they found that no existing evidence output as wired is sufficient. The
implemented dormant server-side evaluator consumes those provider inputs
through three closed method families:

1. `pubmed_multi_work_author` counts only exact works whose bylines fully agree
   with the candidate forename, binds affiliation assertions to those PMIDs,
   and binds every counted work to one OpenAlex author cluster or ORCID works
   identity;
2. `exact_work_unique_author`/`forename_work_grounding` uses a server-held work,
   requires full-forename agreement, runs independently of affiliation
   selection, records the work/authorship/author-cluster identifiers, and
   abstains when the fetched OpenAlex pool is smaller than the reported total;
   and
3. `hard_id_join` uses ORCID only when the source identifier is byline-asserted
   or its works list contains the exact work and the CRM identifier is
   staff-entered or independently receipted. Email is `not_evaluable` in v1.

The evaluator makes its own provider calls and records any per-query failure as
`partial`; `sufficient` requires `providerState=complete`. It reads provider
responses or a server-written roster projection. Browser-originating names,
publications, ORCID, OpenAlex IDs, and identity statuses are deny-only. A staff
confirmation also returns `not_evaluable` in v1 because institution mismatch
can be the premise for that confirmation; the existing human-authority path
continues to honor it separately.

The audit also verified that implementation is still required before Phase 3:
applicant output and roster pruning lose decisive proof fields; publication and
ORCID dates are detached from their affiliation assertions; ordinary save omits
byline/history segments; and applicant promotion performs no server-side
institution COI recomputation. See
`docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md`.

ORCID employment with no recorded end date is an unbounded interval rather than
proof that the affiliation was observed as current. The dated-currentness rule
must preserve that distinction.

### Phase 3 — establish a trusted end-to-end assessment

General Find candidates currently lose typed authority when their browser
payload returns to the roster route. First determine whether the existing
server identity-attestation envelope can safely carry a separate institution
assessment without collapsing identity and institution semantics. If it
cannot, create a separate bounded receipt.

The server-owned binding must cover request, exact candidate key, assessment
schema version, policy version, all normalized assertion/source identifiers,
source dates/currentness, independent-identity version/result/method/provider
state, provider observation and expiry, additional-COI result, and an input
digest. Every v1 claim is mandatory; undefined values never compare as a
match. The roster stores only the bounded projection and receipt. Reload and
save re-read or verify it; browser edits invalidate it.

Before changing migration 048, probe `schema_migrations` in every intended
environment. If 048 is unapplied everywhere, amend the source-built migration.
If any environment has applied it, add a new forward migration. Never rewrite
an applied migration. Any amendment must also update the fresh-install table
definition in `scripts/setup-database.js`, and a gate must keep the measurement
vocabulary synchronized with the policy export.

### Phase 4 — expand measurement without changing behavior

- Keep `REVIEWER_INSTITUTION_MEASUREMENT` exact-on and default-off.
- Record trusted typed inputs for general discovery and applicant cases only
  after server verification.
- Derive the attempt denominator independently from eligible
  `reviewer_find_roster` rows; do not use only successfully inserted measurement
  events as the denominator.
- Record an explicit skipped reason, provider failure,
  policy eligibility, incumbent decision, counterfactual decision, observed
  staff action, and observed save outcome.
- Record whether institution mismatch was the sole incumbent blocking clause,
  so identity/contact holds and institution-driven holds are not conflated.
- State applicant-only typed coverage explicitly until general discovery has a
  trusted server projection.
- Update the aggregate report to separate:
  - safe automatic-clear candidates;
  - current discrepancies surfaced;
  - identity holds;
  - COI holds, including newly detected additional-affiliation conflicts;
  - contact/address/eligibility holds;
  - provider and coverage failures; and
  - cases that remain unscorable.
- Preserve the 90-day and 200,000-row cleanup bounds unless observed volume
  justifies a separately reviewed change.

Measurement stays non-authoritative. A missing or failed event is a coverage
gap, never a product decision.

### Phase 5 — validate shortly before the next reviewer cycle

Do not maintain a Preview branch or deployment for the intervening months.
Merge only dormant contracts, fixtures, and tests after review. Shortly before
the next cycle:

1. refresh provider/API probes and frozen benchmark runs;
2. deploy an ephemeral Preview for card/remedy and rollback smoke testing;
3. run the complete decision path in shadow under the actual cycle workload;
4. adjudicate every proposed automatic clear during the initial shadow window;
5. report the full denominator and every excluded/unscorable case; and
6. ask the owner to approve the first consumer flip only after the safety gates
   pass and the observed reduction is material.

The 26-case proportions are not used as the expected production rate or the
promotion threshold.

### Phase 6 — roll out one high-authority slice

Use a new exact-on server flag for the first end-to-end selection slice. The
server evaluates the flag and projects the resulting cleared/held institution
state into the candidate DTO. The shared client predicate reads that projection
and never reads a public environment flag. The same server decision is checked
again at the save boundary. The slice does not change automated enrichment
writes or identity-anchor weighting.

Eligible first-slice cases require:

- server-bound, author-specific evidence;
- `same` or narrowly verified constituent `parent_child`;
- no ambiguous sibling/subunit comparison;
- a complete, clear additional-affiliation COI screen;
- a valid independent-identity result for final candidate use; and
- every existing eligibility, contact, exact-address, coauthor, and request
  gate to pass.

Staff see current discrepancies and concrete correction choices. Provider
failures retry. Identity-unknown cases use the existing Confirm identity flow.
Cases whose institution concern clears but another gate holds show the
remaining reason without asking staff to reconfirm the institution.

After the first live validation window, retain human review for exceptions and
a predeclared quality-control sample of automatic clears. Set that sample size
from observed cycle volume before enabling the slice.

### Phase 7 — widen authority separately

Review automated enrichment-write veto and identity-anchor weighting as two
later, independently flagged changes. Neither inherits approval from the
candidate-selectability slice. Remove the incumbent boolean authority only
after a symbol-consumer sweep finds no remaining reads and rollback history is
retained.

## Test plan

| Layer | Required tests |
|---|---|
| Currentness producer | Undated PubMed/OpenAlex evidence is `unknown`; dated evidence preserves its exact year and follows the reviewed threshold; no producer hard-codes publication evidence as historical |
| Pure relationship | Existing source-aware 25, unchanged 157-row boolean regression, UC sibling matrix, address/alias/parent-child/subunit/partial-provider cases, canonicalized sibling attack |
| Policy matrix | Versioned 18-case PII-free regression set; every row of the policy table, all enum complements, wrong-person/same-institution, additional-COI conflict and incomplete states; clearance and neutrality use different action values |
| Independent identity | Affiliation-only evidence is insufficient; every sufficient method uses its hardened server-held inputs; all counted bylines fully agree; PubMed PMIDs cluster to one person; incomplete OpenAlex pools abstain; hard-ID source and CRM lineage is independent; email and staff confirmation are not evaluable; full-forename/hard-ID/grounding contradiction returns `contradicted`; initial-only/common-name ambiguity holds; partial/failed provider work cannot be sufficient |
| Server binding | Valid receipt; every mandatory v1 claim omitted in turn; tampered browser values; cross-request replay; changed candidate; expiry no later than 14 days after provider observation; unknown schema/policy/evaluator/method version |
| Roster persistence | Server projection survives reload; untrusted fields are stripped; CAS conflict and cap/eviction do not manufacture authority |
| Candidate card | Auto-cleared institution concern disappears; remaining identity/COI/contact reason remains; current discrepancy shows valid actions; provider failure shows retry |
| Save boundary | Client and server reach the same institution decision; extra affiliations are re-screened; stale/missing receipt holds before Dataverse writes |
| Partial success | Mixed batches return exact successes/rejections/failures; only successful rows graduate; failed rows remain actionable |
| Measurement | Trusted/untrusted capture, every fixed vocabulary value, roster-derived attempt denominator, sole-blocking-clause classification, skipped cases, timeout/failure/circuit breaker, privacy projection, cleanup |
| Migration parity | Existing-DB migration and `scripts/setup-database.js` fresh-install definition carry the same columns, checks, and vocabulary |
| Rollback | Flag-off equality for DTO, rendered state, selection state, save response, writes, and measurement authority |
| Identity regression | Frozen 40-case identity benchmark: zero new false binds and zero new right-person-policy binds |

Every negative test must include the dangerous input it claims to exclude. For
example, the wrong-person fixture must contain matching institution evidence,
and the extra-affiliation fixture must contain an actual applicant/PI conflict.

## Promotion gates

All are blocking for the first high-authority slice:

1. zero wrong-person automatic clears;
2. zero sibling collapses;
3. zero adjudicated current `distinct`, `sibling`, or unresolved
   `related_other` automatic clears;
4. zero additional-affiliation COI conflicts or incomplete required screens
   cleared;
5. zero provider failures converted to match or mismatch evidence;
6. zero new false binds and zero new right-person-policy binds on the frozen
   identity benchmark;
7. 100% of held UI cases expose an action available on that card;
8. 100% of authoritative save decisions use a current server-bound assessment;
9. flag-off behavior matches the incumbent call set and decisions;
10. measurement reports complete denominators, skipped cases, provider
    failures, and telemetry failures; and
11. the owner accepts the observed reduction in avoidable institution-driven
    staff actions.

No numeric benefit threshold is inferred from the 26-case exercise. Declare it
after the organic baseline is available and before viewing the first live
comparison result.

## Contract-reconcile checklist

Before implementation is called complete, trace and verify:

1. source assertion producer;
2. segment parsing and ROR resolution;
3. independent-identity calculation;
4. additional-affiliation COI screen;
5. versioned policy decision;
6. server binding or recomputation;
7. roster write and reload projection;
8. candidate-card render and remedies;
9. selection state;
10. ordinary and applicant save boundaries;
11. Dataverse calls or their absence;
12. measurement write/report/cleanup; and
13. flag-off rollback.

Audit partial success, stale async state, helper semantics, durable surfaces,
and every consumer of the persisted fields. Unknown values and unverified
browser claims must land in a tested fail-closed branch.

## Decisions intentionally left for execution

1. Whether to extend the existing attestation envelope or add a separate
   institution receipt, after comparing their binding and invalidation needs.
2. The treatment of concurrent `related_other` beyond holding and surfacing it
   in the first slice.
3. The numeric benefit threshold and ongoing quality-control sample size,
   declared from organic cycle volume before the results are inspected.
4. Promotion of each high-authority consumer, which always requires a separate
   owner decision.

## Immediate next work

Implement the still-dormant Phase 2 contracts identified by the completed
audit and adversarial review. The pure four-outcome evaluator and dormant v2
adapter now exist. Next, select and implement its authoritative server loader
and receipt/roster representation; add typed dated affiliation assertions;
complete additional-affiliation COI fanout; and call the same fail-closed COI
recomputation at ordinary and applicant save. Correct the three stale
`affiliationHistory` comments when its real consumer is added. Preserve
incumbent authority and keep all new behavior flag-off. Do not enable
measurement, apply a migration, create a Preview deployment, or promote a
high-authority consumer as part of that implementation.
