---
title: Meeting Tracker transcript and summary UX fixes
kind: plan
domain: transcription
status: implementing
summary: "Owner-authorized minimal R1–R8 fixes from the October 7 UX audit; Luna implements, Sol reviews, owner merges."
owner: product-engineering
related:
  - docs/plans/TRANSCRIPT_SUMMARY_UX_AUDIT_2026-10-07.md
  - docs/CI_GATES_REFERENCE.md
---

# Meeting Tracker transcript and summary UX fixes

## Scope and authority

The owner requested a fix plan, execution by Luna, and review by Sol on October 7, 2026. This plan selects the smallest R1–R8 variants in the [source audit](TRANSCRIPT_SUMMARY_UX_AUDIT_2026-10-07.md). All implementation items below are [PLANNED] until the completion evidence is recorded. Work stays in `/Users/gallivan/Code/WMKF_Apps-codex` on `codex/transcript-summary-ux-audit`. The existing lockfile edit belongs to prior work and is excluded.

Change surface: Meeting Tracker session loading, navigation, transcript correction and presentation-summary controls. Entry points: `SessionEditor.js`, `MeetingTrackerList.js`, and `RecordingAndTranscriptCard.js`. Persistence: existing session/slot routes and transcript/summary routes retain their contracts; no new persisted fields, routes, migrations, environment settings or external writes are part of development verification. Consumers: these screens, existing staff and Board readers, and their tests. Prior findings: audit R1–R8.

## Invariants before implementation

| Invariant | Files likely touched | Verification |
|---|---|---|
| Existing sessions expose mutations only after all required data for the current route context loads successfully. New-session creation remains supported. | SessionEditor; meeting-tracker-pages test | Invalid cycle, failed detail/recipients, retry, new session, delayed A → B responses and mutations |
| Missing briefing URL makes no assertion about send history. | SessionEditor; page test | Null URL and readable URL; existing Workbench route contract |
| Summary section explains prerequisites even without a generated bundle or confirmed end; published material remains independently accessible to staff. | RecordingAndTranscriptCard; card test | Absent/manual/generated transcript, stale/unconfirmed boundary, editing, unavailable API, published and draft coexistence |
| Correction drafts do not invalidate publication; republishing does. Boundary editing uses the existing correction route. | Card; card test | Explicit boundary action, names-only warning, resumed draft, failed publish, final-turn boundary |
| Board copy reflects eligibility, not proof that a link is live. Full recording and staff discussion remain excluded. | Card; card test | Open existing URL only; missing/stale derivatives; no automatic mint/send |
| Visit navigation preserves the actual request/cycle/program context and does not mislabel a deliberation session as a recorded visit. | List, SessionEditor, card anchor; page test | Known saved visit versus no visit; real route and query assertions |
| Optional slide extraction failure is not described as absence of a PDF. | Card; card test | Existing slidesIncluded true/false contract |
| Ambiguous publication refreshes summary, collection and materials; background reads never erase local edits or resurrect obsolete state. | Card; card test | Deferred responses, response loss, refresh failure, draft versions, request changes |

## Ordered implementation

1. **R1 — Load safety (S–M, medium risk).** Add explicit successful-context/load status and retry. Gate rendering and mutation handlers; guard every post-await update from loads, saves and slot changes against obsolete route generations. Preserve ETags and valid creation, including initial proposal slot behavior. The visit-editor sibling is recorded in the audit but excluded from this minimal batch.
2. **R2 — Briefing truthfulness (S, low risk).** Replace the unavailable-URL assertion with “Briefing link unavailable.” Add an existing Workbench navigation action using source-derived routing. Do not add a richer DTO, reissue a link or send anything.
3. **R3 — Stable summary section (M, medium risk).** Move the summary task outside confirmed-boundary-only rendering. Explain the actual next prerequisite for absent transcript, manual transcript, missing end, stale derivatives and unavailable summary service. Open a published summary using the existing materials descriptor. Keep published and draft states separate; distinguish staff availability from Board eligibility. Do not enable unsupported splitting of manual transcripts.
4. **R4 — Boundary and republish consequences (S–M, medium risk).** Add “Edit presentation end” through the same correction draft. Before republishing, explain that even names-only republication withholds Board derivatives and summary until regenerated. After success, name the next Generate/Summarize steps. No automatic generation or spend.
5. **R5 — Board page visibility (S, medium confidentiality risk).** Add “Open Board page” only for an existing URL. Explain allowed applicant materials/current presentation derivatives and excluded full recording/staff discussion. No readiness DTO or outside-reader change.
6. **R6 — Navigation (S, low risk).** Rename saved-visit navigation to “Open visit.” Add a recording/transcript entry using available saved-visit identity and a local anchor; preserve query context and full-page navigation conventions. Missing-visit rows should still offer scheduling, not promise a populated publishing workspace.
7. **R7 — Slides copy (S, low risk).** Say “Slide text was not included” when the existing boolean is false. Preserve optional slides and server freshness policy.
8. **R8 — Recovery and unsaved edits (M, medium risk).** Reconcile all three projections after summary publish success or ambiguous failure. Make unknown/unavailable status explicit rather than preferring stale collection data. Preserve unsaved text across background GETs and response ordering, while explicit generate/discard/publish actions deliberately transition drafts. A stale response must not restore an obsolete draft or publish status.

## Execution and review

Luna owns implementation and focused tests in the three named components and their existing test files. The coordinating agent owns this plan, verification and Git operations. Sol performs a fresh, read-only adversarial review after Luna's tests, tracing caller → existing route/service → persistence → consumer and examining negative branches, partial success, ETags and async races. Luna resolves actionable findings; Sol rechecks material fixes. No other checkout or branch is involved.

Protected files: `ResearchPresentationFollowUp.js` and the session reader in `StaffDeliberationsTab.js` require advance flagging for any change; no changes are planned. `FinalWriteupTab.js`, `lib/services/final-writeup/**`, and shared primitives including `Layout.js` are excluded. Stage 3 discussion summaries, Stage 4 Board recordings, richer briefing/slide-reason projections, and cycle readiness dashboards remain deferred.

## Acceptance and release

- Run meaningful DOM regression tests for the invariants, including deferred-promise races, and the existing session, summary, presentation-binding/generation/boundary, transcription-route and outside-reader tests appropriate to the final diff.
- Run lint and types plus relevant documentation/security checks. Gate and self-test run serially; fixture-writing gates must not overlap. Inspect build scripts before any build; do not run checks that read Production outside the owner's narrow prior 1003222 grant.
- Inspect the final diff for protected-file changes, secrets, unrelated lockfile edits and invented route contracts. Record exact test/review results and remaining limitations here.
- Commit completed work descriptively, push only this branch, open and attach a PR. Do not merge or claim deployed acceptance. The owner merges.

## Completion evidence

[PLANNED] Implementation, fresh Sol review, final gates and PR are pending.
