---
name: feedback-staff-ui-never-shows-internal-ids
description: Owner rule 2026-10-04 (S574): staff-facing UI never renders GUIDs, operation ids, stored filenames with ids, or publication/lease bookkeeping; show date, source, version, and one plain status with a next action. Internal state machines stay behind a "Needs attention" disclosure.
metadata:
  type: feedback
  status: active
  scope: ui
  originSessionId: c014bbfe-e9d9-491e-a87e-4c5ed9d1bba8
---

## Recall Rule
Read before designing or reviewing any staff-facing card, panel, or segment that surfaces generated artifacts, jobs, drafts, or publications.

**What happened (S574, 2026-10-04):** the Meeting Tracker site-visit page showed "Current version · ea8e3af6-…", "Correction · 4e7be123-… · Draft", stored filenames `1003222-Transcript-<uuid>.txt`, and a list of every publication row. Owner: GUIDs without timestamps are "meaningless to a user"; "pretty much everything about that panel sucks." The redesign (`docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md`) replaced all of it with "Published <date> · from <recording> · version <n>", one editor, and a "Needs attention" disclosure that appears only when a publication is unresolved.

**Why:** staff need three answers (what is current, is anything in progress or needing me, can I fix it), not the service's bookkeeping. Stored filenames embed ids by design, so even "show the filename" leaks them.

**How to apply:**
- Current-state lines read date, source, and a human version number from the row that holds them; never a publication receipt's `version`/`createdAt` (those are concurrency counters and draft times).
- Hide resolved bookkeeping; show unresolved rows behind one disclosure with plain copy and a next action.
- Never render stored filenames that carry ids; show the type and date instead.
- Copy carries no provider or mechanism nouns (AssemblyAI, reconcile, quarantine, bundle, correction).
- Test it: a fixture with a realistic id-bearing filename and a GUID regex over the rendered card.

Related: [[feedback-human-legibility-schema-principle]], [[feedback-user-facing-error-copy-voice]].
