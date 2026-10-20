---
title: Opus review of the preallocation audio plan
domain: meeting-tracker
kind: audit
status: historical
summary: "Read-only Opus review of the revised preallocation design. Initial findings corrected; final exact-revision verdict READY TO IMPLEMENT. Runtime validation remains pending."
owner: product-engineering
---

# Initial review of preallocation revision

Received via host OAuth Claude Code on 2026-10-19. The reported fingerprint is SHA-1 (default shasum), verified by the lead; the corresponding SHA-256 is `c0b87a9d3f16cc58352029125b0733082c23d1b5c8e344f96f6887f0884b5c1f`. This is the verbatim review of that revision, not approval of later edits.

I'm acting only as reviewer here. I edited nothing, ran no tests, made no network or database requests, and opened no env or credential files.

**What I ran:** `git rev-parse` (HEAD `d90886f73`) and `shasum` on the plan. I also ran one `codegraph explore`, plus Read and Grep on the source files named below and on the installed `@vercel/blob` `dist/index.js`. One shell command (`sed`/`wc`) was denied, so I used Read and Grep for the rest.

**Plan fingerprint:** `549b18fb79133c04605ede1441eeb2baf2f4410f  docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md`

[ADVERSARIAL-REVIEW-RECEIPT: docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md]

## Findings, most severe first

### 1. Medium-high: the route deadlines leave out dispatch and the Zoom Blob write
- **Plan:** 197–206 sets 50/105/270 s and passes `deadlineMs` through "start/service/queue". The read, inspection and upload budgets get formulas; dispatch and the Blob write don't.
- **Source:**
  - Meeting Tracker route has `maxDuration: 60` (`.../transcriptions/[jobId]/start.js:9`).
  - `startMeetingTranscription` calls `dispatchQueuedTranscriptionWorkflow({ jobId })` with no deadline (`service.js:291`), so dispatch gets its own fresh 15 s (`workflow-dispatch.js:10,26`).
  - That makes 50 + 15 > 60. The owner route has 120 − 105 = 15 s, with no margin for the response (`admin/.../start.js:6,33`).
  - Zoom writes use `Date.now() + BLOB_WRITE_MS` (120 s) at `import-service.js:34,312,318`. The plan gives no write formula, even though `startMeetingTranscription` still runs a second 200 MiB read, inspection, queue and dispatch afterwards (`import-service.js:330`).
- **Why it isn't a blocker:** dispatch already accepts `deadline`. With less than 10 s of headroom it defers (`workflow-dispatch.js:47–50`), and every failure becomes `TranscriptionWorkflowDispatchError` (`:39–42`). Both callers already keep the queued job: `dispatchPending:true` at `service.js:292–293`, and 503 `retryable` with the job at `admin start.js:35–36`.
- **Required change:** pass the route deadline into dispatch, or make dispatch's 15 s reservation explicit inside each route budget. Set the Zoom audio and VTT write budget to `min(120 s, remaining − start reserve)`.

### 2. Medium: the streaming success test needs a defined mechanism
- **Plan:** 175–182 says "require full source consumption before success" but doesn't say how. If an implementer uses the Readable's `'end'` event, the final `done` pull can race the parsing of a real 200. A false failure there goes to `failed` with `cleanup_requested_at` (`worker.js:253–255`) and leaves an orphaned remote upload.
- **Source:** today `request()` only cancels the body on a non-ok status (`provider.js:51–52`). The early-2xx check is new behaviour.
- **Required change:**
  - Count bytes as they are pushed. After the JSON is read, treat `yielded !== audio.length` as failure, mapped to the existing provider request failure.
  - In `finally`, `destroy()` the Readable and await its close, with a time limit.
- **Hang analysis (from source):** the single `AbortController` timer (`provider.js:41–42`) covers fetch and the JSON read, so a peer that stops reading without responding can't hang the call. A peer that answers early is caught by the counter.
- **Confirmed sound:**
  - `safeFetch` spreads `requestOptions` straight into `fetch` (`safe-fetch.js:85,93`), so only `request()` needs to forward `duplex`. JSON calls are unaffected.
  - With `failOnRedirect:true` a 3xx comes back to `request()` and fails as `!ok` (`safe-fetch.js:100`), so a used stream is never re-sent.

### 3. Medium: error mapping must be per caller, not per transport
- **Plan:** 88–90, 123 and 223–226 say failures are "mapped by each transport". But the Blob transport has three callers with different error contracts:

| Caller | Size mismatch | Missing blob | Over cap |
|---|---|---|---|
| Owner | `uploaded_size_mismatch` 422 (`runtime.js:366`) | `audio_not_found` 409 (`:315`) | `audio_too_large` 413 (`:321`) |
| Meeting Tracker | `uploaded_metadata_mismatch` 422 (`:157–159`) | `transcription_upload_missing` 410 (`:154–155`) | `content_too_large` 413 (`:346`) |
| Worker | `audio_integrity_mismatch` 409 (`:406–408`) | — | — |

- Expected size is always ≤ the cap, so "more bytes than expected" fires before the cap. The two 413 codes become unreachable for audio, a small contract change the plan should state outright.
- **Leak paths:**
  - The owner route echoes `error.message` for any code starting `transcription_` (`admin start.js:43`).
  - The Meeting Tracker route echoes `error.message` for any status below 500 (`start.js:26–29`).
  - The Zoom importer treats any `{code, status 400–599}` as an authored error (`import-service.js:189–193`).
  - The helper's internal errors must therefore carry no `status`/`httpStatus` and no `transcription_` prefix.
- **Required change:** add the table above to the plan, plus that constraint on helper error fields.

### 4. Medium: cleanup on rejection before allocation, and the Zoom deadline signal
- **Rejected responses:** a mismatched header, content type or ETag is rejected before a reader exists (plan 98–104). The cancellation wording in plan 118–122 only covers the owned reader, but `get()` returns a live `response.body` (blob SDK `index.js:185–195`). The plan must say `result.stream.cancel()` runs on every rejection before allocation.
- **Zoom deadline:** `timedFetch` uses its own `AbortSignal.timeout(240 s)` (`zoom-client.js:14,74–76`). If `deadlineMs` only races the reader (plan 119–120), the socket stays open after the deadline. The fetch signal must combine the per-hop cap with the absolute deadline.
- **Zoom HTML rejection:** today it doesn't cancel the body (`zoom-client.js:258–260`). The plan's "every rejected body is canceled" fixes this; keep it.

### 5. Low-medium: the worker's 5 s reserve doesn't cover the steps after upload
- **Plan:** 206 sets the upload budget to `min(90 s, remaining − 5 s)`. That still beats today's `min(90 s, remaining)` (`worker.js:50–53,204`).
- **Problem:** after the upload come the reference write, the submission-intent write and the submit POST.
- **Source:** `providerTimeout()` runs inside the inner `try` (`worker.js:228–234`). If less than 1 s remains it throws there, and the job becomes `submission_uncertain` even though no POST was sent. This happens after intent has been recorded (`:216`).
- **Required change:** either record this as an existing residual, or check remaining time before `beginTranscriptionProviderSubmission` and reuse the existing revert-to-queued path (`:210–214`). The saved upload reference is then reused. That changes when the job is rescheduled, so it's your call.

### 6. Low: name the outcomes of the pre-upload check
- **Plan:** 185–187. Today nothing runs between inspection and upload (`worker.js:201–203`).
- **Source:** `getLeasedTranscriptionJob` already rejects an expired lease (`store.js:146`).
- **Required change:** the plan should say this check:
  - returns exactly `'fenced'` for a lost lease or a cleanup request (same as `:205–206`);
  - uses the existing `'submissions_disabled'` path when switches are off (`:191–195`);
  - evaluates `jobSubmissionEnabled` on the re-read row.
- The lease of 420 s is confirmed (`store.js:10`) and the worker budget is 240 s (`worker.js:26`).

### 7. Low: Zoom reference release
- `audioBytes` is `const` at `import-service.js:311`; this is the line plan 144–147 changes.
- `describe(file, bytes)` returns only scalar fields (`:320–322`), so the capture keeps no alias to the audio. ✓
- The buffer stays alive through the optional VTT download (`:313–319`). Hashing and releasing it straight after the audio write is an optional improvement.
- Partial success is preserved:
  - `retireMeetingUploadingJob` sets `cleanup_requested_at` (`store.js:1840`), which covers an aborted or partial Blob write.
  - A job that is already queued becomes the import's "started" result (`import-service.js:345–347`).

### 8. Low, release gate only: Node version and undici's chunk handling
- Streaming 64 KiB views depends on undici copying each chunk before putting it on its byte stream. If it enqueued the view itself, the transfer could detach the whole 200 MiB buffer.
- `package.json` pins no Node `engines` version, so the deployed runtime is unknown.
- **Gate:** after upload, assert the source buffer's SHA-256 is unchanged and its `byteLength` is non-zero on the target Node version.

## The six questions

1. **Memory premise:** it's adequate for a bounded optimization. The plan claims no incident and no hard bound (plan 38–40). Keeping the copying inspector (`Uint8Array.from`, `media-inspector.js:70`) is already inside the measured 534.6 MiB. It explains the ~200 MiB gap to the transfer candidate (333.4 MiB) and doesn't cancel the roughly 52% reduction.
2. **Header gating:** it holds. `declared_bytes` comes from the client but is capped (`runtime.js:88`), and the client token limits the upload to that size (`:130`). A large declaration with a tiny upload fails the header check before allocation. A missing or encoded header falls back to today's accumulation, which is bounded at about 2× the expected size and deterministic. Gating on "unencoded" is essential because fetch decompresses transparently. The SDK's `blob.size` is derived from the same header (`index.js:204`). ✓
3. **Ownership and lifecycle:** concrete enough once findings 2 and 4 are applied.
4. **Zoom:** sound, with findings 1 and 7 applied.
5. **Fences and deadlines:** sound, with findings 1, 5 and 6 applied. No new retries are introduced.
6. **Shared helper errors:** finding 3 must be specified.

## Recommendations and evidence

| Recommendation | When it applies | Tested by me? | Check that would disprove it |
|---|---|---|---|
| R1: dispatch inside the route budget; Zoom write formula | Before coding (plan edit) | Source read only | Owner/Meeting test with slow fake Blob: queue ends at about the deadline. Disproved if dispatch can't defer, fail as pending, or ever outrun `maxDuration` |
| R2: byte counter decides upload success | Before coding | Not tested | Local receiver sends 200 after N−1 bytes, and a real 200 arrives with the final pull delayed; neither must produce a false result |
| R3: per-caller error table; helper fields constrained | Before coding | Source read only | Short EOF in each caller gives the codes in the table, and no helper text appears in the route JSON |
| R4: cancel body on early rejects; Zoom signal includes deadline | Before coding | Not tested | Mismatched-header stub: the body is cancelled within 1 s and no socket stays open after the deadline |
| R5: post-upload residual named or budgeted | Owner decision | Not tested | Fake clock leaves less than 1 s after upload; check whether the job reaches `submission_uncertain` with zero POSTs |
| R6: pre-upload check outcomes | Implementation | Source read only | Cleanup or switch flipped during inspection: zero upload attempts and only existing outcomes |
| R8: source buffer intact after upload | Release gate | Not tested | Source digest and `byteLength` after upload on the deployed Node version |

## Blockers vs. tests

**Must be resolved before implementation (plan text only):** R1–R4 need to be written into the plan, with R5 either specified or accepted as a residual. None needs new evidence.

**Implementation tests and release gates (not needed to approve the design):**
- Plan verification items 1–8 as written.
- R6 and R8.
- Hosted memory and concurrency comparison on Preview.
- Target-Node framing check.
- An authorized real provider upload as a separate release step.

**Residual risks:**
- No exactly-once guarantee for remote uploads.
- Unknown-length fallback still allocates about 2× the file size.
- Zoom reference release doesn't force prompt garbage collection (the 741.1 MiB outlier).
- Hosted memory is unmeasured.

**READY WITH NAMED CHANGES** (R1–R4 required in the plan text; R5 needs an explicit decision).


# Follow-up review after R1–R5 disposition

Verbatim review of plan SHA-256 `059cef858c02eb628b96fe434d66776031056e4a5f2bf741e0332494e340aaf5`; named changes A/B are addressed in the next revision.

I edited nothing and ran no tests. I made no network, database, provider or deploy calls, didn't read env or credential files, and delegated nothing.

**What I ran:** `shasum -a 256` on the plan, `git rev-parse` (HEAD `d90886f73`), a full Read of the revised plan, and two Greps (Zoom error statuses and the Zoom import failure-code path). Other source evidence comes from my first-pass reads at the same HEAD.

**SHA-256:** `059cef858c02eb628b96fe434d66776031056e4a5f2bf741e0332494e340aaf5  docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md`

[ADVERSARIAL-REVIEW-RECEIPT: docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md]

## Confirmed as consistent with current source

- **R1, dispatch budget (plan 237–243):** `min(deadlineMs, now + 15 s)` keeps the dispatcher's 15 s cap and its 10 s headroom deferral (`workflow-dispatch.js:10–11, 46–50`). Every failure becomes `TranscriptionWorkflowDispatchError` (`:39–42`). Both callers still keep the queued job:
  - Meeting Tracker returns `dispatchPending` (`service.js:292–293`).
  - Owner start returns 503 `retryable` with the job (`admin start.js:35–36`).
  - Partial success is preserved.
- **R1, Zoom writes (plan 245–251):** if a write's budget is already used up, `createBlobDeadline` throws `blob_deadline_exhausted`/504 (`runtime.js:245`). The importer treats that as an authored error (`import-service.js:189–193`), so the existing retire-then-fail path runs. Retirement sets `cleanup_requested_at` (`store.js:1840`), which also covers a partly written Blob.
  - Arithmetic: 270 − 70 leaves up to 55 s for the start chain's read, then ≤10 s inspection, then dispatch, all within `maxDuration: 300`.
- **R3, error table (plan 279–298):** matches source.
  - Owner codes: `runtime.js:315, 321, 366`.
  - Meeting Tracker codes: `:154–159, 346`.
  - The worker inherits `audio_not_found`/`audio_too_large` through `readPrivateBlob` (`:405`).
  - Zoom: `zoom_download_invalid` and `zoom_unavailable` are both 502 (`zoom-client.js:28, 31, 39`).
  - The rule that helper errors carry no status field closes the fall-throughs I named in the first pass.
- **R3, discard/count after overflow (plan 123–132):** safe.
  - Nothing past expected size is kept, and the preallocated buffer never grows.
  - The drain stops at the old cap, which matches the old readers: `runtime.js:321, 346`; `zoom-client.js:217–219`.
  - Read or deadline errors still take precedence, as they do today.
  - On the optimized branch an overflow means the body broke its own `Content-Length` framing, so in practice it is reached only on the fallback path.
- **R4 (plan 140–146), R5 (plan 270–277), R6 (plan 219–223) and R8 (plan 316–319):** each is specified as I asked.
  - R6 matches the existing `fenced` return (`worker.js:205–206`) and the existing switches-off path (`worker.js:191–195`).
  - `getLeasedTranscriptionJob` already rejects an expired lease (`store.js:146`).

## Remaining findings

### A. Low-medium, named change: "pushed" and "yielded" are not the same thing (plan 200–206)
- Plan 200–202 says an early 2xx **before the source is fully yielded** must fail. Plan 203–204 counts bytes **as each chunk is pushed**.
- A Node Readable pushes ahead of its consumer by up to its high-water mark. An early 200 that arrives while the last ≤64 KiB are still buffered would therefore pass the counter.
- **Fix:** success requires `pushedBytes === audio.length && readable.readableLength === 0`. Both are synchronous state checks, not end-event timing. Alternatively, count bytes when the consumer pulls them.
- **Disconfirming check:** in the local wire test, the receiver sends a valid-URL 200 while about one high-water mark of bytes is still unconsumed. It must fail, while the delayed-final-pull case (plan 316–317) still passes.

### B. Low, clarification: deadline for the VTT download
- Plan 157–159 says the VTT call "keeps existing defaults and caps". Plan 143–146 and 234–236 say downloads get the absolute deadline.
- Today the VTT fetch gets a fresh 240 s per hop (`zoom-client.js:14, 248`; `import-service.js:316`). That could run past `importDeadline − 70 s` and only then be refused at the write.
- **Fix:** state that the VTT download receives `deadlineMs`, capped by `importDeadline − 70 s`, without preallocation.
- **Disconfirming check:** a slow-VTT stub must abort by the write deadline and leave the job retired, not still `uploading`.

### C. Optional
- For Zoom, the mismatch and over-cap outcomes are the same code (`zoom_download_invalid`), so draining after an overflow only spends network time up to the cap.
- The plan could allow cancelling immediately when a caller's two codes are identical. It's not unsafe as written.

## Remaining risks

- A slow start chain inside Zoom import or Meeting Tracker start will often hit dispatch deferral. That schedules a retry after 300 s (`workflow-dispatch.js:49`) and relies on the hourly recovery cron. This adds latency but loses no data.
- The `submission_uncertain` outcome with zero POSTs is kept as a named residual (R5).
- Hosted memory, the deployed Node version and real-provider behaviour remain release gates.

## Blockers vs. tests

**Specification changes before implementation:** A and B, each a one-sentence edit to the plan. Nothing else is outstanding.

**Implementation tests and release gates (not design blockers):** plan verification items 1–8, plus the two disconfirming checks above.

**READY WITH NAMED CHANGES** (A and B)


# Final exact-revision check

Received on 2026-10-19 after applying both follow-up changes. The lead independently verified the SHA-256 below. Review approval covers the specification only; application implementation and release validation remain pending.

Both changes are resolved and I found no remaining specification blockers. This was a read-only check: I ran `shasum -a 256`, `git rev-parse` (HEAD `d90886f73`), one Grep and two Reads of the plan. I ran no tests and made no network, database or provider calls.

**SHA-256:** `6671cf8165542753d2352660999b503d588c036a8f86b353e2a17f5be6f87a5b  docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md`

[ADVERSARIAL-REVIEW-RECEIPT: docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md]

**A (upload success check): resolved.**
- Plan 208–213 captures `expectedBytes` before streaming and requires `pushedBytes === expectedBytes && readable.readableLength === 0` after the JSON read. It does not wait for the end event or a final pull.
- The check runs before the `finally` destroy (214), so destroy can't empty the buffer first.
- A failed check maps to the existing provider failure (212).
- Plan 323–325 tests both cases: a buffered early 200 must fail, and a delayed final pull must still succeed.
- Lines 204–206 ("fully yielded") no longer contradict this.

**B (VTT download deadline): resolved.**
- Plan 160–162 gives the VTT download `min(now + 240 s, importDeadline − 70 s)` without preallocation. The 240 s matches today's per-hop cap (`zoom-client.js:14`).
- Allocation and byte caps stay unchanged (158–159), which is consistent with the rest of the plan.
- An aborted VTT read already becomes `zoom_unavailable`/502 (`zoom-client.js:223–225`). The importer treats that as an authored error, so the job is retired.
- Plan 326–327 tests the slow-VTT case.

**Wording note, not a blocker:** "Other range/listing consumers retain their existing default budgets" (163) could be read as including the import's own listing. Plan 241–243 says that listing must use the import's remaining time. Read in context, 163 means consumers outside the import.
- If you want to be sure, check that the import's listing and detail calls receive `deadlineMs`; a listing-only test would show it.

**Implementation tests and release gates (not part of design approval):** plan verification items 1–8, including the target-Node framing and source-buffer integrity checks, Preview memory and concurrency, and a separately authorized real provider upload.

**READY TO IMPLEMENT**
