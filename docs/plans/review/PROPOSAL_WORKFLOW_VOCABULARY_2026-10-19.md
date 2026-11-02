---
title: Proposal Workflow Vocabulary — Approved Names
domain: product
kind: plan
status: active
summary: Owner-approved vocabulary following colleague review on 2026-10-21; deck and design mockups updated, bounded source-copy adoption is partial.
canonical: false
owner: product-engineering
related:
  - docs/NOMENCLATURE_GLOSSARY.md
  - docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md
---

# Proposal workflow vocabulary: approved names

**Status:** [VERIFIED via owner decision, 2026-10-21] Colleague review is complete. All proposed names are approved, with **Draft writeup** replacing **Post-presentation writeup**. Staff Deliberations remains the Workbench request tab name. Bounded terminology source slices through PR #598 are merged in Git; PR #600 (`78c965b18`) merged the 11-string correction. Root reports 215 focused tests across 7 suites, a six-file text-only AST review, and all CI passing. These source/test receipts do not alone prove deployment. The prior signed-in Production walkthrough confirmed the main Request 1003222 Staff Deliberations/Final writeup headings and found 11 baseline old-label strings across six files (two observed, nine source-only). Production deployment `7483066923` succeeded; a bounded signed-in recheck confirmed the Workbench intro, “Draft writeup work” option, D26 deep-link explanation, and the named Request 1003222 headings. Editing/history and service-error paths were not all exercised. The separate legacy-client error wording update is merged in PR #601, preserving HTTP 400 and both existing machine codes. The 135-test / 3-suite run (including 22 verifier cases) and scoped lint passed. The release verifier confirmed latest Production deployment metadata, expanded local source match, and nine synthetic guard cases; no application HTTP/browser error was tested. Bounded operational receipts and evidence limits are recorded in the [2026-11-01 terminology completion audit](../../audits/terminology-completion-audit-2026-11-01.md). Existing routes, identifiers, persisted user content and historical files remain outside these copy slices.

[Approved terminology presentation](PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.pptx)

The owner's edited deck retains its layout and before/after examples. The approved-name column uses Draft writeup. Illustrative screens are not production screenshots. The table below records the approved names; the glossary points here for the decision.

| Type | Current wording / examples | Approved name |
|---|---|---|
| Workspace | Staff Deliberations | Staff Deliberations (keep) |
| Meeting | Deliberation session / Pre-discussion | Proposal discussion session |
| Meeting | Site visit / Presentation | Research presentation |
| Discussion | Staff discussion | Post-presentation discussion |
| Document | Pre-site briefing / Pre-RP Brief | Proposal discussion brief |
| Shared page | Deliberation briefing / Briefing page | Proposal review packet |
| Agenda | Deliberation session agenda | Discussion session agenda |
| Materials | Site visit materials | Presentation materials |
| Recording | Post-presentation materials | Recording and transcripts |
| Document | Working writeup / Word Draft | Draft writeup |
| Document | Final Writeup | Final writeup |
| Summary | Presentation summary | Presentation summary |
| Summary | Staff discussion summary | Post-presentation discussion summary |
| Analysis | Discussion Sentiment | Post-presentation discussion sentiment |
| Collection | Program briefing | Discussion summaries |
| Research | Cycle Dossier / Scientific briefing | Scientific dossier |

The proposal discussion session covers multiple proposals and their reviews, gathers initial sentiments, and prepares questions for applicants before their research presentations. The proposal discussion brief is the authored document; the proposal review packet is the shared page containing the brief and supporting materials. Discussion summaries collect individual proposal and post-presentation discussion summaries, grouped by SE and MR.

No route, storage, API, or internal identifier migration is specified here. The approved names remain the target; runtime adoption is partial. The linked 2026-11-01 audit records the bounded shared-field, personal-override, and prompt receipts, aggregate inventory, the merged 11-string correction (two baseline browser observations, nine source-only findings), the separate legacy-client wording release-verifier receipt and its no-live-HTTP/browser limitation. It contains no raw saved message or prompt content.
