# Reviewer Finding & Disambiguation — Holistic Review (Codex)

Date: 2026-07-09  
Repo state reviewed: `main` at `5babd970`  
Mode: read-only architecture audit; no product code or durable documentation changed

## Executive verdict

You are solving a real problem, but the current decomposition is wrong.

**Finding and disambiguation are not two symmetric engines.** The actual job is to help a
PD assemble an invite-ready panel. Finding should cheaply produce *candidate hypotheses*
that cover the panel's scientific needs. Identity resolution should decide what the system
may safely display, persist, or act on for each hypothesis. A person record is the eventual
result of that workflow, not the starting assumption.

The current system instead spends heavily on generating, ranking, and submitting the full slate to
deep enrichment toward a configurable numeric name quota, then stores machine-derived fields as independently merged attributes
on a global person record. That is why the implementation keeps oscillating between recall
and safety patches: the system has no coherent unit called an **identity binding** whose
evidence, fields, decision source, correction history, and action permissions travel together.

My direction is:

1. Keep Claude-assisted origination as the incumbent for now, but stop treating one narrow
   experiment as proof that it is the permanent architecture.
2. Rebuild the workflow around panel coverage and a cheap shortlist before deep contact and
   identity enrichment.
3. Replace the flat `confirmed/probable/unresolved` trust ladder with a versioned binding that
   separates machine evidence from human/reviewer attestation.
4. Treat every rebind or correction as invalidating dependent contact, COI, and identity-derived
   fields until they are recomputed or explicitly retained.
5. Measure the actual funnel for one cycle before another retrieval or resolver expansion.

## 1. Reframe

### 1.1 The problem as I would state it

> Assemble a scientifically adequate, conflict-safe, contactable reviewer panel with the least
> staff effort, while preventing a machine-generated person hypothesis from becoming an external
> action or durable organizational fact without sufficient evidence.

That yields four distinct objectives:

| Objective | Question | Primary owner |
|---|---|---|
| Panel coverage | Does the slate cover the scientific question, methods, and distinct expert communities? | PD, assisted by the tool |
| Action safety | Are we contacting the intended person, and are hard policy conflicts blocked? | Tool must enforce |
| Evidence integrity | Can every identity/contact/conflict assertion be traced, corrected, and invalidated? | Tool must enforce; human adjudicates ambiguity |
| Attention cost | Are exceptions few, compact, and decision-ready? | Product/workflow design |

This is better than “candidate recall + identity integrity.” Recall is not a goal without a panel
need, and identity confidence is not a useful abstraction without naming the action it authorizes.

### 1.2 “Surface and inform; human decides” is incomplete

The slogan does not describe the live system. The tool already makes hard decisions:

- [VERIFIED via `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md:162-212`] current
  same-institution policy conflicts are hard-dropped and rejected again before durable save.
- [VERIFIED via `lib/services/reviewer-finder/save-candidates-service.js:102-128`]
  unresolved system-discovered identities are rejected, while named/cited/referred people receive
  a narrowly scoped exemption with contact fields blocked.
- [VERIFIED via `lib/utils/reviewer-invite.js:72-113`] email provenance and identity state
  determine whether an address is considered high or low confidence at invitation time.

The better rule is:

> **The tool decides mechanical policy and action eligibility. It abstains when a consequential
> action rests on ambiguous identity. Humans decide scientific fit, panel composition, and
> genuinely ambiguous evidence.**

The system should silently decide exact, high-integrity facts and hard policy constraints. It
should not silently turn soft evidence into a person binding. Conversely, it should not surface
every low-value row merely because deletion feels irreversible; PD attention is also a safety
resource.

### 1.3 Rank failures at the action boundary

The prompt's candidate-recall, COI, and identity failures mix causes with outcomes. My ordering is:

1. **Wrong-person outreach or mutation of the wrong person's CRM record.** This is externally
   visible, reputational, and durably contaminating.
2. **A hard-policy or material COI surviving to selection/invitation.** A confidently wrong identity
   is especially dangerous because it can falsely clear this layer.
3. **A panel-level coverage hole** that omits an entire relevant scientific or methodological
   community.
4. **Silent loss of one otherwise good reviewer.** Real, but usually recoverable through a rerun,
   a targeted search, a known-person add, or referral.
5. **A weak candidate or false-positive warning consuming a few minutes of staff time.** Not free,
   but least severe.

“Confidently wrong identity” is therefore a **risk multiplier**, not the final loss function. A bad
binding can corrupt publications, email, COI, CRM linkage, and future reuse simultaneously. Its
severity depends on whether the system merely displays the hypothesis or persists and acts on it.

### 1.4 The repository already contains the right conceptual model—but reviewer identity does not use it

[VERIFIED via `docs/SYSTEM_MODEL.md:89-100`] The system model separates automation from record
maturity. [VERIFIED via `docs/SYSTEM_MODEL.md:271-312`] Its document-resolution design likewise
separates heuristic, authoritative, and human-corrected provenance and lets a human correction
upgrade the artifact's maturity.

Reviewer identity needs the same model. A machine-supported candidate, a staff-confirmed person,
and a reviewer-attested ORCID are not higher points on one confidence scale. They are different
provenance and maturity states with different precedence and correction semantics.

## 2. Where you over- and under-invest

### 2.1 Over-invested

#### Numeric-quota generation instead of panel assembly

[VERIFIED via `shared/config/reviewerFinderPreferences.js:8-20`] The configurable target defaults
to 15 names (the UI range is 1–25) and is explicitly described as the recall lever. [VERIFIED via
`lib/services/claude-reviewer-service.js:484-590`] a shortfall automatically triggers a second call
for exactly the numeric deficit.

That optimizes “return 15 names,” not “cover the three panel needs.” A model returning fewer real
people after being told not to fabricate is useful information. Automatically topping up the tail
from a compressed proposal summary risks turning a safety signal into quota pressure.

#### Deep enrichment before the human shortlist

[VERIFIED via `shared/components/reviewers/ReviewerSearchSection.js:600-692`] the UI runs analyze
and discovery first. [VERIFIED via `ReviewerSearchSection.js:702-738`] it then submits **every kept
candidate** to full enrichment with all source options enabled before the PD selects anyone (individual
tiers may still short-circuit or skip). It reranks the enriched
set and persists the surfaced roster at `ReviewerSearchSection.js:740-782`.

This spends the most expensive and failure-prone work—contact search, ORCID, bibliometrics,
affiliation, domain adjudication—on people a PD may reject in seconds. Existence and rough fit are
pre-shortlist questions; contactability and deep identity are post-shortlist questions.

#### Faux precision in ranking

[VERIFIED via `lib/utils/relevance-score.js:26-99`] the ranker adds exact point weights for
provenance, recent publications, affiliation, source count, and keyword overlap. [ASSUMED based on
no outcome-calibration reference found in the scorer or its callers] The weights are not calibrated
against invitation, acceptance, referral, panel completion, or staff time. At this
volume, a few defensible bands and a coverage view are more honest than a scalar order.

#### Source and dormant-lane complexity

[VERIFIED via `lib/services/discovery/constants.js:39-47`] Track B is disabled. [VERIFIED via
`lib/services/discovery-service.js:138-196`] its four literature-search branches remain wired behind
that constant, while `shared/config/prompts/reviewer-finder.js:333-337` documents the empty
`searchQueries` contract. This is not a live alternative;
it is dormant complexity that makes the active architecture harder to reason about.

Adding another scholarly source is not inherently progress. A grounded publication record can
still represent a trainee, deceased researcher, wrong field, or wrong namesake. Grounding solves
fabrication; it does not solve suitability or identity by itself.

#### Proxy evidence promoted into architectural certainty

[VERIFIED via `scripts/eval-orcid-spine-constrained.mjs:1-19`] the ORCID-spine harness explicitly
uses proxy ground truth. It selects with Claude-claimed institution/topic at `:82-92,125-140`, then
calls top-1 affiliation mismatch “naive-WRONG” and rank>1 selection “recovered” at `:144-162`.
There is no independently labeled person identity.

[STALE/OVERCLAIM via `docs/REVIEWER_ORCID_SPINE_SPEC.md:37-57`] “18 recovered the right record,”
“0 stayed confidently wrong,” and “66% resolved” are stronger claims than this harness supports.
The experiment demonstrates that constrained selection reduces obvious top-1 affiliation mismatch
and increases abstention. It does **not** measure false-binding accuracy.

The origination experiment is similarly narrower than later summaries imply:

- [VERIFIED via `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:25-28`] it substituted
  a PD sniff test for live outcomes and a minimal grounded arm for the designed multilane system.
- [VERIFIED via `:55-62,117-128`] only one proposal was fully blind and quantitatively judged; the
  other nine were source-labeled qualitative scans.
- [VERIFIED via rerunning `scripts/origination-sniff-tally.mjs`] the preserved artifacts contain
  exactly one judged request: the historical Claude-assisted Arm A (Track A + then-live Track B)
  13/20, minimal grounded 8/23, applicant recommendations 4/5. It is not a direct test of today's
  Track-A-only, 15-default/top-up pipeline.
- [VERIFIED via `:105-116`] the grounded arm lacked ORCID-works anchoring and field-routed expansion.
- [VERIFIED via `:83-90`] 39 of 50 applicant-recommended names were surfaced by neither arm
  (Claude-assisted missed 39; grounded missed 49).

This is sufficient to reject **that bare grounded arm**. It is not sufficient to establish a general
65% production yield, prove Claude is permanently superior, or validate the untested multilane design.

#### Global person-state machinery for proposal-context hypotheses

[VERIFIED via `lib/services/reviewer-finder/save-candidates-service.js:741-776`] selected candidates'
machine-derived identity fields and decisions are written onto the global potential-reviewer person.
The per-request suggestion write at `:778-789` keeps relevance, rationale, and sources, but not the
full binding evidence.

This is the wrong maturity boundary. Machine identity is derived partly from proposal-specific topic
and claimed-affiliation context. Human/reviewer attestation may be global; a proposal-context machine
hypothesis should remain attached to the suggestion/binding until promoted.

### 2.2 Under-invested

#### Panel-level intent

[ASSUMED based on the reviewed Workbench flow and no panel-coverage input found] The system infers a
scalar list from the proposal but does not let the PD cheaply confirm the panel's
2–4 coverage needs: question expertise, method/technology, adjacent perspective, or another named
gap. The product should optimize completion of those buckets, not a raw name count.

#### Outcome measurement

The first useful measurement layer mostly exists:

- surfaced roster and provenance: `lib/services/reviewer-roster-store.js:65-94`;
- staff exclusion state: `reviewer-roster-store.js:175-190`;
- saved suggestion anchors: `reviewer-roster-store.js:239-260`;
- Dataverse sources and invitation/response lifecycle: `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:24-46`.

What is missing is a compact, queryable funnel tying a run/model/prompt and structured disposition
reason to: surfaced → shortlisted → saved → invited → accepted/declined → useful referral → identity
correction → late COI disclosure → review completed. The volume is tiny enough that one cycle would
be far more informative than another architecture document.

#### Referral conversion measurement

[VERIFIED via `shared/components/external/DeclineFormView.js:102-111`] referrals are collected, and
`lib/dataverse/adapters/reviewer-suggestion.js:1343-1344` persists them. [VERIFIED via
`shared/components/reviewers/ReviewerManagePanel.js:1236-1269` and
`shared/components/reviewers/ReviewerFindPanel.js:73-105`] decline referrals already surface in
Track Reviewers and hand off through “Add as candidate” into the normal identity-safe Add-or-Refer
flow. The deferred item in `pages/api/external/review/[token]/respond.js:1-8` is the email-trigger
handoff, not the staff workflow.

Referral is not a substitute for the first slate—the engine must contact someone before they can
refer—but it is a high-quality multiplier and a natural source of identity anchors (“X at Y”). The
underinvestment is now measurement and possibly notification, not loop closure: track referral
visibility→add→invite→accept yield before adding more machinery.

#### A labeled identity benchmark

The current evals are useful diagnostic probes, not ground truth. Build a small adjudicated set from
real corrected cases and intentionally difficult controls: namesakes, initials, affiliation drift,
early-career/no-ORCID researchers, OpenAlex merge/split cases, changed emails, and known wrong-person
matches. Measure false-bind precision, abstention, adjudication time, contact correctness, and COI
correctness separately.

#### Correctable identity bundles and invalidation

The live code exposes why this matters:

1. **PD override does not perform the clear its comments promise.** The save service passes null
   ORCID/Scholar/metrics for `pdConfirmed` at
   `lib/services/reviewer-finder/save-candidates-service.js:614-623,741-760`, but the real adapter
   prunes nulls and fill-only merges those fields at `lib/dataverse/adapters/researcher.js:44-50,122-151`.
   The branch then skips `clearIdentityFields` at `save-candidates-service.js:764-776`. Existing wrong
   fields survive. [VERIFIED via `tests/unit/reviewer-route-identity-gate.test.js:562-574`] the test
   asserts only that a mocked call received null and that no clear occurred; it does not construct
   an existing populated row. The test passes for the wrong reason.

2. **Self-report can produce a mixed binding.** `lib/services/capture-self-reported-orcid.js:64-87`
   overwrites ORCID/URL and writes a sticky `confirmed`. The self-report decision replaces the evidence
   summary, anchors, resolver version, and timestamp (`lib/dataverse/adapters/researcher.js:251-262`),
   but prior Scholar IDs, metrics, affiliation, and website survive. Those fields are now orphaned from
   the new self-report-only evidence packet, and `researcher.js:271-286` subsequently refuses to clear
   identity fields on a stored `confirmed`. A corrected ORCID can therefore coexist with an older
   person's derived bundle.

3. **Staff field edits are not a rebind.** `lib/services/reviewer-finder/my-candidates-service.js:569-629`
   updates name, affiliation, website, h-index, and email independently, without clearing/rebinding
   ORCID/evidence or recomputing institution COI. The invitation path then loads the existing person
   bundle at `lib/services/review-manager/send-emails-service.js:195-216`.

4. **Downgrade does not invalidate all action-bearing fields.** The resolver's clear list contains
   ORCID, Scholar, and metrics (`lib/services/reviewer-identity-resolver.js:381-386`), but not email,
   email source, affiliation, website, or faculty page. Meanwhile ORCID/PubMed/institution-page email
   sources read HIGH regardless of the current identity status (`lib/utils/reviewer-invite.js:82-103`).

5. **Persisted evidence is not decision-visible.** The Candidates DTO exposes identity-derived fields
   but omits identity status, evidence, resolver version, and resolution time
   (`lib/services/reviewer-finder/my-candidates-service.js:214-240`). Workbench staff cannot inspect
   what justified the binding they are expected to oversee, even if raw fields remain discoverable
   through broader administrative tools.

These are not five unrelated bugs. They are the consequence of merging independent fields instead of
replacing or invalidating one versioned identity bundle.

## 3. Recommended direction — finding

### 3.1 Keep the incumbent, narrow the claim

Keep Claude-assisted name generation as the default now. It is integrated and useful in production;
the historical Claude-assisted + Track-B arm beat the specific bare grounded arm that was tested.
That comparison does not directly evaluate today's Track-A-only pipeline. Do **not** infer that it is permanently the
best architecture, and do not revive a universal retrieval-first inversion without outcome evidence.

Do not buy or build a universal reviewer-matching platform yet. The repo does not have a sufficiently
defined outcome contract to evaluate one. First measure the real funnel and panel-completion problem;
then a narrowly scoped proof-of-value can compare an external system against the same cases.

### 3.2 Make finding a staged panel-assembly workflow

1. **Draft the panel coverage map.** Let the model propose 2–4 needed roles; let the PD correct them
   before generating more names.
2. **Build a cheap first slate.** Union the currently permitted inputs: Claude suggestions, applicant
   suggestions (visibly labeled and policy-capped), explicit proposal-named people, referrals, and—if
   current staff practice supports it—relevant prior WMKF reviewers.
3. **Run minimum pre-shortlist grounding.** Require full-forename consistency plus a recent in-area
   work or a hard identifier. The question is “is this a real, plausible candidate hypothesis?”, not
   “have we built their CRM record?”
4. **Show bands and coverage, not a faux total order.** Strong fit / plausible / needs identity review,
   grouped by panel role and provenance.
5. **Let the PD shortlist.** This is where human scientific judgment belongs.
6. **Only then run deep identity/contact enrichment** on the shortlist and recompute authoritative COI
   before save/invite.
7. **Target gaps deliberately.** If the shortlist lacks a role, invoke the relevant narrow lane:
   ORCID-works PI trail, proposal citations/named peers, topic→author aggregation, or a field-specific
   source. Do not run every lane on every proposal.
8. **Use and measure the live referral handoff.** Track whether surfaced decline referrals become
   added, invited, and accepted; add notification only if referrals are demonstrably being missed.

### 3.3 Measure this for one cycle

Primary metrics:

- PD minutes to an invite-ready panel;
- proposals that starve before the desired invite count;
- surfaced→shortlisted and shortlisted→invited yield by source;
- accepted-or-useful-referral yield by source;
- wrong-person/contact corrections;
- late-disclosed conflicts;
- coverage of the PD-confirmed panel roles.

Do not tune generation, ranking, or a new retrieval lane until it moves one of these metrics.

## 4. Recommended direction — disambiguation

### 4.1 The `confirmed` sentinel is a symptom, not the model

[VERIFIED via `lib/services/reviewer-identity-resolver.js:231-304`] the automated spine can emit
`confirmed`. [VERIFIED via `lib/dataverse/adapters/researcher.js:224-287`] persisted `confirmed` is
sticky and immune to later probable/unresolved writes and clears because it was designed as human
attestation.

Important reachability nuance: the standard generated path rebuilds the persistence decision in
contact-enrichment `finalize` (`lib/services/contact-enrichment/tiers.js:379-385`) through
`evidenceFromEnrichment` (`reviewer-identity-resolver.js:45-77`), which carries no `spine` or
`identityAnchors`; a candidate-level automated `confirmed` becomes one strong anchor and is normally
reclassified to `probable` (`reviewer-identity-resolver.js:337-354`). Automated overwrite is therefore
latent in the standard UI path, not verified normal-path behavior.

But persisted forged `confirmed` is currently reachable at the request boundary:
`pages/api/reviewer-finder/save-candidates.js:34-49` validates only that `candidates` is a nonempty
array; `save-candidates-service.js:608,771-775` trusts nested client
`contactEnrichment.identity` and passes it to `writeIdentityDecision`. An authenticated crafted
request can submit `status:'confirmed'`, skip the adapter's current-row pre-read, and acquire the
human-attestation semantics. The separation is neither typed nor server-validated.

Downgrading automated `confirmed` to `probable` is an appropriate immediate containment, but not the
architecture. The status currently collapses:

- evidence strength;
- identity resolution state;
- decision source/actor;
- record maturity;
- field persistence permission;
- invitation/contact trust.

One enum cannot safely carry all six meanings.

### 4.2 Model a versioned binding

The conceptual unit should contain:

- candidate hypothesis and context;
- selected person identifiers;
- source-specific evidence and contradictions;
- resolver version/time;
- machine recommendation;
- decision source (`automated`, `staff`, `reviewer`);
- attestation event and actor/time;
- dependent field values with provenance;
- correction/rebind history;
- derived action eligibility.

Use separate state dimensions, for example:

- **Resolution:** `unresolved | ambiguous | machine_supported | disputed`.
- **Attestation:** `none | staff_attested | reviewer_attested`.
- **Action eligibility (derived):** `display_only | shortlistable | contactable | inviteable`.

The exact labels matter less than the separation. Automated evidence should never inherit the
precedence of human attestation. Human attestation should be auditable and correctable, not
un-overwritable. An ORCID typo or a binding correction is a new version, not a forbidden downgrade.

### 4.3 Make correction atomic

A rebind or material correction must:

1. preserve the prior binding as history;
2. replace or clear every identity-derived field as one operation;
3. recompute COI against the new identity/affiliation;
4. recompute email/contact invitation eligibility;
5. make contradictions visible to staff;
6. only then promote the binding's mature fields to the global person/contact.

A reviewer self-report proves the identity of the respondent controlling the invitation flow; it
does not prove that the original candidate hypothesis, publications, rationale, or COI were correct.
If the self-reported ORCID differs from the pre-invite binding, that is a **binding-change event** that
must trigger recomputation—not an in-place ORCID overwrite followed by sticky confirmation.

### 4.4 Put machine evidence at the right maturity layer

Keep the full automated binding on the per-request candidate/suggestion until staff selection or
reviewer attestation promotes it. The global potential-reviewer/contact should hold accepted person
facts and the current binding version, not an unqualified merge of proposal-context guesses.

This aligns with the repo's own record-maturity model and makes future reuse safer. It also gives the
PD a compact evidence packet to adjudicate instead of exposing raw fields without their justification.

### 4.5 Build the benchmark before another resolver rule

Freeze a labeled set and require every new promotion rule to report:

- false-bind precision;
- abstention and unresolved rate;
- adjudication time;
- email/contact correctness;
- COI correctness after binding;
- performance by namesake/initial/early-career/no-ORCID/merge-split strata.

Cross-source agreement and affiliation match are evidence features, not truth labels. Stop calling a
new heuristic “confirmed” until an independent person-level label supports it.

## 5. Stop doing

1. Stop treating a fixed reviewer count as the objective or automatically topping up without a named
   panel gap.
2. Stop submitting every surfaced person to full enrichment before human triage.
3. Stop tuning scalar rank weights without evidence that ordering improves panel completion or yield.
4. Stop treating the one-proposal 65%/35% result as a general architecture verdict.
5. Stop treating proxy ORCID eval output as a false-bind rate or ground truth.
6. Stop emitting automated `confirmed`; reserve attestation provenance separately from machine state.
7. Stop using `confirmed/probable` as a universal allowlist for unrelated fields and actions.
8. Stop fill-only merging identity-derived attributes across binding generations.
9. Stop treating manual field edits as a complete identity correction; make them rebind/recompute events.
10. Stop adding namesake-specific promotion rules without a labeled regression case first.
11. Stop preserving dormant lanes as if wired dead code were a low-cost option.
12. Stop adding sources merely because they exist; each source must fix an observed panel-assembly failure.

## 6. The pattern

The recurring mistake is **category collapse followed by proxy escalation**.

The project repeatedly takes a vivid case or weak proxy, turns it into a maximal principle, encodes
the principle across code and durable prose, and only then discovers that two concepts were collapsed:

- source presence became source correctness;
- scholarly grounding became person identity;
- person identity became contact validity;
- automated confidence became human attestation;
- individual relevance became panel coverage;
- a useful diagnostic probe became a production accuracy claim.

The reversal history is consistent with that diagnosis:

- institution→account auto-linking was reversed after checking the actual wrong-link risk;
- broad web discovery was abandoned after live results fabricated or misattributed people/contact data;
- forename hardening overcorrected initial-only records and required a same-session polarity fix;
- retrieval-first was designed at length before the tested bare lane underperformed;
- the “resolver never emits confirmed” invariant survived in comments after the resolver began doing so.

The discipline to adopt is:

1. **Name the decision and loss first.** “May we invite this email?” is testable; “is this identity
   confirmed?” hides several decisions.
2. **Label ground truth before optimizing.** A proxy may route exploration; it cannot certify accuracy.
3. **Stage before enriching.** Spend identity work in proportion to action consequence.
4. **Keep concepts orthogonal in data.** Evidence strength, actor provenance, record maturity, and action
   eligibility are separate dimensions.
5. **Make correction a first-class event.** Invalidation and recomputation are part of the contract,
   not cleanup after a field edit.
6. **Let one cycle of outcomes vote before the next architecture.** At this scale, the sample is small
   enough to inspect and valuable enough not to substitute with another proxy.

## Contract-reconcile conclusion

**Final verdict: NEEDS REWORK at the architecture/model level.** The live system has meaningful
fail-closed gates and useful production capability; this is not a recommendation to stop using it.
It is a recommendation to stop extending the current abstractions.

Required named changes before another large finding/disambiguation increment:

1. Define panel-level outcomes and collect the current funnel for one cycle.
2. Stage shortlist before full enrichment.
3. Separate machine resolution from human/reviewer attestation.
4. Define an atomic binding correction/invalidation contract.
5. Build a labeled identity benchmark.
6. Measure the live referral handoff and add notification only if conversion data shows a visibility gap.

Audit coverage:

- **Whole-flow:** traced Workbench analyze → discover/COI/rank → enrichment → roster → human select →
  save → Dataverse person/suggestion → invite → reviewer response/correction.
- **Partial success:** save is per-candidate and returns exact successful names; no new batch contract
  proposed here.
- **Async/stale state:** the current Workbench rechecks its generation after analyze, discover,
  enrichment, and roster persistence (`ReviewerSearchSection.js:649,692,738,777`).
- **Helper extraction:** N/A; no implementation proposed.
- **Durable surfaces:** the subject's person/suggestion persistence and read consumers were traced;
  no schema or durable-doc change made.
- **Doc reconcile:** N/A by request; this artifact intentionally does not update canonical docs/memory.
- **Symbol/consumer fan-out:** identity status/evidence was traced through persistence, staff reads,
  email confidence, ORCID back-propagation, merge protection, COI, and self-report correction.

## Evidence gaps retained explicitly

- [ASSUMED] Reviewer self-disclosure catches relationship COI reliably. The repo records the owner's
  operating belief, not a measured disclosure/miss rate.
- [ASSUMED] The ten-year rating retrospective supports “review is a floor, not a ranker.” Its selection
  bias is acknowledged and the underlying dataset is not in the repo.
- [VERIFIED GAP] No tracked raw ORCID-sweep outputs or independent person labels exist.
- [VERIFIED GAP] Early-career/no-ORCID stratum 3 remains untested
  (`docs/REVIEWER_ORCID_SPINE_SPEC.md:152-160`).
- [VERIFIED GAP] No prospective ledger currently joins candidate run/source to shortlist, invitation,
  acceptance, referral, identity correction, COI disclosure, and review usefulness.
- [ASSUMED] Prior-reviewer reuse is a useful source under current PD practice. The UI exposes history,
  but owner history says reuse varies by PD and is currently uncommon; treat it as a measured option,
  not a default strategy.
