---
title: How We Use AI Across Our Apps
domain: prompt-executor
kind: spec
status: historical
summary: "Historical plain-language prompt overview; incomplete for the current app registry and not a source of prompt truth."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-07-26
owner: product-engineering
---

# How We Use AI Across Our Apps

> **STALE INVENTORY — do not use as a current prompt or app catalogue.** The
> current system mixes Dataverse prompt rows, bundled prompts, route/service-local
> instructions, deterministic tools, and multiple providers. Several PDF-upload
> apps below were sunset in S344, while current apps and Executor consumers are
> omitted. Use source, live prompt rows, `shared/config/appRegistry.js`, and
> `docs/EXECUTOR_CONTRACT.md` for current behavior.

AI-backed surfaces send task-specific instructions to one or more providers.
This page preserves a plain-language historical overview; it does not enumerate
every active app or prompt.

## Common rules in several historical prompt families

- Neutral/non-effusive tone and no-fabrication instructions appear in several
  proposal/reviewer prompt families, but they are not universal enforcement
  rules across every provider and surface.
- Investigator-name underlining and title casing are output-format rules for
  specific writeup prompts, not global AI policy.

---

## Phase II Writeup / Batch Phase II Summaries _(sunset S344; historical)_

Reads a full Phase II research proposal and produces a **two-part writeup**:

- **Part 1 (Summary Page):** Plain-language for educated non-specialists — Executive Summary, Impact, Methodology Overview, Personnel, Rationale for Keck Funding.
- **Part 2 (Detailed Writeup):** More technical — Background & Impact, Methodology, Personnel.
- Also extracts metadata (institution, PI, funding amount, keywords).
- Staff can ask follow-up Q&A about the proposal.
- Part 1 must avoid all jargon; Part 2 may use technical terms but must define abbreviations.

---

## Batch Phase I Summaries _(sunset S344; historical)_

Analyzes a Phase I proposal and produces a summary plus **four evaluative bullets**:

1. **Impact & Timing** — significance and urgency
2. **Funding Justification** — with specific dollar figures from the budget
3. **Research Classification** — basic vs. applied science, with the fundamental question quoted if identifiable
4. **Keck Alignment** — evaluated against "What We Fund" and "What We Do Not Fund" criteria

---

## Phase I Writeup _(sunset S344; historical)_

Produces a **one-page standardized writeup** with: institution name, an italicized "To..." project title, a Summary paragraph, and exactly four Rationale bullets (Significance, Research Plan with numbered aims, Team Expertise, Foundation Opportunity). The word "paradigm" is forbidden.

---

## Concept Evaluator

> **⚠️ RETIRED 2026-04-25 (Session 110).** This app's page/API/prompt were archived to `/_archived`; it is no longer in the registry or nav. The prompt description below is **retained for reference only** — it is not a live workflow.

A **two-stage pre-screening** tool. Stage 1 reads a concept page image and extracts key info plus search keywords. The system then searches academic databases (PubMed, arXiv, bioRxiv, ChemRxiv). Stage 2 uses those results to rate the concept on five dimensions:

- **Novelty** (Strong / Moderate / Weak)
- **Keck Alignment** (Strong / Moderate / Weak)
- **Scientific Merit** (Strong / Moderate / Weak)
- **Potential Impact** (Strong / Moderate / Weak)
- **Feasibility** (Strong / Moderate / Weak)

Claude is told to be skeptical — "Strong" should be rare (top 10-20%). It checks whether NIH/NSF/DOE could fund the work (if yes, it's not a strong Keck fit).

---

## Multi-Perspective Evaluator

An expanded concept evaluation from **three viewpoints** — Optimist, Skeptic, and Neutral Arbiter — then synthesized into a final recommendation. Includes eligibility screening against nine Keck exclusion categories (medical devices, drug development, clinical trials, digital twins, etc.). Produces a weighted recommendation:

- **Strong Recommend** / **Recommend** / **Borderline** / **Not Recommended**

Each recommendation includes conditions for further consideration.

---

## Literature Analyzer

Processes uploaded research papers in two stages:

- **Stage 1:** Extracts structured info from each paper (title, authors, methods, findings, conclusions, keywords).
- **Stage 2:** Synthesizes across all papers — common themes, methodological patterns, established vs. emerging findings, research gaps, and contradictions.

---

## Funding Analysis

Analyzes a proposal against **real-time federal funding data** (NSF, NIH, optionally DOE/DOD/NASA). Shows the PI's existing awards, keyword-based funding trends, and gaps. Produces tables with specific award counts and dollar amounts, plus 3-5 recommended next steps.

---

## Reviewer Finder

Analyzes a proposal and suggests approximately 12 **peer reviewer candidates**, each with:

- Name and institution
- Expertise areas
- Seniority level
- Reasoning for why they are a good fit (scientific fitness only)

Conflict-of-interest screening is deterministic and server-side (same-institution default hard drop with a narrow read-only contradicted-evidence flag, graded co-author overlap), not part of the model's output — the `POTENTIAL_CONCERNS` advisory was retired (S254). Candidates should span seniority levels and all disciplines covered by the proposal.

### Reviewer Invitation Emails

Takes a template email and adds **one sentence of personalization** based on the reviewer's expertise and the proposal. Maintains formal academic tone — no effusive praise.

---

## Peer Review Summarizer

Takes multiple peer reviews for a proposal and produces:

- **Grade summary** and reviewer details
- **Key quotations** ordered from most positive to most critical
- All **questions and concerns** raised
- **3-5 thematic patterns** with consensus/disagreement analysis
- **Prioritized action items** (Critical / Important / Minor) noting which reviewer raised each point

---

## Integrity Screener

Checks PubPeer and news sources for **research integrity concerns** about applicants:

- Data fabrication, image manipulation, plagiarism
- Misconduct allegations, legal issues, ethical violations
- Distinguishes allegations from confirmed findings
- Flags false-positive risk for common names

---

## Dynamics Explorer

A **conversational CRM assistant** — staff ask questions in plain English (e.g., "Show me all Phase II pending requests for S&E") and Claude translates them into database queries against our Dynamics 365 CRM. Key features:

- Knows Foundation jargon ("the ask" = amount requested, "PD" = program director, "S&E" = Science & Engineering)
- Returns formatted tables
- Supports Excel exports
- Can pull SharePoint documents attached to requests
- Never fabricates data — only shows what the CRM returns

---

## Historical prompt-to-app reference

| App | Prompt(s) Used |
|-----|---------------|
| Phase II Writeup / Batch Phase II | Proposal Summarizer |
| Batch Phase I Summaries | Phase I Summaries |
| Phase I Writeup | Phase I Writeup |
| Concept Evaluator _(retired 2026-04-25; reference only)_ | Concept Evaluator |
| Multi-Perspective Evaluator | Multi-Perspective Evaluator |
| Literature Analyzer | Literature Analyzer |
| Funding Analysis | Funding Gap Analyzer |
| Reviewer Finder | Reviewer Finder + Email Reviewer |
| Peer Review Summarizer | Peer Reviewer |
| Integrity Screener | Integrity Screener |
| Dynamics Explorer | Dynamics Explorer |
