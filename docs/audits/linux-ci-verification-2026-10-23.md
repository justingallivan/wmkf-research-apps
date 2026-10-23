---
title: Local Ubuntu Workflow-Equivalent Verification
domain: engineering-process
kind: audit
status: active
summary: "Core Ubuntu workflow-equivalent checks passed with documented skips. Follow-up cross-decoder evidence shows different behavior between the tested Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds on identical output bytes; exact production artifact parity remains unverified."
canonical: false
cataloged: 2026-10-23
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/audits/release-candidate-checklist-2026-10-22.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
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
The public artifact URL returned 404 in the earlier check. The historical
rollout record says the exact tarball was uploaded to the private store on
October 10, but current object presence, bytes, checksum, and effective
Production configuration have not been checked. The FFmpeg 9.0.2 host run was
not on Linux and did not use the pinned `9.0.2-23` bytes. Thus production-pin
compatibility remains unverified. No source fix is justified by the FFmpeg 6
result alone. The bounded exact-object probe is prepared but not run; a private
Blob read may incur usage charges. See the [FFmpeg media investigation](ffmpeg-media-investigation-2026-10-23.md)
and its [machine evidence](ffmpeg-media-evidence-2026-10-23.json). This is
separate from the private Dataverse-export Blob store investigation.

An initial build and full Jest run were killed by the original 2 GB Docker
memory limit. The successful build ran in the Ubuntu container on the disposable
4 GB VM; the Jest rerun
used a temporary resource-only worker wrapper (384 MB idle worker threshold,
one worker, 768 MB Node heap). Those settings changed no source or tracked test
configuration. A targeted launcher rerun with Docker `--init` passed 18 tests;
this addressed container PID 1 cleanup and is not part of the full Jest count.
The temporary VM was deleted, and the default Docker context remained unchanged.

This local Ubuntu result does not claim hosted GitHub Actions or amd64 coverage.
It provides Linux execution evidence for the configured core checks and for
the FFmpeg 6 decoder behavior; the isolated FFmpeg 9.0.2 comparison narrows the
cause but does not verify the pinned production artifact. Hosted target, human
rehearsal, rollback, and owner promotion decisions remain governed by the
[release checklist](release-candidate-checklist-2026-10-22.md).
