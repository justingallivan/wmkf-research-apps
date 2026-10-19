---
title: Zoom audio memory reduction plan
domain: meeting-tracker
kind: plan
status: draft
summary: "Opus reviewed the proposed audio spool design: NEEDS REWORK. Measure the premise and resolve failure handling before runtime implementation."
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
---

# Zoom audio memory reduction

## Status and decision boundary

[VERIFIED via completed Claude Opus 5.5 review, 2026-10-19] **NEEDS REWORK;
runtime implementation is blocked.** The original review and its exact target
fingerprint are preserved in
[the review receipt](evidence/ZOOM_AUDIO_OPUS_REVIEW_2026-10-19.md).
This disposition amendment changes the plan fingerprint; the receipt is evidence
of the initial review, not approval of this amended draft. The candidate design
below remains provisional. A new Opus review is required before an implementation
approval claim.

The next bounded work is **measurement and design correction**, not the spool
helper. Baseline all three entry paths and determine hosted scratch/memory
behavior. Compare the disk candidate against narrower copy-reduction changes;
neither alternative has been tested here. The measurement gate can end the work.
Resolve the specific worker failure outcomes, route budgets, media-parser parity,
admission and cleanup lifecycle, import scope and wire-level upload mechanics
before promoting any candidate to an implementation plan. No tests/probes in
that proposed experiment have yet been executed.

[PLANNED, 2026-10-19] No implementation yet. Branch:
`codex/zoom-audio-streaming`, based on `bb7b5e04c` (merged speaker picker).
Justin chose temporary file → verify → streaming provider upload over sending
unverified bytes directly from Blob. Justin subsequently required an Opus
adversarial review of both premise and design before implementation. That review
rejected implementation readiness as recorded above. No merge, deployment, schema change, provider
submission or real recording probe is authorized by this planning task.

## Premise: what is proved, and what is not

| Claim | Evidence | Status |
|---|---|---|
| Whole audio is accumulated and concatenated during validation | `runtime.js`: `readPrivateBlob`, `readPrivateContentIfPresent`, `validateAndQueueOwnerJob`, `queueMeetingTranscription` | VERIFIED via source |
| Submission reads the audio again, checks SHA-256, inspects a worker copy, then uploads a Buffer | `runtime.js`: `inspectOwnerInput`; `media-inspector.js`: `Uint8Array.from` and transferable worker data; `worker.js`: `submitQueuedJob`; `provider.js`: `uploadAssemblyAIAudio` | VERIFIED via source |
| Zoom import adds another whole-file buffering path | `zoom-client.js`: `readBounded` / `downloadRecordingFile`; `import-service.js`: `audioBytes`, Blob write, provenance capture, then `startMeetingTranscription` | VERIFIED via source |
| The current ceiling is 200 MiB and accepted duration is at most four hours | `limits.js`; `media-inspector.js`: `validateParsedAudio` | VERIFIED via source; no change proposed |
| Production is currently failing or nearing OOM | No incident, peak-memory trace or failed job has been collected in this task | UNKNOWN; do not describe this as an observed outage |
| Moving audio to disk materially lowers hosted memory accounting and improves reliability | Not measured; filesystem cache/tmp backing may affect process versus instance accounting | ASSUMED; must be falsified or measured before rollout |
| Prefix-only inspection supports every accepted M4A/MP3 | Not established; MP4 parser walks atoms and metadata need not precede media | UNKNOWN; prefix-only parsing is not this design |
| The byte cap must increase to support four-hour Zoom audio | Existing observed-rate estimate already puts four hours under 200 MiB; codec rates vary | NOT ESTABLISHED; cap increase excluded |

This is a proposed memory-efficiency improvement, not a demonstrated production
incident fix. First compare the baseline and proposed path using the same files.
If improvement is negligible or disk failure risk dominates, stop or narrow the
work instead of adding a storage subsystem to satisfy a queue sentence.

## Contract and scope

Caller → staff import/start or owner pilot start → authenticated service and job
binding → private Blob audio → media validation and SHA-256 → existing PostgreSQL
queue transition → leased Workflow worker → reverified audio → AssemblyAI upload
reference → existing submission-intent fence → provider job → unchanged transcript
storage/publication consumers.

Postgres retains only the existing job state, hashes, sizes, ETag, exact private
Blob cleanup paths and provider receipts. Private Blob remains durable audio
storage. Scratch files are invocation-local working data, never persisted in a
job, returned in a DTO, logged, or passed across Workflow steps. No schema,
status enum, route, UI, auth, provider, model or retention change is proposed.

Proposed first slice: eliminate whole-audio buffers from **both queue validation
and worker submission**, shared by Meeting Tracker and the owner pilot. Retain
bounded Buffer reads for small VTT/JSON outputs and existing consumers. Keep the
buffer inspector API where other callers still require it; add a file-based path
without silently changing those callers.

Zoom → Blob import buffering is a separately identified residual. The first
slice must not be called end-to-end Zoom streaming: `audioBytes` may still be
retained by `importZoomRecording` while queue validation runs. Measure that route
as well as the worker. If import remains the controlling peak, a follow-on must
stream Zoom audio into the same bounded scratch lifecycle, stream that file to
Blob, and capture provenance from the streamed digest/length. Preserve the Zoom
host/redirect/bearer rules and leave the small VTT Buffer interface unchanged.
Opus must challenge whether this split delivers enough benefit to justify a
separate first slice, or whether import must be included before rollout.

## Invariants

| Invariant | Proposed surface | Verification |
|---|---|---|
| No audio-length-sized JS buffer in changed runtime paths | runtime temporary-file helper, queue paths, worker, provider | generated chunk source; near-cap RSS and external/array-buffer memory measurement; no preallocated whole-file fixture in timed process |
| Upload begins only after exact pathname/ETag, byte length, SHA-256 and media checks pass | `inspectOwnerInput`, `submitQueuedJob` | wrong hash/ETag/path/length/format produces zero provider uploads |
| Queue metadata is based on actual complete bytes | both queue entry points | hash/count and unchanged version-fenced store update; invalid VTT still rejects |
| Four-hour, audio-only MP3/AAC-in-M4A policy remains | file inspection worker and metadata validator | MP3, M4A with late metadata, video-track rejection, exact duration boundaries |
| Every acquired file, reader, timer and worker has an owner and cleanup path | scoped callback/helper; provider request; inspector | failures before/after each await, abort, timeout, early provider response, cleanup fault |
| No new blind provider submission retry | worker submission/reference/intent fences | existing uncertain-POST and reference-reuse tests plus file cleanup cases |
| Temporary capacity is bounded across concurrent calls | scratch admission and cleanup design below | same-instance concurrent starts, competing helpers, ENOSPC, stale file cases |
| No storage paths or source contents escape | helper/provider errors and DTOs | sanitized errors and unchanged projections |

## Proposed design

### 1. Establish the baseline before changing runtime code

Commit a reproducible synthetic probe, with no credentials, external requests,
database access or application writes. Generate fixtures incrementally; run each
case in a fresh child process and sample RSS, heap, external/array-buffer memory,
elapsed time and scratch bytes. Compare approximately 40 MiB and near-200 MiB
valid audio. Include a late-`moov` M4A, MP3 without a convenient duration header,
slow source/sink, and malformed oversized headers. Do not count fixture allocation
as the implementation's memory usage or rely only on a parent-process sampler.
Current tests' near-cap buffer-inspection allowance is a regression ceiling,
not proof that production is memory-constrained.

### 2. Scope the scratch lifecycle to one operation

Add a small internal audio-only helper, tentatively `audio-file.js`, using Node
streams and `fs` under an application-owned directory in `os.tmpdir()`. Use a
random private directory (0700), fixed server-selected filename (0600, exclusive
create), and no caller-chosen local paths. Stream with backpressure and a small
fixed high-water mark. Count actual bytes and update SHA-256 per chunk; reject
before writing beyond the supplied expected length or 200 MiB ceiling. Abort
the source and close destination on failure. Compare declared response size as
an early check, never as the actual-byte authority. Recheck full length and digest
before handing the completed file to the callback.

Prefer a scoped `with...File(..., callback)` contract to returning a file whose
caller might forget disposal. The callback cannot outlive the helper. No
fire-and-forget cleanup. Destroy/await open streams and terminate/await inspection
workers before removing the exact owned directory. Preserve the primary error if
cleanup also fails, while emitting only a sanitized cleanup signal. Treat a
cleanup failure after an otherwise successful operation explicitly; do not
pretend removal succeeded or blindly repeat a provider submission.

Normal cleanup runs in `finally`. Hard Function termination cannot run `finally`;
therefore this is not immediate physical deletion or durable recovery. A later
invocation may reap only the helper's own stale directories, after a conservative
age exceeding the maximum operation/lease duration, with symlink rejection and
no traversal outside that root. Active files must not be removed merely because
a module-local map was lost. Precise stale-age/admission implementation needs
review before coding; generic `/tmp` sweeps are excluded.

### 3. Resolve scratch capacity before adoption

[VERIFIED via official documentation, 2026-10-19]
[Vercel runtimes](https://vercel.com/docs/functions/runtimes) documents up to
500 MB writable `/tmp` scratch. This is a platform ceiling, not measured free
space or proof of per-request isolation. Two 200 MiB files plus other work can
consume much of it. The database's global provider slot serializes active
provider jobs (`claimQueuedJob` plus unique active-slot index), but does **not**
serialize user queue validation, Zoom imports or other Functions on an instance.

[PLANNED] Bound active scratch use conservatively to one audio spool per shared
scratch root, with a short nonblocking admission attempt and a sanitized retryable
busy error **before any provider request**. Use filesystem-exclusive ownership
if more than one process can share that root; a module semaphore alone is not
proof of instance-wide exclusivity. Check available space with room for the cap
and operational headroom, and still handle ENOSPC during writes (free-space checks
race). Do not wait indefinitely or create a new Postgres lock/table. Admission
ownership, stale-lock recovery and warmed-instance behavior are explicit Opus
review targets. If safe bounded admission is more complex than the benefit,
reject this approach and revisit alternatives rather than shipping an unsafe lock.

Before rollout, a bounded Preview synthetic probe must verify actual scratch
availability, whether disk occupancy affects the relevant memory accounting,
worker support, bundling, concurrent invocation behavior and cleanup. Local RSS
alone cannot prove those hosted properties. No production env changes are part
of this plan.

### 4. Inspect the completed file in the existing isolated worker

Add `inspectAudioFile` using the same hard inspection deadline and resource
limits as `inspectAudioBuffer`. Send only the trusted temporary filename, not
audio bytes, to `audio-inspector-worker.js`. Use installed music-metadata 11.16.1
`parseFile` (verified in `node_modules/music-metadata/lib/index.js`), then the
existing safe metadata projection and `validateParsedAudio` policy. File-based
random access supports metadata at the end. Preserve the buffer entry point and
Turbopack worker-data wrapper behavior for existing consumers.

Stat/size checks occur before parsing. The filename comes only from the scoped
helper. Metadata parsing remains untrusted: file I/O does not by itself prevent
malicious metadata allocations or parser hangs. Retain resource limits, hard
termination and malformed-container tests. Await termination before deletion.
Verify transitive dependency tracing in all execution routes, including Workflow
step builds, not only a local Jest run.

### 5. Integrate queue validation and submission separately

Queue: obtain authenticated Blob SDK stream using the same private token,
cache-disabled reads and expected persisted pathname. Spool once, inspect,
verify MIME/path/size/ETag as each existing entry point requires, then invoke the
unchanged fenced store update with counted bytes, digest and duration. Small VTT
validation remains in scope but still uses its 4 MB buffer bound. Release the
audio scratch file before returning/dispatching; an ambiguous dispatch result
must retain the queued job rather than create another one.

Submission: spool and verify against persisted `audio_sha256`, `verified_bytes`,
`audio_etag`, `audio_pathname` and audio policy before opening the provider upload
stream. Re-read the lease/cleanup state after slow validation and before upload;
an expired/lost lease or cleanup request fences further provider work. Stream
the completed local file through `safeFetch` to the existing exact US/EU upload
endpoint. Use Node streaming request requirements (including `duplex: 'half'`
where required), explicit verified content length, and the existing response
size/URL validation. Keep a narrow server-internal upload interface with explicit
expected size; do not turn arbitrary input streams into trusted audio.

Upload stream ownership ends on success, rejection, early server response,
malformed response or abort. Destroy and await file stream completion before
scratch cleanup, even if fetch never consumes the entire body. Reuse existing
encrypted upload references without reopening audio. Preserve the existing
post-upload lease reread, reference persistence, submission-intent and uncertain
POST behavior. Files never survive into a second Workflow step or retry.

The worker currently has a 240 s budget, parser up to 10 s, provider upload up to
90 s and a 420 s lease. Use one absolute caller deadline across download, spool,
inspection and upload, retaining stage caps and reserving cleanup time. No stage
can reset the total deadline. Queue callers also need a bounded operation budget
within their route limit. Disk I/O may worsen elapsed time; measure rather than
raise timeouts as an incidental fix. Worker error classification must preserve
the existing before/after-submission-intent distinction.

## Alternatives Opus must try to make preferable

1. Keep the current path and improve measurement only: no observed production
   failure has established urgency; the current cap may be adequate.
2. Two Blob reads, validate/hash first, stream a second read to provider: avoids
   scratch, but requires exact version binding and revalidation of the bytes sent;
   chunked I/O does not itself solve media inspection or mutation races.
3. Blob ranged/tokenizer inspection plus streaming: potentially avoids disk;
   requires correct bounded MP3 scanning, late-MP4 metadata, stable version access
   and hashing of actual full audio. No prefix-only safety claim is established.
4. Direct stream with hash checked after upload: lower buffering but relaxes the
   chosen verify-before-provider property. Reject unless Justin reopens that
   requirement after review.

Do not recommend an alternative as proven better without testing the prerequisite
in the real execution seam. Mark untested claims ASSUMED and name a disconfirming
experiment.

## Verification and promotion gates

| Gate | Required evidence |
|---|---|
| Premise | baseline per-path measurements; distinguish observed OOM from expected copy reduction |
| File helper | success/failure/abort/ENOSPC/cap/length/hash tests; no full-file accumulation; backpressure and concurrent admission; stale ownership recovery |
| Media | real parser on synthetic MP3 and front-/late-metadata M4A; malformed/video/too-long cases; worker timeout/exit and termination-before-unlink |
| Queue/worker | invalid input means zero provider upload; both queue modes; existing reference skip; pre/post-intent failures; lease/cleanup fence; no temporary path in persisted data |
| Provider | actual local HTTP test of streaming request mechanics and byte count, plus slow sink, early response and disconnect/abort; mocked fetch alone is insufficient |
| Memory | fresh-process before/after near-cap runs; incremental fixture generation; proposed target no audio-sized copy and at least 100 MiB lower peak RSS at near cap, subject to baseline evidence |
| Hosted | bounded synthetic Preview probe; deployed parser tracing, temporary capacity, concurrent invocation isolation and actual memory accounting |
| Scoped checks | runtime/provider/worker/media suites plus callers' transcription/Zoom-import suites; types, lint, deployment gate + self-test; relevant route and docs gates sequential with self-tests |
| Release | CI green and reviewed diff on feature branch; deliberate owner promotion; rollback is code revert with unchanged schema/job contract |

Real two-to-three-hour production recording verification remains pending and
requires the owner to identify an approved non-sensitive recording and authorize
any new paid transcription. Do not spend on provider submissions merely to obtain
a memory sample. A mocked/local or Preview no-provider test must be described as
such. No byte-limit increase accompanies this work.

## Contract-reconcile audit scope

Whole-flow: mapped above; implementation must inspect every caller and consumer.
Partial success: no batch API; upload reference and queue/dispatch boundaries
still need coverage. Async: source cancellation, file stream close, worker exit,
absolute deadline and lease fences are relevant; no changed UI state.
Helper extraction: audio-only file lifecycle must not change existing small
content reads or Zoom video transfer semantics. Durable surface: temporary files
are new nondurable content-bearing scratch, with lifecycle/capacity requirements;
database/route/count changes N/A. Enum fan-out: N/A unless implementation adds a
new surfaced error, which must be traced to safe UI/retry handling. Doc reconcile:
use sweep for changed runtime facts; do not mark queue completed before rollout.

## Documentation and review handoff

This plan changes intended design only. Current runtime buffering statements
remain true until implementation. Relevant restatements include
`docs/CURRENT_WORK_QUEUE.md`, `lib/services/transcription-pilot/limits.js`,
`docs/atlas/postgres-transcription-pilot.md`, and the Zoom import plan. Dated audit
evidence remains historical. A future implementation must reconcile the exact
scope delivered (including any remaining Zoom import buffer) rather than simply
replacing every mention of buffering with “streaming.”

Opus review output goes in a separate evidence file so this plan can remain
fingerprint-stable during review. Required verdict: READY TO IMPLEMENT, READY WITH
NAMED CHANGES, or NEEDS REWORK; separate premise and design findings, cite current
file:line evidence and state whether checks were executed or only proposed.
Before implementation, integrate blocking review findings and have Opus verify
the revised plan. No implementation should begin on an unresolved premise,
scratch-capacity or integrity/lease finding.
