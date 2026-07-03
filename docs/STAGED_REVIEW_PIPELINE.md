---
title: Staged LLM-Assisted Proposal Review Pipeline
domain: prompt-executor
kind: history
status: active
summary: Proposals flow through stages sequentially. Staff review is required before any proposal is declined at Stage 1. Stages 2 and 3 produce inputs for...
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md
---

# Staged LLM-Assisted Proposal Review Pipeline
## W. M. Keck Foundation — New Cycle Design

> **Status (2026-05-08):** Not yet built. No `pipeline_proposals` table, no Fit Screener app, no Pipeline app. Build plan is in `docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md`. The Virtual Review Panel (Stage 3 dependency) is shipped and running. Cycle redesign is still in flight (concepts being eliminated, Phase I + II likely merging into one applicant package); the per-stage prompts and routing below are valid design once the redesigned cycle locks, but the volume assumption ("3x volume") may need to be revisited when the cycle shape stabilizes.

This document describes a three-stage automated triage and review pipeline for evaluating a higher volume of full proposals. Each stage has a defined purpose, a set of inputs and outputs, and a clear handoff to the next stage or to staff. The pipeline is designed to complement staff judgment, not replace it — LLM outputs at every stage are advisory, not decisional.

---

## Overview

| Stage | Name | Purpose | Model Tier | Output |
|---|---|---|---|---|
| 1 | Fit Screening | Filter clear mismatches | Fast/cheap | Pass / Flag for staff |
| 2 | Intelligence Brief | Assess novelty, prior art, PI capability | Search-capable + cheap | Structured brief for staff |
| 3 | Virtual Panel Review | Approximate peer review for shortlist | Full pipeline | Panel report with resolvable/fundamental concerns |

Proposals flow through stages sequentially. Staff review is required before any proposal is declined at Stage 1. Stages 2 and 3 produce inputs for staff decision-making, not automated decisions.

---

## Stage 1: Automated Fit Screening

### Purpose
Filter proposals that clearly fall outside Keck's mission or submission requirements before staff time is invested. At 3x volume, this stage recovers significant staff capacity.

### Inputs
- Full proposal text
- Keck Foundation mission statement and eligibility criteria (injected as system context)

### Model
Fast, low-cost model (e.g., Claude Haiku or equivalent). No search capability needed.

### Prompt Design
Ask the model to evaluate the proposal against a fixed checklist and return a structured JSON output. Do not ask for narrative assessment at this stage — binary flags only.

Checklist items:
1. **Discipline fit** — Is this basic science research? Flag if applied, translational, clinical, commercial, or product development.
2. **Mission fit** — Does the proposed work align with opening new scientific directions, producing breakthrough discoveries, or developing new technologies? Flag if incremental, confirmatory, or primarily applied.
3. **Institutional eligibility** — Is the applicant a US-based academic institution? Flag if not.
4. **PI type** — Is this a single PI or small team proposal, not a large center or consortium grant? Flag if scope suggests a center-scale effort.
5. **Completeness** — Are all required sections present (aims, methods, budget, team)? Flag if sections are missing or clearly placeholder.
6. **Budget range** — Is the requested amount within Keck's typical range (~$1-2M)? Flag if substantially outside this range.

### Output Schema
```json
{
  "proposalId": "string",
  "overallFlag": "pass | flag | decline_recommend",
  "flags": [
    {
      "criterion": "string",
      "status": "pass | flag",
      "reason": "One sentence explanation if flagged"
    }
  ],
  "staffNote": "1-2 sentence summary of any flags for staff review"
}
```

### Routing Logic
- **No flags → pass to Stage 2 automatically**
- **1-2 flags → route to staff for quick review before Stage 2**
- **3+ flags or any flag on discipline/mission fit → route to staff for possible decline**

### Important Constraint
No proposal should be declined without staff confirmation. Stage 1 outputs are recommendations, not decisions. A misclassification here is an unrecoverable false negative.

---

## Stage 2: Intelligence Brief

### Purpose
For proposals that cleared Stage 1, produce a structured intelligence brief that helps staff read the proposal critically. This stage surfaces prior art, assesses novelty claims, and identifies PI capability gaps — the things non-expert staff are least positioned to catch on their own.

### Inputs
- Full proposal text
- Stage 1 output (for context)
- API access to: Perplexity (sonar-pro), OpenAlex (academic works/authors — replaces the retired SerpAPI/Google Scholar path, S251), arXiv

### Model Sequence
This stage runs four sub-tasks, three of which can execute in parallel after the first.

#### Sub-task A: Claim Extraction (fast/cheap model, sequential)
Extract structured search inputs from the proposal. This runs first and feeds into B, C, and D.

Prompt the model to return:
```json
{
  "proposalClassification": "experimental | instrument-building | theoretical | AI-driven | hybrid",
  "noveltySearchStrings": ["3-6 word search strings for each novelty claim"],
  "techniqueSearchStrings": ["search strings for core methods"],
  "piNames": ["PI and co-PI names with institution"],
  "field": "primary field/subfield in 1-2 words",
  "coreHypothesis": "One sentence: what does this proposal claim will happen if it works?"
}
```

#### Sub-task B: Field Landscape (Perplexity, parallel)
Search for active groups, recent key papers, open problems, and competing approaches. See `virtual-review-panel.js` → `createFieldLandscapePrompt` for full prompt.

Key outputs:
- 5-8 active competing groups with recent publications
- 4-6 most relevant recent papers with relevance notes
- Open problems this proposal addresses (or claims to)
- Competing approaches not discussed in the proposal

#### Sub-task C: Prior Art and PI Capability (OpenAlex, parallel)
For each novelty claim, retrieve top hits and assess comparability. Separately, pull PI's recent publication record and identify capability gaps.

Key outputs:
- Per-claim novelty assessment (direct / partial / tangential prior art)
- PI published capabilities vs. proposed capabilities — flag any gap where the proposal requires a technique not evident in the PI's record

**Disambiguation note:** When searching for PI publications, always include institution name and field to avoid surfacing a different person with the same name. If the search returns ambiguous results, flag for staff verification rather than guessing.

#### Sub-task D: Preprint Scan (arXiv, parallel)
Search for work posted in the last 12-18 months that may not yet appear in peer-reviewed literature. Flag any preprints representing competing approaches, prior demonstration of claimed novelty, or recent negative results.

#### Assembly
Combine outputs from B, C, D into a single intelligence block using `assembleIntelligenceBlock()`. See `virtual-review-panel.js` for implementation.

### Output: Intelligence Brief
A structured document for staff consumption. Should be readable in 5-10 minutes and highlight only what matters for the gatekeeping decision.

```json
{
  "proposalId": "string",
  "proposalClassification": "string",
  "coreHypothesis": "string",
  "noveltyAssessment": {
    "overallVerdict": "well-supported | partially-supported | questionable | unsupported",
    "keyFindings": ["Specific prior art findings that matter, with comparability notes"],
    "gaps": ["Areas where literature search found no prior art — genuine novelty signals"]
  },
  "piCapabilityAssessment": {
    "strengths": ["Demonstrated capabilities directly relevant to proposal"],
    "gaps": ["Proposed capabilities not evident in publication record"],
    "disambiguationNote": "Confirmed PI identity or flag if uncertain"
  },
  "recentLandscape": {
    "competingGroups": ["Groups working on closely related problems"],
    "recentPreprints": ["Any preprints that affect novelty or feasibility assessment"],
    "fieldMomentum": "Is this field moving fast, slow, or stagnant?"
  },
  "staffFlags": [
    "Specific concerns for staff attention, ranked by importance"
  ],
  "recommendedQuestions": [
    "Questions staff might ask the PI if they want to probe further"
  ]
}
```

### Routing Logic
- Staff review the Intelligence Brief alongside the proposal
- Staff make a judgment call: **decline, hold, or shortlist**
- Shortlisted proposals proceed to Stage 3
- The Intelligence Brief travels with the proposal through all subsequent stages

---

## Stage 3: Virtual Panel Review

### Purpose
For proposals that staff has shortlisted, run a full multi-model virtual panel to approximate what peer reviewers would say. This stage is not a replacement for peer review — it is a structured pre-peer-review reality check that helps staff decide whether to commit external reviewer resources.

### Inputs
- Full proposal text
- Stage 2 Intelligence Brief (injected as context)
- API access to: Claude, GPT, Gemini, Perplexity

### Model Sequence
This stage runs the existing two-stage pipeline from `virtual-review-panel.js`, with the Intelligence Brief injected into both Stage 1 (claim verification) and Stage 2 (structured review) prompts.

#### Panel Claim Verification (Stage 1 of existing pipeline)
Each model receives:
- Proposal text
- Intelligence Brief from Stage 2
- Proposal classification from Sub-task A
- Instruction to apply classification-appropriate scrutiny lenses (see prompt additions in `modify-virtual-review-panel-prompts.md`)

#### Structured Review (Stage 2 of existing pipeline)
Each model completes the WMKF reviewer form with:
- `keyUncertaintyResolution` field: what single piece of information would most change this assessment?
- `proposalClassification` field: confirm or refine classification
- All existing fields from the Virtual Review Panel structured-review prompt

#### Devil's Advocate Pass (single additional call)
One model (rotate between runs to avoid systematic bias) is prompted adversarially:

> "Your sole job is to identify the strongest reasons this proposal should NOT be funded. Do not balance concerns with praise. Assume the Foundation has a limited budget and this proposal is competing against stronger alternatives. What would a skeptical domain expert say? Be specific — name the experiment, assumption, or claim that is most vulnerable."

This output feeds into the synthesis as a labeled "skeptical review" rather than being averaged in with the panel.

#### Panel Synthesis
Run `createPanelSynthesisPrompt()` with all individual reviews plus the devil's advocate output. Synthesis should produce:
- Rating matrix
- Consensus points and disagreements
- `resolvableVsFundamental` classification of key concerns
- `keyUncertaintyResolution` consolidated across reviewers
- Panel recommendation with explicit lean: fund / decline / fund-with-conditions

### Output: Panel Report
The existing panel report format (see `virtual-review-panel.js`) plus:
- Devil's advocate summary as a labeled section
- Explicit statement of what the virtual panel can and cannot assess for this specific proposal type
- Recommended questions for PI conversation if "fund-with-conditions"

### Routing Logic
Staff use the Panel Report to make one of three decisions:
1. **Decline** — concerns are fundamental and the proposal is unlikely to survive peer review
2. **PI conversation first** — concerns are resolvable; schedule a call with the PI to probe key uncertainties before committing to peer review
3. **Send to peer review** — proposal is strong enough to warrant external expert review

For proposals in highly technical or niche areas where the virtual panel's confidence note flags significant domain expertise limitations, consider a lightweight informal consultation with a trusted domain expert before committing to full peer review.

---

## Implementation Notes

### Cost Estimates
Based on observed costs from the review sessions above, Stage 3 runs approximately $0.55-0.60 per proposal across four models. Stage 2 will add search API costs (variable by provider). Stage 1 is negligible. Total automated cost per proposal through all three stages should be well under $5.

### Parallelization
- Stage 2 sub-tasks B, C, D run in parallel after A completes
- Stage 3 individual model reviews run in parallel before synthesis
- Multiple proposals can run through Stages 1 and 2 simultaneously
- Stage 3 should be rate-limited to avoid API throttling

### Data Storage
Each stage output should be stored with the proposal ID as a key so the full history is available to staff and can be passed forward into subsequent stages. Suggested schema:
```
proposal_{id}/
  stage1_fit_screen.json
  stage2_claim_extraction.json
  stage2_field_landscape.json
  stage2_prior_art.json
  stage2_preprints.json
  stage2_intelligence_brief.json
  stage3_claim_verification_{model}.json
  stage3_structured_review_{model}.json
  stage3_devils_advocate.json
  stage3_panel_synthesis.json
  stage3_panel_report.docx
```

### Staff Interface
Consider a simple dashboard that shows:
- All proposals with their current stage and routing status
- Flagged items at each stage highlighted for staff attention
- Intelligence Brief and Panel Report accessible without reading raw JSON
- Ability for staff to add notes and override automated routing at any stage

### What This Pipeline Does Not Replace
Be explicit with staff about these limitations:

1. **Premise-level skepticism** — The most important expert reviewer contributions (e.g., "molecules with short coherence times don't make good sensors") require domain expertise that LLMs cannot reliably replicate. When the virtual panel's confidence note flags this kind of limitation, treat it seriously.

2. **PI track record beyond publications** — The PI capability check catches publication gaps but not lab culture, mentoring track record, or execution history.

3. **Field-specific failure modes** — Known problems with specific reagents, mouse lines, or experimental systems (e.g., off-target effects in specific PrP-deficient mouse lines) require a reviewer who knows that specific subfield literature in depth.

4. **The final funding decision** — Staff judgment, informed by LLM outputs and informed by knowledge of the full portfolio, makes the peer review invitation decision. LLM outputs are inputs to that judgment, not substitutes for it.

---

## Reference Files
- `virtual-review-panel.js` — existing prompt functions for Stages 1-2 of the virtual panel
- `modify-virtual-review-panel-prompts.md` — prompt additions for proposal classifier and keyUncertaintyResolution field
- `add-stage0-intelligence-pass.md` — implementation instructions for Stage 2 intelligence gathering
