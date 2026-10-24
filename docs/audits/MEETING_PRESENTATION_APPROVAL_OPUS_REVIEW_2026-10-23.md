---
title: Claude Opus product review — presentation approval increment
domain: product
kind: audit
status: verified
last_verified: 2026-10-23
---

# Claude Opus product review and adjudication

Read-only review of the first implementation increment, requested by the owner. Requested model `opus`, actual main model `claude-opus-5-5`; CLI also reported internal `claude-fable-5-1` usage. OAuth was verified outside the sandbox as `claude.ai`, first-party Team subscription. The review process removed provider/API-key environment variables, allowed only Read/Grep/Glob, used an empty strict MCP configuration, and exited successfully. Duration 563812 ms, 52 turns. The CLI's USD 3.7554854 value is a list-price accounting estimate, not proof of an API-credit charge or invoice. No direct model API or Ultrareview was invoked.

## Verified findings and disposition

| Finding | Primary-agent verification | Disposition |
|---|---|---|
| P1 correction overwrites approved transcript | Same request/end filename and replace upload in presentation-transcript-service; correction changes revision without necessarily changing end | Fixed: derivative uploads use revision/attempt-specific folders and fail-on-conflict; shared summary helper retains its existing default. Friendly filename preserved. Distinct-attempt path regression would fail under the old code. Approved status now separately checks all three retained rows and live metadata; mismatch and unknown have distinct operator copy. |
| P2 approval steals source recovery fence | material-service exact original transcript token/fence recovery conflicts with acquirePresentationSlotLease takeover | Fixed: approval acquires only the three output slots, never Recording or Transcript. Candidate is rechecked after byte reads. Tests assert the exact lease-type set and refuse source drift. |
| P2 no new-table readiness fallback | New readers require migration 086 and fail closed on lookup error, including unenrolled requests | Deployment prerequisite accepted; suggested flag-off legacy fallback rejected because it could bypass sticky enrollment/withdrawal. The existing plan already requires migration/schema verification before reader deployment and an edition-aware rollback floor. No release is authorized or claimed here. |
| P2 4 MiB verification conflicts with 25 MiB text contract | Graph download cap was 4 MiB while writer allows 25 MiB | Fixed: shared 25 MiB constant; typed 422 on size-limit rejection. Test approves verified 5 MiB text and separately checks actionable cap errors. |
| P3 command replay service precheck | Store reuse guard is safer than service reachability; stale service retry returns 409 | Safe limitation retained: refresh resolves uncertain outcomes; a stale retry cannot revive withdrawal. No exactly-once UI/retry claim. |
| P3 reviewed view/candidate drift | Panel's server candidate can differ from concurrently refreshed preparation display; server fingerprint check protects switching to a changed candidate | Remaining UX limitation for integrated recording/orchestration slice; no claim that checkboxes prove human attention. Existing explicit refresh resets reviews and server recomputes fingerprint before approval. |
| P3 live filename after rename | Both resolvers use current Graph filename after integrity checks | Accepted metadata-only behavior; approved byte identity remains pinned. |
| P3 role lookup blocks status | Promise.all previously rejected all status on role/config outage | Fixed: status remains readable with mutation capability false if coordinator eligibility cannot be checked. Missing/unavailable role never grants authority. |

Additional primary-agent fix: both external pages now distinguish unavailable approval state from genuinely absent materials while retaining independently eligible applicant materials.

Post-fix verification: six relevant service/component suites passed 172 tests, including transcript/summary sibling behavior. Opus did not run tests or live QA, and these fixes were verified by the primary agent rather than a second Opus review. The raw review follows as historical evidence; its findings describe the pre-fix code and are superseded by the adjudication above.

## Original read-only review (historical pre-fix snapshot)

## Verdict

The access model holds up. Only the assigned Program Coordinator can enroll, approve or withdraw. I found no path that leaks staff discussion or the full recording, and no way around a withdrawal other than the limit you already accept: Microsoft URLs already issued and files already downloaded can't be recalled.

The slice still breaks one of its own core promises. An approved transcript does not survive the most common correction flow, and nothing tells the coordinator. I found one P1, three P2s and some P3s. None of them exposes content; they are about materials disappearing silently and about breaking an existing recovery path. This is a code trace only: I did no live QA. The migration file changed while I was reading it (header and line numbers moved), so recheck any cited lines in that file.

## What holds

- **Access control:** the route requires Meeting Tracker app access. The service then requires that the caller is the assigned coordinator, has an active staff profile, and that the profile matches (`coordinator-access.js:6-12`). That check runs again right before the pointer switch (`edition-service.js:107`). Helpers can read status but every change is refused.
- **Concurrent changes:** approval locks the request row and checks the version (`edition-store.js:38-45`). Withdrawal is a single update conditioned on the expected version and edition (`edition-store.js:60-64`). The two can't interleave.
- **Withdrawal and enrollment during a read:** both external resolvers re-check the policy after the Graph read and before redirecting (`presentation-page-service.js:429`, `briefing-page-service.js:821`). The Board page summary text is dropped if the policy changed mid-read (`presentation-page-service.js:347-350`). Enrolled requests with no approved edition get nothing, never the legacy set (`edition-model.js:61`).
- **Retention against supersession:** superseding a row only changes its lifecycle state, and the approved-rows check ignores lifecycle state. Nothing deletes superseded files. The video side doesn't depend on the current cut's status.
- **Byte identity:** at approval, transcript and summary bytes are downloaded and SHA-256 checked, and the video's quickXorHash is checked against the cut. When serving, size plus eTag (or quickXorHash for video) are rechecked. The Board summary text is checked by SHA (`presentation-page-service.js:219`).
- **No other way in:**
  - The buffered briefing `/document` route refuses rows from the post-presentation producer (`briefing-page-service.js:718`).
  - The split-open and Workbench video routes are staff-only.
  - There is no third external consumer under `pages/api/external` or `lib/external`.
  - Graph echoes the caller's drive ID and strictly checks the item ID (`graph/media.js:38-43`), so the strict ID comparison can't falsely refuse a file.

## P1

**1. Correcting a transcript overwrites the approved transcript file in place, with no signal to the coordinator.**
- **Mechanism:** the presentation transcript filename is built only from the request number and the presentation end (`presentation-transcript-service.js:273`, `:352`). The upload uses `conflictBehavior: 'replace'` (`:166-167`).
  - A transcript correction creates a new revision but keeps the same presentation end (`meeting-tracker-transcription/service.js:616`).
  - The new revision has a new generation key, so no earlier row is found, and the writer uploads to the same SharePoint path. That replaces the approved file's bytes under the same item.
  - The approved edition still points at the old row, whose stored eTag and hash haven't changed. The live eTag has, so the transcript is refused (`edition-model.js:71`, `:81`). This is the byte guarantee working, but the transcript is gone.
- **Who sees it:** on the briefing page the transcript is listed (`briefing-page-service.js:96`, `:296-304`), so the approved set quietly shrinks to summary and video, because `approvedEditionRows` serves a subset (`edition-model.js:65-73`). On the Board page the transcript isn't listed (`presentation-page-service.js:341`) but its member link stops working.
- **No warning:** the panel still says "The approved presentation is available to the Board" (`PresentationApprovalPanel.js:63`, `:70`), because the status it gets carries no health information (`edition-service.js:40-43`).
- **The other two members are fine:** summary filenames include the draft version (`transcript-summary-service.js:568`), and video filenames use the split ID with `fail` (`presentation-video-split-worker.js:420-421`).
- **Fix:**
  - Make the presentation transcript filename unique per revision and upload with `fail`, matching the sibling writers.
  - Have the approval status (GET) report whether every member of the active edition still matches its pinned identity, so the panel can show "approved version is no longer servable."

## P2

**2. Approval takes all five slot leases, which permanently breaks recovery of a stuck transcript publication.**
- **Mechanism:**
  - Approval takes the RECORDING and TRANSCRIPT leases as well as the three edition slots (`edition-service.js:19`, `:87-91`).
  - Taking over an expired lease swaps the token and bumps the fence (`slot-lease-store.js:25-40`).
  - Resuming a publication left in `unknown` or `retryable` requires the exact original token and fence (`material-service.js:2311-2318`, called from `meeting-tracker-transcription/service.js:792`).
- **Effect:** any approval attempt, even one that later fails with "busy" or "candidate changed", turns a pending publication recovery into `meeting_transcript_original_fence_lost`. Approval doesn't write transcripts, and its frozen fingerprint plus byte checks already make the edition internally consistent.
- **Fix:** take only the three edition slots, or refuse approval while an unresolved transcript publication receipt exists for the request.

**3. No runtime gate on the new tables.**
- **Mechanism:** `edition-reader.js:9-12` reads `meeting_presentation_visibility` for every request and turns any error into a 503.
- **Effect:** if this code ships before migration 086 is applied, or the migration has to be rolled back, every request loses its presentation items, legacy ones included:
  - The Board context marks presentation unavailable (`presentation-page-service.js:339-342`).
  - Opening a member fails with 503 (`:398`).
  - The briefing page hides the items (`briefing-page-service.js:325-326`, `:791`).
- The Board page path has no schema-ready check at all. This only bites if the deploy/apply ordering slips, which your current block prevents, but nothing in the code enforces it.
- **Fix:** add an explicit feature-ready flag. When it is off, use the legacy selector without reading the table. When it is on, keep the "enrolled with no approved edition never falls back to legacy" rule exactly as it is.

**4. Transcripts between 4 MB and 25 MB can never be approved, and the error is misleading.**
- **Mechanism:** the verification download is capped at 4 MB (`edition-service.js:26`), while the writer allows up to 25 MB (`post-presentation-transcript-file.js:4`).
- **Effect:** Graph's size-limit error is not a `ServiceHttpError`, so the route returns the generic "Board approval is unavailable. Try again." (`presentation-approval.js:34-35`). Typical transcripts are much smaller, but if it happens the coordinator has no way forward.
- **Fix:** reuse the writers' size limits and return a 422 with a real message.

## P3

- **Approve retry protection is unreachable.** The service's version pre-check (`edition-service.js:79`) rejects a replay before the store's command-ID reuse path (`edition-store.js:40-44`) can run. The panel also generates a new command ID on every click (`PresentationApprovalPanel.js:86`). A retry after an unclear response gets a safe 409, not "already approved." Either let the store decide replays or remove the dead path.
- **What the coordinator reviewed isn't tied to what gets approved.** The checkboxes are just client claims. The panel only refreshes on mount, after its own actions, or on the manual refresh (`RecordingAndTranscriptCard.js:3830-3833`, `:3641`), independently of the card's material view. The server's candidate-changed 409 catches most drift. The exact "reviewed what was approved" link would need the panel to show the candidate's summary and video itself, or to send the reviewed document IDs for comparison.
- **Live filenames are served instead of pinned ones.** Approved rows return Graph's current name rather than the edition's stored filename (`presentation-page-service.js:410`, `briefing-page-service.js:806`). A rename changes what the Board sees, but the bytes are unchanged.
- **GET depends on the role lookup.** The coordinator check runs inside the same `Promise.all` as the status read (`edition-service.js:64-66`). A settings outage, or an inactive assigned coordinator (`eligibleStaff` throws), fails the whole status view, including for helpers.

## Later slices, not defects

Durable orchestration, removing the provider checkboxes, manual full-video recovery, the before-meeting redesign and the Workbench reorganization are planned and not claimed here. Finding 2 is a defect of this slice and shouldn't wait for durable orchestration.

## Limits

- Code trace only. No live Graph, Postgres or UI checks, and I didn't run the tests.
- That `replace` keeps the same item ID is inferred from Graph's documented behaviour at the same path, not observed. If it creates a new item, finding 1 still happens, just as a missing file instead of changed bytes.
- Issued pre-authenticated Microsoft URLs and downloaded files can't be recalled after withdrawal, as already accepted.
- I didn't review the unfinished docs. The tree was being edited during the review.
