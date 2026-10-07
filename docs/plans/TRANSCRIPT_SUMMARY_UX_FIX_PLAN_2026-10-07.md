---
title: Meeting Tracker transcript and summary UX fixes
kind: plan
domain: transcription
status: built-in-branch
summary: "R1–R8 and the Opus follow-up are built in PR 455, with Sol review and local verification complete; hosted acceptance and owner merge remain pending."
owner: product-engineering
related:
  - docs/plans/TRANSCRIPT_SUMMARY_UX_AUDIT_2026-10-07.md
  - docs/CI_GATES_REFERENCE.md
---

# Meeting Tracker transcript and summary UX fixes

## Scope and authority

The owner requested a fix plan, execution by Luna, and review by Sol on October 7, 2026. This plan selects the smallest R1–R8 variants in the [source audit](TRANSCRIPT_SUMMARY_UX_AUDIT_2026-10-07.md). The original R1–R8 specification was completed at `a14c8ccee` in PR 455. The owner has authorized the Opus follow-up below; its implementation and independent review are complete. Hosted acceptance and owner merge remain pending. Work stays in `/Users/gallivan/Code/WMKF_Apps-codex` on `codex/transcript-summary-ux-audit`. The existing lockfile edit belongs to prior work and is excluded.

Change surface: Meeting Tracker session loading, navigation, transcript correction and presentation-summary controls. Entry points: `SessionEditor.js`, `MeetingTrackerList.js`, and `RecordingAndTranscriptCard.js`. Persistence: existing session/slot routes and transcript/summary routes retain their contracts; no new persisted fields, routes, migrations, environment settings or external writes are part of development verification. Consumers: these screens, existing staff and Board readers, and their tests. Prior findings: audit R1–R8.

## Invariants before implementation

| Invariant | Files likely touched | Verification |
|---|---|---|
| Existing sessions expose mutations only after all required data for the current route context loads successfully. New-session creation remains supported. | SessionEditor; meeting-tracker-pages test | Invalid cycle, failed detail/recipients, retry, new session, delayed A → B responses and mutations |
| A successful session creation is retained if initial slot creation or navigation subsequently fails; retry cannot duplicate it. | SessionEditor; page test | Session POST succeeds then slot POST fails; router.replace fails or returns false |
| Missing briefing URL makes no assertion about send history. | SessionEditor; page test | Null URL and readable URL; existing Workbench route contract |
| Summary section explains prerequisites even without a generated bundle or confirmed end; published material remains independently accessible to staff. | RecordingAndTranscriptCard; card test | Absent/manual/generated transcript, stale/unconfirmed boundary, editing, unavailable API, published and draft coexistence |
| Correction drafts do not invalidate publication; republishing does. Boundary editing uses the existing correction route. | Card; card test | Explicit boundary action, names-only warning, resumed draft, failed publish, final-turn boundary |
| Board copy reflects eligibility, not proof that a link is live. Full recording and staff discussion remain excluded. | Card; card test | Open existing URL only; missing/stale derivatives; no automatic mint/send |
| Visit navigation preserves the actual request/cycle/program context and does not mislabel a deliberation session as a recorded visit. | List, SessionEditor, card anchor; page test | Known saved visit versus no visit; real route and query assertions |
| Optional slide extraction failure is not described as absence of a PDF. | Card; card test | Existing slidesIncluded true/false contract |
| Ambiguous publication refreshes summary, collection and materials; background reads never erase local edits or resurrect obsolete state. | Card; card test | Deferred responses, response loss, refresh failure, draft versions, request changes |
| Dirty summary text retains its original draft ID/version fence; refreshing cannot grant old text authority over another editor's newer draft. | Card; card test | Same draft/newer version; replacement draft; GET begun before save/generate/discard/publish |

## Implementation specification (completed in branch)

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

[VERIFIED via Sol plan review, 2026-10-07] Initial verdict: ready with the two named execution requirements above. Session creation and initial slot creation are separate writes (`lib/services/meeting-tracker/session-service.js:247`, `lib/services/meeting-tracker/slot-service.js:124`). Summary draft updates use an expected-version fence (`lib/services/post-presentation-materials/summary-draft-store.js:120`); preserving text while silently adopting a refreshed version defeats its purpose. The regression evidence for these requirements is recorded below.

Protected files: `ResearchPresentationFollowUp.js` and the session reader in `StaffDeliberationsTab.js` require advance flagging for any change; no changes are planned. `FinalWriteupTab.js`, `lib/services/final-writeup/**`, and shared primitives including `Layout.js` are excluded. Stage 3 discussion summaries, Stage 4 Board recordings, richer briefing/slide-reason projections, and cycle readiness dashboards remain deferred.

## Acceptance and release

- Run meaningful DOM regression tests for the invariants, including deferred-promise races, and the existing session, summary, presentation-binding/generation/boundary, transcription-route and outside-reader tests appropriate to the final diff.
- Run lint and types plus relevant documentation/security checks. Gate and self-test run serially; fixture-writing gates must not overlap. Inspect build scripts before any build; do not run checks that read Production outside the owner's narrow prior 1003222 grant.
- Inspect the final diff for protected-file changes, secrets, unrelated lockfile edits and invented route contracts. Record exact test/review results and remaining limitations here.
- Commit completed work descriptively, push only this branch, open and attach a PR. Do not merge or claim deployed acceptance. The owner merges.

## Original implementation evidence (a14c8ccee)

[VERIFIED via source, focused tests and Sol final review, 2026-10-07] Luna (`gpt-6-luna`) implemented the three UI components and two test files. Sol (`gpt-6.1-sol`) reviewed the plan and implementation independently; final verdict **READY**, no remaining blocking finding. The review corrected route-scoped creation recovery, fresh draft validity, discard acknowledgment, persisted summaries without a confirmed boundary, and preservation across successive publishing-state refreshes. Deferred-response tests now wait for response-driven metadata or consumed JSON rather than pre-existing text.

| Completed item | Source evidence |
|---|---|
| R1: matching-context load gate, Retry/Back, stale-response guards, retained and route-scoped partial creation | `shared/components/meeting-tracker/SessionEditor.js:381`, `shared/components/meeting-tracker/SessionEditor.js:467`, `shared/components/meeting-tracker/SessionEditor.js:600` |
| R2/R6: truthful unavailable-link copy, Workbench fallback, saved-visit transcript link, Open visit label | `shared/components/meeting-tracker/SessionEditor.js:48`, `shared/components/meeting-tracker/SessionEditor.js:200`, `shared/components/meeting-tracker/MeetingTrackerList.js:66` |
| R3/R4/R5/R7: stable summary section and published-file action, explicit boundary editing and publication consequences, Board page link and eligibility copy, honest optional-slide copy | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:1657`, `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:2140`, `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:2420` |
| R8: draft text/ID/version preservation, context/sequence guards, explicit discard and three-projection publish recovery | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:1588`, `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:1705`, `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:1733` |

[VERIFIED via local commands] **260 tests passed in 13 suites**. Final UI run: 99 tests across `meeting-tracker-pages`, `recording-and-transcript-card`, and `site-visit-editor-t5-matrix`. Backend/consumer run: 161 tests across `workbench-dashboard-service`, `meeting-tracker-session-service`, `transcript-summary-service`, `presentation-transcript-binding`, `presentation-transcript-service`, `meeting-tracker-transcription-presentation-boundary`, `meeting-tracker-transcription-routes`, `site-visit-summary-batch`, `presentation-link-service`, and `external-presentation-page`. Commands used `./node_modules/.bin/jest --runInBand` with these files under `tests/unit/`; logs: `/tmp/transcript-ux-ui-final.log`, `/tmp/transcript-ux-contract-tests.log`.

[VERIFIED via local commands] Final `npm run build`, `npm run check:types`, changed-file ESLint, and `git diff --check` passed. Build retained two existing dynamic-filesystem tracing warnings. Full `npm run lint` failed on the pre-existing Git-ignored `tmp/b4-inactive-fix/probe.js` (`@next/next/no-assign-module-variable`); the file was not changed. `npm run lint -- --ignore-pattern tmp/b4-inactive-fix/probe.js` passed with warnings, and changed-file ESLint passed again after the final correction (six advisory React-compiler warnings, zero errors). No lint configuration was weakened.

[VERIFIED via `/tmp/transcript-ux-final-gates.log`] API-route security, doc currency, fact consistency, canonical pointers, doc symbol refs, build-claim freshness, status-enum parity, trust-boundary GUID, secret scan and scaffolding checks passed with their self-tests run serially; docs catalog and agent invariants also passed. No migration or route was added. Factory-ledger/live deployment checks were not run because they could read Production outside authorized scope.

Contract reconciliation: existing route/service/version fences and outside allowlists were traced; there are no new persisted fields/enums/helpers requiring consumer migration. UI complement checks include failed versus loaded/new routes, delayed contexts, successful create with failed follow-up, manual versus generated transcript, current versus stale/unconfirmed publication, ready versus publishing drafts, mismatched server draft IDs/versions, and failed post-discard refresh. Local tests plus source review cover these states; this is not proof of hosted publication or byte access. Distinct deferred old-GET tests were not added for every generation/discard action; their shared sequence guards were source-reviewed, with explicit discard-success/GET-failure and save-race regressions.

Bounded documentation reconciliation: the audit is explicitly a historical base snapshot; this plan owns current branch status. The PC Meeting Tracker plan's briefing and navigation restatements now describe branch behavior without claiming deployment. Broader pre-existing document discrepancies listed in the audit remain outside this fix; no whole-repository sweep completion is claimed.

Release: commit and push only this branch and open a PR for owner merge. No new Production reads/writes, provider calls, email, environment changes or migrations were performed in Phase B. Protected Workbench readers, final-writeup ownership and shared primitives remain unchanged; the pre-existing lockfile edit is excluded.


## Opus follow-up — authorized October 7

[VERIFIED via OAuth Claude Code review of `a14c8ccee`] Claude Opus 5.5 returned READY with non-blocking P2 findings: missing transcript status was treated as a manual upload; preserved text from a changed/deleted draft retained misleading live-draft guidance; failed summary reads had no retry and could leave stale Checking/not-checked copy. The hash-scroll finding was initially [ASSUMED] and was subsequently reproduced by the browser probe below. The review used only Read/Grep/Glob; `apiKeySource` was `none`. The owner authorized this patch after reviewing the findings.

Change surface: `RecordingAndTranscriptCard.js` and its focused tests. Persistence: none new; existing summary draft GET/PATCH/DELETE/publish version fences remain unchanged. Consumer: the local card and visit navigation. Luna owns runtime/tests; root owns browser verification/docs; independent review follows the frozen patch. Protected files and Production boundaries above remain in force.

| Follow-up invariant | Verification before completion |
|---|---|
| Absent/unavailable artifact metadata cannot be called a manual upload; only explicit `bundleEditable === false` supports that explanation. | Transcript material present + absent/failed collection; explicit manual artifact complement |
| Local recovery text is distinct from the authoritative server draft; changed/missing draft must not masquerade as a live publishing draft or enable obsolete mutations. | Ready and publishing local text against null/replaced/new-version server draft; accurate conflict and disabled obsolete actions |
| Load latest is an explicit replacement of local text, succeeds only after a successful current response, and preserves text on failure. | Successful load, failed load, delayed stale load, expected-version fence preserved before replacement |
| Summary status is retryable and current-context loading cannot stick after moving to a state where no GET is needed. | Failure → Check again success; known absent metadata; deferred GET across changed context; newer read not cleared by old response |
| A fragment navigation reaches the asynchronously mounted card, without scrolling ordinary visits or repeatedly stealing scroll position. | Real browser with delayed mocked visit response, matching/no fragment; source change only if failure is reproduced |

[VERIFIED via `/tmp/transcript-anchor-baseline.json`] A temporary Chrome profile rendered the real `SiteVisitEditor` and baseline `RecordingAndTranscriptCard` from `a14c8ccee`, with synthetic router/chrome/applicant-materials area and all requests intercepted. The visit GET was delayed 800 ms. With the exact fragment, `scrollY` remained 0 and the card top was 2238.78 px in a 720 px viewport; no fragment also stayed at 0. No page/request errors occurred. This proves the delayed-mount failure in that browser harness, not hosted authentication or real materials access. The fix is confined to the card.

[VERIFIED via final source and Sol review, 2026-10-07] Luna implemented all four follow-ups. Unknown transcript metadata remains distinct from explicit manual uploads. Concurrent draft changes retain local text in a separate recovery buffer with explicit Load latest; failed reads preserve that text and obsolete mutations stay unavailable. Summary reads expose Check again. Sol identified an additional compact correction-publish DTO case: missing summary metadata cannot establish publication absence. The corrected card shows unavailable status with collection refresh while preserving access to existing summary material; its failed-refresh regression passed. Sol's final verdict is **READY**, with no remaining blocker.

[VERIFIED via `/tmp/transcript-anchor-fixed.json`] Chrome 154.0.8037.98 scrolled the delayed-mounted card to the viewport top (`scrollY: 2239`, card top −0.22 px) for the matching fragment. No-fragment navigation stayed at 0; manually scrolling to 0 followed by a parent rerender stayed at 0. No page/request errors occurred. The card owns a one-time exact-fragment scroll. This synthetic local browser probe is not hosted acceptance.

[VERIFIED via `/tmp/transcript-ux-followup-tests.log`, `/tmp/transcript-ux-followup-lint.log`, `/tmp/transcript-ux-followup-build.log`] Final follow-up verification passed **158 tests in 5 suites**: meeting-tracker-pages, recording-and-transcript-card, site-visit-editor-t5-matrix, transcript-summary-service, and presentation-transcript-binding. These overlap the original implementation run above and are not additional disjoint coverage. Final build and scoped ESLint passed (six advisory warnings, zero errors); types passed during this follow-up. The original full-lint limitation remains unchanged.

Release remains PR 455 on this branch for owner merge. No hosted acceptance, merge, deployment, or Production operation is claimed.
