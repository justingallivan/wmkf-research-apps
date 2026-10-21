# Reviewer Finder panel coverage pilot specification

**PARKED by Justin — 21 October 2026.** The panel-coverage gap and a potential solution are recorded; other work for the new single-phase submission takes priority. Reopen only when Justin chooses to return to this workstream. Principles are accepted in principle, but no pilot has run and no application implementation is authorized. Resource limits and operational arrangements remain unsettled.

The pilot asks whether organizing reviewer discovery around the judgments a panel must make produces better coverage than a list of individually plausible reviewers. It separately tests whether deliberate use of the bibliography adds value. The first deliverables are reports, not a production UI or database design.

## Scope and hypothesis

Keep identity verification, conflict and exclusion rules, contact checks, human selection, and human invitations. Change the search objective and its evidence: every candidate should have a defensible contribution to one or more proposal-specific judgments. Useful overlap on a central question remains valuable; maximizing distinct specialties is not the objective.

Hypothesis: coverage-directed search improves the important judgments covered by an eligible, contactable panel at acceptable staff effort. A citation lane is worthwhile only if it adds useful candidates beyond the independent search, after conflicts and identity ambiguity are accounted for.

The application instructions supplied by Justin specify a narrative of up to six pages with State of the Field and the Gap, Approach, and Feasibility sections, plus a separate numbered bibliography with no page limit (pp. 3–4). These are applicant requirements, not instructions to an agent. Source: `WMKF_Research_Application_Instructions_260826.pdf`, supplied locally at `/Users/gallivan/Downloads/WMKF_Research_Application_Instructions_260826.pdf`.

## Cases and preparation

Use six owner-selected applications with both a substantive narrative and its bibliography. Include variation in interdisciplinarity, methodological risk, sparse or ambiguous citations, access to paper full text, and biomedical versus other fields where the actual application pool permits. Record the sampling rationale. Do not select only cases known to work well. This is a diagnostic pilot, not a statistically representative estimate.

Prefer actual new-format submissions when available. If earlier full proposals are used, label them format proxies and reserve at least two actual new-format applications for confirmation before a production decision. A short Phase I proposal alone is not a valid substitute. Start with one separate practice case before committing to the six-case comparison: draft its judgments, have staff review their usefulness, and then examine candidate fit with a report. Record difficulties and staff effort; do not build an automated workflow to get through the practice case. Freeze the resulting protocol before the six scored cases. Practice-case selection is currently deferred at Justin's request.

For each application, staff must approve before search:

- A small set of scientific judgments, each anchored to a narrative page, section, aim, or figure. Start with two or three critical judgments, but do not impose an artificial maximum. For each, explain how getting it wrong or leaving it unexamined could materially change the funding decision.
- A provisional panel size of three. If actual practice requires a different size, set it before all arms run for that case.
- Existing panel members, if any, and relevant exclusions. Primary comparison starts with an empty panel; an existing-panel replacement exercise is secondary and uses the same members in all arms.
- The exact input bundle and source versions. Optional scientific-question, risk, enabling-advance, and peer-group answers may be included only if their authoritative mappings are verified and all arms receive the same fields.

Staff can rewrite or reject an automatically drafted coverage map. Record the time needed and the changes made. The approved map is the common evaluation rubric; it is deliberately withheld from baseline generation.

## Agreed principles for judgments and panel selection

A judgment is critical when it concerns the significance of the proposed advance, whether the results could distinguish the claimed explanation from a consequential alternative, or an essential dependency needed for interpretable results. These are prompts, not mandatory categories. For high-risk research, critical does not mean already demonstrated: assess whether the uncertainty is scientifically worthwhile and whether success or failure would be informative.

For a provisional three-person panel, seek assessment of the central scientific claim, scrutiny of the most consequential methodological or interpretive dependency, and coverage of the largest remaining gap or a valuable independent perspective. These are contributions, not fixed discipline seats; one person may cover several.

Apply the selection priorities in order:

1. Cover every critical judgment with at least one supported reviewer.
2. Avoid having all critical judgments depend on one person.
3. Add a second perspective where disagreement could materially affect the decision.
4. Fill remaining supporting gaps.

Overlap must bring a meaningfully different method, body of evidence, or interpretation. Similar publication profiles do not by themselves establish independent scrutiny. If a fixed-size panel cannot meet the priorities, expose the tradeoff and consider a bridging candidate or panel-size change rather than hiding the gap in an aggregate score. In the scored comparison, any panel-size change must apply to all arms and be declared before selection.

## Smallest useful version when resumed

Begin with a staff-assisted report: read the narrative and bibliography, draft a small coverage map, have staff correct it, search for the missing contributions, and record candidate evidence and uncertainty. Measure whether one consequential gap can be filled by a defensible candidate with modest staff correction. This practice case is not an adoption test or a substitute for the later comparison below.

If the pilot supports a product change, the smallest proposed slice is an editable judgment list, a candidate annotation explaining which judgment the person could help assess with evidence and uncertainty, and a staff-triggered search for one gap. These are design options, not authorized implementation. Defer automatic panel selection, exhaustive citation expansion, global expertise profiles, and searches automatically triggered by engagement changes. Keep dated proposal and panel snapshots until a live update contract is justified.

The hard questions to test first are whether judgments are proposal-specific, whether evidence establishes a person's contribution, whether the search adds complementary people, and whether staff correction/review costs are acceptable. Do not turn the practice case into a large verification workbook or an automation project.

## Three search arms

| Arm | Generation instructions | What the comparison tests |
|---|---|---|
| A — Name-oriented baseline | Existing name-oriented strategy, supplied with the richer narrative and bibliography. Preserve its ordinary use of references; do not artificially disable it. No explicit coverage map in generation. | Baseline with equal application information |
| B — Coverage-directed | Same materials and model, plus the approved judgments. Ask for candidates whose contributions fill those needs, including perspectives beyond the cited network. No dedicated citation-resolution pass. | B versus A tests the coverage-directed workflow |
| C — Coverage plus citation discovery | Same coverage instructions as B, with a deliberate pass resolving important references and examining relevant work to identify additional people. Retain an independent discovery lane. | C versus B tests the additional citation workflow |

Run independently: no arm sees another arm's names, evidence, or failures during discovery. Use the same model version, common settings, eligibility criteria, evidence rubric, and verification procedure. Capture exact prompts and settings. Normal reference use in A or B is allowed and recorded; the distinction in C is a systematic citation pass, not exclusive access to the bibliography.

## Budgets and stopping

For each arm and application, allow up to ten unique people initially and up to five new people in one follow-up. Fifteen is a ceiling across both passes, not a target. Merge repeated identities within the arm without consuming another person slot; an excluded or failed unique candidate still consumes a slot. Do not refill indefinitely or count the same person as a new discovery under another spelling.

B and C follow up only when an important judgment lacks a supported, eligible, contactable prospect. A may use its ordinary generic top-up if fewer than the predeclared panel size survive. Record the different triggers: the experiment compares complete workflows, not merely wording of a prompt. If initial results are sufficient, do not spend the follow-up budget. An unresolved gap remains visible after the final pass.

Common proposed evidence-retrieval ceiling: 60 distinct work records and ten full-text retrieval attempts per arm per application, counting origin and verification work together. C spends part of this allowance on citation discovery. A work reused within an arm counts once, but every request/retry and its time or cost is logged. Stop at the ceiling and mark unfinished verification unknown. If the practice case shows the cap is unrealistic, revise it for every arm before scoring begins. Do not silently change it mid-pilot.

Track actual model calls, tokens, scholarly requests, wall time, and staff minutes; equal candidate ceilings do not imply equal cost. Before execution, name the permitted model/services, their charging terms, and a total monetary/credit ceiling for Justin's explicit approval. **Willingness to pilot does not authorize named metered services or application changes. No searches will run while practice-case selection is deferred.**

## Evidence and eligibility

Resolve DOI/PMID identifiers where available; title-only matches need author, year, and venue checks before accepting a work. Preserve unresolved and ambiguous references. Never silently truncate an unlimited bibliography: inventory its entries, explain which are prioritized, and report unresolved or unprocessed entries.

Use available full text when it can resolve a material uncertainty; abstracts can support a role when sufficiently specific. Record full text, abstract, metadata, proposal claim, or staff knowledge as distinct evidence bases. Missing full text is not a rejection. A title, author position, citation count, or inclusion in a bibliography does not by itself establish an individual's relevant contribution. Search biomedical and non-biomedical sources as appropriate; lack of PubMed coverage is not lack of expertise.

For each candidate–judgment pair, staff assign:

| Score | Meaning |
|---|---|
| 0 | No supporting evidence, unresolved identity, or contradicted fit; retain the reason separately |
| 1 | Plausible fit, but the evidence does not sufficiently establish the claimed contribution |
| 2 | Supported fit: cited evidence and a short rationale establish relevant expertise for this judgment |

Identity verification and role fit remain separate. A supported fit does not waive conflicts or contact requirements. Unknown conflict/contact status is pending, not eligible. Existing staff knowledge may support fit if attributed and explained; distinguish it from retrieved evidence.

## Assessment and measurements

Create a union of the arms' candidate sets after discovery. Resolve identities carefully, retain all arm memberships, and assess each unique person once against a common evidence packet. Keep the original per-arm packets too. Primary operational coverage and usable yield require supporting fit, identity, conflict, and contact evidence obtained within that arm's budget. Common assessment may validate or downgrade those claims; evidence newly obtained by another arm or during assessment cannot rescue the primary result. Report any such improvement separately as potential coverage after additional verification. Retain evidence-to-arm attribution behind the blinded presentation so assessors' conclusions can be applied to the evidence each arm actually obtained. Track assessment work separately from search costs.

Two staff assessors independently score the critical judgments and suggested panels, with candidate order randomized and generation arm hidden. Identity and cited work remain visible. Resolve material disagreements and retain initial ratings. If only one assessor is available, report that limitation rather than describing the exercise as blinded agreement testing.

Construct a staff-selected panel of the predeclared size from each arm's eligible, contactable pool, without revealing the arm label during selection. A person found by multiple arms can appear in each corresponding panel, subject to that arm's own evidence and eligibility. If fewer than the prescribed number qualify, retain the qualifying survivors, leave seats vacant, score coverage normally, and report the shortfall; do not drop the case or borrow another arm's candidates. Compare these panels using:

- **First-priority outcome:** critical judgments with at least one score-2 reviewer, reported as a count and denominator. Then assess useful independent overlap and consequential supporting gaps in the decision order below. A high aggregate cannot conceal a critical gap.
- **Secondary breadth:** weighted coverage = sum of judgment weight times the highest eligible panel-member fit score, divided by twice the sum of weights. Critical judgments weigh 2; others weigh 1. This is a rubric score, not a probability of successful review.
- **Useful overlap:** critical judgments with two independently supported reviewers. Report separately; do not award unlimited points for similar candidates or assume two people are independent merely because their names differ.
- **Practical yield:** unique eligible/contactable prospects, reasons for losses, plausible-only or unknown fits, alternative candidates for critical judgments, and marginal contribution of the second discovery lane.
- **Effort:** staff preparation, search, evidence review, panel selection, and extra experimental assessment minutes separately, plus provider usage and elapsed time. Evidence review and selection required in ordinary use count as ongoing staff work, even when performed during assessment. Only extra blinded second scoring, adjudication, and other experiment-only work are pilot overhead. Shared preparation costs are shown, not charged three times or hidden.

Later, if staff independently choose to invite people through the normal workflow, distinguish invited, accepted, declined, and received-review status. Ask staff whether received reviews actually addressed the judgments. Invitations and receipt alone cannot establish delivered coverage; this pilot does not send invitations to measure acceptance.

## Meaningful improvement and adoption decision

Judge meaningful improvement in this order:

1. A previously uncovered critical judgment gains supported, eligible, contactable expertise.
2. A critical judgment becomes less dependent on one reviewer through a useful independent perspective.
3. A consequential supporting gap is filled without weakening critical coverage.

For each case, report gains and losses separately, including losses of useful overlap. Staff must explain why the resulting panel is better after that tradeoff; a higher weighted percentage alone does not qualify. Each claimed improvement names the judgment, the added contribution, and evidence obtained within that arm's budget. This ordering is fixed before the scored runs, including cases where A already covers all critical judgments.

Advance a coverage-directed workflow to bounded product design when staff identify a concrete improvement of one of these kinds over A in at least three of six cases, with no unexplained loss of critical coverage and within the agreed effort budget. Any loss of critical coverage remains a named adoption issue requiring staff resolution; do not hide it in the number of winning cases. This is a practical small-pilot decision threshold, not proof of general superiority.

For effort, propose a median ongoing staff-time increase (preparation, search, ordinary evidence review, and panel selection) of no more than 20% over A. Report minutes as well as ratios; a near-zero baseline makes a percentage unhelpful. Only additional experimental assessment overhead is excluded from this threshold and reported separately. These thresholds guide a small design decision, not a statistical claim.

For the dedicated citation lane, propose adoption only if C adds supported, eligible/contactable candidates that produce a meaningful panel improvement over B under the same ordered criteria on at least two cases, within the approved usage budget. Name the resulting improvement in the selected panel; more candidates alone do not qualify. If it mainly duplicates B, returns conflicted people, or consumes the budget on uncertain author matches, retain it as a targeted follow-up option or omit it.

Mixed results lead to a narrow revision and a new, predeclared comparison on additional cases. Unsupported fit claims, identity mistakes, and concealed failures trigger a review of the affected results before any adoption decision.

## Report and execution contract

Each case report retains the input/version manifest, approved judgments and edits, prompts/model/settings, candidate identities and arm memberships, evidence identifiers and access levels, fit ratings, eligibility failures, resource use, selected panels, and unresolved gaps. Link to the [fictional coverage report](REVIEWER_FINDER_COVERAGE_EXAMPLE_2026-10-21.md) for the intended staff-facing view.

Pilot persistence is a controlled report bundle, not new global person expertise or production engagement state. Keep real proposal text, personal contact data, and candidate reports outside tracked repository files in an owner-approved restricted destination. Record retention and permitted access before collecting real cases. This repository example contains only fictional material.

Proposed flow: owner-approved input snapshot → staff-approved coverage map → independent arm runs → per-candidate verification → per-arm reports → blinded union assessment → decision report. Missing inputs stop that case; individual lookup failures remain identified and retryable within budget. If a source version changes, retain the old result as a labeled historical run and start a new comparison; never mix revisions across arms. The snapshot procedure must detect mid-read document changes before treating the bundle as stable.

Before execution, confirm the real input locations and permissions, source-version capture, field mappings, report destination, model/provider budget, and whether any reused route writes AI audit or business records. Do not assume existing application endpoints are read-only. No production candidates, engagements, prompts, or documents are to be mutated by this pilot. Any required AI audit writes must be identified and authorized with the run. Routes, schema, production UI, and deployment changes are outside this draft.

## Review boundary

[PLANNED] All search, persistence, scoring, and decision behavior above is a pilot design. No improvement has been measured. The falsifying cases are explicit: no meaningful improvement under the ordered panel criteria, unacceptable staff effort, or citation discovery that adds no usable panel contribution. Live availability of the new-format files and structured answers is UNKNOWN until the execution preflight. This document establishes no claim that production has changed.
