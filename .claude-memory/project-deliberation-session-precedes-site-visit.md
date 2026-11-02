---
name: project-deliberation-session-precedes-site-visit
description: "PC deliberation sessions happen BEFORE the site visit / research presentation — an internal staff briefing on what to address at the visit; a session dated before the presentation is normal, not stale data."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-11-02 via source/Git, focused tests/CI, and bounded Production recheck; PR #600 deployed and three Workbench copy locations confirmed
  originSessionId: 42ef6bd1-176f-4e4c-8aac-52e98856079b
  modified: 2026-11-02T02:57:58Z
---

## Recall Rule
Read when reviewing Meeting Tracker session chronology or placing deliberation
events in a timeline. A deliberation session is the internal staff briefing held
before the research presentation; use the workflow plan for terminology and sequence.

[VERIFIED — owner decision, 2026-10-06] A Meeting Tracker deliberation session is an internal
staff briefing held **before** the site visit (research presentation) to agree
what staff should address there. Lifecycle order: a PD prepares the pre-site
briefing and shares it with staff and select Board members → deliberation session,
where the briefing and proposal are discussed → site visit (research presentation)
→ Draft writeup → group review → leadership review.

Vocabulary was approved after colleague review on 2026-10-21, with Draft writeup replacing the proposed Post-presentation writeup. See `docs/NOMENCLATURE_GLOSSARY.md` and the approved table at `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`; the deck and mockups are updated. PRs #577, #580, #581, #583, #590, #591, and #592 merged bounded display-copy slices; PR #593 merged the audit as `d73cdc96e`, PRs #594–#597 merged A1–A4/B1–B2/C1–C2 (`21c937783`, `6cbed404c`, `73ecc8445`, `3285d2ad3`), PR #598 merged scoped prompt-source copy (`25cac4785`), and PR #600 (`78c965b18`) merged the 11 source-confirmed copy corrections. Root reports 215 focused tests across 7 suites, a six-file text-only AST review, and all CI passing. Production deployment `7483066923` succeeded; the signed-in recheck confirmed the Workbench introduction, “Draft writeup work” option, and rare D26 deep-link explanation. The other eight findings remain source-confirmed paths not all triggered in the browser. Root has separately updated two legacy-client error messages on `codex/legacy-terminology-final-check`; the 156-test / 3-suite run, scoped lint, AST review, and independent review passed, preserving HTTP 400 and existing machine codes. That change's PR and Production verification are pending. The current status and evidence limits are recorded in the [2026-11-01 terminology completion audit](../docs/audits/terminology-completion-audit-2026-11-01.md); the [email preservation audit](../docs/audits/email-terminology-preservation-2026-11-01.md) records email-specific limits. Preserve the `cycle-dossier` key/routes, persisted reason `Stopped by the Cycle Dossier operator.`, settings and prompt keys/contracts, and user content.

**Why:** I misread a session dated weeks before the presentation as test residue and placed the session line under the Group review step of the Staff Deliberations stepper; both were wrong.

**How to apply:** never flag a session earlier than the presentation as an anomaly; place session facts between the briefing and the presentation in any timeline or stepper. TEST request 1003222 was used mainly to exercise late-workflow features (transcripts), so gaps in its history are expected, not bugs. Related: [[feedback-verify-external-platform-claims]].
