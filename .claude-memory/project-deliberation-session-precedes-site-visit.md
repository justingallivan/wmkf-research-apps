---
name: project-deliberation-session-precedes-site-visit
description: "PC deliberation sessions happen BEFORE the site visit / research presentation — an internal staff briefing on what to address at the visit; a session dated before the presentation is normal, not stale data."
metadata:
  node_type: memory
  type: project
  status: active
  last_verified: 2026-11-01 via owner-approved vocabulary and scoped source/Git receipts; no deployment claim
  originSessionId: 42ef6bd1-176f-4e4c-8aac-52e98856079b
  modified: 2026-11-01T10:42:40-08:00
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

Vocabulary was approved after colleague review on 2026-10-21, with Draft writeup replacing the proposed Post-presentation writeup. See `docs/NOMENCLATURE_GLOSSARY.md` and the approved table at `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`. The deck and mockups are updated. The Workbench display-copy slice for StaffDeliberationsTab, StaffDeliberationsPanel, FinalWriteupTab, and PreSiteDistributionPanel merged in PR #577 as `e7cd37982`; this is source/Git evidence, not deployment proof. PR #580 merged the Meeting Tracker four-term UI-copy slice as `30bc81e77` in source/Git, without establishing deployment. The Board-reader display-copy slice in `pages/external/briefing/[token].js` and `pages/external/presentation/[token].js` merged through PR #581 as `8c0859a6f` in source/Git, without establishing deployment; it uses Proposal review packet, Proposal discussion brief, Proposal discussion session, Research presentation, and Presentation materials. That Board-reader scope excludes the applicant upload page, emails, generated documents, historic filenames, tokens/routes, and API payload changes. The two Meeting Tracker summary views use approved post-presentation discussion wording for the summary/transcript content they present; this is not a repo-wide Staff discussion label migration. Remaining recorded staff-discussion labels await separate scope. The email source-copy slice merged through PR #583 as `3c4c6ee0b` in source/Git, without establishing deployment; existing stored Admin/personal settings, already-prepared email content, and generated documents were not changed, deployed setting values were not inspected, and no backfill is included. The applicant-materials display-copy slice merged through PR #590 as `4f665c6a9` in source/Git, without establishing deployment; its upload-page title/support-email subject and Staff Deliberations materials-card heading use Presentation materials. As of 2026-11-01, the recording/transcript display-copy slice is in progress on `codex/recording-discussion-terminology`: Recording and transcripts / Post-presentation discussion wording across the Recording and transcripts card, Preparation panel, Site Visit editor, and Research Presentation follow-up, plus a clearer label for the scheduled event end in Staff Deliberations. The scheduled event end remains a calendar value; the presentation end in the recording is the transcript position of the last presentation turn. No timestamp, processing, route, token, settings, or API contract changes are included. Check Git/PR and release receipts for current status. See [email terminology preservation audit](../docs/audits/email-terminology-preservation-2026-11-01.md) for email-copy evidence and limits. Broader runtime surfaces require separate scope.

**Why:** I misread a session dated weeks before the presentation as test residue and placed the session line under the Group review step of the Staff Deliberations stepper; both were wrong.

**How to apply:** never flag a session earlier than the presentation as an anomaly; place session facts between the briefing and the presentation in any timeline or stepper. TEST request 1003222 was used mainly to exercise late-workflow features (transcripts), so gaps in its history are expected, not bugs. Related: [[feedback-verify-external-platform-claims]].
