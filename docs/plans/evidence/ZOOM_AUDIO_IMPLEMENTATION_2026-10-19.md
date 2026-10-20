---
title: Zoom audio preallocation implementation evidence
domain: meeting-tracker
kind: audit
status: active
summary: "Branch code passes local tests and bounded real-Blob Preview checks. Real Zoom/AssemblyAI Preview acceptance also passed; memory outliers and release limits remain explicit. Production promotion is pending."
owner: product-engineering
---

# Branch implementation and verification

[VERIFIED via source and local commands, 2026-10-19] Implemented on
`codex/zoom-audio-streaming` against the fingerprinted
[Opus-reviewed specification](../ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md).
This receipt records branch source and local checks. Subsequent
[bounded Preview acceptance](ZOOM_AUDIO_PREVIEW_VALIDATION_2026-10-19.md) passed;
the later [owner-approved real Zoom/AssemblyAI acceptance](ZOOM_AUDIO_REAL_PREVIEW_2026-10-19.md)
also passed. No Production deployment is claimed. The local implementation
phase itself made no migration, environment update, live Zoom call, real recording
or AssemblyAI request; the linked hosted receipts describe subsequent external work. The existing 200 MiB/four-hour caps, private-store selection, parser worker,
job schema and uncertain-submission policy remain unchanged.

## Invariants and tests

| Invariant | Enforcement / meaningful verification |
|---|---|
| Preallocate only after trusted metadata agrees | `audio-read.js` strict length/encoding gates; MIME/ETag checks in runtime; real-reader tests cover optimized, missing/invalid/encoded fallback and pre-reader cancellation |
| Never return partial or unverified bytes | Exact EOF/count and cap checks, discard-only overflow; runtime tests mutate the final byte before inspection; benchmark corrupt control runs implemented source and observes zero upload requests/bytes |
| Per-caller errors stay distinct | Owner/Meeting/worker mismatch, missing and cap matrices in runtime tests; sanitized Zoom errors and failure-state tests |
| Bound stream ownership and cleanup | Per-read abort listeners removed immediately, canceled/released readers, bounded cancellation; wire tests exercise early 413, valid early 200, fully pushed-but-buffered 200, disconnect, timeout and stalled JSON |
| Preserve immutable upload bytes and wire framing | Real provider and safeFetch code with only physical fetch redirected to owned loopback; hash, count, explicit Content-Length, no chunked framing and unchanged source byteLength/hash |
| Preserve latest lease/switch/reference fences | Worker tests inspect before stale-state/cleanup exits, disable switches during inspection, reuse a newly discovered reference and retain zero-POST uncertainty after durable intent |
| Cover Zoom through queue/dispatch | Audio-only opt-in; scalar capture before clearing audio reference and Blob reread; shared deadlines for listing/detail/audio/write/start; VTT uses start reserve and a real stalled read retires the uploading job |

Optimized reads allocate exactly expected bytes and retain no chunk array.
Missing/invalid/encoded length falls back to bounded accumulation. An EOF mismatch
below the cap retains each caller's existing error; crossing the cap retains its
413 classification. Small generic content readers are unchanged. Metadata/status
rejections cancel the live body before reader acquisition; helper-owned failures
cancel only once. Unknown internal errors become sanitized caller errors.

Upload uses 64 KiB Buffer views in a byte-mode Readable, explicit length and
`duplex: half`. Success checks pushed byte count AND empty readable buffer before
destroy, without waiting for a final done pull. It cannot independently prove
remote byte retention; that remains the provider receipt's meaning.

A Node 24 measurement exposed retained chunks from racing every read against a
single pending abort promise. The final helper and bounded provider JSON reader
use per-read listeners removed in finally. Final source hashes are saved with the
measurements below. A fresh read-only agent reviewed source and meaningful
negative controls; its benchmark finding (the corrupt control inadvertently
loading baseline code) was corrected and the control rerun with the exact
`audio_integrity_mismatch` result required. This is separate from the historical
Opus specification approval and is not a hosted acceptance claim.

## Local checks

- Regression: **33 Jest suites, 927 tests passed**, covering transcription runtime,
  provider, worker, media, workflow, owner/Meeting routes/services, Zoom client,
  import routes/service/store and existing consumer contracts.
- Node **22.23.3** and **24.22.0**: **40 tests each** for the real reader,
  production-provider/safeFetch wire seam and media inspection. Tests use the
  installed Undici transport for loopback; the memory comparison uses each
  process's native fetch. The subsequent Preview receipt records the actual Node 22.23.2 runtime;
  local runtime parity alone was not treated as hosted proof.
- Scoped ESLint, `npm run check:types` and the standard Next production build
  passed. The build compiled workflows and traced the unchanged inspector worker
  plus music-metadata for owner start, Meeting start and Zoom import. The emitted
  worker asset also parsed the synthetic AAC fixture on Node 24 (3.065 seconds).
- Route matrix, route/service boundary, Dynamics context, GUID boundary and
  transcription deployment-config gates and self-tests passed sequentially.
  Documentation/Atlas, secret and scaffolding gates are recorded with this commit.
  Deployment-config checks without environment/artifact inventory do not verify
  live deployment configuration.

`tsc --noEmit` alone has no root tsconfig in this JavaScript repository; the
project's actual `check:types` configuration was used and passed. No database
integration rerun is claimed: persistence code/schema is unchanged and existing
unit fences plus source tracing cover this change.

## Implemented-code memory comparison

[VERIFIED via local synthetic comparison]
[Raw results](ZOOM_AUDIO_IMPLEMENTED_MEMORY_2026-10-19.json) contain **56 fresh-process
measurements plus one final-byte corruption control**, using macOS ARM,
Node 24.22.0/native fetch, original source `d90886f73` versus the implemented
runtime. Source SHA-256 hashes are included. Known-length MP3 and late-metadata
M4A cases run at 40 and 199 MiB for owner, Meeting, Zoom and submission paths;
fallback and two concurrent starts add M4A samples. Receiver RSS is excluded in a
separate child process; there is no forced GC during the measured operations.
Each known-length near-cap cell below pools one MP3 and one M4A trial; these tiny
sample medians are descriptive, not statistical guarantees. Peak process RSS,
MiB (median and full range):

| Flow | Original | Implemented |
|---|---:|---:|
| owner | 714.6 (702.2–727.0) | 532.4 (529.6–535.2) |
| meeting | 724.1 (720.3–727.8) | 529.5 (529.1–529.9) |
| zoom | 1,107.9 (1,094.5–1,121.3) | 1,024.5 (915.6–1,133.4) |
| submit | 1,031.0 (948.5–1,113.6) | 710.1 (664.5–755.7) |

The Zoom comparison includes an awaited physical HTTP Buffer write to the local
receiver before queue reread, modeling the SDK's Buffer body path. It does **not**
run the real Blob SDK/storage contract, multipart behavior or hosted accounting.
The HTTP receiver verifies every written body hash/size; each submission upload
also verifies exact framing, hash and size through the provider code.

Do not substitute the earlier prototype's 534.6 MiB result for these measurements.
Near-cap Zoom has an implemented **1,133.4 MiB** outlier versus an original maximum
of **1,121.3 MiB** despite a lower pooled median. Unknown-length Zoom measured
**1,120.0 MiB** versus **1,118.2 MiB** original; fallback does not provide a Zoom
memory improvement in that sample. Two simultaneous near-cap Zoom starts measured
**1,527.9 MiB** versus **1,901.4 MiB** original, and two Meeting starts **943.7 MiB**
versus **1,326.5 MiB**. These are one trial each, not safe admission bounds.
Buffer reference release does not force collection. Concurrency and hosted
validation remain material release gates; no cap or concurrency-policy expansion
is justified.

The benchmark's two overflow/underflow assertions still test the historical
prototype helper; production-reader bounds are established by the new real-helper
unit tests. The historical prototype quick comparison remains runnable against
its frozen baseline; its dated results are preserved separately.

## Contract audit and remaining promotion gates

Whole-flow: authenticated caller → server deadline → scoped job/Zoom listing →
validated bytes → existing Blob/job writes → dispatch → leased worker → verified
upload/reference/intent → existing response/consumer. Partial success remains at
import retirement/start and queue/dispatch boundaries; tests preserve those
existing outcomes. Async ownership is covered by per-read abort/cleanup, import
lease CAS, queued-job recovery and pre/post-upload worker fences. Shared-reader
extraction preserves distinct caller errors. New schema/routes/enums and
symbol-consumer fan-out are N/A; the helper is internal and no durable shape
changes. The copying inspector is deliberately unchanged.

Sweep Mode A scoped to the changed audio byte path: queue, limits commentary,
review disposition, benchmark current-status prose, transcription and Zoom Atlas
pages and the Zoom import plan distinguish branch source from deployed history.
The fingerprinted specification and original reviews remain immutable dated
records. Other feature/provenance/attendance history is outside this audio change.
No current audio statement is intended to claim deployed optimization.

The linked Preview receipt now verifies the real Blob SDK/store, configured
runtime, bundled parser, corrupt-byte rejection and bounded concurrent memory/
timing. The later real-recording receipt verifies Zoom download/import, one AssemblyAI
transcription, saved content and TXT download with cleanup and the automatic
notification side effect recorded. Remaining before promotion: final-head CI and
owner promotion. Hosted slow-source/disconnect, callback delivery and sustained
independent concurrency remain untested. Non-abortable auth/database work, hard termination, transient
pre-intent failures becoming failed/cleanup, post-intent zero-POST uncertainty and
orphan remote uploads remain explicit residuals. No production OOM or universal
memory ceiling is established.
