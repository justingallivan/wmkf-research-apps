# Reviewer Holistic Reviews — Comparison and Planning Synthesis

Date: 2026-07-09  
Status: planning input; no implementation decision is recorded here  
Scope: reviewer finding, identity/disambiguation, and the recurring decision pattern behind both

## Source reviews

- **Fable review:** [Reviewer Finding & Disambiguation — Holistic Review (Fable)](./reviewer-holistic-review-fable-2026-07-08.md), especially §§0–6.
- **Codex review:** [Reviewer Finding & Disambiguation — Holistic Review (Codex)](./reviewer-holistic-review-codex-2026-07-09.md), especially §§1–6 and the contract-reconcile conclusion.

Both source reviews are tracked beside this comparison. The Codex review was promoted byte-for-byte
from the original gitignored `outputs/reviewer-holistic-review-CODEX-findings.md` artifact on
2026-07-09 so a later session can inspect the complete source rather than relying on this synthesis.

## Executive synthesis

The reviews converge on the same root diagnosis: the system has over-invested in candidate-generation
and identity heuristics relative to the small, human-curated operating scale; identity is fundamentally
a provenance problem rather than one confidence score; a confidently wrong identity is the most
dangerous failure; outcome measurement is too weak; and repeated namesake patches should give way to a
coherent model. Fable states that diagnosis more memorably. Codex reaches substantially the same themes
but is sharper in three ways:

1. It distinguishes measured evidence from proxy evidence and historical experiments from the current
   production pipeline.
2. It checks the recommendations against current code and corrects a stale claim about the referral
   handoff.
3. It treats `confirmed` as one symptom of a missing identity-binding contract, then identifies live
   write, correction, and action-boundary defects that a new label or source field would not repair.

For planning, the Codex review should be the controlling assessment where the reviews conflict. Fable
remains valuable for the strategic frame, prioritization pressure, and description of the recurring
reasoning pattern.

## Comparison at a glance

| Topic | Shared assessment | Fable emphasis | Codex refinement | Planning consequence |
|---|---|---|---|---|
| Operating scale | Small batches and expert judgment should constrain engineering complexity. | The Claude engine is the product; improve it and compound it with referrals. | Keep the incumbent narrowly, but do not generalize a thin historical experiment into a permanent architecture verdict. | Optimize the panel-assembly workflow before funding another origination architecture. |
| Finding | Current investment is too broad and poorly measured. | Close the referral loop, sample more candidates, freeze ranking complexity, remove low-value retrieval work. | The referral staff handoff is already built; stage cheap slate creation, human shortlisting, and deep enrichment. | Measure coverage, shortlist conversion, invitation outcomes, and referral conversion for a cycle. |
| Identity | Provenance matters more than an opaque confidence score; wrong-person certainty is the root risk. | Reserve `confirmed` for human attestation and add a binding-source field. | Separate candidate binding, evidence, attestation, correction/version state, and action eligibility. | Design a versioned identity binding rather than patching the current enum. |
| Self-report | Reviewer self-report is the strongest available human evidence. | Calls it a “perfect disambiguator.” | It proves control by the respondent; it does not retroactively prove that the pre-invitation candidate record referred to that person. | A changed ORCID must trigger rebinding and atomic recomputation/clearing of derived state. |
| Evaluation | A benchmark is needed before more resolver tuning. | Treats the constrained ORCID result as a clean empirical win. | The harness explicitly uses proxy ground truth and cannot establish a `39 wrong → 0 wrong` result. | Build an independently labeled person-level benchmark with abstention and action-boundary outcomes. |
| Change posture | Stop namesake-by-namesake patches and speculative elaboration. | More willing to delete Track B, ranking, and document heuristics now. | Preserve reversibility until current callers, useful subparts, and outcome effects are measured. | Prefer containment and evidence collection before destructive retirement. |
| Recurring pattern | Vivid cases lead to maximal principles, implementation, and later reversal. | “Encode first, let reality vote later.” | Adds that multiple representations then drift across UI, persistence, identity, and send gates. | Require one explicit contract and a cross-layer verification pass before new rules land. |

## 1. Where the reviews agree

### 1.1 The workflow is human-in-the-loop by design

Both reviews reject the premise that the product should autonomously discover and verify the final
panel. The real task is to help a program director assemble a defensible panel efficiently. Fable's
“surface and inform; human decides” discussion is in §1.4; Codex sharpens the same frame in §§1.1–1.3
by asking whether evidence is sufficient for the *next action*, not whether the system can emit a
globally confident person record.

### 1.2 Identity is a provenance and state-transition problem

Both reviews agree that `probable`/`confirmed` cannot safely summarize all relevant questions. At
minimum, the system needs to know what person is believed to be bound, what evidence supports that
binding, whether a human attested, and whether the current state is safe for an invitation. Fable
develops this in §§4.1–4.2; Codex develops it in §§4.1–4.4.

### 1.3 Confidently wrong is the highest-severity failure

Both place wrong-person identity ahead of ordinary ranking weakness. That is directionally right:
wrong binding can contaminate COI evaluation, contact data, bibliometrics, and the invitation itself.
Codex makes the severity boundary more operational by ranking failures at the action boundary (§1.3)
rather than treating a wrong enrichment field and a wrong outbound invitation as equivalent events.

### 1.4 Outcome evidence is underbuilt

Both reviews call for a labeled identity benchmark and better finding outcomes. Neither accepts more
resolver rules or more retrieval architecture as a substitute for observing shortlist, invite,
accept/decline, referral, and panel-composition outcomes. See Fable §§2–4 and Codex §§2.2, 3.3, and 4.5.

### 1.5 The same reasoning pattern is recurring

Fable §6 and Codex §6 independently describe essentially the same failure mode: a vivid edge case is
elevated into a universal principle, encoded across code and prose, and corrected only after later
reality exposes the missing distinction. Codex adds a useful systems observation: each such rule is
copied into several representations, so later correction becomes a cross-layer consistency problem.

## 2. Where Codex corrects or sharpens Fable

### 2.1 The origination experiment supports a narrow decision, not a settled product identity

Fable treats the Claude arm as the product and the 65% versus 35% result as the strongest evidence for
that conclusion (§§0, 1.2, and 3). The underlying experiment is narrower:

- historical Arm A included both Track A and Track B, not the current Track-A-only shape
  (`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:38-50`);
- only one proposal was fully quantified and blinded; the other nine were qualitative and
  source-labeled (`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:55-62`);
- the outcome was an expert sniff-test substitute, not invitation or panel outcome data
  (`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:105-128`); and
- the document itself says the result does not test the full grounded multilane design
  (`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:105-128`).

**Assessment:** Fable's practical preference for the incumbent is reasonable, but “the engine is the
product” is stronger than the experiment warrants. Codex's “keep the incumbent, narrow the claim”
(§3.1) is the better planning rule.

### 2.2 The constrained ORCID harness is proxy evidence

Fable says the ORCID spine moved from “39 confidently-wrong → zero” (§4.2). The harness explicitly
states that its ground truth is a proxy: Claude's claimed institution and field drive selection, and
ORCID employment provides corroboration; it is not an independently labeled person benchmark
(`scripts/eval-orcid-spine-constrained.mjs:17-19`). Its summary labels top-1 affiliation mismatches as
“naive-WRONG,” then counts abstention or a rank change as recovery
(`scripts/eval-orcid-spine-constrained.mjs:154-162`).

**Assessment:** the result is useful evidence that constrained selection and abstention reduce risky
assertion under this proxy. It does not establish that 39 real people were previously misidentified or
that no real people remain misidentified. Codex §§2.1 and 4.5 correctly preserve that distinction.

### 2.3 The staff-facing decline-referral handoff is already built

Fable repeatedly describes referrals as captured but not closed into an operational loop (§§0, 1.2,
2, and 3). In the current tree, the Track Reviewers view surfaces decline referrals and offers “Add as
candidate” (`shared/components/reviewers/ReviewerManagePanel.js:1236-1269`). That action switches to
the Add-or-Refer form, pre-fills the suggested name and referring reviewer, and clears stale identity
anchors before normal resolution (`shared/components/reviewers/ReviewerFindPanel.js:73-107`).

**Assessment:** the Fable claim is **STALE/CONFLICTING** for the current staff handoff. The still-open
question is not whether the staff loop exists, but whether it converts: referral surfaced → candidate
added → invite sent → accepted/declined → panel seated. The separate decline-acknowledgment/referral
email remains deferred (`pages/api/external/review/[token]/respond.js:7`). Codex §2.2 correctly
redirects planning to outcome measurement without conflating those two handoffs.

### 2.4 Self-report is strong attestation, not retroactive proof of candidate binding

Fable calls the response lifecycle a “perfect disambiguator” (§1.3). Self-reported ORCID is strong
evidence about the person who controls the response link, but it does not prove that earlier automated
records, enrichment, or COI decisions were bound to that same person.

The current self-report path overwrites ORCID and writes a confirmed decision
(`lib/services/capture-self-reported-orcid.js:64-87`). It does not, in that transaction, clear or
recompute previously derived Scholar identifiers, metrics, affiliation, website, or COI state. The
adapter's confirmed state is also sticky against later identity-decision writes and identity-field
clears (`lib/dataverse/adapters/researcher.js:251-286`).

**Assessment:** self-report should be treated as authoritative new evidence that triggers a rebind. It
should not merely decorate the old bundle with a stronger status.

### 2.5 A binding-source field is necessary but insufficient

Fable's proposal to distinguish automated from human-confirmed identity (§4.1) moves in the right
direction. Codex correctly argues that the durable model needs more than a source field:

- the bound person/anchor and its version;
- evidence items and their provenance;
- attestation source and time;
- correction/supersession state;
- which derived fields were computed from which binding version; and
- action eligibility at invite/send time.

Without those distinctions, a source field still permits a mixed record: new ORCID, old Scholar
profile, old metrics, stale affiliation, and stale COI conclusion. Codex §§4.1–4.4 provide the more
complete planning model.

### 2.6 Codex identifies live correctness defects outside Fable's strategic frame

These findings materially change sequencing because they are current correctness risks, not future
architecture preferences:

1. **PD override does not reliably clear old identity-derived fields.** The save path passes `null` for
   blocked ORCID/Scholar/metric values, but `upsertByPotentialReviewer` prunes nulls
   (`lib/dataverse/adapters/researcher.js:44-50,122-151`). The explicit clear is inside the
   `!pdConfirmed && identity` branch, so the PD-confirmed branch can leave pre-existing wrong values in
   place (`lib/services/reviewer-finder/save-candidates-service.js:741-776`).
2. **Self-report can create a mixed identity bundle.** The new ORCID is authoritative, but other fields
   derived from an earlier binding are not invalidated atomically
   (`lib/services/capture-self-reported-orcid.js:64-87`).
3. **Staff edits are not an identity rebind.** Editing a saved candidate can change identity-bearing
   fields without a single operation that re-resolves the person and recomputes all downstream state;
   invitation eligibility is evaluated later in another service
   (`lib/services/reviewer-finder/my-candidates-service.js:569-629`;
   `lib/services/review-manager/send-emails-service.js:195-216`).
4. **The authenticated save route accepts nested identity state too trustingly.** The route validates
   that `candidates` is a non-empty array but does not schema-validate each candidate's identity payload
   (`pages/api/reviewer-finder/save-candidates.js:34-49`), while the service consumes
   `contactEnrichment.identity` (`lib/services/reviewer-finder/save-candidates-service.js:608-623`).
   The normal generated path may cap automated decisions, but a crafted authenticated request can bypass
   assumptions made by the UI.

**Assessment:** planning should contain these boundary defects before or alongside a larger identity
model redesign. Renaming `confirmed` alone would leave them intact.

### 2.7 The better finding redesign is staged panel assembly

Fable's finding recommendations emphasize the Claude engine, more sampling, referrals, and removal of
low-value retrieval/ranking work (§3). Codex preserves the useful parts but changes the unit of design:

1. establish panel intent and coverage needs;
2. generate a relatively cheap, broad slate;
3. let the program director shortlist;
4. deeply enrich and disambiguate only the kept candidates; and
5. learn from invitation and panel outcomes.

This sequencing is more consistent with the actual operating scale and avoids paying the most expensive
identity/enrichment cost for every generated name. It also produces cleaner outcome data than comparing
ever more elaborate upstream candidate generators.

## 3. What planning should retain from Fable

Fable contains several strong judgments that survive the corrections above:

- **Keep scale visible.** The annual number of panels and reviewer engagements should be present in any
  architecture decision; sophistication must earn its keep.
- **Protect abstention.** “Unresolved” is often safer and more honest than a weakly supported person
  selection.
- **Treat referral as multiplicative.** Referral is not an independent source; the system must first
  find and contact the person who can refer. The current handoff therefore deserves outcome measurement,
  not dismissal.
- **Stop case-by-case namesake patches.** A benchmark and a state model should precede another resolver
  heuristic.
- **Record outcomes.** The durable evidence should be shortlist decisions, invite decisions,
  accept/decline/referral behavior, and final panel composition—not merely search output quality.
- **Challenge speculative complexity.** Track B, web discovery, ranking layers, and document heuristics
  should each have an explicit measured job or be candidates for retirement.

## 4. What planning should not carry forward unqualified

- Do not cite the historical 65%/35% experiment as proof that the current production pipeline or all
  Claude-assisted origination variants are settled.
- Do not cite the constrained ORCID harness as 39 independently verified wrong identities reduced to
  zero.
- Do not plan “build the staff-facing referral handoff” as new work; verify and improve the
  already-built handoff's conversion and observability. Decide separately whether an external
  decline-acknowledgment/referral email is worthwhile.
- Do not treat self-report as proof that all pre-existing fields belonged to the respondent.
- Do not treat `confirmed` plus one source field as a complete identity model.
- Do not delete retrieval/ranking surfaces solely from the reviews; first complete the live-caller and
  outcome audit required for destructive retirement.
- Do not start vendor procurement until the organization has defined the outcome contract a vendor
  would be measured against. Neither review contains current market evidence sufficient for a
  buy-versus-build decision.

## 5. Planning sequence implied by the comparison

This is a sequencing recommendation, not an implementation plan.

### Phase A — Contain current trust-boundary and correction defects

- schema-validate identity-bearing candidate input server-side;
- ensure manual override, self-report, and staff correction invalidate or recompute dependent fields
  atomically; and
- make invitation/send eligibility consume the current binding rather than a mixture of stale fields.

### Phase B — Define the identity contract

- separate binding, evidence, attestation, correction/version, and action eligibility;
- define which state is proposal-specific and which is reusable person-level evidence; and
- define transitions for automated evidence, staff override, reviewer self-report, and later correction.

### Phase C — Build measurement before more heuristics

- create an independently labeled person-level identity set;
- measure abstention, false binding, correction, and unsafe-action rates;
- instrument shortlist, invite, decline/referral, acceptance, and panel-seating outcomes; and
- establish one-cycle baselines.

### Phase D — Re-shape finding around panel assembly

- make panel intent/coverage explicit;
- postpone expensive enrichment until after human shortlist where feasible;
- use measured gaps to decide whether more sampling, ranking, retrieval, referral UX, or a vendor is
  justified; and
- retire low-value surfaces only after caller and outcome verification.

## 6. Contract-reconcile verdict

**READY WITH NAMED CORRECTIONS as planning input.** The two reviews support the same strategic direction,
but they are not interchangeable evidence. The Fable review is strongest as a strategic and behavioral
diagnosis. The Codex review is stronger as the current-tree contract assessment because it preserves
evidence limits, corrects the referral-loop claim, and traces identity through input, persistence,
correction, and invitation boundaries.

Material claims in this synthesis are classified as follows:

- **[VERIFIED]** The decline-referral staff handoff exists in the current UI.
- **[VERIFIED]** The origination experiment was narrow and partially qualitative.
- **[VERIFIED]** The constrained ORCID harness declares proxy ground truth.
- **[VERIFIED]** Current identity writes and correction paths permit stale or mixed identity-derived
  state in the cases described above.
- **[STALE/CONFLICTING]** Fable's claim that referral capture is not closed into a staff-facing loop.
- **[OVERSTATED]** Fable's `39 confidently-wrong → zero` characterization.
- **[ASSUMED until measured]** Staged panel assembly will improve total staff time or final panel quality;
  it is the better experiment design, not yet a demonstrated outcome.

The focused durable-fact sweep also found two planning surfaces that restated the older claims. This
comparison reconciles them in place: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` now marks
its P3.1 staff handoff as shipped rather than remaining work, and
`docs/REVIEWER_ORCID_SPINE_SPEC.md` now labels the 39-case result as proxy-ground-truth performance
rather than independently proven person identity.

## 7. Source map for future planning

| Question | Primary source |
|---|---|
| Strategic Fable diagnosis | `docs/audits/reviewer-holistic-review-fable-2026-07-08.md` §§0–6 |
| Current-tree Codex assessment | `docs/audits/reviewer-holistic-review-codex-2026-07-09.md` §§1–6 |
| Historical origination experiment and limitations | `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` §§1–3 |
| ORCID proxy-evaluation contract | `scripts/eval-orcid-spine-constrained.mjs:1-19,82-92,125-162` |
| Decline-referral staff handoff | `shared/components/reviewers/ReviewerManagePanel.js:1236-1269`; `shared/components/reviewers/ReviewerFindPanel.js:73-107` |
| Candidate save trust boundary | `pages/api/reviewer-finder/save-candidates.js:34-49`; `lib/services/reviewer-finder/save-candidates-service.js:608-623,741-776` |
| Null-pruning and explicit identity clearing | `lib/dataverse/adapters/researcher.js:44-50,122-151,251-286` |
| Reviewer self-reported ORCID | `lib/services/capture-self-reported-orcid.js:64-87` |
| Staff edit and invitation boundaries | `lib/services/reviewer-finder/my-candidates-service.js:569-629`; `lib/services/review-manager/send-emails-service.js:195-216` |
