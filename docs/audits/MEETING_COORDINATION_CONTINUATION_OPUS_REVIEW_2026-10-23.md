# Meeting coordination continuation — Opus review and verification

Owner: Codex. Branch: `codex/session-start-20261023`. Review date: 2026-10-23 America/Los_Angeles. Scope: coordinator collection mail, combined reviewed preparation admission, consultant selection and empty groups. Agenda and Workbench composition were implemented concurrently and are independently tested below; Opus was expressly told not to review the ongoing agenda edits. No production promotion, migration, email or provider processing occurred.

## Review mechanism

The owner authorized an ordinary Claude Opus product review through subscription OAuth. An outside-sandbox authentication check confirmed `claude.ai` / first-party Team. Provider API keys and alternate-provider authentication variables were removed from the child environment. The CLI ran `--model opus --effort high --safe-mode`, Read/Grep/Glob only, strict empty MCP configuration. The review succeeded after 597,523 ms and 66 turns. Reported model metadata names `claude-opus-5-5` and an internal `claude-fable-5-1` helper. Metadata cost fields are list-price estimates, not an API-credit invoice. No direct model API or Ultrareview was used. The reviewer inspected source; it ran no tests or browser QA.

## Findings adjudicated against current source

| Finding | Verdict and change | Evidence |
|---|---|---|
| P2: a coordinator/recipient refusal after a reminder claim looked like possible delivery | VERIFIED, FIXED. All pre-transport reminder checks now mark `dispatched:false`; network transport uncertainty remains separate. The at-most-once claim is retained. | `collection-service.js` `sendReminderEmail`; test with a successful claim followed by failed staffing read proves no mail call and `outcome:failed` |
| P2: the saved correction editor stayed editable/stale after admission | VERIFIED, FIXED concurrently with the review. A confirmed durable start closes only its matching saved correction editor. A failed/malformed receipt keeps it. Source-version, missing-attendance and missing-draft worker failures map to `preparation_source_changed`, which offers new reviewed input instead of an impossible old-version retry. | `saveReviewForPreparation`, `closePreparedReview`, PreparationPanel `onStarted`; full card test checks attendance PATCH → exact returned version → queue, no synchronous publication, editor closed; delayed-save navigation and malformed-receipt tests |
| P3: direct admission accepted missing attendance | VERIFIED, FIXED. Admission requires saved `discussionAttribution` before creating durable work; publication still enforces its full fresh context. | New preparation-service tests prove refusal before store/document calls and exact-version acceptance |
| P3: coordinator read after collection insert escaped without the durable collection result | VERIFIED, FIXED. Initial invitation checks are inside classified send handling; a failed staffing read returns the persisted collection and definite invitation failure. Known safe configuration feedback is retained. | Collection-service regression constructs successful insert followed by failed staffing read |
| P3: known configuration 503 was shown as uncertain | VERIFIED, FIXED. The modal recognizes the explicit coordinator/signature/defaults pre-dispatch codes; unrelated transport 503 remains uncertain. | Explicit allowlist in MaterialsEmailModal |
| P3: helpers without mapped Dynamics identity cannot preview | EXISTING INTENTIONAL ELIGIBILITY BOUNDARY, RETAINED. Authorized preparation already requires linked active staff; the accepted plan preserves real identity and request restrictions. This increment does not broaden preparation to unlinked profiles. Linked helpers can preview and cannot dispatch. | Existing preview identity guard; helper signed-proof route test |
| P3: retired sweep read rows before refusing and logged a failed run | VERIFIED, FIXED. Its real non-dry-run entry immediately reports `automatic_reminders_retired`, with no schema/collection work or errors. Explicit diagnostic dry runs retain read-only checks; the default sender still refuses before any claim. No runtime re-enable flag or schedule was added. | Default sweep test proves zero reads/claims/mail; synthetic historical algorithm tests remain injected |
| P3: inactive coordinator leaked an unrelated Board-domain error | VERIFIED, FIXED for the changed mail resolver. A known inactive-staff refusal becomes actionable `meeting_coordinator_unavailable` (503). Other lookup failures remain failures. Existing approval access semantics are retained. | Coordinator-sender test constructs `board_staff_unavailable` and checks meeting configuration feedback |

## Independent primary-agent verification

[VERIFIED via Jest] 18 suites / 591 tests passed after these fixes, including the actual isolated PostgreSQL preparation suite. Changed-surface coverage includes mail authority and drift, contributor contact, retired reminders, preparation worker/admission, saved-review UI, consultant refs, empty defaults/recipient handoff, agenda callbacks/concurrency, Workbench hierarchy, and existing request-adapter contracts. No test invokes real mail or a paid provider. The production filenames-only query separately showed 84 tracker filenames, latest 085; 355 local/remote refs contain 085/086/087. This allocates no new migration in this checkpoint.

[VERIFIED via browser] Actual `@hello-pangea/dnd` code in a synthetic local preview: Space/ArrowUp/Space moves the third row to first, a changed ETag during keyboard dragging refuses the save, and 390px width has no horizontal overflow or browser exceptions. The same check was repeated with the compiled application stylesheet. This is focused component QA, not a claim of live end-to-end deployment.

[VERIFIED via commands] Configured type check, integrated Webpack production build, API-route and route/service security gates with their self-tests, Dynamics context gate with its self-test, documentation currency and canonical-fact gates with their self-tests. Scoped lint has zero errors; existing effect/ref warnings remain. `git diff --check` passes. Default Turbopack remains unsuitable for this managed worktree's external node_modules symlink, so the build uses Webpack without changing dependencies.

## Remaining implementation

[PLANNED] Research-presentation invitation preview/send/reconcile ledger and endpoint, full before-meeting task composition, and rare manually paired transcript/audio plus MP4 recovery. These are still authorized work, not new product decisions. Feature migrations 086/087 are not applied to Production; durable preparation admission defaults off. Production application/promotion remains a final deliberate release action after the integrated implementation is concrete.

## Historical raw review snapshot

The following is the original read-only review before the verified fixes above. Its line numbers and missing-code observations refer to that snapshot and are not current defects.

**Verdict: no P1s. I found two P2s worth fixing before promotion, plus a few P3s.** I couldn't find any way for someone other than the assigned Shared Admin Program Coordinator to mint a link, insert a collection, claim a reminder or send. This is a read-only review: I ran no tests, and the tests below count only as evidence of what the implementation intends.

## P2-1: A refusal after the reminder claim is reported as "Dynamics may have accepted it"
- `remindMaterialsContributors` claims the reminder at `lib/services/site-visit-materials/collection-service.js:785`. After that, `sendReminderEmail` re-runs `getCoordinator()` and `assertCoordinatorSender` (`:836`), plus the recipient checks at `:837-844`.
- Anything thrown there carries no `dispatched:false` flag. That includes a changed assignment (403/409) or a temporary read failure in `getRole`/`eligibleStaff`.
- With no flag, `classifyEmailDispatchError` (`shared/utils/email-send-outcome.js:52`) returns "uncertain". `:791-799` then answers 202 with "Dynamics may have accepted the reminder…", and the modal tells the coordinator to "check the recipient", even though no Dynamics activity was created.
- This breaks invariants row 6, which says a definite refusal and an uncertain outcome stay distinct. The invitation path handles this case correctly: `sendInvitation:677` passes stale and coordinator errors through with their real status.
- Losing the claim is accepted in the doc. The wrong outcome is the defect.
- **Fix:** wrap `:836-845` so errors before the transport get `dispatched = false`, the same way `assertCurrentEmailSender:198-202` does. This also fixes the sweep's `sendUnconfirmed` count (`reminder-sweep.js:177-178`).

## P2-2: After "Save and prepare", the draft stays editable and is never refreshed
- `saveReviewForPreparation` (`RecordingAndTranscriptCard.js:1713-1738`) releases its busy flag and returns. The editor keeps `state:'draft'`, "Save changes" stays enabled (`:2675`), `SpeakerEditor` is not read-only (`:2669`), and `blockedReason` (`:3637`) doesn't know a preparation is pending.
- **(a) Editing before the worker runs:** a name edit bumps the draft version and clears `attendance_review`/`discussion_attribution` (`transcription-pilot/store.js:1721-1723`).
  - The worker then publishes the admitted version and gets `meeting_transcript_correction_changed` back. It records the step as `blocked` with that raw code (`preparation-worker.js:95-97`).
  - `PreparationPanel.js:49-57` has no message for that code, so the user sees a generic "Needs attention" and a "Retry this step" button (`:58`). Retry resends the same `input.source.expectedVersion`, so it can never succeed.
  - No wrong content is published; the server checks the version and attendance at `service.js:608` and `:613-614`. The problem is a dead end in the workflow.
- **(b) After the worker publishes successfully:** `onPreparationUpdated` (`:3876-3883`) reloads the materials and the collection but never `correctionDetail`. The editor still shows a draft whose next save will 404 (`loadCorrectionDraft:462`).
- **Fix:**
  - In the worker catch, map `meeting_transcript_correction_changed`, `meeting_attendance_confirmation_required` and `correction_draft_not_found` to `preparation_source_changed`. The panel already has copy for that code (`:53`).
  - After a successful start from `beforeStart`, or in `onPreparationUpdated`, close or reload the correction editor (e.g. `setCorrectionDetail(null)`), or lock editing while a preparation started from this correction is pending or running.

## P3
1. **Admission doesn't check attendance.** `startPreparation` (`preparation-service.js:54-56`) admits a correction on its version alone. Only the UI requires a confirmed attendance review; a direct API call can admit an unconfirmed draft that the worker then blocks. Fix: also refuse when `!draft.correction?.discussionAttribution`.
2. **Coordinator check outside the `try` on create.** `sendInvitation:638` runs after `insertCollection` (`:597`). A temporary `getCoordinator()` failure escapes as a raw error, the route returns 500, and the modal shows "uncertain", although no activity was created and the collection now exists. Fix: move the check inside the `try` with `dispatched:false`, or run it before the insert.
3. **The modal treats 503 refusals as uncertain.** `MaterialsEmailModal.js:156` only treats 400/403/409, or `outcome:'failed'`, as a failure. The new 503 refusals (`meeting_coordinator_unavailable`, `site_visit_materials_signature_unavailable`, `…email_defaults_unavailable`) therefore show "could not be confirmed". Fix: treat a 503 that carries a `code` as failed.
4. **Helpers without a Dynamics mapping can't preview.** `actorRefFromSession` returns null when the session has no Dynamics user id (`lib/utils/actor-ref.js:72-76`). `previewMaterialsEmail:863` then refuses with 403 "not linked", so those helpers can't preview, against invariants row 7. Allow preview with a null actor (`canSend:false`) if that's the intent.
5. **Retired sweep still does work before refusing.** The default sweep reads test state, the Request, documents, upload jobs and contacts for every row (`reminder-sweep.js:110-147`) before `getSender` refuses (`:148-149`). Any manual call is also logged as a failed run (`pages/api/cron/site-visit-materials-reminders.js:51`). Fix: short-circuit at the top when there is no sender.
6. **Wrong error code for an inactive coordinator.** `eligibleStaff` (`board-writeups/config.js:47-49`) throws `board_staff_unavailable` 403. Callers expecting `meeting_coordinator_*` therefore see the wrong code, e.g. the stale/coordinator passthrough at `collection-service.js:677` and `requireCoordinatorAccess` from `retryPreparation:76`.

## Checked and clean
- **Sender authority:** every create, invite and remind checks the coordinator before minting, inserting, claiming or sending (`collection-service.js:554`, `:694`, `:748`). Both Dynamics calls use `noFallback:true` and recheck the assignment and signature before creating the activity and before SendEmail (`:165-172`, `:188-203`).
- **Preview binding:** the route recomputes the preview at send time and checks the proof against it (`materials.js:77-79`). The digest covers the actor, profile, mailbox, coordinator snapshot with revision and signature fingerprint, recipients, visit, due date and body (`:906`). A helper's proof can't be used by the coordinator, and the modal disables Send when `canSend` is false.
- **Reminders retired:** the default `getSender` returns null before any claim. Even with an injected sender, `sendReminderEmail` gets no `profileId` and refuses at `:836`. The route isn't in `vercel.json`.
- **Contributor page:** it shows the Shared Admin coordinator and degrades to null if the lookup fails (`contributor-service.js:79-82`, `:132-135`).
- **Attendance:** changing names or the presentation end clears the review and decision on the server. Publishing requires a confirmed review at the current context. The worker publishes exactly the admitted version, and the edition-managed UI hides direct Publish (`:2676`).
- **Attendees:** consultant roster refs are allowed. Other roles are filtered out in SQL (`recipient-directory-service.js:31`) and rechecked (`attendee-service.js:134`, `:199`). An explicit `[]` is kept as empty rather than replaced by defaults (`session-service.js:203-215`; SessionEditor always sends the array, `:440`). Applicant suggestions only fill unsaved visits (`SiteVisitEditor.js:237`).

**Test gaps:** I saw no tests for how a refusal after the reminder claim is classified, for editing a draft after it has been admitted, or for admission refusing an unconfirmed draft. `recording-and-transcript-card.test.js:2255` covers only the happy path of save-then-queue-exact-version.
