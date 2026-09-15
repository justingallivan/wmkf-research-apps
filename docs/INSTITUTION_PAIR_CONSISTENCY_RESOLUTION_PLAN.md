---
title: Institution Affiliation Compatibility Resolution Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Stage 2 presentation is live; Stage 3 prospective measurement is source-built but not enabled or schema-probed."
canonical: false
cataloged: 2026-08-08
last_verified: 2026-09-15
owner: product-engineering
related:
  - docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
  - lib/services/institution-affiliation-consistency.js
  - lib/services/ror-institution-identity-resolver.js
  - benchmarks/institution-pair-consistency/README.md
---

# Institution Affiliation Compatibility Resolution Plan

## Current decision

**STAGE 2 LOW-AUTHORITY PRESENTATION IS PRODUCTION-LIVE BEHIND AN EXACT-ON
ROLLOUT FLAG, 2026-08-19.** The owner accepted
**conditional neutrality** as the governing policy for unresolved affiliation
evidence:

> Unresolved affiliation evidence contributes neither corroboration nor
> contradiction. It does not veto a reviewer identity that is independently
> sufficient without that affiliation evidence. When independent identity
> authority is not sufficient, the workflow holds and gives the user a concrete
> identity remedy.

This supersedes the prior future-stage framing in this document that embedded
consumer actions in relationship labels such as `related-autoclear` and
`related-surface`. The typed relationship/policy services and source-aware
25-case evaluation are implemented. The owner subsequently authorized a Stage
2 implementation limited to notification and explanatory reviewer-card
presentation. That implementation is gated by
`NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION=on`; code defaults off, while the
live Preview and Production environments are exact `on`. It does **not** change
the frozen boolean-fixture vocabulary, candidate selectability, identity
authority, or durable-write authority.

Signed-in synthetic Preview acceptance completed on 2026-08-19. The
Preview-only harness rendered six projector-pinned cases through the production
candidate card and exercised all mapped notice actions without an API or
persistence call. This proves the low-authority UI contract and exact rollback;
it does not supply organic false-clear, alert-volume, or review-reduction
evidence because all 952 audited Production roster rows carried zero persisted
Stage 2 presentation DTOs before enablement. The owner accepted that bounded
synthetic evidence for the low-authority rollout; organic effectiveness and
alert-volume evidence must now be observed from normal Production use.

A 2026-08-19 promotion review then falsified four untested boundaries. Commit
`947fb46` hardened them before promotion: non-author-specific evidence cannot
corroborate or contradict identity, two unidentifiable internal subunits sharing
a parent abstain instead of becoming parent/child, a named organization before
an address suffix is not discarded as location decoration, and explicit server
identity-review copy cannot inherit the positive candidate-suggestion label.

The strategic correction is broader than a threshold adjustment:

1. determine the relationship between resolved organizations;
2. retain the source, date, currentness, and author attribution of each
   affiliation assertion; and
3. apply a policy specific to the authority of each consumer.

Affiliation compatibility is one identity signal. It never establishes that
two people are the same by itself.

**Stage 3 product direction (owner, 2026-09-14):** reduce avoidable staff input,
not eliminate human review. Verified departmental and constituent-school names
for the same institution should clear the *institution* concern automatically;
an independently insufficient person identity can still require an identity
remedy. A compatible segment in a multi-affiliation byline should not become a
mismatch because another affiliation is present. A genuine, unreconciled
current-institution difference should be made clear to the user with a usable
correction path. Historical differences and provider uncertainty must not be
presented as current conflicts. This is a planning priority, not a Stage 3
runtime-authority change. The deployment observations below are dated
2026-08-19; this 2026-09-14 update checked local source and the owner decision,
not current Production environment state.

**Stage 3 measurement source state (2026-09-15):** migration 051, the
`REVIEWER_INSTITUTION_MEASUREMENT=on` best-effort writer, aggregate operator
report, and retention cleanup are source-built on `codex/ror-measurement-runs`.
The migration was not applied in this session, live schema was not probed, and
the flag defaults off. Successful roster writes
and authenticated staff/save outcomes can be counted prospectively after
promotion, but no independent non-affiliation identity proof, exact upstream
publication/employment observation date, or complete extra-affiliation COI
screen is supplied. Every proposed action remains `not_evaluable` by schema;
this is not a Stage 3 selection or write-authority rollout.

## Current implementation truth

| Capability | Current state | Evidence |
|---|---|---|
| Stage 1 decorated-byline comparison | **VERIFIED, shipped.** The alert uses the staged segment comparator; enrichment composes the legacy and staged boolean checkers. | `alert-reviewer-affiliation-mismatch.js`; `enrich-recommended-service.js` |
| Pair result exposed to consumers | **VERIFIED boolean only.** `areConsistent()` returns `true` or `false`; it does not expose relationship, currentness, or remedy. | `institution-affiliation-consistency.js:335-369` |
| Enrichment authority | **VERIFIED high authority.** A false/error comparison contributes to `institutionContradicted`, which combines with the independent identity status in `identityNeedsReview` and gates researcher, ORCID, metrics, and COI writes. | `enrich-recommended-service.js:684-767,933-1005` |
| ROR relationship substrate | **VERIFIED present but not available to pair consumers.** The candidate/decision layer reads typed ROR relationships and detects sibling conflicts; the identity wrapper returns only a hydrated identity or `null`, discarding the decision provenance needed for pair policy. | `ror-institution-decision.js`; `ror-institution-identity-resolver.js:63-114` |
| Source/time-aware affiliation assessment | **VERIFIED Production-live at Stage 2 low-authority consumers behind an exact-on rollout flag.** Assertions retain source/currentness/author specificity, explicit multi-organization segments, source/canonical ROR ids, adjudicated internal-subunit scope, and typed relationships. Enrichment supplies publication/applicant and recorded-institution provenance to card presentation; the post-acceptance alert supplies reviewer-self-report and staff-record provenance. | `institution-affiliation-assessment.js`; `ror-affiliation-assertion-resolver.js`; `institution-affiliation-stage2.js`; Stage 2 focused tests; live Vercel env/deployment probes |
| Typed consumer policy | **VERIFIED at Stage 2 presentation authority only.** The total evaluator still covers all five consumers and fails closed for unknown/high-authority inputs. Only candidate-card and staff-notification projections consume it; selectability and write gates continue to consume booleans and legacy flags. | `institution-affiliation-assessment.js`; `institution-affiliation-stage2.js`; focused tests |
| Stage 2 runtime presentation | **VERIFIED Production-live after signed-in synthetic Preview acceptance.** PR #126 merged at `8c64ec76`; exact `on` is set in Production and Ready deployment `dpl_85jgQ2c4jR6V599KycEHcbww5Xag` was built afterward. The versioned DTO is sanitized before roster persistence, stale caches re-enrich when enabled, provider failure is retryable/nonterminal, unexpected Stage 2 failures fall back to legacy presentation, and flag-off ignores cached typed presentation. | `shared/utils/institution-stage2-presentation.js`; `reviewer-search-logic.js`; `ReviewerSearchSection.js`; `alert-reviewer-affiliation-mismatch.js`; `pages/workbench/institution-stage2-smoke.js`; focused tests; signed-in Preview smoke; live Vercel env/deployment probes |
| Source-aware 25-case gate | **VERIFIED PASS, shadow only.** 25/25 relationship and action matches; zero sibling collapses, unsafe clears, manufactured reviews, or live-capture provider failures; all three challenged cases are compatible/nonblocking under explicit independent-identity sufficiency. | `benchmarks/institution-affiliation-compatibility/v1/results/source-aware-25-shadow-2026-08-19c.md` |
| Additional-affiliation COI handoff | **PARTIAL / Stage 3 blocker (source check 2026-09-14).** The typed assessment retains `additionalAffiliations`, but the current candidate/server COI signal list does not consume those typed extra segments. A compatible segment cannot authorize selection until every relevant extra has been screened or explicitly excluded by source/time policy. | `institution-affiliation-assessment.js:296-317`; `deduplication-service.js:700-781`; `save-candidates-service.js:343-445` |
| Promotion-review falsification | **VERIFIED hardened and merged.** Disconfirming tests cover unattributed evidence, same-parent unidentifiable subunits, a named organization followed by an address, and server-required identity-review presentation. The frozen 25-case result remains unchanged. | `947fb46`; PR #126; focused unit and benchmark suites |
| Runtime independent-identity input | **PARTIAL / Stage 3 promotion blocker.** A read-only 2026-08-19 roster audit found 46 source-ready mismatch rows, but only two carried the compact non-affiliation anchor breakdown inspected by the audit. The 2026-09-14 contract audit and adversarial review established that no current carried output is sufficient as wired. A dormant server-side evaluator now applies the required full-forename, author-cluster, complete-pool, source-lineage, provider-state, digest, and expiry rules, but it has no authoritative loader, runtime caller, roster projection, or receipt. The benchmark therefore remains counterfactual rather than runtime authority. | `scripts/audit-institution-affiliation-shadow-cases.js`; `lib/services/independent-reviewer-identity.js`; `docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md`; focused tests; read-only production Postgres audit |

The shipped boolean comparator remains the sole identity, selectability, and
durable-write authority until every high-authority consumer in this plan is
deliberately migrated. Stage 2 may change presentation only when its flag is on.
The stop-rule remains in force: do not add another string-side guard or a third
enrichment checker. New work proceeds through the typed contract below.

## Problem statement

The product question is not:

> Are these two organization strings exactly the same?

It is:

> Given the source and time of each affiliation assertion, does the evidence
> corroborate, remain compatible with, or genuinely contradict this reviewer's
> independently established identity?

The old boolean loses distinctions that change the correct action:

- a department, school, or hospital can be a unit of the recorded university;
- a publication can list multiple simultaneous affiliations;
- a publication affiliation can be historical while the recorded institution
  is current;
- sibling campuses are different organizations without necessarily proving a
  different person across time;
- a provider failure or ambiguous resolution is not affirmative evidence of a
  mismatch; and
- the same unresolved relationship may be harmless in display copy but unsafe
  when no independent identity authority exists.

The 2026-08-18 unresolved-case smoke exposed the framing failure:

- an exact UCSF affiliation plus HHMI was blocked because the string contained
  multiple organizations;
- University of Ottawa plus a street address was blocked by an overbroad
  system-parent safeguard; and
- Duke University School of Medicine versus Duke University was treated as a
  substantive organizational conflict.

The first and third cases were also mislabeled in the benchmark itself. A gate
that treats its own policy labels as unquestionable truth can reward the wrong
behavior.

## Scope and non-goals

### In scope

- affiliation segmentation and provenance;
- resolved organization relationships;
- temporal/currentness context;
- per-consumer policy and remedies;
- benchmark adjudication and shadow rollout; and
- migration of the alert, reviewer card/selectability, enrichment write gate,
  and identity-anchor consumer.

### Out of scope

- proving person identity from affiliation alone;
- changing COI relationship rules or weakening the COI firewall;
- exact-address ownership or contact-address attestation;
- contact/account legal-entity verification;
- invitation sending or campaign state transitions; and
- another heuristic patch to the Stage 1 string comparator.

## Contract 1 — affiliation assertions

Every source affiliation becomes one or more assertions before organization
comparison. The implementation shape may vary, but the semantic contract is:

```text
AffiliationAssertion
  rawText
  sourceType          publication | orcid_employment | official_profile |
                      applicant_record | staff_record | reviewer_self_report
  sourceReference     work/profile/record identifier when available
  observedAt          publication/employment/observation date when available
  currentness         current | historical | unknown
  authorSpecific      true | false | unknown
  resolvedSourceId    source-matched ROR id when available
  resolvedCanonicalId canonical ROR id when canonicalization was applied
  canonicalization    successor/predecessor metadata when present
```

Rules:

1. Semicolon- or provider-delimited multi-organization evidence is segmented
   and each affiliation is resolved independently.
2. An exact or compatible match on one segment is retained even when additional
   affiliations exist. The extras remain visible metadata and are not identity
   contradictions merely because they are additional. Stage 3 must explicitly
   pass relevant extra segments through server COI screening; the current
   Stage 2 typed projection does not do so.
3. Publication bylines are historical observations at the publication date
   unless a stronger source explicitly establishes currentness.
4. Missing dates/currentness remain `unknown`; the system does not infer
   current conflict from recency guesses.
5. Provider failure is recorded as unresolved operational provenance, never
   converted into `distinct`.

## Contract 2 — organization relationship

The comparator returns relationship truth without embedding a consumer action:

| Relationship | Meaning |
|---|---|
| `same` | Same resolved entity or an accepted alias/translation of it |
| `parent_child` | One resolved organization is an ancestor/descendant or constituent unit of the other; direction is retained |
| `sibling` | Distinct peer organizations sharing a parent; neither contains the other |
| `related_other` | A typed relationship exists but is not parent/child, including successor/predecessor and weaker cross-organization relations |
| `distinct` | Both resolve and no qualifying relationship connects them |
| `unresolved` | One or both operands cannot be resolved confidently, the provider fails, or evidence is internally ambiguous |

The relationship result also carries:

- the matched assertion/segment;
- both source and canonical ROR ids;
- relationship direction and provider provenance;
- resolution confidence/reasons;
- additional affiliations; and
- an explicit unresolved reason when applicable.

### Hard relationship invariants

1. Sibling campuses never become `same` or `parent_child`. UCLA and UCSD remain
   distinct sibling entities even when both share the University of California
   parent.
2. Parent/child compatibility does not imply sibling equivalence.
3. Successor/predecessor canonicalization is adjudicated before same-id
   equality; canonicalization must not erase the source relationship.
4. A shared parent or generic name fragment is never sufficient to classify
   siblings as the same organization.
5. Additional affiliation is evidence shape, not an organization relationship.
6. Two internal subunits without independent organization identifiers abstain
   when all they establish is a shared parent.
7. An assertion whose author specificity is false or unknown cannot add
   affiliation identity weight or create an affiliation contradiction.

## Contract 3 — evidence context

Relationship truth is combined with temporal and source provenance before a
consumer acts:

| Evidence context | Compatibility interpretation |
|---|---|
| `same` or `parent_child` from an author-specific source | Corroborating/compatible affiliation evidence |
| One compatible segment plus additional affiliations | Compatible; carry additional affiliations as informational and COI-relevant evidence |
| Current, authoritative `sibling` or `distinct` versus another current assertion | Unreconciled current difference; a conflict only after segmentation/source evidence does not establish a joint appointment or other compatible explanation |
| Historical `sibling` or `distinct` versus a current assertion | Possible career history; neutral unless another source proves concurrency or contradiction |
| `related_other` | Not automatically compatible; evaluate source/time and surface when current significance is unclear |
| `unresolved` | Neutral; neither corroboration nor contradiction |

If source time/currentness is unavailable, a distinct relationship does not
silently become a current contradiction. The assessment must say what is known
and route according to independent identity authority.

## Contract 4 — conditional neutrality and independent identity

Define `independent-identity/v1` at the execution point for every
high-authority consumer. This is a new server-side computation, not a
reinterpretation of a current `confirmed`/`probable` status or carried anchor.
It must use no affiliation assertion under adjudication and return
`sufficient`, `insufficient`, `contradicted`, or `not_evaluable`.

The closed sufficient methods and binding rules live in
`docs/audits/reviewer-institution-phase2-contract-audit-2026-09-14.md` and
`docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md`. In
particular, counted publication bylines require full-forename agreement and
one bound author cluster; work grounding uses server-held inputs and a complete
provider result pool; ORCID hard-ID joins require independent source and CRM
lineage; and email joins are not evaluable in v1. Staff confirmation remains a
separate human-authority path and cannot feed back as affiliation-independent
identity proof.

Every v1 binding claim is mandatory. The result is bound to the request,
immutable candidate key, complete input digest, closed method/evaluator
versions, provider state and observation time, and expiry no later than 14 days
after that observation. `sufficient` requires `providerState=complete`; any
provider-call failure, stale input, missing claim, browser-only field, or
incomplete author pool fails closed.

Policy:

```text
independent identity contradicted
  -> reject through the identity/eligibility path; institution agreement cannot
     rescue the candidate

unreconciled current sibling/distinct conflict
  -> veto, regardless of independent identity sufficiency, until corrected or
     explicitly staff-confirmed under the existing identity-attestation flow

unresolved affiliation + independentIdentitySufficient
  -> neutral; do not create an institution veto

unresolved affiliation + !independentIdentitySufficient
  -> hold; give an identity remedy, not an institution-mismatch accusation

same/parent_child affiliation
  -> remove the institution veto and optionally corroborate; never establish
     the person identity by itself
```

Unknown enum values, missing provenance, or an unavailable independent-identity
calculation fail closed at high-authority consumers. At display-only consumers
they render as honest unavailable/unresolved information and never as a
confirmed mismatch.

## Consumer policy

| Consumer | Compatible (`same`, `parent_child`, additional) | Unreconciled current sibling/distinct | Historical sibling/distinct | Unresolved |
|---|---|---|---|---|
| Post-acceptance staff notification | Suppress or show a non-actionable note | Alert with both resolved institutions and a correction path | Informational career-history note; no mismatch alert | “Could not compare”; nonblocking operational information |
| Reviewer candidate card copy | Clear warning or show useful specificity/additional affiliation | “Current affiliations conflict” with exact choices | “Earlier work lists …”; no action required | Never say mismatch; explain whether identity is otherwise sufficient |
| Candidate selectability | Selectable when other identity gates pass | Hold until correct record/right person/not-a-fit choice | Selectable when independent identity is sufficient | Selectable when independent identity is sufficient; otherwise hold with Confirm identity |
| Automated researcher/contact/metrics writes | Removes affiliation veto; independent identity still required | Veto | Neutral when independent identity is sufficient | Neutral when independent identity is sufficient; otherwise hold |
| Identity resolver anchor | `same` corroborates; `parent_child` corroborates at a lower or explicitly separate weight | Contradictory only when genuinely concurrent/current | Neutral/non-corroborating | Neutral/non-corroborating |

No consumer may infer its action directly from the relationship enum. All
actions flow through a total, versioned policy table whose unknown/default case
is explicit.

## User remedies

Every held state names an action the user can actually take:

| Reason | User-facing remedy |
|---|---|
| Unreconciled current sibling/distinct conflict | Confirm the right person and recorded current institution; record the additional joint appointment when applicable; correct the record; or choose Not a fit |
| Independent identity insufficient | Confirm identity using the existing exact-person flow, add/correct authoritative evidence, or choose Not a fit |
| Provider failure/timeout | Retry enrichment; do not ask the user to adjudicate organization identity because the system was unavailable |
| Ambiguous organization resolution | Show the resolved candidates when useful and allow correction of the recorded institution; otherwise treat as neutral if independent identity is sufficient |
| Historical difference | No remedy; show only when it helps explain the evidence |
| Additional affiliation | No identity remedy; retain as information and COI input |

The UI must not display “Suggested because” above negative identity evidence,
must not call `unresolved` a mismatch, and must not recommend an action that is
not available on that card.

## Evaluation reset

### Status of existing artifacts

- The frozen Stage 1 pair fixtures and Wave 6 result remain valid evidence for
  the shipped boolean comparator. Their `related-surface` vocabulary is a
  Stage 1 gate convention, not the future Stage 2 relationship contract.
- The 2026-08-18 25-case unresolved smoke is a **diagnostic falsification
  artifact only**. It retained comparable pairs for only 15 cases, omitted
  temporal/source context, and contained at least two conceptually wrong human
  labels. It must not gate promotion.
- The shadow `institution-structural-sameness` experiment on branch
  `codex/institution-decision-harness` is not a production candidate. Its value
  is proving that a narrower string classifier cannot satisfy this contract.
- The replacement source-aware v1 fixture, normalized ROR snapshot, runner, and
  passing artifact live under
  `benchmarks/institution-affiliation-compatibility/`. Its go verdict permits
  continued shadow evaluation only.

Existing frozen files remain immutable. Revised cases and labels use a new
versioned directory/result slug.

### Re-adjudicated 25-case smoke

Build a new read-only 25-case set from unresolved production-shaped cases that
retain the full comparison context. Every case must include:

- both raw institution operands and their segmented assertions;
- source type and source reference;
- publication/observation date and currentness when available;
- resolved source/canonical ROR ids and typed relationships;
- independent non-affiliation identity evidence available at the consumer;
- an adjudicated relationship label;
- a separately adjudicated consumer action; and
- adjudicator rationale/confidence with evidence links or provider snapshots.

Adjudication is blind to the proposed classifier result on the first pass.
Disagreement between the old label, proposed relationship, and adjudicator is a
review queue, not automatically a model error. Labels may be changed, and the
label-revision rate is published.

Minimum slice coverage across the 25 cases:

- exact/alias/address/department decoration;
- parent/child;
- multiple or joint affiliations;
- sibling and genuinely distinct current affiliations;
- historical institution changes; and
- unresolved/provider-failure/ambiguous cases.

The three challenged smoke cases are mandatory regressions:

- `83ce8914d857`: compatible UCSF segment plus additional HHMI affiliation;
- `97d16b3bdc69`: University of Ottawa plus address decoration; and
- `24810991224e`: Duke University School of Medicine parent/child compatibility.

All three must avoid a blocking institution mismatch when independent identity
requirements are otherwise satisfied.

### Headline metrics

Report counts and denominators per relationship and evidence-context slice. Do
not publish aggregate accuracy without them.

1. **Sibling entity collapses:** zero `same`/`parent_child` classifications.
2. **Unsafe action clears:** zero adjudicated, unreconciled current
   sibling/distinct conflicts mapped to a clear action; legitimate joint
   appointments are labeled separately and must not count as conflicts.
3. **Manufactured reviews:** count and rate of adjudicated compatible/historical
   cases that still require staff action.
4. **Conditional-neutrality accuracy:** unresolved cases mapped according to
   independent identity sufficiency, with no circular affiliation authority.
5. **Honest copy:** zero unresolved/provider-failure cases described as an
   affirmative mismatch.
6. **Remedy coverage:** 100% of held cases expose an available, relevant action.
7. **Label quality:** old-label revision count/rate, published as a first-class
   result.
8. **Identity safety:** zero new false person binds on the frozen identity
   benchmark and no new right-person-policy binds.
9. **Operational completeness:** zero skipped cases or provider failures in a
   passing live run; provider-failure fixtures remain covered offline.

The existing 157-row Stage 1 corpus and UC sibling matrix remain adversarial
safety evidence. They supplement rather than replace the source-complete 25.

## Implementation stages

### Stage 1 — typed shadow contract and adjudication

**Authority:** none; shadow only.

**Status: IMPLEMENTED AND PASSING, 2026-08-19.** The v1 artifact reports 25/25
relationship matches, 25/25 action matches, zero sibling collapses, zero unsafe
clears, zero manufactured reviews, all three challenged regressions
nonblocking, five revised old labels out of sixteen old-labeled rows, and zero
provider failures in the final live ROR capture. The production independent-
identity execution-point contract remains insufficient for an authority flip.
The result did not itself authorize Stage 2 or Stage 3; the owner separately
authorized the bounded Stage 2 presentation implementation on 2026-08-19.

Deliver:

1. provenance-preserving ROR operand resolution;
2. multi-affiliation segmentation;
3. typed relationship and evidence-context results;
4. a pure, total per-consumer policy evaluator;
5. explicit independent-identity sufficiency without circular affiliation
   credit;
6. the re-adjudicated source-complete 25-case harness; and
7. shadow comparison against current booleans, with no runtime behavior change.

Go only when:

- all 25 cases are complete and independently adjudicated;
- the sibling and unsafe-action hard gates are zero;
- the three challenged cases map to compatible/nonblocking outcomes;
- unknown/default branches are pinned fail closed for high-authority consumers;
- label revisions and per-slice denominators are published; and
- the old boolean remains the only runtime authority.

Stop if source/time provenance cannot be supplied at the execution point. Do
not compensate with another string heuristic.

### Stage 2 — low-authority consumer rollout

**Authority:** notification and explanatory UI only; no automated identity or
Dataverse-write authority.

**Status: PRODUCTION-LIVE BEHIND EXACT-ON ROLLOUT FLAG AFTER SYNTHETIC SIGNED-IN
PREVIEW ACCEPTANCE, 2026-08-19.**
`NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION=on` enables source-aware
candidate-card explanations/remedies and post-acceptance staff notifications.
The exact default/off path restores the incumbent boolean presentation. The
implementation passes the frozen 25-case presentation projection, remedy,
selection-authority, write-authority, provider-fallback, rollback, focused unit,
type, lint, and flag-on production-build gates.

The signed-in Preview smoke used `pages/workbench/institution-stage2-smoke.js`,
which is SSR-hidden outside Preview and guarded by reviewer access. Six static,
non-sensitive cases are equality-pinned to the production projector and render
the real `CandidateCard`; eight displayed notice actions write only to local
component state. The owner confirmed all six cases, the exact flag-on state, and
the local action check on deployment `dpl_kZqGC1j1yuF73RYCbWum3HgQaS9T`.
Focused coverage independently clicked all eight actions and asserted zero
network calls. Cleanup removed the branch-specific flag and temporary Entra
callback; default-off deployment `dpl_5c2Cj98zUGybjjT5TdcvPuRFUL88` completed
that Preview test cycle.

PR #126 subsequently merged the implementation to `main` at `8c64ec76`. A
read-only environment pull independently verified exact `on` in Production,
and Ready Production deployment `dpl_85jgQ2c4jR6V599KycEHcbww5Xag` was built
after that variable was created. Stage 2 low-authority presentation and
notification behavior is therefore live; unset/`off` remains the immediate
rollback.

This closes synthetic UI acceptance, not organic effectiveness sampling. A
read-only Production audit found 952 roster rows and zero persisted Stage 2
DTOs, so creating live examples would have mutated the shared roster. No claim
of material manual-review reduction or bounded informational-alert volume has
been made. Those are post-enable observation gates, not claims established by
the deployment itself.

A fresh Claude Fable adversarial review returned **REWORK** before enablement:
it found a flag-on cache loop for deceased rows and a provenance fallback that
could label applicant-entered text as historical publication evidence. Commit
`0089822` fixes both, records an invisible versioned legacy-fallback DTO after
unexpected Stage 2 failure, and makes the edit affordance use the same exact
flag/version/visibility gate as the rendered notice. The remaining review risk
is operational: unresolved ROR comparisons can increase informational alert
volume. Synthetic Preview could not measure that residual, so it is now a
Production observation item. Fable's fresh
post-fix review returned **APPROVE** with no P0/P1/P2 findings. Its residuals
are copy-only: a deterministic-failure fallback remains on the incumbent copy
until another enrichment or a presentation-version bump, and the edit-
affordance rollback is pinned at the shared helper rather than by a separate
component-level test.

Deliver:

- typed staff notification behavior;
- reviewer card explanation and remedy selection;
- historical/additional-affiliation notes; and
- explicit provider-failure/retry copy.

Post-enable observation and rollback criteria:

- **PENDING ORGANIC EVIDENCE:** sampled false-clear review finds no hidden
  current conflicts;
- **VERIFIED SYNTHETIC PREVIEW:** 100% of held fixture cards expose an action
  available on that card;
- **VERIFIED SYNTHETIC PREVIEW:** unresolved never renders as mismatch;
- **PENDING ORGANIC EVIDENCE:** compatible/historical cases show a material
  reduction in manual-review prompts; and
- **VERIFIED:** rollback to the boolean presentation remains independently
  available.

### Stage 3 — identity-authority rollout

**Authority:** candidate selectability, enrichment write veto, and identity
anchor semantics.

**Primary outcome:** reduce institution-driven holds that require no human
judgment because the author-specific evidence names a verified unit of the
recorded institution or contains a compatible segment alongside another
affiliation. Count the staff actions avoided, not just relationship-label
accuracy. Identity confirmation, COI, and exact-address checks remain separate.

| Evidence at the decision point | Planned institution action | Person/other gate |
|---|---|---|
| Author-specific `same`, or verified constituent `parent_child` with no unresolved subunit/sibling ambiguity | Auto-clear the institution concern with no staff click or mismatch warning | Still require the existing independent person, contact, COI, and address gates |
| One compatible segment plus additional affiliations | Auto-clear the institution concern; retain every additional segment with source/currentness for server COI screening | An extra affiliation alone is not a person mismatch, but a current extra matching a PI institution can still block selection |
| Historical `sibling`/`distinct`, or difference with unknown currentness | No current-institution accusation; use informational or neutral presentation | Require independent identity for any high-authority action |
| Unreconciled, author-specific, genuinely concurrent/current `sibling` or `distinct` | Hold and show both institutions with correction, joint-appointment, right-person, and Not a fit remedies that the card actually exposes | Never clear merely because a shared parent or name fragment exists |
| `unresolved`, including partial/provider failure | Neither affirm a match nor accuse a mismatch; retry a provider failure | Proceed only when independent non-affiliation identity is sufficient; otherwise hold for identity confirmation |
| Concurrent `related_other` | Hold pending source/time adjudication; do not count it as an eligible automatic departmental clear | Resolve the open policy decision before broadening this slice |

The first automatic-clear slice is deliberately narrower than all possible
`parent_child` relationships. It requires typed, source-preserving evidence of a
constituent unit; a separately governed hospital, an unidentifiable internal
subunit, or two sibling campuses cannot be cleared from a shared umbrella
alone. A department may be auto-cleared as an *institution issue* even if the
person remains held for another reason. That distinction must survive the
stored verdict and user-facing remedy.

#### Stage 3 execution sequence

**June–August cohort probe (2026-09-14):** a read-only census found 953
retained Find-roster rows, 106 currently mismatch-flagged, but no historical
staff-action count or source-complete typed selection inputs. An exploratory
stored-text ROR probe is non-authoritative and cannot label auto-clear cases.
The [baseline audit](audits/institution-affiliation-last-cycle-baseline-2026-09-14.md)
records denominators and the missing measurements. Execution step 1 remains
open: prospective capture is source-built but not enabled or live-probed, with no organic
events yet. Do not interpret 106 as avoidable reviews or proceed to a live
selection-authority flip on this evidence.

**Owner-reviewed intake result (2026-09-14):** a varied 26-case subset of the
source-recoverable cohort produced 22 same-person, two different-person, and
two unknown labels, plus 19 same-institution and seven distinct-institution
labels. One wrong-person case also had internally consistent institution
evidence for that wrong person, directly confirming that institution agreement
cannot bypass the identity gate. This is useful qualitative evidence for the
narrow automatic-clear direction, but it remains nonrepresentative and lacks
original-source timing, complete extra-affiliation COI screening, and observed
staff-action labels. It therefore does not close execution step 1 or authorize
a consumer flip. The focused policy, label, test, measurement, and rollout
sequence is in
`docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md`.

1. **Measure and label the work being removed.** Establish an organic baseline
   of institution-driven holds and staff actions per case. Add a blind,
   independently adjudicated held-out slice of departmental/constituent-school,
   multi-affiliation, current sibling/distinct, joint-appointment, historical,
   `related_other`, ambiguous-subunit, and provider-failure cases. Label
   organization relationship, source/currentness, institution-only clearance,
   person-identity sufficiency, other hold reasons, and final consumer action
   separately. Count observed staff actions; a shadow prediction of an avoided
   click is not an observed reduction. If the current action trail cannot
   attribute an institution-driven step, add bounded, privacy-minimized
   measurement before declaring a benefit. Preserve the frozen 25 and 157
   cases; do not tune on them. The 157-row corpus has boolean-era labels and
   no source/currentness/action context, so it remains an incumbent regression,
   not a typed-policy acceptance oracle. Create a separately versioned,
   source-complete typed adversarial set. Include the five request-1002903
   pairs through the actual typed pair path rather than the ROR identity
   adapter, which has no pair method.
2. **Prove independent person identity.** Audit every current resolver anchor
   for affiliation dependence, including institution-corroborated ORCID and
   `affiliation_match`. Define and version the exact non-affiliation combination
   sufficient at each high-authority execution point. Produce a server-owned,
   machine-checkable result bound to the evaluated person/candidate and current
   inputs; unknown, stale, or circular evidence is insufficient. Preserve the
   full-forename contradiction and initial-only namesake guards. A bare
   `confirmed`/`probable` status is not this proof.
3. **Carry a safe typed assessment through the real flow.** Specify a bounded,
   versioned server-owned assessment with assertion provenance, selected
   relationship/context, independent-identity result, policy decision,
   source-version/freshness binding, additional affiliation segments, and
   reason/remedy. Reconcile the Postgres
   Find-roster `candidate` JSONB projection, cache invalidation, every read
   projection, and the server promotion boundary before selecting a storage
   shape; do not assume a new table is needed. A browser-carried policy field
   never grants authority. The typed assessment already retains additional
   segments, but the current server COI screen does not consume that list.
   Before multi-affiliation selection can clear, screen every relevant extra
   segment against PI institutions with source/currentness preserved. A
   current extra that creates institution COI still blocks; an incomplete
   required COI screen holds for retry, not an automatic clear. Prove this
   after roster reload and provider failure. Exclude an extra from screening
   only with a recorded source/time reason. Do not change the existing COI
   relationship rule under the guise of affiliation policy.
4. **Shadow the complete decision path.** At the same candidate and input
   version, compare incumbent and typed decisions without changing selection
   or writes. Trace producer → roster → card → server save/reject and record
   which holds would disappear, which real conflicts or extra-affiliation COIs
   would surface, and which cases still require identity or contact input. Count provider failures and
   skipped cases explicitly; a case missing its source/time or independent
   identity input cannot be scored as a successful automatic clear.
5. **Roll out the first end-to-end selection slice behind its own exact-on
   rollback.** The client and server must agree: a card must not become
   selectable while the save boundary still rejects the same institution
   decision. The current enrichment path folds institution contradiction into
   `identityNeedsReview`, withholds fields from the card, and gates automatic
   Dataverse person writes (`enrich-recommended-service.js`); the card's
   `projectReviewerContact` and `save-candidates-service.js` also enforce
   independent promotion checks. Design and test a bounded way to retain or
   rederive *vetted* candidate evidence for selection without opening the
   separate enrichment write gate. Recheck extra-affiliation COI at the server
   boundary rather than trusting a card or stored presentation. If that
   separation cannot be proved, stop
   and review the consumer order instead of shipping a cosmetic checkbox or
   silently flipping automatic writes. Genuine concurrent conflicts, COI, and
   exact-address rules remain enforced at the server.
6. **Evaluate the first slice before widening it.** Report the baseline and
   post-change eligible departmental/multi-affiliation hold rate, staff actions
   avoided, incorrectly cleared current conflicts, wrong-person binds,
   provider failures, and held cases lacking an available remedy. Only after
   the owner accepts the predeclared benefit threshold and safety evidence
   should enrichment write veto and identity-anchor weighting receive their
   own, independently reversible reviews.

The decision-flow gates include the source-complete 25, the unchanged 157-row
Stage 1 *boolean* regression and UC sibling cases, a separately adjudicated
source-complete typed adversarial/held-out slice, the frozen 40-person identity
benchmark, and real pair replay through the typed assessment. The 157 boolean
labels cannot certify typed actions without source/time and consumer-action
labels. Required outcomes: zero new wrong-person or right-person-policy binds;
zero sibling collapse or adjudicated current-conflict automatic clear; zero
adjudicated current extra-affiliation COIs incorrectly cleared under the
existing matcher; no
provider failure promoted to a match or mismatch; every hold has an available
remedy; the COI matcher and exact-address flow remain unchanged. Newly screened
extra segments may correctly expose COI holds; report those separately from
institution-mismatch holds. The benefit gate is
the owner-approved reduction in *avoidable institution-driven staff actions*
against the organic baseline, with its denominator and excluded cases shown.
No numeric threshold is inferred from the 25-case fixture.

Migrate one consumer at a time behind independently reversible configuration:

1. candidate selectability;
2. enrichment durable-write veto; and
3. identity-anchor weighting.

Go for each consumer only when:

- the source-complete 25, unchanged boolean regression, and a source-complete
  typed adversarial/held-out corpus each pass their own contract;
- the frozen identity benchmark records zero new false binds and zero new
  right-person-policy binds;
- independent identity sufficiency is proven at that exact execution point;
- unreconciled current sibling/distinct conflicts still veto;
- unresolved with sufficient independent identity is demonstrably neutral;
- unresolved without sufficient independent identity holds with a real remedy;
- the COI hard-drop rule and exact-address attestation flow are unchanged;
  any new COI holds from complete extra-segment input are measured; and
- the owner explicitly approves the consumer flip.

The boolean contract is removed only after all registered consumers have moved
to the typed policy and a symbol-consumer sweep finds no remaining authority
reads.

## Safety invariants

1. Affiliation evidence alone never confirms a person.
2. Sibling organizations never become the same entity.
3. Historical difference is not silently promoted to current contradiction.
4. Unresolved is neutral, not positive and not negative.
5. Conditional neutrality requires independently sufficient non-affiliation
   identity evidence; otherwise the workflow holds.
6. Provider failure never becomes a mismatch and never silently enables a
   high-authority action.
7. Unknown relationship/policy values fail closed at high-authority consumers.
8. Additional affiliations must reach COI evaluation but do not create
   identity contradiction merely by being additional.
9. Relationship policy never changes the COI hard-drop matcher.
10. No new string-side checker or enrichment-seam guard is added.
11. No current identity status or anchor is promoted directly into
    `independent-identity/v1`; the server recomputes the closed method.
12. `sufficient` requires complete provider work, complete binding claims, and
    a current receipt no older than the 14-day maximum.

## Contract-reconcile requirements for implementation

Before each stage is called complete, trace:

1. source affiliation producer;
2. assertion segmentation and provenance;
3. ROR candidate/relationship resolution;
4. typed relationship result;
5. evidence-context assessment;
6. independent identity calculation;
7. per-consumer policy decision;
8. persisted/logged/DTO representation;
9. client state and rendering; and
10. tests, benchmarks, operational gates, and rollback.

The partial-success and async audits must prove that one failed affiliation
segment or provider request cannot silently discard successful segments or
write stale results into a later reviewer/request context. Any new durable DTO
field must be swept through every select/projection, serializer, roster
consumer, and UI bucket before authority changes.

## Historical Stage 1 evidence

Stage 1 remains the falsification record for the current boolean comparator:

- segment-wise comparison shipped without changing the default checker;
- the alert and enrichment seams adopted the staged behavior in bounded steps;
- the enrichment seam now composes legacy and staged checkers, preserving
  associated-link clears while adding decorated-byline clears;
- the Wave 6 live gate passed 157/157 with zero provider failures;
- the frozen-40 identity run remained identical to baseline with zero false
  binds; and
- repeated adversarial review produced explicit checker and seam stop-rules.

Detailed frozen boolean artifacts and fixture semantics remain under
`benchmarks/institution-pair-consistency/`. They prove the current Stage 1
boolean behavior. The separate source-aware v1 artifact proves the new shadow
relationship/policy contract only; neither artifact proves that production
consumers have migrated.

## Remaining implementation decisions

These are required before Stage 3, not silently assumed:

1. the versioned runtime/roster representation for the typed assessment;
2. the policy for concurrent `related_other` evidence beyond the named
   parent/child and sibling classes; and
3. the owner-approved minimum manual-review reduction that justifies a
   consumer flip.

The owner has settled the *direction* of item 3: unnecessary departmental and
multi-affiliation holds should clear automatically, while genuine current
discrepancies should be surfaced. The numeric benefit threshold remains open
until the organic baseline is measured. The first selection rollout also needs
an explicit answer to the producer/card/server-save coupling in execution step
5; no current source check establishes that those authorities can be flipped
independently.

No threshold tuning against the 25-case set is permitted without preserving a
held-out or newly collected adjudication slice. If the relationship substrate
cannot explain a new case, record it as unresolved and improve coverage in a
new evaluation version; do not patch the consumer with a case-specific rule.
