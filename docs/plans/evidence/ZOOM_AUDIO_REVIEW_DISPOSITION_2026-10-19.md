---
title: Zoom audio adversarial review disposition
domain: meeting-tracker
kind: decision
status: active
summary: "Implementation held after Opus review. Local comparisons favor copy reduction; revised contracts and target-environment validation remain required."
owner: product-engineering
---

# Review disposition

The [original Opus 5.5 review](ZOOM_AUDIO_OPUS_REVIEW_2026-10-19.md) returned
**NEEDS REWORK**. The [plan](../ZOOM_AUDIO_STREAMING_PLAN_2026-10-19.md) is a
blocked draft. No runtime code, production state, environment, database or
provider request changed. Planning/review is now supplemented by a
[local synthetic benchmark](ZOOM_AUDIO_BENCHMARK_2026-10-19.md); no application
implementation or hosted/provider experiment has occurred.

## Findings accepted as implementation blockers

- **Premise and scope:** whole-file copies are verified in source, but no
  production OOM has been established. Local copy-reduction benefit is now
  measured in the linked report; hosted benefit remains unknown. The Zoom importer
  retains its own audio Buffer while calling queue validation. A worker-only
  memory result cannot stand in for the entire Zoom import route. Measurement
  must be able to stop the project or choose a narrower change.
- **Failure contract:** `worker.js` `submitQueuedJob` catches a pre-intent failure
  and writes `failed` plus `cleanup_requested_at`. A new scratch admission or
  ENOSPC error would follow that path. Calling it retryable in prose supplies no
  retry mechanism. Define and test bounded backoff, lease release, retention and
  exhaustion behavior before introducing local resource failures. Do not broaden
  retry handling across ambiguous submission intent.
- **Parser parity:** installed music-metadata `parseFile` consults the extension
  before content sniffing; today's `parseBuffer(bytes, undefined)` does not get
  that hint. Use a deliberately sniffed path/tokenizer strategy and test parity
  on accepted, mismatched and malicious bytes. Prove the Node worker build in
  deployment. A dot in an ancestor directory is not by itself proof of a wrong
  parser; verify the extension lookup result rather than blindly banning dots.
- **Capacity and lifecycle:** choose concrete admission, reservation, stale-owner
  recovery, cleanup-error and hard-kill behavior. The global provider slot does
  not serialize starts/imports. Neither a filesystem lock nor a module counter is
  yet a proven sufficient or necessary design for this deployment.
- **Deadlines:** Meeting Tracker start declares 60 s, owner-pilot start 120 s,
  Zoom import 300 s; the worker budget is 240 s. Explicit end-to-end budgets with
  cleanup reserves must fit each caller. Existing stage caps do not add up to an
  enforced total deadline.
- **Streaming mechanics:** prove actual body framing, byte count, timeout, early
  response and close behavior through the chosen fetch seam. Local wire tests
  cannot prove the actual provider integration; an authorized provider check is
  a separate release gate. Preserve saved-reference reuse and submission fences.
- **Consumer coverage:** enumerate error projection/retry consequences at both
  queue modes and Zoom import. Extend parser tracing/probe coverage to every
  execution route that uses the changed inspector.

## Qualifications to the original review

The receipt preserves Opus's words; its hypotheses are not promoted wholesale
to verified facts:

- File random access is proposed relative to a prefix-only design; buffers
  already support late metadata. The design has no new format-support advantage
  over today's buffer parser.
- A streaming fetch body does not automatically establish that the request
  must use chunked framing when an explicit content length is provided. Opus did
  not run the wire test. The subsequent local wire test now demonstrates explicit
  content length without chunked framing on Node 26.6.0 for both Buffer and
  stream bodies. Actual AssemblyAI/deployed-runtime integration remains untested.
- Dropping the Zoom Buffer reference and transferring a single Buffer through
  the inspector have now been compared locally. The report preserves the
  preallocation Zoom outlier and limits claims to measured samples. File-backed
  Blob bodies remain untested; this benchmark used file streams for disk upload.
- `/tmp` backing and hosted memory accounting are unmeasured. A tmpfs result or
  charged file cache would challenge the benefit; compare full measured peaks
  rather than infer all memory savings from a filesystem label alone.
- There are no new stale audio scratch files today: this code does not yet use
  that scratch lifecycle. Platform termination would create that risk after
  adopting the proposal; the review's existing deadline mismatch is real source
  evidence, not evidence that scratch leakage has already occurred.
- The Blob SDK's returned pathname is not independent proof of object identity.
  Keep persisted-path scoping as an authorization boundary, while actual full
  length and SHA-256 establish byte integrity. A final-byte mutation test must
  prove that no provider bytes are sent before verification completes.

## Next gate and limits

The bounded provider-free local experiment is complete: owner start, Meeting
Tracker start, Zoom import and submission byte paths were compared in fresh
processes. Revise the design using that evidence and obtain a fresh Opus review
before runtime implementation. Any hosted experiment still needs an explicit
synthetic-only target and resource budget; it must not touch real recordings or
invoke paid transcription incidentally. Hosted memory accounting remains unknown.

Documentation currency, catalog, symbol-reference and build-claim checks passed
for the planning work; runtime tests were not run because runtime code is
unchanged. The initial review fingerprint remains an audit record, not approval
of subsequent plan edits.
