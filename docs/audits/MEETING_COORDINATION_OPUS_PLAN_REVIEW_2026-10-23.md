---
title: Claude Opus Meeting Coordination Plan Review
domain: product
kind: audit
status: review-received
summary: Read-only OAuth Claude Opus review of the Meeting coordination plan at a9076fb9c; nine findings, ready with named changes, not yet adjudicated or applied.
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
- Scope: plan review only. Findings below are the reviewer's conclusions, not independently adjudicated acceptance or implementation evidence. No plan corrections have been applied from this report. Repository policy/product intent takes precedence over a proposed reviewer remedy.

# Claude review output

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
