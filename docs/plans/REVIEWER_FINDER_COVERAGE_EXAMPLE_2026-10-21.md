# Reviewer Finder example panel coverage report

**Fictional demonstration — no real proposal, reviewer, publication, verification, search result, or measured pilot outcome appears below.** The identifiers and evidence descriptions illustrate the report format. Do not use them for outreach or infer that the strategy has been tested.

This example follows the [draft pilot specification](REVIEWER_FINDER_PANEL_COVERAGE_PILOT_2026-10-21.md). It shows a panel tradeoff rather than an automatically selected winner.

## Application and review decision

Illustrative application: Can patterned mechanical pulses create persistent cell-state changes?

The hypothetical proposal argues that a mechanical perturbation produces lasting cellular memory. It proposes a custom stimulation device, live-cell imaging, and longitudinal molecular measurements. The panel must judge whether persistence is real, whether the device isolates the intended perturbation, and whether the analysis distinguishes a causal change from selection of pre-existing cells.

Illustrative input manifest: narrative revision N1, six pages; bibliography revision B1, 24 references; coverage map revision M2. In a real report, replace these labels with actual file identity/version, content hash, extraction status, and retrieval time. Here, none exists.

Panel budget: three people. Starting panel: empty. Search arm: C, coverage plus citation discovery. Search and evidence counters: not run. Applicant exclusions, author identity, and conflicts below are simulated.

## Judgments the panel must cover

| ID | Judgment | Importance | Hypothetical proposal anchor |
|---|---|---|---|
| J1 | Would the claimed persistence support cellular memory rather than a transient response? | Critical, weight 2 | Narrative p. 2, field/gap; p. 4, Aim 2 |
| J2 | Can the device isolate the intended mechanical exposure from heating or fluid-flow effects? | Critical, weight 2 | Narrative p. 3, Aim 1; Figure 1 |
| J3 | Could the experiments and analysis distinguish induced change from selection or measurement artifacts? | Critical, weight 2 | Narrative p. 4, Aim 2; p. 5, analysis |
| J4 | Can the proposed live-cell measurements sustain the required resolution and duration? | Supporting, weight 1 | Narrative p. 6, feasibility |

Staff note: J3 is critical because failure to distinguish induced change from selection would undermine the central interpretation. J4 remains supporting here, but would become critical if measurement limitations made the results uninterpretable. These designations follow the scientific consequences rather than a quota of critical judgments. They do not require the high-risk project to have already demonstrated success.

## Candidate evidence and eligibility

All status labels in this table are **simulated outcomes**, not checks performed. Evidence E1–E6 refers to invented descriptions in the next section, not real papers.

| Candidate | Discovery route | Distinct contribution | Simulated eligibility/contact | Remaining uncertainty |
|---|---|---|---|---|
| R1 | Both lanes | Persistence mechanisms and causal controls | Eligible; contact corroborated | Limited evidence for device engineering |
| R2 | Citation lane | Independent assessment of persistence mechanisms | Eligible; contact corroborated | Considerable overlap with R1; independence still needs checking |
| R3 | Independent lane | Device controls and perturbation calibration | Eligible; contact corroborated | Analysis expertise only plausible |
| R4 | Independent gap follow-up | Long-duration imaging and measurement failure modes | Eligible; contact corroborated | Less expertise in the central memory mechanism |
| R5 | Citation lane | Possible imaging expertise | Identity unresolved; contact unknown | Title-only work match cannot support selection |
| R6 | Citation lane | Strong apparent device fit | Excluded: simulated recent applicant collaboration | Fit does not override the exclusion |

## Coverage matrix

Scores follow the specification: 2 = supported, 1 = plausible, 0 = no sufficient support. A zero is not proof that the person lacks expertise. Only eligible, contactable candidates contribute to panel metrics.

| Candidate | J1 memory | J2 device | J3 causal interpretation | J4 imaging | Evidence basis |
|---|---:|---:|---:|---:|---|
| R1 | 2 | 0 | 2 | 0 | E1: abstract plus attributed staff knowledge |
| R2 | 2 | 0 | 1 | 0 | E2: abstract |
| R3 | 0 | 2 | 1 | 0 | E3: full text |
| R4 | 1 | 0 | 2 | 2 | E4: full text |
| R5 | 0 | 0 | 0 | 0 | E5: ambiguous metadata; identity unresolved |
| R6 | 0 | 2 | 0 | 0 | E6: abstract; excluded from metrics |

Illustrative evidence notes:

- **E1:** An invented abstract describes controlled longitudinal experiments on persistence. Staff knowledge specifically attributes relevant experimental work to R1. That attribution supports J1 and J3; author position alone would not. A real record would identify the work, exact passage, staff assessor, and rationale.
- **E2:** An invented abstract establishes R2's relevant persistence research but does not establish the proposed analysis contribution. J3 stays at 1. Full text is unavailable in this scenario; that does not erase the abstract-supported J1 assignment.
- **E3:** An invented methods section documents calibration and controls for mechanical, thermal, and flow effects; a contribution statement links R3 to the device work. This supports J2, not the whole proposal.
- **E4:** Invented methods and contributions connect R4 to long-duration imaging, phototoxicity controls, and tracking-error analysis. Those support J3 and J4. They make a memory-mechanism contribution plausible, not established.
- **E5:** A similar title and surname do not establish a work or person match. No role receives supported credit.
- **E6:** Even supported technical fit is removed from usable coverage because the simulated conflict rule excludes R6.

A real evidence record includes DOI/PMID or another stable identifier where available, a source link, access level, date, the relevant passage/location, identity linkage, and a short explanation of the candidate's contribution. This example intentionally supplies no invented DOI or publication link.

## Panel alternatives and tradeoff

| Panel | Members | Critical judgments supported | Weighted breadth | Important tradeoff |
|---|---|---|---|---|
| A | R1, R2, R3 | 3 of 3 | 12/14 = 86% | Two supported perspectives on J1, but no supported J4 reviewer |
| B | R1, R3, R4 | 3 of 3 | 14/14 = 100% | J4 gains coverage; J1 now depends on one supported reviewer |

For Panel A, the best fit scores are 2, 2, 2, 0. With weights 2, 2, 2, 1, the numerator is 4 + 4 + 4 + 0 = 12 and the maximum is 14. Panel B scores 2 on all four judgments. These percentages summarize a fictional rubric; they do not estimate review quality or certainty.

**Illustrative staff decision:** provisionally favor Panel B if the imaging feasibility question needs specialist scrutiny. Keep R2 as an alternative when independent assessment of the central mechanism matters more, or as a replacement for R1. Confirm that J1's single-reviewer dependence is acceptable. Both panels cover all three critical judgments; Panel B does not improve that count. It may qualify as a meaningful improvement because it fills a consequential supporting gap and adds supported overlap on J3, but it loses overlap on J1. Staff must explain why that tradeoff is preferable; the aggregate score does not decide it. R2's independence also needs confirmation before its overlap can be counted as useful independent scrutiny.

The useful follow-up was specific: find expertise in sustained imaging and its failure modes. Another general memory expert would not have repaired the J4 gap. If R4 could not be verified or contacted within the budget, the correct result would remain “J4 unresolved.”

## Predicted versus delivered coverage

Current demonstration state: all eligible candidates are prospects. No invitations, acceptances, or reviews exist.

If a real Panel B were invited, J4 would remain provisional until R4 accepted. A decline would reopen that gap and prompt an explicit staff decision about another search. Even after acceptance, this would be predicted coverage. After receipt, staff would record whether the review actually addressed J4 and identify any missed judgment; receipt alone would not turn prediction into demonstrated coverage.

## What a completed pilot report would add

This example is one hypothetical case view, not an arm-comparison result. A completed report would add candidate memberships across A/B/C, exclusions and lookup failures by arm, initial assessor ratings and disagreements, selected panel comparisons, source-access differences, actual resource/staff costs, and a decision against the specification's predeclared thresholds. All of those results are currently **not measured**.
