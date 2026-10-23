---
title: FFmpeg Media Verification Investigation
domain: engineering-process
kind: audit
status: active
summary: "The exact pinned private FFmpeg archive was read back and hash-verified; its Linux x86_64 binaries pass the unmodified 26-test media suite under emulation in a Linux ARM64 harness. Current Production deployment configuration remains unverified."
canonical: false
cataloged: 2026-10-23
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/audits/linux-ci-verification-2026-10-23.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
  - docs/audits/ffmpeg-media-evidence-2026-10-23.json
  - docs/audits/pinned-ffmpeg-linux-evidence-2026-10-23.json
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
**Current pinned-artifact result:** the private object at the fixed historical
pathname was read once and its 151,144,252 bytes matched the tracked SHA-256
`14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902` before
extraction. The canonical installer succeeded and reported
`n9.0.2-23-g27b46f0fbc-20261008`; a separate binary preflight verified both
FFmpeg and ffprobe as ELF 64-bit x86-64 and recorded both version lines. The
unmodified 26-test Jest suite passed in
one invocation (26 passed, 0 failed, 0 skipped; 122.549 seconds) on Debian 12
Linux ARM64 with Node 22.23.4 and Python 3.11.2, using those exact pinned x86-64
binaries through QEMU user-mode emulation. The clean source copy was candidate
`7b83211cfb9d694d38f28d8e90e7c858ef4c1c5c`; 5,486 tracked files and symlinks
were unchanged before and after the run. This closes the pinned-binary media
behavior question for that bounded harness. It does not verify a native x86-64
application stack or what the current Production deployment runs. Details and
limits are in the [pinned Linux evidence](pinned-ffmpeg-linux-evidence-2026-10-23.json).
An earlier full emulated x86-64 harness run passed 25 tests and failed the
two-audio-stream receipt test with ENOENT after the original seven FFmpeg 6
failures passed; child status and stderr were unavailable, so the cause remains
unknown and is not attributed to FFmpeg behavior. An unchanged targeted rerun
ended with exit status 139 before producing Jest JSON. These inconclusive
attempts are not evidence for the successful ARM64-harness result.

| Evidence run | Decoder / inputs | Result |
|---|---|---|
| Ubuntu supplemental suite | FFmpeg 6.1.1, Linux arm64, original run | 19/26 pass and 7 fail; initial retained receipt has one `audio_past_cut` diagnostic |
| Paired follow-up fixture runs | Same recipe and source-fixture SHA-256 values; Linux FFmpeg 6.1.1 vs macOS FFmpeg 9.0.2 | Follow-up diagnostics reproduce all seven at `audio_past_cut`; FFmpeg 9.0.2 passes seven, including intentional mutants |
| Same encoded outputs | Seven case outputs, four unique MP4 SHA-256 values, decoded by both builds | Linux FFmpeg 6.1.1 exceeds expected decoded samples; macOS FFmpeg 9.0.2 returns exact expected samples |
| Full unchanged Jest suite | Candidate source copy `9c4a6a830e7dea183d9bfe977468330ece18bcce`, macOS arm64, FFmpeg 9.0.2 | 26/26 pass in 21.684 seconds |
| Exact pinned private archive and Linux media suite | Fixed-path private Blob read; exact SHA-256; Debian 12 ARM64 harness with pinned x86-64 FFmpeg/ffprobe emulated | 151,144,252 bytes matched the tracked SHA; canonical installer succeeded; separate binary preflight verified architecture/version; unmodified suite passed 26/26 in 122.549 seconds |

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
| Exact pinned private object and media behavior | **VERIFIED within bounded scope:** one Blob SDK metadata call and one content GET read the fixed pathname; byte count and SHA-256 matched; pinned x86-64 tools passed the full unmodified media suite under emulation in a Linux ARM64 harness. |
| Current Production configuration and deployment | **UNKNOWN:** no active deployment lookup or effective Production pathname check was performed. Exact bytes at the historical fixed pathname do not prove that Production currently uses them. |

## Contract reconciliation scope

Two paths were reviewed: the local test uses the FFmpeg/ffprobe pair on PATH
with synthetic fixtures and the shipped cut recipe; the worker reads its
configured private artifact, verifies SHA, installs it in a sandbox, runs the
cut, and validates the success/failure receipt before an upload decision.
The cut recipe supplies the acceptance guards in both paths. Partial-failure
behavior is explicit in the artifact contract table.
No runtime code, schema, asynchronous behavior, helper, or persisted symbols
changed. This reconciliation updates documentation and evidence records only;
no Atlas or schema changes apply.

The historical Ubuntu result and follow-up diagnostics are in the [Linux
verification record](linux-ci-verification-2026-10-23.md). Machine-run details,
including exact fixture and output hashes, are in the
[evidence JSON](ffmpeg-media-evidence-2026-10-23.json).

## Scope and limits

The historical comparison used Linux arm64 FFmpeg 6.1.1 and macOS arm64 FFmpeg
9.0.2; the latter did not use the exact pinned archive. A later authorized
bounded private-object read used one Blob SDK metadata call and one content
GET, transferred 151,144,252 bytes within the 192 MiB ceiling, and verified the
exact SHA-256 before extraction. The canonical installer succeeded and
reported the pinned FFmpeg version; a separate binary preflight verified both
FFmpeg and ffprobe as ELF 64-bit x86-64 and recorded their version lines. The
unchanged media suite then passed on a Debian 12 Linux ARM64 harness using the
pinned x86-64 FFmpeg/ffprobe through QEMU user-mode emulation. An initial full
emulated x86-64 harness run was 25/26; its two-audio receipt failure has an
unknown cause because child status and stderr were unavailable. An unchanged
targeted run ended at exit status 139 before producing Jest JSON. The successful
ARM64 harness run does not establish a native x86-64 application stack. No
hosted GitHub Actions run, active Production deployment inspection, effective
Production pathname check, or source modification occurred; current Production
artifact use remains unknown. No Blob listing or write, deployment change,
database write, or other live application operation occurred.

Explicit non-findings: no evidence that the current Production deployment uses
the historical pathname or the verified bytes; no successful native x86-64
full-application-stack result; and no basis to change the media source guard
from the historical FFmpeg 6 result alone.

## Recommendation and disconfirming checks

Keep the source guard unchanged. Exact pinned bytes and Linux media behavior
are now established for the bounded emulated harness; a separate read-only
check of the active Production revision and effective pathname is still needed
to make a claim about what Production currently runs.

Disconfirming checks are explicit: the same-output hash set (seven cases,
four unique MP4 hashes) was identical across builds, yet decoded sample counts
differed; rerunning either build against those retained outputs and finding the
opposite counts would falsify that historical observation. A non-green rerun
of the verified pinned binaries would challenge repeatability and require
investigation; a reproducible media assertion failure would challenge the
bounded compatibility result. A current deployment inspection showing a
different worker revision or effective pathname would falsify any claim that
the historical configuration is current. None of these checks changes the
historical 19/26 Ubuntu FFmpeg 6.1.1 result.
