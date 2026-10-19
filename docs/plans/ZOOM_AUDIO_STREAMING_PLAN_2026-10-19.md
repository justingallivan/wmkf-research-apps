---
title: Zoom audio preallocation and streaming upload plan
domain: meeting-tracker
kind: plan
status: draft
summary: "Exact-size audio reads and verified-buffer streaming upload, including Zoom import. Review status is recorded separately; no runtime implementation."
owner: product-engineering
related:
  - docs/plans/evidence/ZOOM_AUDIO_BENCHMARK_2026-10-19.md
  - docs/plans/evidence/ZOOM_AUDIO_REVIEW_DISPOSITION_2026-10-19.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/atlas/postgres-transcription-pilot.md
---

# Zoom audio: preallocation and streaming upload

## Decision and readiness

[PLANNED, owner direction 2026-10-19] Replace unnecessary audio copies with
preallocation and streaming the **already verified Buffer** to AssemblyAI. Include
Zoom download/import and both queue-validation entry points. This document
supersedes the original disk proposal; its [Opus review](evidence/ZOOM_AUDIO_OPUS_REVIEW_2026-10-19.md)
remains historical evidence. No scratch files, disk admission/reaper, ownership
transfer through the inspector, new retry framework, or byte-cap increase is in
this revision. The existing copying buffer inspector remains the media authority.

**Design specification for review.** The current review verdict and exact
reviewed fingerprint are recorded in the
[review disposition](evidence/ZOOM_AUDIO_REVIEW_DISPOSITION_2026-10-19.md), so
recording a verdict does not mutate the review target. This task authorizes
planning/review only. No application, schema, environment, deployment, real
recording or provider request changes have been made. Implementation requires
resolution of the named review changes; promotion additionally requires the
tests and release gates below.

## Evidence and limits

[VERIFIED locally via the [benchmark](evidence/ZOOM_AUDIO_BENCHMARK_2026-10-19.md)]
147 synthetic fresh-process cases on macOS/Node 26.6.0 plus five final-byte
corruption controls support copy reduction. Near-cap (199 MiB) submission median
RSS: current 1,104.9 MiB → preallocation + streaming 534.6 MiB. Zoom import median:
912.8 → 544.4 MiB, with a **741.1 MiB outlier**. The original import reference can
outlive its usefulness; clearing it does not guarantee prompt garbage collection.
These are exploratory local comparisons, not hard memory bounds or a production
OOM diagnosis. Blob SDK write allocations/cloud latency were not measured.

[UNKNOWN] Deployed Node/fetch compatibility, hosted memory/concurrency and real
provider integration remain unverified. The padded late-metadata M4A is a valid
three-second AAC container with inert padding, not a multi-hour Zoom recording.
The benchmark's preallocation prototype did not exercise the header-gating or
cancellation design below. No universal format or hosted-capacity claim follows.

## Whole-flow scope

Manual owner/Meeting Tracker start → authenticated scoped job → private Blob
read → exact-size verified bytes → existing copying inspector and four-hour
policy → existing fenced Postgres queue update → existing dispatch contract.

Zoom import → approved occurrence/file selection → exact-size audio download →
existing private Blob Buffer upload → content-free provenance capture → release
import audio reference → the same queue validation/dispatch. Optional VTT remains
on its existing small-content path. Zoom → Blob upload is **still buffered**;
streaming in this revision refers to AssemblyAI upload, not direct Zoom-to-Blob.

Worker → existing job/lease → full Blob read and stored digest/length/ETag checks
→ unchanged media inspection → pre-upload lease reread → stream immutable verified
Buffer views → encrypted upload reference → unchanged submission-intent fence,
uncertain-POST handling, output storage and publication consumers.

Durable ownership is unchanged: private Blob has audio; Postgres has existing
metadata, hashes, cleanup paths, leases and receipts. No new table, migration,
route, DTO field, status, prompt, provider/model or external auth scope is needed.

## Invariants and likely surfaces

| Invariant | Likely files | Verification |
|---|---|---|
| Optimization never trusts client size or a response header as byte integrity proof | runtime, Zoom client, small audio reader | persisted bounded expected size; actual EOF/count; full SHA-256 before provider |
| No new eager 200 MiB allocation for a known short/unknown-length upload | transport preflight and reader | short metadata rejected before allocation; absent/encoded/invalid length uses capped fallback |
| Both queue modes and worker get exact-size reads | runtime and callers | owner/Meeting Tracker/worker tests plus benchmark branch assertions |
| Zoom provenance is complete before audio reference release | import-service | capture hash/size unchanged; capture failure prevents start; no payload alias survives into start |
| Provider accepts only the existing bounded Buffer interface | provider, worker | no arbitrary caller stream; 64 KiB views, exact length, unchanged URL/JSON guards |
| No provider upload before complete integrity and format checks | runtime/worker | final-byte mutation, wrong stored digest/size/ETag, invalid format yield zero upload attempts |
| Inspection policy and copy ownership remain unchanged | existing media inspector | current MP3/M4A parser, video rejection, four-hour tests and worker tracing |
| All new stream ownership ends on completion, abort or error | reader/provider | stalled source, early response, disconnect, abort, timer and close tests |
| Existing job/dispatch/uncertain-submission behavior remains authoritative | service/worker/import-service | failure-state matrix below; no blind new transcription retry |

## 1. Exact-size audio reads with a bounded fallback

[PLANNED] Add a small internal `readExactAudioBytes` helper in
`lib/services/transcription-pilot/audio-read.js`, shared only by the Blob audio
reader and opt-in Zoom audio download. It owns a Web readable-stream reader,
expected size, hard byte cap and AbortSignal; it performs no auth, HTTP, storage,
inspection, logging or persistence. Its internal failures are mapped **per
caller**, not merely per transport, as specified below. Do not change general VTT/JSON
content readers or extract unrelated helpers.

Validate expected size as a safe positive integer ≤ `MAX_TRANSCRIPTION_BYTES`
(current 200 MiB) **before allocation**. Expected size comes from the scoped
persisted row (`declared_bytes` for queue; `verified_bytes` for worker) or the
approved Zoom file's `file_size`, never a new request-body parameter.

Prevent eager-allocation amplification: optimize only after the trusted HTTP
response exposes an unencoded, strictly numeric, safe `Content-Length` matching
that expected size. Validate content type and existing ETag constraints before
allocation too. The installed Blob SDK exposes `result.headers`; its `blob.size`
is parsed from that same header, not independent evidence. A known unencoded
mismatch rejects before allocating. Missing/invalid length or encoded bodies use
the existing bounded accumulation strategy, still enforcing expected size and
cap. Do not issue a new HEAD or invent a size for headerless content. The helper
must take this branch decision explicitly; tests prove its precondition, not just
the optimized case. Trusted headers can still accompany a truncated response;
per-read caps/deadlines remain necessary. No universal one-buffer guarantee is
claimed for fallback or concurrent calls.

Optimized branch: allocate exactly expected bytes, copy each incoming view into
its checked offset, stop copying before overflow, require exact EOF length,
and return only the fully initialized buffer. `Buffer.allocUnsafe` is permitted
only with that invariant; no partial view or uninitialized bytes can escape on
short reads/errors. Do not retain chunk arrays or call `Buffer.concat` there.
`Buffer.alloc` is an acceptable simpler choice if its measured cost is negligible.

Preserve over-cap classification without writing beyond expected size: if actual
bytes exceed expected size, mark mismatch, discard/count remaining bytes only
until EOF, cap violation, read error or the existing deadline. Do not retain the
overflow or return the prefix. A cap violation then keeps the existing 413; EOF
below/equal cap yields the caller's mismatch code. This drains no further than
the old capped reader, and avoids classification depending on chunk size. The
bounded fallback follows the same classification. A trusted unencoded header
already over cap maps to the caller's cap error before allocation; other known
header mismatch maps to its mismatch error. A source read/deadline failure still
takes its existing precedence over a not-yet-completed EOF classification.

Abort/size/read failure cancels the owned reader and releases its lock. Race a
stalled read with the signal so a source that ignores abort cannot hang the
operation. Bound cancellation settlement to 1 s inside the cleanup reserve;
release the lock and retain the original transport error if cancellation fails.
No body is consumed by a second reader or background operation after return.
Missing Blob still maps to each caller's existing missing-upload semantics.
Before reader acquisition, every rejected metadata response must cancel its live
body directly (`result.stream.cancel()`/`response.body.cancel()`), with the same
1 s cleanup bound and primary-error preservation. This includes type, ETag,
header, HTML and status rejections. Fetch itself must receive a signal whose
timeout is min(per-stage cap, absolute deadline remaining), so rejecting/racing a
reader cannot leave a longer-lived Zoom request open. Redirect bodies are closed
before the next hop; no new signal resets the total budget.

For Blob audio, add a dedicated internal reader; do not globally rewrite
`readPrivateContentIfPresent` or `readPrivateBlob`, which also serve small output
content. Queue and worker opt into the audio reader with their correct expected
size. Preserve `useCache:false`, private token selection, MIME checks and each
caller's existing missing-file and mismatch codes. Path scoping remains an
authorization boundary; SDK-echoed pathname is not independent byte proof.
SHA-256 plus actual length remain the full-content integrity authority. Preserve
legacy optional ETag behavior rather than rejecting all old rows with no ETag.

For Zoom, add internal options `preallocateAudio:true` and `deadlineMs` to
`downloadRecordingFile`. Only the import audio call opts in. The VTT call and
other download/range consumers keep their allocation defaults and byte caps.
The VTT download receives `deadlineMs: min(now + 240 s, importDeadline - 70 s)`
without preallocation; its fetch/body must abort by that deadline, rather than
spend the reserved start time and fail only at the subsequent Blob write. Other
range/listing consumers retain their existing default budgets. Preserve all
HTTPS/host/port/credential checks, at most five manual redirects, bearer on hop
zero only, HTML rejection, and actual-byte size validation. Every rejected or
redirected response body is canceled. No new URL or token is exposed.

## 2. Zoom import ownership and provenance

Keep the current claim, chosen-file identity refresh, job creation, Blob write,
provenance normalization/capture, start and recovery order. `audioBytes` becomes
a narrowly owned mutable reference: await the existing Buffer-based Blob write;
compute and persist the same selected-file digest/count/times; then clear it
before calling start. The VTT reference stays bounded at 4 MB and retains its
current validation. Do not reuse the imported Buffer as queue input or skip the
Blob reread/hash because this invocation just uploaded it.

The descriptor/capture retains only scalars, never a closure, object or subarray
that references audio storage. Blob write/capture failure follows the existing
retire/fail or lease-recovery logic and must not call start. If queueing already
succeeded but dispatch fails, preserve the existing returned job/dispatchPending
contract instead of freeing the import slot or creating another job. Do not add
forced GC, a global Buffer cache, allocation pooling or a new concurrency lock.

## 3. Stream only the immutable verified upload

Keep `uploadAssemblyAIAudio({region,audio,contentType,timeoutMs})` as the bounded
Buffer-only interface. After its existing validation, create an owned Node
Readable over **64 KiB subarray views**, with byte mode/backpressure and a bounded
high-water mark. Do not use `Readable.from([audio])`, spread/copy the whole buffer,
accept a caller-supplied stream, reread Blob, or transfer/detach the Buffer.

Pass that stream to the existing exact-region `safeFetch` endpoint with
`Content-Length: audio.length`, octet-stream content type and `duplex:'half'`.
Extend the private request helper only enough to forward this upload-specific
option; JSON GET/POST/DELETE requests remain unchanged. Keep redirect refusal,
server-only auth, bounded provider JSON and exact CDN upload-reference checks.
The worker exclusively owns this Buffer: no code mutates its bytes from completed
verification until stream settlement. Returning from inspection does not transfer
ownership to another subsystem.

Use the existing upload AbortController across request/body/JSON handling.
Always destroy and await settlement of the owned Readable in `finally`, with
bounded cleanup and timer/listener disposal. Early non-2xx, valid-looking early
2xx before the source is fully yielded, disconnect, timeout, malformed JSON and
invalid CDN reference must not return an upload reference. Require full source
consumption before success using a **byte counter incremented as each chunk is
pushed**, not a race against the Readable's `end` event. Capture `expectedBytes`
from the validated Buffer before streaming. After bounded JSON read, success
requires **`pushedBytes === expectedBytes && readable.readableLength === 0`**:
the byte-mode Readable may push ahead of its consumer by its high-water mark.
A failed predicate is an existing provider-request failure. An equal counter
and empty buffer do not wait for a final iterator-done pull. In `finally`, destroy the
Readable and await close with a 1 s bound, disposing upload abort/timer/listener
resources even when close fails. Close on an early response rather than wait
indefinitely for a peer that stopped reading. Preserve the primary error if
stream close also fails. This is not a claim of independently verified remote
byte retention; an upload response remains the provider's receipt.

Before opening the upload, reread the existing lease and cleanup state after
slow inspection and recheck submission switches. Keep the existing post-upload
reread/reference write and submission-intent/uncertain-POST fences unchanged.
There is still a possible lease-loss/hard-kill gap and orphan upload before
reference persistence; this plan does not promise exactly-once remote uploads.
Saved references continue to bypass audio reread and upload.
Specifically, evaluate `jobSubmissionEnabled` on the re-read row. Lost/expired
lease, non-submitting state or cleanup returns exactly `fenced`; switches off
reuse the existing `submissions_disabled` requeue/release path. If the re-read
already has a saved upload reference, reuse it. Do not mutate through a stale row
or upload after any of those exits.

## 4. Absolute byte-operation budgets and outcomes

[VERIFIED via route/source config] Current route limits: Meeting Tracker start
60 s; owner pilot start 120 s; Zoom import 300 s. Worker budget 240 s, lease 420 s.
[PLANNED] Establish server-only deadlines at route entry, before awaited auth:
Meeting Tracker start +50 s, owner start +105 s, Zoom import +270 s; retain the
worker's existing absolute deadline and reserve its final 5 s for settlement.
Never accept the deadline from JSON/query input or reset it between phases.

Pass `deadlineMs` through start/service/queue and Zoom import's listing/detail,
download, Blob write and start calls. Zoom listing/token/redirect pagination
must use the same remaining time; existing per-request caps remain maxima.
Both Meeting Tracker service start and owner-route dispatch must call the
existing dispatcher with `deadline: min(deadlineMs, now + 15 s)`; this keeps its
current stage cap without allowing a fresh 15 s beyond the route deadline. Its
existing <10 s headroom check defers dispatch.
Keep `dispatchPending:true` for Meeting Tracker, and the existing queued-job 503
retryable response for owner start. Other dispatcher callers keep their existing
defaults unless explicitly part of this start chain.

For **each** Zoom audio/VTT Blob write, set its absolute write deadline to
`min(now + 120 s, importDeadline - 70 s)`. The shared 70 s reserve is for the
subsequent capture/start validation/queue/dispatch chain, not a fresh 70 s per
write. Refuse to start a write if that deadline is already exhausted; use the
existing import failure/retirement path. Pass the original import deadline into
start and onward into dispatch. This is a budget, not a transfer-rate guarantee;
slow-source and write/queue-boundary tests must exercise deferral and retirement.

Private Blob reads use min(90 s, remaining time minus 15 s for inspection/store).
Inspection uses min(10 s, remaining time minus 5 s). Provider upload uses
min(90 s, worker remaining minus reserve). Refuse to begin an operation whose
remaining allowance is nonpositive. Do not raise route limits incidentally.
This bounds the changed byte operations, not currently non-abortable auth/DB
calls; reserve does not guarantee their completion under platform hard kill.

| Event | Required outcome |
|---|---|
| Queue size/type/read/inspection failure before fenced queue write | Same existing caller error/status; no queue/dispatch/provider call; uploaded job remains governed by existing retry/expiry rules |
| Zoom error before start | Existing retirement/failure logic for still-uploading job; uncertain job-read/retire preserves importing lease for recovery |
| Queued job with pending/lost dispatch acknowledgement | Preserve existing queued job and outbox recovery; no repeat upload/job creation |
| Worker read/hash/inspection/upload failure before submission intent | Preserve current `failed` + cleanup-request behavior; do not label it retryable or add a retry loop |
| Error after persisted submission intent | Existing uncertain-submission path; no automatic second transcription POST |
| Lease/cleanup/switch changes before upload | Fence upload and use existing disabled/recovery paths; no new status |
| Upload succeeded but reference persistence/lease failed | Existing orphan-upload residual; never treat a missing saved reference as proof no remote upload happened |

Existing terminal handling of transient pre-intent Blob/provider errors is a
known residual, not fixed in this memory change. No new busy/ENOSPC/admission
errors are introduced. **Design decision for the post-upload tail:** preserve its
existing scheduling and intent rules. The 5 s reserve is for stream settlement,
not a promise that reference/intent DB writes plus the submit POST fit. If time
expires after intent but before any POST is sent, today's inner timeout catch
can still record `submission_uncertain` with zero POSTs. Record/test that residual;
do not silently change it into a new queued/backoff policy in this memory slice.

Per-caller mapping (codes/statuses are the current contract):

| Caller | Actual size mismatch / short EOF | Missing audio | Actual bytes over cap |
|---|---|---|---|
| Owner queue | `uploaded_size_mismatch` / 422 | `audio_not_found` / 409 | `audio_too_large` / 413 |
| Meeting Tracker queue | `uploaded_metadata_mismatch` / 422 | `transcription_upload_missing` / 410 | `content_too_large` / 413 |
| Worker inspection | `audio_integrity_mismatch` / 409 | `audio_not_found` / 409 | `audio_too_large` / 413 |
| Zoom download | `zoom_download_invalid` / 502 | Existing Zoom failure mapping | `zoom_download_invalid` / 502 |

The worker inherits missing/over-cap codes from its current `readPrivateBlob`
call; these are not absent cases. Blob deadline exhaustion retains
`blob_deadline_exhausted` / 504; other SDK/network failures retain the existing
caller's adapter/route behavior (Zoom read/deadline errors map to
`zoom_unavailable` / 502). Provider stream failures map to existing provider
request failure. Helper errors carry **no `status`/`httpStatus`, no
`transcription_` prefix, no free-form source message, token or pathname**. Every
internal category is translated before crossing into a route or import catch;
an unknown helper category becomes that caller's sanitized generic failure,
never an authored helper error. Test route/UI projections and import failure
codes so details do not leak through the owner/Meeting/Zoom error fall-throughs.

## Verification required before promotion

1. Unit-test the real exact-reader branches: metadata-gated allocation,
   unknown/encoded/malformed header fallback, invalid/zero/over-cap expected size,
   short/oversized/multi-chunk input, failed/stalled read, pre-aborted signal,
   cancellation/lock settlement and no partial buffer escape. Preserve all small
   content-reader callers. A negative guard test must contain the excluded data.
2. Exercise both queue entry points and worker with actual byte digests, mutated
   final byte, MIME/ETag/length conflicts and existing media-policy tests. Keep
   the inspector and its worker unchanged; no new parser selection is introduced.
3. Zoom: redirects/credentials/HTML/error bodies, header fallback, exact file
   refresh, capture failure, release-before-start, dispatch partial success and
   lease recovery. Include optional VTT success/failure and no-audio cases.
4. Provider: actual local wire test through the production provider/safeFetch
   seam, target Node version, size/hash/framing, slow sink, early 413 and early
   valid-URL 200, disconnect, abort, oversized JSON, invalid CDN URL, source
   settlement and original error precedence. Include a complete body whose final
   iterator-done pull is delayed: byte counting must not falsely fail it. Assert
   an early valid-URL 200 with the last high-water mark still buffered fails.
   A slow-VTT case must abort before the start reserve and trigger retirement,
   not leave a still-uploading job. Assert
   zero upload on invalid bytes and verify the original Buffer's full SHA-256 and
   nonzero byteLength are unchanged after upload on the target Node runtime.
5. Worker: pre-upload stale lease/cleanup/switch fences, saved-reference reuse,
   post-upload fence and pre/post-intent failure outcomes. No blanket retry test
   that ignores durable intent.
6. Rerun the committed benchmark against the **implemented code**, including the
   real header branch and Blob write behavior. Retain maxima/outliers; no forced
   in-operation GC. Do not claim the prototype's 534.6 MiB as an implementation
   guarantee. Compare 40/near-200 MiB, unknown-length fallback and concurrent starts.
7. Scoped runtime/provider/worker/Zoom/route suites, types/lint and relevant
   route/context/GUID/deployment gates, each gate sequential with its self-test.
   Trace existing inspector dependencies for all actual callers, including start
   and Zoom import, before claiming deployed coverage.
8. Synthetic-only Preview validation on the configured runtime: header branch,
   parser bundle, error/abort behavior, allocations/concurrent invocation memory
   and byte-path timing. No real recording or paid transcription is implicit.
   A real provider-upload or production acceptance probe is a separate authorized
   release action. CI and deliberate owner promotion are still required.

No change is made to the 200 MiB/four-hour limits, accepted confidentiality policy,
private-store token contract, job schema, global provider slot or remote retention.

## Prior review disposition and documentation

The original disk review's scratch-capacity, ENOSPC retry, stale reaper and
`parseFile` selection blockers no longer apply **because those mechanisms are
excluded from this design**, not because they were fixed. Premise now has local
measurement; hosted evidence is still a release gate. Deadlines, stream lifecycle,
Zoom scope and error-state semantics are explicit above and remain review targets.

Use contract-reconcile to trace caller → bytes → persistence → consumer before
completion. Partial success is at queue/dispatch/import boundaries; async fences
and helper differences are enumerated above. New schema/routes/status fan-out is
N/A. Sweep the source headers/limits commentary, queue, relevant Atlas and Zoom
import plan only when implementation changes current facts; current buffering
statements stay true today. Preserve original review/benchmark records as dated
evidence. Review receipt is stored separately and fingerprint-bound to this plan;
no source implementation should begin until its blockers are resolved.
