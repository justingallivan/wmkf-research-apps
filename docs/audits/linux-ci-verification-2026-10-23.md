---
title: Local Ubuntu Workflow-Equivalent Verification
domain: engineering-process
kind: audit
status: active
summary: "Core Linux workflow-equivalent checks passed with documented skips; supplementary media verification remains open because the pinned FFmpeg artifact was unavailable from its tracked public origin."
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

This is a qualified pass, not an all-tests-green claim. A separate supplemental
video suite had 19 passing and 7 failing tests (26 total) after FFmpeg 6.1.1 was
installed. The media recipe and tests are unchanged from recorded local
`origin/main` candidate `c09a4f`; one failure includes an `audio_past_cut`
diagnostic receipt at `step: accept`. The tracked production worker pins FFmpeg
`9.0.2-23`. Its tracked public artifact URL returned 404 for both GET and HEAD;
the checksum-verified pinned binary was not obtained or used. The production
artifact store was not queried, so this does not establish that the artifact is
missing there. Pin compatibility remains unknown. No source fix was made; these
media tests and artifact are separate from the private Dataverse-export Blob
store investigation. Next, obtain the checksum-verified pinned binary through an
approved source and rerun all 26 media tests before classifying the failure.

An initial build and full Jest run were killed by the original 2 GB Docker
memory limit. The successful build ran in the Ubuntu container on the disposable
4 GB VM; the Jest rerun
used a temporary resource-only worker wrapper (384 MB idle worker threshold,
one worker, 768 MB Node heap). Those settings changed no source or tracked test
configuration. A targeted launcher rerun with Docker `--init` passed 18 tests;
this addressed container PID 1 cleanup and is not part of the full Jest count.
The temporary VM was deleted, and the default Docker context remained unchanged.

This local Ubuntu result does not claim hosted GitHub Actions or amd64 coverage.
It provides Linux execution evidence for the configured core checks while the
supplementary FFmpeg comparison remains open as described above. Hosted target,
human rehearsal, rollback, and owner promotion decisions remain governed by the
[release checklist](release-candidate-checklist-2026-10-22.md).
