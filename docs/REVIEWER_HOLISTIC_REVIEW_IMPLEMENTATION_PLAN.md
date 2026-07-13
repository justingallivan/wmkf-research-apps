---
title: Reviewer Holistic Review — Implementation Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Active hybrid plan: safe slices reach main behind legacy-default seams; identity containment, measured rollout, and post-campaign cleanup."
canonical: false
cataloged: 2026-07-12
owner: product-engineering
related:
  - docs/audits/reviewer-holistic-review-comparison-2026-07-09.md
  - docs/audits/reviewer-holistic-review-codex-2026-07-09.md
  - docs/audits/reviewer-holistic-review-fable-2026-07-08.md
  - lib/services/reviewer-identity-resolver.js
  - lib/dataverse/adapters/researcher.js
  - .claude-memory/project-reviewer-holistic-redesign-parallel-build.md
---

# Reviewer Holistic Review — Implementation Plan

## Status and controlling direction

**ACTIVE — hybrid execution approved 2026-07-12.** The evaluation foundation
and incremental branch-by-abstraction model are green-lit. Phase-specific
schema execution, production cohort activation, destructive cleanup, and
runtime promotion gates still require the explicit decisions named below. The
2026-07-09 comparison memo is the controlling assessment where
the source reviews conflict. This plan incorporates its corrections rather than
merely linking to them:

- current trust-boundary and correction defects are contained before the
  experimental redesign;
- identity is a versioned binding contract, not `confirmed` plus one source
  column;
- independently labeled evaluation precedes resolver tuning;
- the staff referral handoff is treated as shipped; measurement replaces a
  duplicate build;
- destructive cleanup follows a successful comparison and promotion decision.

The original Fable review remains useful for strategy and prioritization. It is
not controlling evidence for current code state.

## Evidence labels

- **[VERIFIED]** — rechecked against the 2026-07-12 tree or a named owner
  statement.
- **[PLANNED]** — required behavior in this plan; not built.
- **[ASSUMED]** — must be probed before implementation and may not justify a
  destructive or trust-bearing action.
- **[STALE/CONFLICT]** — contradicted by the current tree or controlling memo.

## Hybrid incremental execution model

The old P0→P4 model mixed production safety fixes, experimental redesign, and
cleanup on one long-lived branch. The replacement follows the governing
campaign-release strategy's branch-by-abstraction rule:

1. Build each slice on a short-lived branch with one named invariant and one
   rollback path.
2. Merge independently safe slices to `main` only after their tier-specific
   tests and deliberate promotion decision.
3. Keep legacy behavior authoritative by default. Additive schema, dual writes,
   policy seams, evaluation assets, and shadow comparisons may reach `main`
   before any user-visible switch.
4. Route behavior changes through a server-owned deterministic request cohort;
   absent, unknown, or unreadable assignment selects the baseline.
5. Freeze the comparison against the exact post-containment baseline commit,
   not a moving branch name.
6. Retain old readers/writers through the controlled pilot and at least one
   complete campaign of observation.
7. Run D1 cleanup only after promotion and observation; it is not part of the
   experiment and never shares a behavior-change commit.

No multi-phase redesign branch is required for delivery. A temporary branch or
worktree may host unfinished exploratory code, but production-intended work is
re-cut into small legacy-default slices before merging to `main`.

## Whole-flow contract

Every identity phase must trace and test this complete flow:

1. analyze/discover/enrich result;
2. client candidate state;
3. save request payload;
4. route authentication and envelope validation;
5. per-row server validation and trusted identity decision;
6. person binding plus derived-field persistence;
7. proposal-specific COI and suggestion state;
8. save response identifiers and retryable client state;
9. staff edits, self-report, merge, and later correction;
10. invite/materials/honorarium action eligibility;
11. docs, Atlas, scripts, tests, and gates.

No phase is complete after proving only a write path.

## Universal invariants

1. **Confidence is not provenance.** `wmkf_identitystatus` may describe
   resolver confidence; it may not prove who supplied or attested the binding.
2. **Unknown fails closed.** Missing/unknown binding source, version, correction
   state, or required derived-state version is ineligible for identity-dependent
   writes and actions.
3. **Server authority.** Persistence eligibility never derives solely from
   client-supplied nested identity state. PD confirmation is a distinct explicit
   staff action, not a magic status value in an otherwise automated payload.
4. **Versioned replacement.** A correction creates or advances one binding
   version and invalidates or recomputes all state derived from the superseded
   binding. A record may not combine a new ORCID with an old Scholar profile,
   metrics, affiliation evidence, or COI conclusion.
5. **Lineage-aware clearing.** Automated replacement may clear fields derived
   from the superseded binding; it must not erase independently attested/manual
   fields without an explicit transition rule.
6. **Self-report ordering.** Reviewer self-report is persisted as a durable
   rebind before ORCID back-propagation, honorarium onboarding, or any other
   identity-dependent downstream action. No synthetic in-memory `confirmed`
   shortcut may bypass that order.
7. **Action-boundary enforcement.** Invite/send, ORCID back-propagation, merge,
   and downstream automation consume the current binding/action policy rather
   than `{confirmed, probable}` literals.
8. **Partial success remains honest.** In a mixed batch, only successful rows
   become saved in the client. Malformed and failed rows remain retryable and
   carry stable identifiers, not only display names.
9. **Async state is generation-scoped.** Analyze, enrich, save, and pilot
   routing carry the current request/proposal generation. Every post-`await`
   client write verifies that generation (success and failure paths), or the
   old request may not mutate the newly selected proposal's state.
10. **Fail-closed reads survive refactors.** A failed read of current binding
   state never falls through to an overwrite, clear, merge, or send.
11. **No COI policy change.** The surface-not-gate posture and authoritative
    institution-COI save check remain unchanged.
12. **Behavior freeze for extraction.** Characterization tests precede helper
    consolidation; passthrough semantics gain no new defaults.
13. **Destructive work is last.** No removal is justified by a plan label or a
    disabled flag alone; live callers and behavior must be verified immediately
    before deletion.

## Non-goals

- No retrieval-first inversion revival or Track-B resurrection.
- No roster-reuse or per-person reviewer-history product work without a new
  owner signal.
- No applicant-recommendation slate expansion; the recent approximately
  one-per-panel policy remains an owner practice, not a hard-coded invariant.
- No COI re-gating or new soft COI flags.
- No new external data vendors or procurement work.
- No SerpAPI/contact-enrichment tier reduction in this plan.

---

## B0 — Owner gate and evaluation freeze

**[APPROVED 2026-07-12]** Build the evaluation foundation and use the hybrid
incremental model. Runtime behavior and external-state gates remain scoped to
their phases.

Before the first redesign commit, create a tracked evaluation manifest containing:

- exact `baselineCommit` from `origin/main` and redesign starting SHA;
- frozen proposal IDs and document hashes;
- identity fixture version;
- prompt row/version, resolved model IDs, model overrides, reviewer count,
  temperature, exclusions, and run count;
- scoring rubric, tie rule, thresholds, named adjudicator, artifact schema,
  and evaluation-script version.

Changing a frozen item creates a new evaluation version. It may not silently
replace the registered comparison.

**Foundation built:** the draft lives at
`docs/audits/reviewer-holistic-evaluation-manifest-v1.json`; validate its
structure with `npm run eval:reviewer-holistic:manifest`. Before any comparison
run, `node scripts/validate-reviewer-holistic-evaluation-manifest.js
--require-frozen` must pass. Draft status is deliberately non-runnable: the
baseline freezes after shared C0 containment, not at scaffold creation.

**Acceptance:** manifest reviewed before behavior changes; baseline checkout is
reproducible; shared containment is merged or explicitly excluded before the
baseline commit is frozen.

---

## C0 — Contain current identity-boundary defects

**Delivery:** one short-lived Tier-2 branch per independently reversible
containment slice. **[OWNER-GATE]** for each production promotion.

### C0.1 Validate each save row without breaking partial success

**[IMPLEMENTED + VERIFIED + PROMOTED 2026-07-12 at `c5b0593a`]** Row validation,
stable save/error keys, same-name graduation protection, request-generation
guards, server-signed automated identity receipts, and request-scoped staff
identity confirmation are complete. Verification: 197 targeted tests, full
suite 478/478 suites and 5,395/5,395 tests, typecheck, production build, and the
applicable route/DAL/docs/security gates plus self-tests. Production deployment
`dpl_AxKRtNJtPMi3eKQK9LLeGHUQHTqt` reached READY with live aliases and no error
logs in the post-deploy scan. C0.2 was promoted independently after its own
verification bundle and owner gate, as recorded below.

**[VERIFIED pre-C0.1 baseline; superseded by the implementation above]**
`/api/reviewer-finder/save-candidates` validated only
`requestId` plus a non-empty `candidates` array. The service saves per row, and
the client uses `savedNames` to mark only successful rows saved.

Add explicit per-candidate schema/normalization at the start of the service
loop, before any adapter write:

- require a stable `clientCandidateId` (or deterministic submitted candidate
  key), name, and supported field shapes;
- reject unknown status/source values and unbounded identity/evidence payloads;
- treat nested identity and provenance as untrusted hints until reconstructed
  or verified by a server-owned path;
- do not allow a client-supplied `confirmed` or `pdIdentityConfirmed` value to
  manufacture automated persistence eligibility;
- keep request-envelope validation in the route and row validation in the
  service so one malformed row does not reject valid siblings.

Response contract:

- mixed valid + invalid: `200`, successful rows plus per-row errors;
- all policy/validation rejected: `422`;
- zero saved with operational failures: retain the existing `500` category;
- add `rejectedInvalid`, `code: 'invalid_candidate'`, submitted row index, and
  stable candidate key to failures;
- retain `savedNames` for compatibility, add `savedKeys`, then migrate the
  client to `savedKeys` before removing name-based graduation.

Tests must prove failed/malformed rows remain selected and retryable, successful
rows alone become saved, duplicate display names cannot graduate each other,
and `success:true` is impossible when every row failed. Add a proposal-switch
test in which the first save resolves after the UI has moved to another request;
neither its success nor its failure may update the new request's roster.

### C0.2 Close the attestation-overwrite hole

**[IMPLEMENTED + VERIFIED + PROMOTED 2026-07-12 at `e5ed38db`]**
`researcher.writeIdentityDecision` now requires a server-only
`identityOrigin` of `self_report` or `automated`; only `self_report` may persist
`confirmed`. All six direct writers declare their origin (one self-report and
five automated runtime/backfill paths). Automated `confirmed` decisions are
cloned and persisted as `probable`, stored
`confirmed` rows remain sticky, and unknown origins/read failures write
nothing. `clearIdentityFields` accepts only the automated origin and preserves
the same sticky, fail-closed read. The adapter matrix and caller-path tests are
implemented. The guard remains read-then-write rather than atomic; I1 must
replace it with a durable binding contract. Verification: 133 targeted unit
tests, 24 route integrations, full suite 478/478 suites and 5,414/5,414 tests,
ESLint, script syntax checks, typecheck, production build, and the applicable
Dataverse/docs/memory gates plus self-tests. Production deployment
`dpl_CLsy2yHBC4y5EvMquEWaaVKtqcgM` reached READY with all live aliases; the
post-deploy error-level scan returned no logs.

Until the durable binding fields exist, make the origin of a `confirmed`
decision explicit at the adapter boundary. Only the reviewer self-report path
may pass the transitional attestation marker. Automated writers and backfills
must identify themselves as automated; an automated incoming `confirmed` is
downgraded to `probable` before persistence and may not overwrite a stored
attestation.

Preserve the existing sticky skip and fail-closed reads. Cover the full matrix:
incoming origin (self-report/automated/unknown) × stored status
(confirmed/non-confirmed/read failure). Unknown origin fails closed.

This marker is transitional. I1 replaces it with the durable binding source and
version; do not proliferate it to UI payloads.

### C0.3 Make corrections invalidate dependent state

**[SCHEMA PREREQUISITE DEPLOYED; NOT AUTHORITATIVE 2026-07-12]**
The live containment audit found that this promise cannot be implemented safely
against the current columns: the seven overlapping identity fields have no
per-field lineage, proposal COI has no structured currency marker, and a person
binding has no durable generation. The additive prerequisite is now tracked in
`wave13-reviewer-identity-binding` with a read-only ABSENT/EXACT/DIVERGENT
preflight. The owner-approved production-only apply created all ten fields and
post-apply typed metadata verification reported 0 ABSENT / 10 EXACT / 0
DIVERGENT. It adds no runtime reader or writer; current behavior remains
authoritative, and null fields mean legacy/unknown, never eligible-by-default.

Create one server-owned rebind/invalidation operation used by:

- PD confirmation in `save-candidates-service`;
- reviewer self-report in `capture-self-reported-orcid`;
- identity-bearing staff edits in `my-candidates-service`;
- later automated re-resolution where the bound person changes.

For the containment slice, update the person row with one explicit PATCH that
can write nulls; do not pass nulls through `upsertByPotentialReviewer`, which
prunes them. Clear only the established resolver-sourced field set, preserve
manual fields, and recompute or fail closed on proposal-specific COI before a
later action. A write failure must not be reported as a successful rebind.

Classify staff-edit fields explicitly: descriptive edits that do not change the
person binding remain ordinary edits; name, email, ORCID, identity anchor, or a
staff “right person” action trigger the rebind contract.

### C0.4 Enforce current-state eligibility at send

The send service already re-derives email confidence from the person row.
Extend the server-authoritative gate so stale/invalidated identity state is not
actionable. The modal remains advisory. Tests must include a wrong/stale bundle
present in the fixture; a negative assertion without dangerous input is not an
eligibility test.

### C0 verification

- scoped unit/integration tests for route → service → adapters → response →
  client graduation;
- capture-mode invitation test for stale/unknown state refusal;
- full `npm test` and `npm run check:types`;
- `check:api-routes` + self-test sequentially if request/response documentation
  changes;
- `/contract-reconcile` before promotion.

---

## M1 — Build the evaluation system before further resolver changes

### M1.1 Independently labeled person benchmark

Create at least 40 frozen cases before tuning behavior:

- at least 20 hazards: namesakes, wrong forenames, initials, affiliation drift,
  merged clusters, stale binding/correction, and no-ORCID/early-career cases;
- at least 20 clean positives across fields and career stages.

Each case stores separately:

1. frozen candidate input and upstream response shapes;
2. expected person anchor or required abstention;
3. permitted action eligibility;
4. authoritative evidence citations;
5. labeler and adjudication status.

Existing tests and ORCID scripts may supply input shapes, but their current
classifications are not truth. Labels are established without viewing either
pipeline’s output, using authoritative public identity evidence, with disputes
adjudicated before unblinding.

Metrics:

- false-binding count/rate;
- correct-binding coverage;
- abstention count/rate;
- correction integrity across transition cases;
- unsafe-action count/rate.

Hard offline safety gates:

- zero false bindings in hazard fixtures;
- zero unsafe actions;
- every correction-transition fixture fully invalidates/recomputes derived state;
- no reduction in correct-binding count versus frozen main;
- clean-positive abstention may exceed baseline by at most one case.

Use exact numerators/denominators; do not turn a small fixture set into an
unsupported population claim.

### M1.2 Proposal-level blinded head-to-head

Select ten held-out proposals before execution, stratified across program area
and thin/full proposal signal. Do not use proposals that tuned the redesign.

Run frozen main and completed redesign with identical documents, prompt/model
configuration, candidate count, exclusions, and environment. Run three
replicates per proposal/arm and retain run IDs. Union and deduplicate candidates,
randomize blind IDs, then have the PD score:

- correct person;
- on-topic;
- independent/eligible;
- shortlist yes/no;
- disqualifier reason;
- coverage contribution;
- whether the slate can staff the target panel without another search.

Offline pilot-eligibility rule:

- all identity safety gates pass;
- no wrong-person increase;
- aggregate eligible-shortlist count is at least baseline;
- redesign loses on no more than two proposals;
- redesign wins on at least four proposals and has at least two more wins than
  losses, where a win means equal-or-better coverage with higher eligible
  shortlist yield or fewer additional searches.

A tie or threshold miss means retain the baseline and revise or stop.

### M1.3 Observational channel baseline

Build the read-only outcome probe before finding changes. Report by each
`wmkf_sources` token:

- sourced rows, currently selected, invited, accepted, declined,
  decline-with-referral, materials sent, and review received.

Report multi-touch attribution and exclusive-token cohorts separately. Never
sum multi-touch channel counts as unique people. Label `wmkf_selected` as a
current mutable snapshot, not historical shortlist, and materials-sent as a
participation proxy, not final panel seating. Use `wmkf_reviewreceivedat` for
review submission.

The artifact is observational evidence, not a causal head-to-head result.

---

## I1 — Define the versioned identity-binding contract

**[FIELDS APPROVED + DEPLOYED 2026-07-12; OWNER-GATE REMAINS]** for transition
semantics and runtime activation.

### I1.1 Minimal durable model

Extend the person entity with a new isolated schema wave. The design must carry:

- binding version (monotonic integer or equivalent generation);
- binding source (`self_reported`, `staff_confirmed`, `automated`, plus an
  explicit legacy/unbound state for migration);
- canonical bound-person anchor;
- binding/attestation timestamp;
- derived-state binding version;
- compact per-field lineage for the overlapping mutable identity bundle, so a
  replacement can clear superseded automated values without erasing an
  independently attested/manual value.

Continue using the existing evidence summary/verified-anchor fields for compact
evidence provenance; do not duplicate their payload without a demonstrated need.
Correction/supersession is represented by advancing the binding version. Action
eligibility is computed from current binding, derived-state version, evidence,
email source, and proposal-specific state rather than stored as an opaque
boolean.

The tracked Wave 13 contract uses these person columns:
`wmkf_identitybindingversion`, `wmkf_identitybindingsource`,
`wmkf_identitybindinganchor`, `wmkf_identityboundat`,
`wmkf_identityderivedbindingversion`, and
`wmkf_identityfieldlineagejson`. The lineage JSON is a compact server-owned map
for the allowlisted identity-bearing fields; malformed, oversized, unknown-key,
or unknown-source payloads must fail closed. Its exact schema and transition
rules are a required I1.3 writer contract, not client input.

**[PURE CONTRACT BUILT; NO DATAVERSE READER/WRITER 2026-07-12]**
`lib/services/reviewer-identity-binding-contract.js` now freezes the non-I/O
contract: checksum-valid `orcid:`, exact OpenAlex author `openalex:`, and
server-created `staff-attestation:` anchors only; coherent bound/unbound tuples;
and deterministic strict lineage for the seven overlapping fields. Lineage is
capped at 2,048 UTF-8 bytes, rejects unknown keys/sources/future generations,
and requires every non-null field to have exactly one entry. ORCID and Scholar
id/URL pairs must be canonical; metrics retain their live schema ranges.

If proposal COI is derived from a person binding, persist or otherwise prove
both the binding version and the authoritative proposal/rule context used for
that decision. Wave 13 carries `wmkf_identitycoistatus`,
`wmkf_identitycoibindingversion`, `wmkf_identitycoicontexthash`, and
`wmkf_identitycoicheckedat` on the suggestion. The context hash is lowercase
SHA-256 over a canonical, versioned server-side COI context; the exact input
normalization and rule-version contract must be frozen and tested before a
writer lands. Missing/unknown status, a mismatched/unknown binding version, or
a missing/mismatched context hash is stale and fails closed until recomputed.
Do not persist a separate `stale` status or opaque eligibility boolean.

`lib/services/institution-coi-context.js` now freezes the pure proposal-side
institution context hash: server-loaded authority only, lowercase request GUID,
exact canonical institution tuples, deterministic sorting, explicit rule
version, and lowercase SHA-256. It deliberately excludes coauthor COI: current
save does not recompute that decision authoritatively. A structured `clear` is
forbidden until every reviewer-affiliation signal used by the decision is
server-owned and covered by the binding generation; client candidate or
workbench `analysisResult` inputs cannot establish durable currency.

### I1.2 Transition table

Define and test these transitions before schema deployment:

| Event | Source | Version behavior | Required invalidation/recompute | Action posture |
|---|---|---|---|---|
| automated first resolution | automated | create v1 | derive allowed fields | eligible only if policy passes |
| automated same-person replay | automated | no bump when materially identical | idempotent refresh only | unchanged |
| automated different-person result | automated | bump | replace matching-lineage fields; recompute COI | blocked until complete |
| PD “right person” confirmation | staff_confirmed | bump | clear automated identity bundle; retain explicit staff fields; recompute COI | blocked until complete |
| staff identity-bearing correction | staff_confirmed | bump | invalidate superseded derived state | blocked until complete |
| reviewer self-report | self_reported | bump | self-report wins; invalidate/recompute dependent state | downstream only after durable commit |
| later correction/revocation | explicit correcting source | bump | invalidate old binding and action state | blocked until complete |
| merge | compare binding source/version | preserve higher-trust/current binding by explicit rule | never discard live attestation silently | fail closed on ambiguity |

Unknown source/version and stale derived versions are explicit negative test
cases, not fall-through defaults.

### I1.3 One writer and one policy reader

Replace status-only adapter guards with a shared binding writer that:

- reads current binding fail closed;
- enforces source precedence;
- detects materially identical replay;
- advances the version only for a real transition;
- writes the binding plus explicit invalidations as one coherent operation;
- returns the committed binding used by downstream consumers.

Create one pure action-policy helper used by invite/send, ORCID back-propagation,
and merge protection. Sibling consumers may add stricter domain rules but may
not reinterpret confidence as provenance.

The future writer must use optimistic concurrency: read `@odata.etag`, compute
the transition, and issue the one coherent PATCH with `ifMatch`; a 412 rereads
and recomputes through a small bounded retry. Human-event replay identity is
durable, not `new Date()`: staff uses the server-created confirmation UUID, and
self-report uses canonical ORCID plus the engagement's stable acceptance
timestamp. Replaying the same event is a no-op; a later correction event bumps
even when the visible ORCID text is unchanged. Any staff/automated affiliation
change that can affect institution COI must advance the binding generation or
invalidate linked suggestion currency.

---

## I2 — Schema delivery, backfill, and complete consumer migration

### I2.1 Schema delivery

**[VERIFIED]** Dataverse schema is delivered through declarative waves and
`scripts/apply-dataverse-schema.js`; the apply engine creates missing attributes
but does not reconcile a divergent existing definition.

**[DEPLOYED + METADATA-VERIFIED; NON-AUTHORITATIVE 2026-07-12]**
`lib/dataverse/schema/wave13-reviewer-identity-binding/` contains two additive
extension specs (ten fields total), and
`scripts/preflight-reviewer-identity-binding-fields.mjs` derives the expected
metadata from those specs. The production-only apply was explicitly approved
after the owner classified the ancient sandbox as unsuitable. Fresh preflight
reported 10 ABSENT / 0 EXACT / 0 DIVERGENT; execute created all ten attributes;
post-apply typed verification reported 0 ABSENT / 10 EXACT / 0 DIVERGENT. No
application code selects or writes the columns, so schema creation did not
change production behavior. A post-apply row probe found zero person or
suggestion rows with any Wave 13 field populated.

**[SANDBOX EXCEPTION APPROVED 2026-07-12]** The documented
sandbox target (`orgd9e66399.crm.dynamics.com`) is reachable, but the Wave 13
preflight fails because `wmkf_appreviewersuggestion` does not exist there. The
combined wave was not partially applied there. The owner identified that
sandbox as ancient/unknown and approved the established production dry-run →
execute → metadata-verify exception. This exception authorizes only the
additive schema operation; runtime readers/writers and transition semantics keep
their separate promotion gates.

Use a new isolated string-suffixed wave such as
`wave13-reviewer-identity-binding`; do not append to or rerun wave6 as the new
delivery unit. Add a preflight with three outcomes:

- `ABSENT` — creation path;
- `EXACT` — safe idempotent no-op;
- `DIVERGENT` — abort before application code deploys.

Deployment order:

1. sandbox dry-run;
2. sandbox execute and metadata verification;
3. production dry-run;
4. production execute and metadata verification;
5. only then deploy readers/writers that select the new columns.

Rollback disables new application reads/writes through an explicit compatibility
gate. It does not drop columns.

Commit the manifest/preflight first. Apply the additive schema as a separate
owner-approved operation while all production readers still ignore it. Land
dual writers and shadow readers in later short branches; no single merge may
both create the fields and make them authoritative.

### I2.2 Conservative legacy backfill

Do not infer human attestation from `wmkf_identitystatus = 'confirmed'` alone.
Classify legacy rows only from recoverable explicit evidence/audit provenance.
Unproven rows remain `legacy/unbound` and require review before an
identity-dependent action.

Provide dry-run/summary/apply/verify modes, resumable checkpoints, before/after
counts, per-category samples, and idempotent replay. Backfill scripts identify
their writes as automated unless evidence proves another source.

### I2.3 Symbol-consumer and projection migration

Migrate every live trust consumer, not only the adapter and merge guard:

- identity writer/clear paths in contact enrichment, save-candidates,
  workbench enrichment, self-report, and both identity backfills;
- invite rendering and server send enforcement;
- ORCID back-propagation and its workbench/send/honorarium callers;
- merge protection and merge DTOs;
- acceptance drain ordering—remove the synthetic in-memory `confirmed` value
  and durably rebind before honorarium/back-propagation;
- external-token, render, send, merge, and backfill `$select` projections;
- PR4/e2e verification scripts and any script that treats
  `status === 'confirmed'` as provenance.

Keep specialized projections least-privilege, but include every field required
by the shared policy helper. Grep the raw persisted field names after migration;
map/helper-symbol searches alone are insufficient.

### I2.4 Durable surfaces and gates

Update in the same phase:

- `docs/atlas/dataverse-wmkf-potentialreviewers.md`;
- `docs/DATAVERSE_CUSTOM_SCHEMA_INVENTORY.md`;
- `docs/REVIEWER_DATA_MODEL.md`;
- reviewer identity wiki/design docs;
- `docs/API_ROUTE_SECURITY_MATRIX.md` if save request/response semantics change;
- this plan and linked memory.

Run sequentially where defined: schema preflight, scoped tests, full tests,
types, `check:atlas` + self-test, `check:api-routes` + self-test,
`check:dataverse-access-layer` + self-test, `check:route-service-boundary` +
self-test, `check:docs-catalog`, `check:fact-consistency` + self-test,
`check:doc-symbol-refs` + self-test, and `check:build-claim-freshness` +
self-test. Run `/contract-reconcile` and `/sweep` before completion.

---

## H1 — Evaluation-backed resolver hardening

### H1.1 Status semantics

After I1 separates confidence from provenance, decide whether automated
high-confidence results retain `confirmed` as a confidence label or are renamed.
This is a UI/evaluation decision, not an attestation-safety mechanism. Any
change must pass M1 without weakening abstention or action safety.

### H1.2 Name-comparison consolidation

Re-verify the three candidate implementations in discovery name matching,
reviewer identity evidence, and the work-author resolver. Write characterization
tests against M1 fixtures first, then extract existing semantic predicates into
one module with passthrough/no-default behavior.

Do not collapse distinct semantics such as exact exclusion, fuzzy author
matching, display dedupe, and persistence identity resolution.

### H1.3 Early-career/no-ORCID decision

**[OWNER-GATE]** Either run the independently labeled stratum-3 evaluation or
document the accepted posture that these names abstain to a human. Do not call
an unmeasured slice implemented.

---

## F1 — Finding investments

### F1.1 Staff referral loop — shipped

**[VERIFIED]** The workbench surfaces decline referrals and pre-fills the normal
Add-or-Refer flow. Do not rebuild it. The open work is measurement in M1.3 and,
separately, an **[OWNER-GATE]** on whether an external decline-acknowledgment
email is worthwhile.

### F1.2 Applicant recommendations as neighborhood seeds

Test applicant-suggested names/affiliations as community anchors in analyze,
with explicit exclusion of those people from returned candidates. Keep this
prompt-level first; no new retrieval lane. Verify exclusion at the final output,
not only dedupe.

Prompt changes follow the Dataverse-resolved prompt plus Executor contract.
Production reseed remains the owner’s step. Evaluate through M1.2; do not cite
the historical narrow 65/35 experiment as proof of this design.

### F1.3 Stage panel assembly

Only after M1 identifies a measurable need, test the comparison memo’s staged
workflow: establish panel intent, generate a broad inexpensive slate, let the
PD shortlist, and deeply enrich/disambiguate only kept candidates. Measure
staff rescue work and time-to-panel-ready; do not assume this is faster.

---

## F2 — Controlled live pilot and promotion decision

Offline comparison cannot measure acceptance or completed reviews while the
redesign remains off production. A limited pilot therefore follows the offline
gate and precedes full promotion.

Before the pilot, record immutable proposal-to-arm assignment and pipeline
commit/version. If the mutable suggestion ledger cannot preserve that event,
add the smallest durable experiment surface or classify the pilot as
observational; do not claim causality from mutable `selected` state.

### Production routing and rollback contract

The pilot must run through a server-owned assignment boundary:

- both pipeline versions are deployed behind a fail-closed dispatcher;
- baseline is the default for an absent, unknown, malformed, or unreadable
  assignment;
- staff/client payloads cannot select an arm;
- an assignment is immutable for a request once its first pilot run begins;
- every generated/saved suggestion is attributable to pipeline commit/version
  and assignment version;
- disabling new redesign assignments does not rewrite historical attribution;
- rollback returns unassigned/new requests to baseline without making existing
  redesign-derived rows appear to be baseline output.

Before choosing a storage mechanism, probe existing app-setting and suggestion
surfaces. If no existing surface can enforce immutable assignment plus durable
attribution, write a separate owner-gated durable-surface design and run
`/contract-reconcile`; do not hide the pilot in an environment variable or a
client-supplied flag. Production deployment also obeys the Dataverse target
interlock and campaign release strategy.

Pilot metrics:

- selected→invited;
- invited→accepted and invited→declined;
- decline→referral;
- accepted→materials sent;
- materials sent→review received;
- staff-added rescue count and time-to-panel-ready.

Promotion requires:

- all offline safety and proposal gates pass;
- zero unsafe actions in the pilot;
- non-inferior invited→accepted and materials→review-received conversion;
- no increase in staff rescue work or time-to-panel-ready;
- explicit owner promote/stop decision.

With small annual samples, report exact numerators/denominators and confidence
intervals; treat channel results as directional rather than claiming powered
superiority.

---

## D1 — Post-decision cleanup only

D1 does not run while building or evaluating the redesign.

### D1.1 Track B deletion **[OWNER-GATE]**

Immediately before deletion, re-verify that `TRACK_B_ENABLED` has no runtime
override and enumerate all live imports/callers. Preserve any live
`track-b-identity` helpers until their consumers migrate. Characterize
`discover()` at the accepted redesign commit and prove output is identical
before/after cleanup.

Delete only after the redesign has passed F2 and the owner chooses promotion.
Reconcile the discovery facade compatibility contract, wiki, plans, tests, and
all `TRACK_B` restatements.

### D1.2 Historical plan retirement

Add supersession/classification banners to retrieval-first plans whose posture
is no longer current. Preserve historical content; do not rewrite history as if
the old direction never existed.

### D1.3 Heuristic consolidation

Institution aliases, recency calculations, and biology-biased synonyms are
separate behavior changes unless characterization proves otherwise. If any
fixture output changes, stop and return to owner/evaluation rather than folding
the change into cleanup.

---

## Sequencing and gates

| Order | Phase | Lane | Owner gate | Exit evidence |
|---|---|---|---|---|
| 1 | B0 manifest foundation | short Tier-0/1 branch → main | approved | validator + draft manifest |
| 2 | M1 measurement | short behavior-free branches → main | label/rubric approval | independent benchmark + observational baseline |
| 3 | C0 containment | one Tier-2 branch per invariant → main | per-slice promotion | contract trace, tests, capture send gate |
| 4 | freeze baseline | tracked manifest update | owner approval | exact post-containment commit + frozen inputs |
| 5 | I1 binding contract | design/tests/seam branches → main, legacy default | schema/semantics | transition table + policy seam |
| 6 | I2 expand/dual-write/backfill | separate Tier-2/3 branches → main | production schema + read switch | verified metadata, shadow parity, full fan-out |
| 7 | H1 hardening | cohort-disabled branch → main | stratum/status choices | benchmark non-regression |
| 8 | F1 finding experiments | baseline-default dispatcher → main | prompt/cohort activation | blinded proposal comparison |
| 9 | F2 controlled pilot | deterministic production cohort | pilot + promote/stop | downstream outcomes + owner decision |
| 10 | campaign observation | old/new coexist | expansion approval | one complete campaign without safety regression |
| 11 | D1 cleanup | post-observation branch | destructive approval | live-caller audit + behavior freeze |

## Collected owner decisions

1. Approve each C0 runtime promotion after its evidence bundle.
2. Approve the M1 label set, rubric, thresholds, and adjudicator before freezing.
3. **Durable fields approved/deployed 2026-07-12;** approve transition semantics
   before runtime writers/readers activate.
4. **Additive production schema execution approved/completed 2026-07-12,**
   separately from code deployment.
5. Decide early-career/no-ORCID evaluation versus explicit abstention.
6. Decide whether to test applicant recommendations as prompt-level community
   seeds and authorize any production prompt reseed.
7. Decide whether an external decline-referral acknowledgment email is useful.
8. Approve the limited live pilot after offline gates pass.
9. Record promote/stop after the pilot.
10. Approve Track B deletion only after promotion and campaign observation.

## Completion rule

“Ready to merge” requires every applicable contract-reconcile audit: whole
flow, partial success, async/stale state, helper semantics, durable surfaces,
doc reconciliation, and raw-symbol consumer fan-out. Any unverified claim stays
`[ASSUMED]`; any red relevant gate blocks completion.
