---
name: project-deliberation-session-precedes-site-visit
description: "PC deliberation sessions happen BEFORE the site visit / research presentation — an internal staff briefing on what to address at the visit; a session dated before the presentation is normal, not stale data."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-11-01 via source/Git; terminology implementation branch status, no deployment claim
  originSessionId: 42ef6bd1-176f-4e4c-8aac-52e98856079b
  modified: 2026-11-01T14:07:45-08:00
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

Vocabulary was approved after colleague review on 2026-10-21, with Draft writeup replacing the proposed Post-presentation writeup. See `docs/NOMENCLATURE_GLOSSARY.md` and the approved table at `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`; the deck and mockups are updated. PRs #577, #580, #581, #583, #590, #591, and #592 are source/Git receipts for bounded display-copy slices, not deployment evidence. Audit findings A1–A3 are implemented on `codex/reader-helper-terminology`; that implementation branch is not merged/live. PR #593 is the separate audit-only PR on `codex/terminology-completion-audit`. Preserve the `cycle-dossier` key/routes, persisted reason `Stopped by the Cycle Dossier operator.`, settings and prompt keys/contracts/bodies, and user content. The [2026-11-01 terminology completion audit](../docs/audits/terminology-completion-audit-2026-11-01.md) records remaining A4/B/C work and unknown live saved values, prompts, files, and deployment state; the [email preservation audit](../docs/audits/email-terminology-preservation-2026-11-01.md) records email-specific limits. No deployment is inferred.

**Why:** I misread a session dated weeks before the presentation as test residue and placed the session line under the Group review step of the Staff Deliberations stepper; both were wrong.

**How to apply:** never flag a session earlier than the presentation as an anomaly; place session facts between the briefing and the presentation in any timeline or stepper. TEST request 1003222 was used mainly to exercise late-workflow features (transcripts), so gaps in its history are expected, not bugs. Related: [[feedback-verify-external-platform-claims]].
