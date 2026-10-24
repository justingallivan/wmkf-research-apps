---
title: Claude Opus Meeting Coordination Plan Review
domain: product
kind: audit
status: adjudicated
summary: Read-only OAuth Claude Opus review of the Meeting coordination plan at a9076fb9c; nine findings verified and narrowed where overstated, with accepted plan corrections and all four subsequent owner choices resolved; implementation remains pending.
canonical: false
owner: product-engineering
related:
  - docs/plans/MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md
---

# Review receipt

- Requested by owner: Claude Opus, OAuth subscription authentication, no API credits.
- Authentication checked outside the sandbox: loggedIn true, authMethod claude.ai, firstParty provider, Team subscription. No tokens read or exported. API credential and alternate-provider environment overrides were removed from the review subprocess.
- Mechanism: local Claude CLI print mode, requested model alias opus, high effort, safe mode, Read/Grep/Glob only, no MCP servers. No Ultrareview or direct model API substitute.
- Reviewed commit: `a9076fb9c8bd15b19ea0e6cdd3a71fab3aaed472`.
- Plan SHA-256: `b8e0dbdc4d4e96513ed8cd0d4925d901e167bf1ee0907c660846c4c328823fe7`.
- CLI result: success, exit 0; no permission denials; 72 turns, about 11 minutes 39 seconds.
- Model usage metadata identifies `claude-opus-5-5` and also `claude-fable-5-1`. Opus was the requested reviewer; the CLI reports additional Fable usage. No claim that every internal CLI operation used Opus exclusively. List-price cost estimates in CLI metadata are not proof of an API charge; this run used the verified OAuth session.
- Scope: plan review only. At receipt, findings below were the reviewer's conclusions rather than independently adjudicated acceptance. The subsequent adjudication and plan corrections are recorded separately below; neither is implementation evidence. Repository policy/product intent takes precedence over a proposed reviewer remedy.

# Subsequent owner decisions — current plan authority

[VERIFIED via explicit owner instructions, 2026-10-23] All four product questions identified during verification are resolved: remove separate summary-provider consent; support matching manual audio/transcript plus MP4 as rare recovery while preferring Zoom API; permit explicit coordinator retry after a possible-duplicate-charge warning; and require the assigned Program Coordinator personally to send materials requests/reminders, while helpers may prepare/review drafts. These are planned behaviors, not implementation evidence. The [implementation plan](../plans/MEETING_COORDINATION_IMPLEMENTATION_PLAN_2026-10-23.md) contains the resulting contracts. No delegated send-as feature is included. The snapshot and raw review below preserve what was open when reviewed.

# Historical verification snapshot — before subsequent owner decisions, 2026-10-23

[VERIFIED via primary-agent source reads, an independent bounded read-only check, and focused existing tests] Scope: verify F1–F9 against caller → persistence → consumer and update the proposed plan. No runtime edits, live probes, schema changes, actual emails or paid processing occurred. The original review below is an immutable historical receipt of the reviewed commit; its absolute wording does not override this adjudication.

| ID | Verdict and source evidence | Required correction applied to plan |
|---|---|---|
| F1 | CONFIRMED gap, NARROWED wording. `execute-prompt.js:223` may log a preflight block; :268-364 logs dispatched attempts afterward and returns/throws post-call run IDs. No guaranteed pre-dispatch recoverable summary result receipt. `transcript-summary-service.js:380-384` loses paid-call classification. | Distinguish undispatched, known response and unknown attempt; preserve durable submission intent. Propose fenced abandon/new-attempt recovery with possible duplicate charge warning, subject to owner policy. “No receipts at all” and inevitable permanent blockage are not accepted literally. |
| F2 | CONFIRMED. `summary-draft-store.js:36-64,166-175,288-295` covers replacement, expiry-filtered reads and indiscriminate expiry; maintenance invokes it. | Uncertainty/ownership tombstone survives text expiry and is consulted by reservation/legacy endpoints. Include >360-second and >14-day races with maintenance/late responses. |
| F3 | CONFIRMED; broad risk was already in plan, concrete mechanism incomplete. `presentation-video-approval-service.js:272-281` supersedes earlier splits; split-store :463-467 requires approved state for lookup; `briefing-page-service.js:812-815` uses ETag unlike presentation reader's size/quickXorHash check. | Approved member identities independent of mutable split/current winner; shared type-aware resolver and E2 partial-registration/E1-availability test. Preserve differing existing transcript listing behavior across the two pages. |
| F4 | CONFIRMED enrollment omission, REJECTED existing flag-off exposure assertion. `post-presentation-materials-readiness.js:20-40`, `verify-presentation-token.js:15-20` fail closed. `presentation-page-service.js:145-158,386-387` serves currently bound derivatives. | Sticky visibility-row enrollment; server guards new/legacy producer paths; outage distinct from no enrollment; no pre-edition code rollback. Existing flag-off is not a current leak. |
| F5 | CONFIRMED. `summary-draft-store.js:28-64` protects ready draft unless exact replacement requested; summary service :357-360 maps conflict. | Blocked-existing-draft step, keep/review or exact-version explicit replacement, approval source consistency. |
| F6 | CONFIRMED separate compatibility decision. `transcriptSummary.js:7-20`, summary service :339-354 and migration 070:34-36 require summary acknowledgement. Controlling design's import-removal section explicitly preserves unrelated acknowledgements. Import timestamp in migration 060:10 already nullable. | Ask narrowly about separate summary consent; keep import removal settled, preserve historical records and truthful initiating actor. Do not invent run-source enum: Executor :56-63 currently has no background value. |
| F7 | CONFIRMED existing source restriction, remedy NOT OWNER-APPROVED. video-split service :100-147 refuses uploads/unverified or unmatched copied sources. | Manual Board path is an explicit owner scope choice; do not silently select Zoom-only from review advice. Existing staff-only manual work remains possible. |
| F8 | CONFIRMED sender/source mismatch, NARROWED scope. materials route :57-64 uses session actor/email; collection service :150,637-647,865-872 uses request coordinator and operator signature/template; contributor service :79-93 uses request coordinator. Dynamics email :191-201 and :238-240 separate sender from actor. Cron route :10-13 explicitly records retirement. `confirmMaterialsReady`:899-910 is an in-app state write, not email. | Shared configured sender/name/signature/template with authenticated operator audit, preview binding and proven send-as if delegation selected. Keep automatic reminders retired; no new confirmation email. Owner selects who can perform Send. |
| F9 | PARTLY CONFIRMED; consultant source absence REFUTED. recipient-directory-service :27-33,104-146 supports Board/Consultant; attendee-service :198-205,218-219,310-311 filters/rejects them. Curated-recipient-service independently supplies configured Contact options for existing Workbench composer. Session agenda service/route exists; visit logistics has no invitation mail command. | Reuse each established identity source; extend tracker refs/validation/pickers; add request/visit invitation preview-send-reconcile contract and distinguish absent vs explicitly empty selection. No third directory or calendar service. |

[VERIFIED via focused Jest run] Eight suites / 254 tests passed: execute-prompt-provider, summary-draft-store-reserve, transcript-summary-service, presentation-page-service, presentation-video-approval-service, site-visit-recipient-directory, curated-site-visit-recipient-service, meeting-tracker-attendees. Scripted SQL/mocked providers verify existing behavior only; they do not prove real concurrency, proposed new code, live schema or send-as rights.

Contract audits: whole-flow and symbol fan-out covered named routes/stores/readers; partial success covers candidate registration/old edition; async covers unknown provider work and late completion; helper semantics preserve staff/external and directory differences; durable surfaces remain proposed; doc reconciliation updates the plan and this receipt while leaving historical review text labeled. No new runtime/schema status is asserted.

Disconfirming checks: existing Consultant query disproves source absence; token/readiness guards disprove existing flag-off exposure; Executor post-call/preflight audit disproves absolute receipt absence; imported-source guards confirm the cut limitation. Current live metadata/permissions and proposed race protections remain NOT TESTED. All four pending product choices are listed in the updated plan; coordinator authority and required video remain settled.

Planning verification: documentation currency, symbol references, build-claim freshness (each followed sequentially by its self-test), docs catalogue and diff whitespace checks passed for this correction. No whole-repository implementation-truth audit is claimed.

Verdict: source verification complete for the nine named findings; accepted technical corrections are in the plan. Four product choices and the named Slice 0 technical prerequisites remain; implementation readiness is conditional on those inputs.

# Historical Claude review output — reviewed a9076fb9c


## Meeting coordination plan review: verdict READY WITH NAMED CHANGES

The plan's core design (frozen editions, a visibility pointer, a durable preparation ledger, the coordinator role) checks out against source. I found nine residual issues. One needs an owner decision. Slice 4 is not concrete enough to start yet. Everything below comes from reading files only; nothing was run or changed.

## 1. Findings, highest priority first

**F1 · HIGH · confirmed gap: an unknown paid summary outcome has no way out, so Board approval can get stuck permanently**
- **Plan:** lines 80, 82, 125.
- **Evidence:**
  - `lib/services/execute-prompt.js:300,334` writes the run record only after the provider call returns. There is no durable receipt written before dispatch.
  - `execute-prompt.js:163,268,364` tracks whether the call was dispatched only in memory (`err.paidCall` true/null/false). `transcript-summary-service.js:380-381` ignores it and marks every failure as failed.
  - Transcription already has an explicit exit for this case: `pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/abandon.js:20-21` and `transcription-pilot/store.js:1220-1225` (`acknowledgePotentialDuplicateCharge`).
- **Failure:** the worker crashes during the presentation summary call. The plan says to stop visibly, retry only confirmed failures, and not let the existing summary endpoint bypass the protection. There are no receipts to reconcile against, so the step never resolves. The edition requires a reviewed summary, so approval is blocked for good.
- **Plan change:**
  - State that summaries have no durable receipt.
  - Use `paidCall === false` as the only in-process signal that retry is safe.
  - Add an explicit coordinator "abandon, accepting a possible duplicate charge" transition per summary step, reusing the transcription pattern.

**F2 · HIGH · confirmed: the uncertain-run protection also has to cover the 14-day expiry, not just the 360-second rule**
- **Plan:** lines 82, 102.
- **Evidence:**
  - `summary-draft-store.js:288-295` (`expireSummaryDrafts`, called from `pages/api/cron/maintenance.js:234`) moves `generating` rows to `expired` after 14 days, regardless of who owns them.
  - `reserveSummaryDraftRun` (`:36-45`) and `getActiveSummaryDraft` (`:172`) then no longer see an active row.
- **Failure:** an uncertain run is left in needs-attention for more than 14 days. The cron expires it, and the next legacy POST or orchestrator retry reserves a new run and makes a second paid call. The earlier review only named the 360-second rule.
- **Plan change:** in Slice 2, exempt orchestration-owned uncertain rows from `expireSummaryDrafts` and from the active-row filters. Add a test for a run older than 14 days racing a legacy request.

**F3 · HIGH · confirmed incompatibility: registering a replacement video breaks the edition that is still active, and the two Board readers disagree on how to check video bytes**
- **Plan:** lines 88, 90, 92.
- **Evidence:**
  - `approvePresentationVideoSplit` is the only seam that creates a presentation video record (`presentation-video-approval-service.js:43-44`). It runs `settleWinner` and `supersedeApprovedPresentationVideos` (`:272-281`; store `:529-537`).
  - The Board reader only serves a video whose split state is `approved` (`presentation-page-service.js:79,408-409`).
  - The presentation page checks video bytes by size plus quickXorHash, because SharePoint changes a video's eTag on metadata-only edits (`:356-363`). The briefing open path checks the eTag for video too (`briefing-page-service.js:812-815`).
- **Failure:**
  - Approving replacement edition E2 registers its video first, which marks E1's split superseded. If summary registration then fails, E1 stays active as the plan intends, but its video now returns 404. That is exactly the partial case line 90 promises to protect.
  - Separately, any metadata edit makes the briefing reader refuse the approved video.
- **Plan change:**
  - Edition rows store each member's byte identity by type. Video: split id plus output drive/item, size and quickXorHash. Text: content hash.
  - The edition resolver must not depend on split state or a current-winner lifecycle.
  - Both external readers call one shared member resolver.

**F4 · MEDIUM-HIGH · confirmed: the enrollment marker is undefined, and preparation itself makes artifacts Board-visible on requests that aren't enrolled**
- **Plan:** lines 119, 133-135.
- **Evidence:**
  - Today's rollout control is environment-only: `post-presentation-materials-readiness.js:20-40` supports off / on / a single `test:<guid>`. Production was `on` as of 2026-09-29 (`docs/PC_MEETING_TRACKER_PLAN.md:114-119`, dated evidence, not a live probe). So `test:<guid>` cannot be the enrollment switch.
  - `generatePresentationTranscript` registers a READY/DRAFT row (`presentation-transcript-service.js:361-366`). The legacy readers serve it (`presentation-page-service.js:150,386-387`) or list it (`briefing-page-service.js:298-301`).
  - Turning the flag off already fails closed (`verify-presentation-token.js:15,20`; `briefing-page-service.js:312-318`). Line 135's concern about a flag-off exposing current winners doesn't apply; the real hazard is rolling the code back, which the plan already covers.
- **Failure:** someone uses the new **Save and prepare** on a request that isn't enrolled. The presentation transcript becomes openable by the Board before any approval, which breaks requirement 2.
- **Plan change:**
  - Name a persisted marker, such as "a visibility row exists".
  - Make the preparation and approval routes refuse requests that aren't enrolled, enforced on the server.
  - State what readers do when the marker can't be read. Failing closed changes current behavior for requests that aren't enrolled.

**F5 · MEDIUM · confirmed: one active draft per request and kind collides with re-running preparation after a source change**
- **Plan:** line 72; the design record, line 49.
- **Evidence:** `summary-draft-store.js:28-59` returns `summary_draft_exists` unless the caller names `replaceDraft`; `transcript-summary-service.js:357-360`.
- **Failure:** while correcting, the coordinator edits a draft for revision R2, then fixes speakers again (R3) and runs Save and prepare. The summary step conflicts, and the plan doesn't say whether it blocks, replaces the draft or asks.
- **Plan change:**
  - Add a defined step outcome, `blocked_existing_draft`.
  - Replace a draft only with the `{draftId, version}` the user confirmed.
  - Approval rejects any draft whose revision doesn't match the preparation input.

**F6 · MEDIUM · confirmed conflict: the summary acknowledgement already blocks the one-action flow**
- **Plan:** lines 104, 169 treat this as conditional or unknown. It isn't.
- **Evidence:**
  - Migration `070_meeting_transcript_summary_drafts.sql:34-36` makes acknowledgement version, actor and time NOT NULL.
  - `transcript-summary-service.js:339-341` returns 400 without an accepted version, and `:374` hardcodes `runSource: 'Vercel Interactive'`.
  - The approved mockup (`transcript-preparation.html`, line 10) has only the speaker/end, video-ending and summary-reviewed checkboxes. It has no provider disclosure.
- **Good news:** `transcription_jobs.non_sensitive_acknowledged_at` is nullable and has no CHECK (`060_transcription_jobs.sql:10`). The removal sites are routes and services only: `start.js:20-21`, `zoom-imports.js:12,38`, `import-service.js:249,332`, `runtime.js:149,408`.
- **Plan change:** resolve this before Slice 2 (see section 2). Record the initiating actor on the parent record and give the worker its own run source.

**F7 · MEDIUM · confirmed: a manual import can never reach Board approval**
- **Plan:** requirement 1; Slice 3 includes "Zoom/manual" import.
- **Evidence:** `presentation-video-split-service.js:100-107` refuses transcripts that were uploaded. `:127-135` requires a copied, verified Zoom video.
- **Plan change:** define the video step for a non-Zoom source as a non-retryable "needs Zoom video" state. Recovery is Import from Zoom and then Verify video. Add an acceptance test showing approval is blocked.

**F8 · MEDIUM · confirmed: requirement 7 (Program Coordinator sends materials mail) has no mechanism, and current code uses the source the plan forbids**
- **Plan:** requirement 7, line 59, Slice 4.
- **Evidence:**
  - The coordinator's name comes from the request field `_wmkf_programcoordinator_value`: `collection-service.js:71,150`, `contributor-service.js:41,79-80`, `reminder-sweep.js:54`.
  - The sender is the person clicking (`collection-service.js:843`) or, for automatic reminders, whoever created the collection (`reminder-sweep.js:14-15,72-76,151`).
  - Searching `lib/services/site-visit-materials` found no "confirmation" email.
- **Plan change:**
  - List these sites in Slice 4 and switch them to `getRole('programCoordinator')`.
  - Define fail-closed or skip behavior when the role is unassigned.
  - Check in Slice 0 whether sending from the coordinator's mailbox works when the person clicking is someone else. That is ASSUMED; the cron only proves sender equals actor.
  - Say whether "confirmations" means new scope.

**F9 · MEDIUM · confirmed scope gap: requirement 8's consultants and research-presentation invitations don't exist yet**
- **Plan:** requirement 8, Slice 4, line 24.
- **Evidence:**
  - Agenda sending is session-only (`pages/api/meeting-tracker/sessions/[id]/agenda.js`).
  - The recipient directories are staff and Board only (`SessionAgendaPanel.js:70-74`; `SiteVisitEditor.js:58,187,234`).
  - Searching for "consultant" in meeting-tracker components and routes finds nothing. There is no email send in `lib/services/site-visit`.
- **Plan change:** Slice 4 must name:
  - the new invitation send route and service for research presentations (reusing agenda-service's frozen preview and uncertain-send handling, and registered in the API security matrix);
  - where consultant contacts come from;
  - how a deliberately empty attendee group is stored differently from "not set".

**Low priority:** the briefing page lists the presentation transcript (`briefing-page-service.js:298-302`). Line 88's "hidden but openable" wording only covers the presentation page, so the edition allowlist should decide this for both readers.

**Covered and not repeated:** approve/withdraw version conflicts, stale-approval retries, the revocation limit, internal-only allowlists, rollback to the pre-edition code, the shared role's app option (`config.js:43-50,87`), and the 360-second rule.

## 2. Owner decision needed
- **Summary provider disclosure (F6):** should **Save and prepare materials** show the existing Anthropic disclosure? If yes, it's recorded as a new acknowledgement version and needs no schema change. If no, a migration relaxes the three NOT NULL fields and the plan records that the disclosure was removed. The plan forbids both deleting the disclosure silently and inventing an acknowledgement, and the approved mockup leaves it out, so this can't be settled technically.

## 3. Verdict: READY WITH NAMED CHANGES
- **Required plan changes:** F1–F7 become explicit Slice 1–2 contracts; F8–F9 get Slice 4 re-scoped before it starts.
- **Blocker:** the F6 owner decision blocks Slice 2.

| Recommendation | Prerequisite | Tested | Disconfirming check | Status |
|---|---|---|---|---|
| Abandon-with-acknowledgement for summaries | `abandon.js:20-21` pattern exists | NOT TESTED | Find a durable Executor receipt written before dispatch (none at `execute-prompt.js:300,334`) | VERIFIED gap |
| Byte identity by member type | `presentation-page-service.js:356-363` | NOT TESTED | Live eTag stability for video | VERIFIED vs source |
| Persisted enrollment marker | `readiness.js:20-40` | NOT TESTED | Current production flag value | ASSUMED `on` (dated) |

**Limits of this review:**
- **Files not read:** `RecordingAndTranscriptCard.js`, staff-text/logistics/Workbench readers, the summary-draft and video-split route guards, Atlas pages, and the earlier review's full text.
- **Not checked:** live schema, configuration, flags, cron cadence and the Dynamics send-as behavior.
- **Not run:** no tests or gates.
