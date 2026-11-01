---
name: project-deliberation-session-precedes-site-visit
description: "PC deliberation sessions happen BEFORE the site visit / research presentation — an internal staff briefing on what to address at the visit; a session dated before the presentation is normal, not stale data."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-10-31 via owner-approved vocabulary and source/Git receipts; PR #577 merged Workbench copy as e7cd37982; Meeting Tracker four-term copy was on codex/meeting-tracker-terminology as of 2026-10-31; deployment not established
  originSessionId: 42ef6bd1-176f-4e4c-8aac-52e98856079b
  modified: 2026-10-31T18:37:03-07:00
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

Vocabulary was approved after colleague review on 2026-10-21, with Draft writeup replacing the proposed Post-presentation writeup. See `docs/NOMENCLATURE_GLOSSARY.md` and the approved table at `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`. The deck and mockups are updated. The Workbench display-copy slice for StaffDeliberationsTab, StaffDeliberationsPanel, FinalWriteupTab, and PreSiteDistributionPanel merged in PR #577 as `e7cd37982`; this is source/Git evidence, not deployment proof. As of 2026-10-31, the Meeting Tracker four-term UI-copy slice was on branch `codex/meeting-tracker-terminology`: Site Visit → Research presentation; Deliberation session → Proposal discussion session; Program briefing → Discussion summaries; Discussion Sentiment → Post-presentation discussion sentiment. The two summary views also use approved post-presentation discussion wording for the summary/transcript content they present; this is not a repo-wide Staff discussion label migration. Remaining recorded staff-discussion labels await separate scope. Check Git/PR and release receipts for current status. Saved subjects, emails, and generated documents retain their existing wording and remain separate scope; broader runtime changes also require separate scope.

**Why:** I misread a session dated weeks before the presentation as test residue and placed the session line under the Group review step of the Staff Deliberations stepper; both were wrong.

**How to apply:** never flag a session earlier than the presentation as an anomaly; place session facts between the briefing and the presentation in any timeline or stepper. TEST request 1003222 was used mainly to exercise late-workflow features (transcripts), so gaps in its history are expected, not bugs. Related: [[feedback-verify-external-platform-claims]].
