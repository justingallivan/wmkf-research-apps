---
title: Local Zoom audio memory comparison
domain: meeting-tracker
kind: audit
status: active
summary: "Synthetic local benchmarks favor reducing buffer copies before disk spooling. Hosted memory, provider compatibility and production readiness remain unverified."
owner: product-engineering
---

# Local Zoom audio comparison

## Decision supported by this experiment

[VERIFIED via the attached raw results, 2026-10-19] The current byte paths use
materially more local process memory than the simpler candidates. At 199 MiB,
submission median peak RSS fell from **1,104.9 MiB to 534.6 MiB** with exact-size
input allocation plus streaming the verified Buffer to a local HTTP receiver.
Adding a worker round trip reduced submission to 333.4 MiB; disk spooling reached
162.0 MiB. These are process measurements, not Vercel instance memory or evidence
of a production OOM.

Recommendation: revise the design around **preallocation, releasing the Zoom
import reference before start, and streaming the verified upload** first. Treat
worker transfer as a separately justified ownership change, and do not adopt a
scratch admission/reaper subsystem on the evidence collected so far. That is a
design recommendation, not implementation approval. The revised plan still needs
Opus review and deployment-specific validation.

The recommendation does not hide the counterexample: the preallocation Zoom
candidate had one **741.1 MiB** trial, versus a 544.4 MiB median. Buffer reference
release does not guarantee immediate collection. Transfer's Zoom trials were
542.2–545.5 MiB. If a predictable upper bound matters more than minimizing the
code change, the transfer candidate deserves further investigation.

## Reproduce and inspect

- Harness: `scripts/benchmarks/zoom-audio-memory.mjs`.
- Candidate inspector: `scripts/benchmarks/zoom-audio-inspector-worker.cjs`.
- [Raw results and source SHA-256 fingerprints](ZOOM_AUDIO_MEMORY_RESULTS_2026-10-19.json).
- [Initial Opus review](ZOOM_AUDIO_OPUS_REVIEW_2026-10-19.md).
- [Review disposition](ZOOM_AUDIO_REVIEW_DISPOSITION_2026-10-19.md).

Executed final command:

```sh
node scripts/benchmarks/zoom-audio-memory.mjs --repeats 2 --output /tmp/zoom-audio-isolated-final.json
```

Use `--quick --repeats 1` for a 4 MiB smoke comparison. Parent-generated fixtures
and per-case scratch directories are removed after normal completion. Files are
synthetic, and child environments contain only explicitly selected local settings
and fake application credentials. No environment file is loaded. The source-fetch
replacement rejects all unrecognized targets; the only actual HTTP connection is
loopback. There are no database, Blob, Zoom, AssemblyAI or deployment requests.

The saved JSON adds source fingerprints and a mechanical result-validation
summary to the harness output. It contains the **corrected isolated-receiver
run only**; earlier exploratory measurements are not mixed into these numbers.

## Method and denominator

- macOS arm64, Node **v26.6.0**, native fetch/undici **8.9.0**. This does not
  establish the deployed Node version or memory allowance.
- 144 matrix cases: two sizes × two formats × two repeats × 18 flow/candidate
  combinations. Each ran in a fresh child process. Four observations contribute
  to each size/flow/candidate summary: two MP3 and two M4A-container trials.
- Three additional 8 MiB submission cases slowed both source and sink by 1 ms
  per received/generated chunk: baseline, transfer and spool.
- Five final-byte corruption controls: baseline, preallocation, preallocation
  with streaming upload, transfer and spool. All rejected the fully read corrupt
  input with **zero upload attempts, requests or received bytes**.
- Two preallocation boundary controls rejected short and overflowing input.
- The upload receiver ran in a **separate process**. Its buffers and RSS are not
  included in the application process measurements.
- The main process sampled RSS, heap, external and array-buffer memory every
  5 ms. `process.resourceUsage().maxRSS` captured high-water RSS even across
  synchronous copies that the sampler could miss. Tables use that high-water
  value in MiB, including the process's starting footprint. Raw JSON also records
  starting and sampled peaks. External/array-buffer samples are not a complete
  accounting of parser-worker or kernel memory.
- Modules were loaded before timing; GC was requested once before timing.
  There was **no forced GC during the operation**. Fixture generation/hash work
  occurred outside the measured child. Inputs arrived in 64 KiB chunks from
  local files. Order was fixed, sample count small, and filesystem caches warm;
  these are exploratory comparisons, not statistical capacity guarantees.

MP3 fixtures are incrementally generated silent MPEG Layer III frames at the
same 417-byte framing used by existing media tests, without a convenient duration
header. The near-cap fixture is 208,666,383 bytes and parses to 13,071,647 ms
(about 3.63 hours), within the four-hour policy.

M4A fixtures contain the repository's valid three-second AAC fixture plus inert
`free`-box padding **before late `moov` metadata**, for exact 40/199 MiB sizes.
They test size and late metadata access, not the parsing cost, sample tables or
audio quality of a genuine multi-hour AAC recording. Accepted duration remained
3,065 ms. Do not present the padded fixture as a real long Zoom M4A.

## Which code was exercised

Baseline uses current `validateAndQueueOwnerJob`, `queueMeetingTranscription`,
`inspectOwnerInput`, `inspectAudioBuffer` and its actual inspector worker,
`uploadAssemblyAIAudio`/`safeFetch`, `importZoomRecording`, and the Zoom client's
bounded download. Stores, Blob, request binding and the service's dispatch wrapper
are local stubs. The Zoom importer calls the real queue validator through that
wrapper; it does not run a real Workflow.

The Blob read stub provides a chunked synthetic file stream. The Blob write stub
checks the bytes' digest without invoking the SDK or a second HTTP upload.
Consequently import measurements omit Blob SDK upload allocations and cloud
latency. The provider hostname still passes the existing `safeFetch` validation;
the fetch seam then redirects the request **inside this process** to the local
receiver. No production allowlist was changed. Submission measurements cover
inspection and upload, not the worker's lease/submission-intent orchestration or
transcription job creation.

Candidates are benchmark-only module-loader substitutions or callbacks. They do
not modify files under `lib/`, `pages/` or `shared/`:

| Candidate | Changed operation in the experiment |
|---|---|
| Baseline | Current runtime read/inspection/upload and current Zoom import |
| Drop | Zoom only: clear `audioBytes` after capture and before start; retain current readers |
| Preallocate | Fill one exact-size Buffer instead of chunk accumulation/concatenation in audio readers; Zoom also clears its original reference |
| Preallocate + stream | Submission only: preallocate, retain current copying inspector, then stream verified Buffer views with explicit length |
| Transfer + stream | Preallocate and transfer the exact backing ArrayBuffer to the parser worker and back; submission streams verified views; Zoom uses preallocation and reference clearing |
| Spool + stream | Bounded file spool/hash, extensionless file inspection and streaming upload; **Zoom still uses its current buffered download**, so this tests the original proposed split, not a fully streamed importer |

Transfer uses the same resource limits and metadata validator and includes a
named worker-data field with a simulated Turbopack wrapper. This is not a test of
an actual bundled/deployed worker. Spool queue callbacks do not implement a new
store lifecycle. None of the candidates is production-ready implementation code.

## Peak RSS: 199 MiB input

Values are **median (minimum–maximum)** MiB, four trials per populated cell.

| Candidate | Owner start | Meeting Tracker start | Zoom import + start | Submission + upload |
|---|---:|---:|---:|---:|
| Baseline | 710.8 (709.3–711.8) | 710.7 (710.6–722.0) | 912.8 (903.2–918.8) | 1104.9 (1103.7–1109.7) |
| Drop only | — | — | 713.2 (712.9–722.5) | — |
| Preallocate | 513.1 (512.9–513.4) | 513.0 (512.8–513.4) | 544.4 (542.4–741.1) | 910.0 (909.5–910.4) |
| Preallocate + stream | Same preallocation path | Same preallocation path | Same preallocation path | 534.6 (532.4–536.4) |
| Transfer + stream | 314.4 (313.9–314.6) | 315.0 (314.1–318.9) | 544.0 (542.2–545.5) | 333.4 (332.5–334.8) |
| Spool + stream | 128.1 (127.5–128.1) | 127.4 (127.2–127.5) | 493.0 (492.6–493.5) | 162.0 (158.0–163.0) |

At 40 MiB, submission medians were baseline 297.4, preallocate 267.7,
preallocate + stream 189.6, transfer + stream 158.1 and spool + stream 131.8 MiB.
Zoom import medians were respectively baseline 274.1, drop-only 233.3,
preallocate 204.7, transfer 197.3 and spool 172.4 MiB. Full ranges and the separate
owner/Meeting Tracker measurements are retained in JSON.

The larger submission comparison is about **52% lower median RSS** for
preallocation + streaming versus baseline. Transfer saves another roughly
201 MiB on submission but does not lower the largest median stage, Zoom import,
which remains about 544 MiB. Disk reduces that stage to about 493 MiB in the
tested split, not to the 162 MiB measured for isolated submission. Maxima across
different invocations must not be added or treated as a concurrent-instance test.

## Timing and byte correctness

For 199 MiB, submission elapsed ranges were baseline 0.447–0.498 s,
preallocate 0.391–0.413 s, preallocate + stream 0.354–0.364 s,
transfer 0.341–0.358 s and spool 0.340–0.354 s. Zoom import ranged
0.523–0.583 s baseline, 0.492–0.495 s drop-only, 0.455–0.479 s preallocate,
0.448–0.463 s transfer and 0.455–0.496 s spool. These are cached local I/O and
loopback timings; they predict neither cloud completion time nor timeout safety.

Slow 8 MiB cases took approximately 380 ms baseline, 375 ms transfer and 380 ms
spool; RSS was 133.8, 104.4 and 97.2 MiB respectively. No stalls or digest failures
occurred. This is a finite slowdown check, not an adversarial backpressure proof.

All **43 local uploads** had exact received size and SHA-256, an explicit
`Content-Length`, and no `Transfer-Encoding`. In particular, supplying a stream
body with `duplex: 'half'` did **not** force chunked framing in this Node version.
That falsifies the original review's unconditional local framing assertion;
it does not prove AssemblyAI accepts the proposed request or that every Node
version behaves identically. The final-byte controls proved zero upload attempts
before digest validation. The transfer candidate also returned the original bytes
intact on successful runs, as verified by the receiver's full-file digest.

## Limits and decision gates still open

No hosted experiment, production recording, OOM event, real provider upload,
deployed-runtime parity, concurrent invocation, lease race, early response,
disconnect, abort, ENOSPC, hard kill/reaping, malicious metadata or universal
format-parity test was performed. Native memory allocation and kernel cache
accounting on Vercel remain unknown. Local disk savings cannot settle the disk
adoption question. Existing byte/duration limits are unchanged.

Simpler candidates win on **local measured memory versus existing code**. Their
production compatibility, safe interface, ownership, cancellation and bounded
failure behavior still need a revised design and Opus review. Keep provider
submission and cleanup semantics unchanged in that future design. Do not expand
this benchmark task into a deployment or application implementation.

## Recommendation evidence and disconfirming checks

| Recommendation | Evidence executed | Disconfirming check / remaining prerequisite | Status |
|---|---|---|---|
| Favor preallocation + verified-buffer streaming over immediate disk adoption | Real queue/inspection paths, local wire/hash checks, near-cap memory comparison | Run target-runtime/hosted comparison; if memory does not improve, reject the recommendation | LOCAL SUPPORT; adoption pending |
| Include Zoom import in the revised scope | Actual importer plus queue; drop/preallocate alternatives; 741.1 MiB outlier retained | Sustained/concurrent starts may keep buffers longer; no hard memory bound established | VERIFIED locally; concurrency unknown |
| Consider transfer only when its extra memory reduction/ownership guarantees matter | Exact-byte round trip, metadata policy, lower submission RSS | Actual bundled worker and failure/cancellation parity could reject the approach | LOCAL SUPPORT; not yet required |
| Defer the scratch subsystem | Split's Zoom median remains 493 MiB; extra hosted/capacity lifecycle unresolved | A hosted comparison proving disk necessary and safe could overturn this choice | INFERENCE from measured scope |

## Scoped reconciliation

Sweep Mode A: the changed fact is **local candidates have now been measured**.
Searches covered the audio plan/disposition, queue, Atlas, source-limit comments,
current session, memory and historical review evidence. Updated active plan and
disposition statements that said no comparison had run. Current buffering/open
queue and production-unknown statements still agree with unchanged runtime.
The original fingerprinted Opus review remains visibly historical, with its
untested recommendations preserved as of that review. No live restatement found
claims production readiness or a production memory result.

Contract scope: actual byte paths and candidate callbacks are accounted for;
partial store/dispatch and lease behavior are stubbed, not verified. Async process,
worker, stream and owned fixture cleanup is exercised on normal completion and
digest rejection; other failure branches remain open. New database/routes/status
fan-out N/A. Durable additions are scripts and synthetic evidence only.
