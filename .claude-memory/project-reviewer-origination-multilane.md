---
name: project-reviewer-origination-multilane
description: "Historical S239 grounded-origination design and probes. S246 retained Claude-assisted origination; multilane remains a targeted sparse-tail design, not the primary engine. Track B stays off; shared recency ranking is implemented."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-10-22 via Track-B guards, parser, shared ranker, and S246 decision record; S239 probe results retain their original date
---

## Recall Rule
Read before any reviewer-finder ORIGINATION (candidate-generation) work, or before re-opening "how do we find candidates." The fuller, canonical design lives in `../docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12 — read it; this entry is intent/router. Validated by two read-only probes (`scripts/probe-grounded-origination.mjs`, `scripts/probe-applicant-trail-origination.mjs`) on 1002794 / 1002959 / 1003020 + two Codex review passes (S239). NOT BUILT.

## Current routing

Keep Claude-assisted origination and staff curation. The S246 sniff test deferred
retrieval-first cutover; it did not refute the ORCID-works-anchored multilane design.
Track B is archived off in `lib/services/discovery/constants.js`, and the analyze
parser returns empty query arrays. Re-enabling requires reviewed query generation
as well as the switch; it is not authorized by this note. Current routing and
reactivation prerequisites: `../docs/agent-wiki/topics/reviewer-origination.md`.

Shared recency ranking already exists in `lib/utils/relevance-score.js`; do not
rebuild it from the historical dependency list. A future multilane experiment
still needs to establish how its own evidence supplies recent-activity inputs.
Preserve the owner ranking principle in [[project-reviewer-ranking-recency-over-citations]].

## Historical S239 findings (2026-06-10; design-only)
- **The disease is the MECHANISM, not keywords.** In the S239 probe baseline, ~92–98% of candidates originated from Track-B keyword-RECONSTRUCTION (ask "which papers match these words?" → mint ONE author per paper; pub-count = query-hit concentration). Pure hallucination (`barred_parametric`) ≈ 0 — they are *real people found by the wrong question*. Fix: ask the PERSON-LEVEL question ("who is active on this topic?"). LLM keywords are a fine INPUT to that question — topic→author-aggregation surfaced Corkum (physics) and Samson/van Loon/Bjørås/Madabhushi (the DNA-repair proposal). Do not villainize keywords; villainize paper-reconstruction + 1-author minting.
- **Lanes are independent harvesters; coverage = UNION, confidence = CONVERGENCE.** Run every lane the proposal's signals enable: cited-reference DOIs · PI citation trail (ORCID-anchored, best for *continuing-line* proposals) · proposal-named / peer-groups (strongest single signal) · topic→author-aggregation (best for *pivot* proposals where the PI corpus ≠ the proposal's novel field). Don't architect for the worst case — exploit rich signals, degrade gracefully on thin ones. No proposal triggers every lane; none triggers zero.
- **SAFETY — convergence must be on resolved IDENTITY (shared ORCID / exact work authorship), NEVER on a shared NAME.** Two lanes agreeing on a name string is not identity proof; promoting on it reintroduces the wrong-email/affiliation failure the save-path force-null gate exists to prevent. A surname in a peer-group sentence is an ANCHOR to resolve, not a candidate. See [[project-reviewer-verify-fail-dangerous]] and `../docs/REVIEWER_TRACK_B_IDENTITY_SPEC.md`.
- **Pivot proposals are NOT a system failure.** When a PI proposes a novel departure from their corpus (Keck's wheelhouse), the PI-trail can't reach the field but peer-groups + topic-aggregation do — e.g. 1003020 named "Madabhushi and Tsai" in its narrative.

## Gotchas / dependencies (own files)
- PI identity is STRUCTURED + free (not LLM-extracted): [[project-reviewer-pi-identity-structured]].
- OpenAlex MERGES same-name authors → use the ORCID works list as the corpus: [[project-openalex-merge-use-orcid-works]].

## Historical pre-build checklist (Codex verdict: NOT-YET, S239)

This is the original experiment checklist, not a current inventory of missing
controls or authorization to build a replacement engine. Revalidate each item
against source and owner policy before any separately scoped sparse-tail build.
Identity-equality corroboration; the peer-group PARSING lane (designed, unbuilt, unvalidated); two NET-NEW COI gates — advisor/advisee + all-time-collaborator COI have NO deterministic gate today (prompt-text only); wire lanes INTO existing seams (`discover` / `openalex-service` / `reviewer-provenance` / `save-candidates` / Workbench), never a parallel pipeline; facet generation needs broader/atomic queries (5-word MeSH strings yield OpenAlex corpora of 0–20); recency-weighting was listed as remaining experiment work. That statement does
not describe the already-shipped shared ranker; lane-specific evidence/recency
requirements still need to be specified when revisiting the design.

Related: [[project-reviewer-finder-retrieval-redesign]] (S231 direction), [[project-reviewer-recall-over-precision]] (S238), [[project-reviewer-finder-proposal-doc-context]] (sparse Phase-I). Supersedes the "PI extracted from proposal text" assumption.
