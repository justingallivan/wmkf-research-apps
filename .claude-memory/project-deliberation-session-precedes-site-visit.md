---
name: project-deliberation-session-precedes-site-visit
description: "PC deliberation sessions happen BEFORE the site visit / research presentation — an internal staff briefing on what to address at the visit; a session dated before the presentation is normal, not stale data."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-11-01 via source/Git; PR #594 A1-A3, #595 B1, #596 B2 merged; A4/C1/C2 source work in progress; no deployment claim
  originSessionId: 42ef6bd1-176f-4e4c-8aac-52e98856079b
  modified: 2026-11-01T17:04:38-08:00
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

Vocabulary was approved after colleague review on 2026-10-21, with Draft writeup replacing the proposed Post-presentation writeup. See `docs/NOMENCLATURE_GLOSSARY.md` and the approved table at `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`; the deck and mockups are updated. PRs #577, #580, #581, #583, #590, #591, and #592 merged bounded display-copy slices; PR #593 merged the audit as `d73cdc96e`, PR #594 merged A1–A3 as `21c937783`, PR #595 merged B1 as `6cbed404c`, and PR #596 merged B2 as `73ecc8445` (source/Git only, not deployment evidence). A4 capitalization, C1 future-created event/session names, and C2 fixed error copy are in progress on `codex/remaining-source-terminology`; check current Git/PR and release receipts before reporting later status. C1 leaves the legacy blank-value fallback and saved names intact; C2 preserves machine codes, statuses, content, paths, prompts and failure behavior. Preserve the `cycle-dossier` key/routes, persisted reason `Stopped by the Cycle Dossier operator.`, settings and prompt keys/contracts/bodies, and user content. The [2026-11-01 terminology completion audit](../docs/audits/terminology-completion-audit-2026-11-01.md) records the remaining source slice and unknown live saved values, prompts, files, and deployment state; the [email preservation audit](../docs/audits/email-terminology-preservation-2026-11-01.md) records email-specific limits. No deployment is inferred.

**Why:** I misread a session dated weeks before the presentation as test residue and placed the session line under the Group review step of the Staff Deliberations stepper; both were wrong.

**How to apply:** never flag a session earlier than the presentation as an anomaly; place session facts between the briefing and the presentation in any timeline or stepper. TEST request 1003222 was used mainly to exercise late-workflow features (transcripts), so gaps in its history are expected, not bugs. Related: [[feedback-verify-external-platform-claims]].
