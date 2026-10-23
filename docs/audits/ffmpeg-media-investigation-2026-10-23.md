---
title: FFmpeg Media Verification Investigation
domain: engineering-process
kind: audit
status: active
summary: "Cross-decoder checks show different behavior between the tested Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds on identical MP4 outputs; the exact pinned Production artifact and current deployment configuration remain unverified."
canonical: false
cataloged: 2026-10-23
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/audits/linux-ci-verification-2026-10-23.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
  - docs/audits/ffmpeg-media-evidence-2026-10-23.json
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md
---

# FFmpeg Media Verification Investigation

## Finding

The original supplemental suite on Ubuntu 24.04.5 arm64 with FFmpeg 6.1.1 had
19 passes and 7 failures. Its retained initial log contains one coded
`audio_past_cut` diagnostic; follow-up diagnostics reproduced all seven at the
`decoded_samples` guard. An isolated macOS host with FFmpeg 9.0.2 passed all
seven cases and the complete unmodified 26-test suite. The same encoded MP4
outputs decoded differently across those tested Linux/FFmpeg 6.1.1 and
macOS/FFmpeg 9.0.2 builds. Identical bytes isolate the decoder side of the
difference; these runs do not separate version effects from OS/build effects.
The exact Production archive (`9.0.2-23`) has not been read back or compared by
SHA-256.

| Evidence run | Decoder / inputs | Result |
|---|---|---|
| Ubuntu supplemental suite | FFmpeg 6.1.1, Linux arm64, original run | 19/26 pass and 7 fail; initial retained receipt has one `audio_past_cut` diagnostic |
| Paired follow-up fixture runs | Same recipe and source-fixture SHA-256 values; Linux FFmpeg 6.1.1 vs macOS FFmpeg 9.0.2 | Follow-up diagnostics reproduce all seven at `audio_past_cut`; FFmpeg 9.0.2 passes seven, including intentional mutants |
| Same encoded outputs | Seven case outputs, four unique MP4 SHA-256 values, decoded by both builds | Linux FFmpeg 6.1.1 exceeds expected decoded samples; macOS FFmpeg 9.0.2 returns exact expected samples |
| Full unchanged Jest suite | Candidate source copy `9c4a6a830e7dea183d9bfe977468330ece18bcce`, macOS arm64, FFmpeg 9.0.2 | 26/26 pass in 21.684 seconds |

For the failures, `durationTs` at timebase `1/48000` equals expected samples;
the rejecting guard is `decoded_samples`. Excess decoded samples are 16 at
12.437 seconds, 800 at 10.010 seconds, and 256 for the two-second gap mutant.
The 11b frame-timestamp control and 12b audio-gap control still reject as
intended with `frame_timestamp_mismatch` and `unsupported_timeline`. The source
guard was preserved; this evidence alone does not justify a source change.

## Artifact contract evidence

| Check | Evidence and status |
|---|---|
| Test and cut behavior | **VERIFIED in source:** `tests/unit/presentation-video-cut-script.test.js` builds synthetic inputs and invokes the cut script (lines 48–69); source fixtures and controls are defined at lines 52–58 and 333–395. The test evidence covers the test path, not Production artifact bytes. |
| Source artifact identity | **VERIFIED in source:** worker SHA constant is `14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902` (`presentation-video-split-worker.js:40–41`). Provisioning uses that SHA and fixed pathname (`stage4-provision-ffmpeg.mjs:16–20`); the test asserts SHA equality only (`stage4-provision-ffmpeg.test.js:4–10`). |
| Runtime pathname and read | **VERIFIED in source:** worker obtains pathname from `PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME`, reads with `UPLOADS_BLOB_RW_TOKEN`, bypasses cache, and rejects a SHA-256 mismatch (`presentation-video-split-worker.js:87–103`). It does not hard-code the provisioning pathname. |
| Install and version receipt | **VERIFIED in source:** installer rechecks SHA, extracts the archive, executes `ffmpeg -version`, and writes `ffmpegVersionLine` to the sandbox install receipt (`presentation-video-cut-script.js:97–123`). Worker starts install and handles its exit code (`presentation-video-split-worker.js:319–324`). The successful version line is not copied into the durable verification receipt; the worker only reads the install receipt code on failure (`presentation-video-split-worker.js:290–295`). |
| Cut acceptance and partial failure | **VERIFIED in source:** the cut script compares stream duration and decoded samples to the cut boundary (`presentation-video-cut-script.js:420–428`), renames partial output only after checks (`431–434`), and removes partial/final files on failure before writing the receipt (`435–448`). Worker checks the cut receipt before upload (`presentation-video-split-worker.js:399–408`). |
| Historical provisioning and public origin | **HISTORICAL / VERIFIED for earlier requests:** the October 10 rollout record says the artifact was uploaded and `PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME` set in Production (`docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md:323–329`). On October 23, the tracked public asset URL returned 404 for HEAD and the release-by-tag API returned 404 for GET. Neither establishes current private object bytes or the current effective environment value. |
| Current private object and deployment | **UNKNOWN:** no private-object metadata/content read, current Production pathname check, active deployment lookup, or current worker installation was performed. |

## Contract reconciliation scope

Two paths were reviewed: the local test uses the FFmpeg/ffprobe pair on PATH
with synthetic fixtures and the shipped cut recipe; the worker reads its
configured private artifact, verifies SHA, installs it in a sandbox, runs the
cut, and validates the success/failure receipt before an upload decision.
The cut recipe supplies the acceptance guards in both paths. Partial-failure
behavior is explicit in the artifact contract table.
New production changes, new async behavior, helper extraction, and new persisted
symbols are **N/A** because this is a documentation-only investigation. The
durable restatements updated were the Linux verification record, release
checklist, and release-preparation receipt; no Atlas or schema changes apply.

The historical Ubuntu result and follow-up diagnostics are in the [Linux
verification record](linux-ci-verification-2026-10-23.md). Machine-run details,
including exact fixture and output hashes, are in the
[evidence JSON](ffmpeg-media-evidence-2026-10-23.json).

## Scope and limits

The isolated FFmpeg 9.0.2 host was macOS arm64 and did not run the exact
`9.0.2-23` archive. Ubuntu arm64 used FFmpeg 6.1.1; no Linux FFmpeg 9 run or
amd64 run is established. No hosted GitHub Actions run, production deployment
inspection, private-store access, live credential read, or source modification
occurred. The result is decoder-comparison evidence, not production byte-pin
verification.

The exact-object probe is prepared in private temporary storage and passed
`node --check` only. It fixes the historical pathname and SHA, makes one
metadata request and at most one object GET, allows up to 192 MiB with bounded
timeouts and zero SDK retries, hashes a local mode-0600 temporary copy, retains
it only on exact size/hash match, and does not list, write, extract, or execute
Blob content. The cap is a transfer ceiling, not an estimate of actual object
size. The probe was not run. A private Blob read may incur usage charges.

Explicit non-findings: no evidence that the private artifact is currently
missing; no evidence that Production currently uses the historical pathname;
no evidence of exact pinned-binary compatibility; and no basis to change the
media source guard from the FFmpeg 6 result alone.

## Recommendation and disconfirming checks

Keep the source guard unchanged. To establish exact local binary parity, the
owner must either authorize the named bounded private Blob read (which may
consume paid usage) or provide a local copy whose SHA-256 matches the tracked
pin. Verify the retained archive hash before any extraction or test use. A
version string or newly built FFmpeg 9.0.2 archive is not a substitute for that
byte match. A separate read-only check of the active Production revision and
effective pathname is needed to make a claim about what Production currently
runs; it is not required to establish local binary behavior.

Disconfirming checks are explicit: the same-output hash set (seven cases,
four unique MP4 hashes) was identical across builds, yet decoded sample counts
differed; rerunning either build against those retained outputs and finding the
opposite counts would falsify that observation. A verified archive hash that
differs from the pin would falsify exact artifact parity. A current deployment
inspection showing a different worker revision or effective pathname would
falsify any claim that the historical configuration is current. None of these
checks changes the historical 19/26 Ubuntu result.
