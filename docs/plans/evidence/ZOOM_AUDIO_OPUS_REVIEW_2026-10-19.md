---
title: Opus adversarial review of Zoom audio plan
domain: meeting-tracker
kind: audit
status: historical
summary: "Read-only Opus 5.5 review of the initial Zoom audio memory plan; verdict NEEDS REWORK. Source findings and untested recommendations are preserved."
owner: product-engineering
---

Review received 2026-10-19 through Claude Code using the verified host OAuth session. This is the original review of the SHA-256 identified below, preserved verbatim. Recommendations were not executed. Later plan amendments require a new review before implementation approval.

# Adversarial review: Zoom audio memory reduction plan

[ADVERSARIAL-REVIEW-RECEIPT: docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md]

- **Plan reviewed:** `docs/plans/ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md`, 275 lines, untracked, on branch `codex/zoom-audio-streaming` at `bb7b5e04c`.
- **SHA-256:** `1423272c48141c6adf30fbfd756082290b9afda47618e89f9b53fd06a80a7bc7`. Any edit to the plan makes this receipt stale.

**Verdict: NEEDS REWORK.** Stop the temp-file work until the measurements below have been run, then revise the plan before writing any code. Blockers are listed at the end.

## Read-only checks performed

**Commands run:**
- `shasum -a 256` and `wc -l` on the plan; `git status --short`; `git log -1`.
- `cat -n` of `limits.js`, `audio-inspector-worker.js`, `media-inspector.js` and `provider.js`.
- `sed`/`grep` ranges in `store.js` (claim and requeue logic, lease length, active-slot index), `import-service.js`, `zoom-client.js`, `safe-fetch.js`, `workflow.js`, `workflow-probe.js`, `vercel.json`, `next.config.js` and the five caller routes' `maxDuration` settings.
- `grep` of `lib/` for `tmpdir`, `mkdtemp`, `/tmp/`, `openAsBlob` and `statfs`.
- `grep` of `docs/` for memory/OOM incidents.
- `node -v` (local v26.6.0).
- `grep` in `node_modules/undici/lib/web/fetch/body.js` (installed undici 6.29.0).

**Files read in full or in part:** `runtime.js`, `worker.js`, `store.js` §600–670 and §755–795, migration `060…sql:113`; in music-metadata 11.16.1, `lib/index.js`, `lib/core.js`, `ParserFactory.js` and `MP4Parser.js`; strtok3 `FileTokenizer.js`; `@vercel/blob/dist/index.js:99-209`; tests `transcription-pilot-media.test.js` and `transcription-pilot-worker.test.js` (by grep).

**Denied:** one command (`cd node_modules/music-metadata && grep …`). I redid it with the Grep and Read tools instead.

**Not done:**
- No tests, gates, probes, network calls, database access or environment-file reads.
- I did not run `codegraph explore` myself. The prompt hook supplied CodeGraph context, and because the files were named I read the source directly.
- Every "experiment" below is a proposal unless marked as executed.

---

## Part A: Premise

**P1 (High). No measured evidence of a production problem, and the code's own reason for streaming is excluded by the plan.**
- [VERIFIED] `limits.js:14-17` gives the reason for streaming: whole-file buffering makes 200 MiB a "memory-bounded ceiling", and streaming "removes it".
- [VERIFIED] The plan rules out any cap increase (plan lines 37 and 244).
- [VERIFIED] The only memory measurement in the repo is a test regression ceiling: `transcription-pilot-media.test.js:94-116`, bounded at 2×cap + 112 MiB.
- [VERIFIED] `vercel.json` has no `memory` key, so function memory is the platform default. I have not verified what that default is.
- [VERIFIED] No OOM or memory incident appears in `docs/`. That is absence in the repo only; I can't see Vercel logs.
- [VERIFIED, plan line 34] The plan admits the outage status is UNKNOWN.
- Conclusion: the work is a hypothetical efficiency improvement with no stated success value beyond "≥100 MiB lower".
- Required change: make the baseline measurement (plan §1) a gate that can end the project, not a step inside it.

**P2. The four-hour duration cap already fits within 200 MiB at the one observed bitrate.**
- [VERIFIED arithmetic] From `limits.js:10-13` (40.8 MB per 62 min ≈ 0.66 MB/min), four hours is about 158 MB ≈ 151 MiB, which is under 200 MiB.
- The cap only binds above about 0.874 MB/min (≈116 kbps). Whether Zoom produces audio-only files at that bitrate is ASSUMED/unknown, and there is one observation.
- Either way, this work changes neither limit.

**P3 (High). The model of current peak memory is incomplete, and the split puts the worst route last.**

Modelled from source (ASSUMED until measured; garbage-collection timing not observed):

| Stage | Source | Peak |
|---|---|---|
| Blob read | chunks + `Buffer.concat`, `runtime.js:317-325` | ~2× while concatenating |
| Inspection | caller buffer + `Uint8Array.from` copy, `media-inspector.js:70` | ~2× |
| Upload | undici copies any ArrayBufferView body (installed undici 6.29.0, `body.js:118-122`; the Fetch spec requires the copy) | ~2× at `provider.js:67` |

- The plan's premise table (plan line 31) misses the upload copy.
- **The Zoom route is worse.** `import-service.js:311-331` keeps `audioBytes` alive across the Blob write, the provenance hash and `startMeetingTranscription` → `queueMeetingTranscription` → `inspectAudioBuffer`. That puts the route at roughly 3× in one invocation, plus the Zoom download's own 2× concat (`zoom-client.js:205-227`).
- So the proposed first slice (plan lines 58-73) probably leaves the Zoom import route as the largest peak. The split is backwards for the route that matters most.
- The Zoom-side fix the plan defers is very likely trivial: drop the `audioBytes` reference after `describe`/`capture` and before the start call. That does not need a scratch-file lifecycle. (NOT TESTED; see matrix row R4.)

**P4. Random access gives no format advantage. The plan's claim at line 162-163 conflicts with the source.**
- [VERIFIED] `parseBuffer` already uses a random-access tokenizer (`ParserFactory.js:58-61`).
- [VERIFIED] The MP4 parser skips over `mdat` with `tokenizer.ignore(len)` in every mode (`MP4Parser.js:142-153`), so late-`moov` files already parse today.
- Reading from a file only removes the copy handed to the inspector worker; it gains nothing for metadata placement.

**P5. Disk and page-cache accounting could cancel the entire benefit.**
- [ASSUMED] If `/tmp` is tmpfs, or if file pages count against the function's memory limit, spooling 200 MiB to disk just moves the memory.
- The plan's hosted gate (plan lines 150-153 and 236) does not name a metric that would decide this.
- Required change: one bounded synthetic Preview probe *before* any helper code. It should record the `/tmp` filesystem type (`/proc/mounts` or `statfs`) and the memory counters (`/sys/fs/cgroup/memory.current` and `memory.stat` anon/file/file_dirty, if readable) while writing a ~200 MiB file. That location is ASSUMED readable.
- If `/tmp` is memory-backed, reject the disk design.

**P6. No `/tmp` usage exists anywhere in `lib/`, so this is a new runtime surface.**
- [VERIFIED by grep]
- The repo's existing large-file precedent is ranged, chunked transfer (`video-copy-worker.js:839-848`, `zoom-client.js:309-337`), not disk.

**Premise decision: narrow, and stop pending the experiment.**
- First run plan §1 locally on all three routes (owner start, Meeting Tracker start, Zoom import) plus the P5 hosted probe.
- Compare against a narrow in-memory option (R3/R4): pre-allocate one exact-size buffer, transfer it to the inspector and back, stream the upload from the verified buffer, and release `audioBytes` in the Zoom route. The model puts that at about 1× cap with no scratch subsystem.
- This option is NOT TESTED and is not claimed to be better.
- Only adopt temp-file spooling if the measurements show that 1× is still too much and that disk is not counted as memory.
- One genuine advantage of the temp-file design: it separates network time from the hard 10 s parse timeout. Streaming the bytes straight into the parser would merge the two.

---

## Part B: Design findings, ordered by severity

**B1 (Blocker). The "retryable busy error" has no retry path; any new local failure in the worker destroys the job.**
- [VERIFIED] Every error thrown before the submission-intent step in `submitQueuedJob` ends at `worker.js:253-256`. That sets `status:'failed'` and `cleanup_requested_at`, which deletes the user's audio.
- [VERIFIED] The only non-terminal early exit is the `submissions_disabled` path (`worker.js:191-195`). It returns the job to `queued` without `next_attempt_at`, so `claimNextQueuedJob` (`store.js:630-657`) would re-claim it immediately inside the same drain loop (`worker.js:485-493`).
- [VERIFIED] No worker test covers an early failure: there is no mocked rejection of `inspectOwnerInput` or `uploadAssemblyAIAudio`.
- The plan says (lines 139-142) that busy/ENOSPC errors will be "retryable", but nothing in the worker would make them so.
- Worst case: a stale lock or a full `/tmp` on one instance fails and deletes every job that lands there.
- Required change:
  - Specify the outcome for each case: busy, ENOSPC, scratch I/O error, cleanup failure.
  - Example: `submitting` → `queued` with a bounded `next_attempt_at` backoff, an attempts ceiling, the lease released, and no cleanup.
  - Exclude the job from re-claim within the same drain pass.
  - Test that an ENOSPC rejection leaves the audio in place and schedules a backoff.
- Residual: existing transient Blob/provider failures already fail jobs permanently. That is out of scope, but it should be written down.

**B2 (Blocker). `parseFile` changes how the parser is chosen and can fail silently.**
- [VERIFIED] `parseFile` picks a parser by file extension first (`music-metadata/lib/index.js:39`). The strtok3 `fromFile` call also records `fileInfo.path` (`FileTokenizer.js:12`), and `ParserFactory.js:70-71` uses that extension too.
- [VERIFIED] Today's `parseBuffer(bytes, undefined)` always detects the format from content (`ParserFactory.js:73-86`).
- If the "fixed server-selected filename" (plan line 105) ends in `.mp3`, the MPEG parser's lenient frame-sync scan becomes the first parser tried on any bytes. If it ends in `.m4a`, real MP3 uploads are rejected. Either way the format guarantee in plan line 81 changes.
- [VERIFIED] `getExtension` uses `lastIndexOf('.')` over the *whole path* (`ParserFactory.js:142-145`), so a dot anywhere in the temp directory path changes the result.
- [VERIFIED] The non-Node build of `parseFile` always throws (`core.js:118-120`; package.json `exports` has separate `node` and `default` entries). The inspector worker's catch-all (`audio-inspector-worker.js:24-27`) would turn a wrong build being loaded into `audio_malformed` on every upload. Combined with B1, that means total rejection plus job deletion.
- Required change:
  - Use a filename with no extension, and assert the full path contains no `.`.
  - Add parity tests: the file path and the buffer path return identical results for every fixture, including MP3 bytes declared as `audio/mp4` and M4A bytes in an MP3-named file.
  - Add a deployed probe that proves the Node build is loaded (see B7).

**B3 (Blocker). Scratch admission and stale-file recovery are left as open questions.**
- The plan (lines 121-127 and 139-148) defers both to review, so they block implementation as written.
- A one-spool-per-root limit is also an availability regression: concurrent starts that succeed today would get "busy".
- Recommended simplest design:
  - Per-operation `mkdtemp` directory (0700) under one app-owned root. Check the root with `lstat` (not a symlink, owned by this uid).
  - Exclusive-create file (0600) with no extension.
  - In-process reservation counter in bytes, plus a `statfs` free-space check of expected bytes + headroom.
  - ENOSPC is handled as retryable (B1).
  - No lock files.
  - A reaper limited to the helper's own name prefix that removes only directories older than the helper's own absolute deadline + margin. Make that at least the 420 s lease (`store.js:10`) plus the largest route `maxDuration` (300 s).
  - The helper must enforce that deadline itself, so no operation can outlive the age guard.
- Add filesystem locks only if the Preview probe shows several processes sharing one `/tmp`. Whether routes share an instance or bundle is ASSUMED/unknown.
- Residual: after a process is frozen and thawed, an operation may still hold an open file whose directory was reaped. Reading through the open file handle stays correct; the pre-upload lease re-read (B6) fences it.

**B4 (High). Route time budgets are already inconsistent, and spooling makes them worse.**
- [VERIFIED] The Meeting Tracker start route allows 60 s (`transcriptions/[jobId]/start.js:9`). `queueMeetingTranscription` passes no deadline, so the Blob read defaults to 90 s (`runtime.js:27,154`), followed by a 10 s inspection.
- [VERIFIED] The Zoom import route allows 300 s (`zoom-imports.js:11`), but its stage caps add up to 240 + 120 + 90 + 10 = 460 s (`zoom-client.js:14`, `import-service.js:34`, `runtime.js:27`).
- When the platform kills an invocation at its limit, `finally` never runs and a stale 200 MiB file is left behind. This is a live scenario, not a hypothetical one.
- Required change: give a numeric absolute deadline for each entry point (route limit minus a cleanup reserve) and pass it into the helper. Test that running out of time mid-spool leaves no directory.

**B5 (High). Upload streaming mechanics are unproven.**
- A stream body through `fetch` with `duplex:'half'` is sent with chunked transfer encoding. Whether undici honours a caller-supplied `content-length` with a stream body is NOT TESTED. Whether AssemblyAI `/upload` accepts chunked uploads is NOT TESTED and can't be checked offline.
- An option to test: a file-backed Blob (`fs.openAsBlob`) as the body. undici takes the length from `blob.size` (`body.js` Blob branch) and no duplex is needed. This is ASSUMED, including how Node behaves if the file changes after opening.
- Required change:
  - A local HTTP server test asserting the exact wire headers and byte count.
  - A server that responds early (for example 413 before reading the body), a disconnect, and an abort; afterwards assert the file handle is closed.
  - If content-length can't be sent through `safeFetch`, document which SSRF/redirect boundary replaces it.
  - The real AssemblyAI check needs Justin's explicit authorization. A real upload is an external request even without a `/transcript` POST.

**B6 (Medium). Lease fencing: the new pre-upload re-read narrows the gap but doesn't remove it.**
- [VERIFIED] Today nothing re-checks the lease between `inspectOwnerInput` and the upload (`worker.js:201-204`). The re-check after upload (`worker.js:205-208`) can return `'fenced'` and leave a remote upload orphaned.
- A hard kill after the upload but before the reference is saved leads to a re-queue after the lease expires (`store.js:758-772`) and a second upload.
- State this as a residual risk, not a fix. Keep the existing "reuse the saved reference" path (`worker.js:198-199`) unchanged.

**B7 (Medium). The dependency-tracing check covers only three of five routes.**
- [VERIFIED] The tracing test (`transcription-pilot-media.test.js:30-43`) and `next.config.js:87-144` cover the owner-pilot jobs route, the cron drain and the Workflow flow route.
- [VERIFIED] Inspection also runs from the Meeting Tracker start route and `zoom-imports.js` (through `queueMeetingTranscription`), and neither has an include entry.
- That Zoom import works in production would disconfirm the gap; I can't verify that from the repo.
- Required change: make the test's route list match the real set of callers, and extend the existing hosted probe (`workflow-probe.js:34-44`) to call the file-based inspector.

**B8 (Medium). The pathname integrity check is vacuous.**
- [VERIFIED] `@vercel/blob get()` returns the pathname you asked for (`index.js:136,200`), so `runtime.js:158` and `runtime.js:367` compare a value to itself.
- [VERIFIED] The ETag comes from a response header and may be `''` (`index.js:206`). The worker check `job.audio_etag && …` is then skipped.
- The real integrity guarantee is SHA-256 plus length.
- Required change: drop pathname from the verification column of the invariant table (plan line 79). Replace mocked "wrong path" tests with a test that flips the **last byte** and asserts the local sink received zero bytes. That separates "verify, then upload" from "hash while streaming".

**B9 (Medium). New error codes do have fan-out; plan line 255 marks it N/A.**
- Busy and ENOSPC errors on the queue path reach the UI through the start routes.
- [VERIFIED] In the Zoom import route, a new error raised during start retires the `uploading` job and fails the import (`import-service.js:333-357`). Staff then have to download from Zoom again. Codes that `isAuthoredError` doesn't recognise become the generic fallback code.
- Required change: trace each new code to the UI copy and retry handling.

**B10 (Low-Medium). File handle lifetime when the inspector times out.**
- [VERIFIED] On timeout the worker is terminated (`media-inspector.js:80-85`), so `parseFile`'s own `finally { close }` never runs.
- Whether file handles are closed when a worker thread is torn down is ASSUMED.
- Required change: count open file descriptors before and after the timeout and malformed-file cases, and await `terminate()` before removing the directory. Today the code calls `terminate().catch` without awaiting it.

**B11 (Low). The measurement gate doesn't discriminate between designs.**
- "≥100 MiB lower RSS" (plan line 235) is passed by any design that removes one copy. Local RSS also excludes hosted page-cache accounting.
- Required change: record `arrayBuffers`, `external` and RSS over repeated runs, and compare the temp-file design against the narrow in-memory option on the same fixtures.

**Already handled adequately:**
- The queue/dispatch partial-success path: `service.js:290-294` already returns `dispatchPending`.
- The global provider slot: [VERIFIED] the unique index in `060…sql:113-115`.
- Small VTT/JSON reads are left buffered.
- Symlink and caller-path restrictions, once B3 is applied.

---

## Recommendation evidence matrix

| # | Recommendation | Prerequisite at the point of execution | Experiment executed? | Disconfirming check | Status |
|---|---|---|---|---|---|
| R1 | Run the baseline on all 3 routes before any runtime code | Fresh-process harness, fixtures generated incrementally | NOT TESTED | Near-cap peaks are small relative to function memory → stop the work | Required gate |
| R2 | Hosted Preview probe of `/tmp` type and memory counters | Synthetic only (Zoom env vars are Production-only per `CREDENTIALS_RUNBOOK.md:156`) | NOT TESTED | `/tmp` is tmpfs, or the memory counter rises with file size → reject disk design | Required gate |
| R3 | Narrow in-memory option: exact-size buffer, transfer to inspector and back, stream upload from the buffer | Transfer survives the Turbopack `workerData` wrapper (`media.test.js:57-69` pattern) | NOT TESTED | Measured peak is not ≈1×, or the wrapper breaks the transfer | Alternative to compare; not claimed better |
| R4 | Release `audioBytes` before start; pre-allocate in `readBounded` | V8 frees the buffer once the reference is dropped across an await | NOT TESTED | `arrayBuffers` during queue validation still includes the Zoom buffer | Recommended |
| R5 | Retryable worker outcome for local-resource errors (B1) | `mutateLeased…` accepts `next_attempt_at` for `submitting` (field already used at `worker.js:289-291`) | NOT TESTED | ENOSPC test shows `failed` or a cleanup request | Blocker fix |
| R6 | Extensionless scratch path plus parser parity tests (B2) | Full path contains no `.` | Source VERIFIED; behaviour NOT TESTED | Buffer and file results differ on any fixture | Blocker fix |
| R7 | Wire-level upload test; consider a file-backed Blob body (B5) | Local HTTP sink | NOT TESTED | Chunked encoding with no content-length, or an open file handle after an early response | Blocker fix |
| R8 | Byte reservation + `statfs` + age-guarded reaper, no lock files (B3) | Helper enforces its own absolute deadline | NOT TESTED | Probe shows several processes sharing `/tmp` → add a filesystem lock | Recommended |
| R9 | Per-route absolute deadlines (B4) | Route `maxDuration` values known | Mismatch VERIFIED; fix NOT TESTED | Spool killed by deadline leaves a directory behind | Required |
| R10 | Tracing test covers all 5 routes plus a deployed file-inspection probe (B7) | `workflow-probe.js` pattern | Gap VERIFIED; probe NOT TESTED | Probe returns `audio_malformed` on the synthetic fixture | Required |
| R11 | Last-byte-flip test with a zero-byte sink (B8) | Local HTTP sink | NOT TESTED | Sink receives any bytes before rejection | Required |

---

## Verdict: NEEDS REWORK

**Blockers:**
1. **P1/P3:** The premise is unmeasured, and the split leaves the Zoom import route as the likely peak. R1 and R2 must be run, and the decision must cover the Zoom route, before choosing a design.
2. **B1:** There is no retryable path; local scratch errors would fail jobs and delete the user's audio.
3. **B2:** `parseFile` chooses the parser by extension, and a wrong build being loaded fails silently.
4. **B3:** Admission, the stale-file age and reaping are unspecified, and one spool per root regresses availability.
5. **B4:** Existing route time budgets are inconsistent, so platform kills already leave stale scratch files.
6. **B5:** Streaming the upload with content-length is unproven, and the AssemblyAI check needs explicit authorization.

Named changes to make after the blockers: B6–B11.

No implementation should begin until these findings are reconciled and Opus has re-verified the revised plan.
