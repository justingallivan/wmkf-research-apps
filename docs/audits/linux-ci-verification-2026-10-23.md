---
title: Local Ubuntu Workflow-Equivalent Verification
domain: engineering-process
kind: audit
status: active
summary: "Core Ubuntu workflow-equivalent checks passed with documented skips. The exact pinned private FFmpeg archive was verified and its unmodified media suite passed on a Linux ARM64 harness using emulated x86_64 binaries; current Production deployment configuration remains unverified."
canonical: false
cataloged: 2026-10-23
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/audits/release-candidate-checklist-2026-10-22.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
  - docs/audits/pinned-ffmpeg-linux-evidence-2026-10-23.json
---

# Local Ubuntu Workflow-Equivalent Verification

**Candidate:** `94447672fe04a788b0e6aadb5deeb9d2fc85e82a`. The run used a clean,
case-sensitive detached checkout, Ubuntu 24.04.5 arm64, Node.js 22.23.4, and
npm 10.9.9. No live environment files or project credentials were copied into
the isolated environment; the tracked `.env.example` was present. It did not contact GitHub Actions, and it does not establish
an amd64 result. Machine and run details are retained in the
[evidence record](linux-ci-evidence-2026-10-23.json).

The configured core checks passed: clean `npm ci`; ESLint with zero errors and
161 warnings; all 42 workflow gates, including configured types; canonical
Turbopack production build in an Ubuntu container on a fresh disposable 4 GB VM
(129.22 seconds); and ten
required PostgreSQL suites (130 tests, 7.541 seconds). The build left the
migration manifest unchanged. Coverage Jest passed in 541 seconds with 1,432
suites, 24,763 tests, five snapshots, and 18 suites / 241 tests skipped.
Coverage instrumentation was enabled; Jest coverage thresholds were disabled.

This is a qualified pass, not an all-tests-green claim. The original Ubuntu
arm64 supplemental video run remains 19 passing and 7 failing tests (26 total)
with FFmpeg 6.1.1. Follow-up diagnostics reproduced all seven failures at the
`decoded_samples` guard in `audio_past_cut`; container `durationTs` exactly
matched the expected sample count at timebase `1/48000`. The excess decoded
samples were 16 for the 12.437-second case, 800 for the 10.010-second case, and
256 for the two-second gap mutant. The 11b frame-timestamp control and 12b
audio-gap control continued to reject with their intended
`frame_timestamp_mismatch` and `unsupported_timeline` codes, respectively.

Paired runs used the same recipe and source-fixture SHA-256 values. Follow-up
diagnostics reproduced all seven `audio_past_cut` failures on Linux with FFmpeg
6.1.1; an isolated macOS host running FFmpeg 9.0.2 passed all seven, including
the intentional mutants. Both toolchains also decoded the same seven case
outputs (four unique MP4 hashes): each FFmpeg 6.1.1 count exceeded the expected
cut, while FFmpeg 9.0.2 returned the exact expected count. This establishes a
behavior difference between these tested Linux/FFmpeg 6.1.1 and macOS/FFmpeg
9.0.2 builds for identical bytes; it does not attribute the difference to
version alone or prove exact production binary parity. The full unmodified
26-test Jest suite passed on the isolated host in 21.684 seconds.

The production worker pins FFmpeg archive SHA-256
`14020417ff8ef01470e8cb771355e65c37aff62b80fb0be41eeb7611d1360902`; the
provisioning script uses pathname
`stage4/ffmpeg-n9.0.2-23-g27b46f0fbc-linux64-gpl-9.0.tar.xz`, while the worker
reads the effective pathname from `PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME`.
The public artifact URL returned 404 in the earlier check. The exact fixed-path
private object was subsequently read with one Blob SDK metadata call and one
content GET:
151,144,252 bytes matched the pinned SHA-256 before extraction. The canonical
installer succeeded and reported `n9.0.2-23-g27b46f0fbc-20261008`; a separate
binary preflight verified both FFmpeg and ffprobe as ELF 64-bit x86-64 and
recorded both version lines. The full unmodified 26-test suite then passed
in one invocation (26/26, no skips) on Debian 12 Linux ARM64 with Node 22.23.4
and Python 3.11.2, using the exact pinned binaries via QEMU user-mode
emulation. This establishes pinned-binary media behavior in that bounded
harness; it does not establish a native x86-64 application stack, hosted CI,
or what the current Production deployment runs. The current effective
Production pathname and active revision remain unchecked. See the [pinned
Linux evidence](pinned-ffmpeg-linux-evidence-2026-10-23.json), [FFmpeg media
investigation](ffmpeg-media-investigation-2026-10-23.md), and its [historical
cross-decoder evidence](ffmpeg-media-evidence-2026-10-23.json). This is separate
from the private Dataverse-export Blob store investigation.

An earlier full emulated x86-64 harness run passed 25 tests and failed the
two-audio-stream receipt test with ENOENT after the original seven FFmpeg 6
failures passed; child status and stderr were unavailable, so the cause remains
unknown and is not attributed to FFmpeg behavior. An unchanged targeted rerun
ended with exit status 139 before producing Jest JSON. The later full 26/26
result is from the Linux ARM64 harness with pinned x86-64 FFmpeg/ffprobe
emulated, not a full x86-64 application stack.

An initial build and full Jest run were killed by the original 2 GB Docker
memory limit. The successful build ran in the Ubuntu container on the disposable
4 GB VM; the Jest rerun
used a temporary resource-only worker wrapper (384 MB idle worker threshold,
one worker, 768 MB Node heap). Those settings changed no source or tracked test
configuration. A targeted launcher rerun with Docker `--init` passed 18 tests;
this addressed container PID 1 cleanup and is not part of the full Jest count.
The temporary VM was deleted, and the default Docker context remained unchanged.

This local Ubuntu result does not claim hosted GitHub Actions or amd64 coverage.
The separate pinned-binary run uses x86-64 FFmpeg/ffprobe under emulation in a
Linux ARM64 harness; it does not constitute a native x86-64 application-stack
or hosted CI pass. The historical FFmpeg 6 decoder behavior remains recorded
above; exact pinned-binary media behavior is now verified within the bounded
harness. Current Production configuration remains unknown. Hosted target,
human rehearsal, rollback, and owner promotion decisions remain governed by the
[release checklist](release-candidate-checklist-2026-10-22.md).
