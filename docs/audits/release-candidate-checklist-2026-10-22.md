---
title: Release Candidate Checklist
domain: engineering-process
kind: audit
status: active
summary: "Core local Ubuntu checks passed with documented skips. The exact pinned FFmpeg archive and Linux media behavior are verified in a bounded emulated harness; current Production deployment configuration remains unverified. Three release decision groups remain open."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/audits/release-preparation-private-store-2026-10-22.md
  - docs/audits/release-candidate-lineage-2026-10-22.json
  - docs/audits/linux-ci-verification-2026-10-23.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
  - docs/audits/ffmpeg-media-investigation-2026-10-23.md
  - docs/audits/ffmpeg-media-evidence-2026-10-23.json
  - docs/audits/pinned-ffmpeg-linux-evidence-2026-10-23.json
  - docs/audits/controlled-reviewer-rehearsal-plan-2026-10-22.md
  - docs/audits/internal-staff-rehearsal-observations-2026-10-22.md
---

# Release Candidate Checklist

**Assessed code candidate:** `eaa126028d7918c94340e75f1ea3213ad041f010`;
application runtime checkpoint `4720980edb6b2c769907e54102e27779c3f567e0`.
The fully gated candidate `81b8a063b` and the later fixture candidate
`9b2ec0060` are separate evidence points; neither is a claim that this
assessment has completed a promotion review.

The local verification applies to candidate `9b2ec0060`: isolated Node
22.23.4/macOS Turbopack build passed; 51/51 browser tests passed in one run with
no retries; three focused unit suites passed 40 tests; scoped ESLint and diff
check passed; baseline and reviewer-authoring headless smoke runs each reached
their mock-backed page with HTTP 200, no blocked requests, and no human pass.
**[VERIFIED via reviewed Git source-lineage comparison]** Only four documentation
files changed from `9b2ec0060` to `eaa126028`
(`git diff --name-status 9b2ec0060..eaa126028`);
the code and test diff is empty (`git diff --exit-code 9b2ec0060..eaa126028 --
scripts tests pages lib shared package.json package-lock.json next.config.js`).
Application runtime and dependency/configuration trees also match `4720980ed`
(`git diff --exit-code 4720980ed..eaa126028 -- pages lib shared package.json
package-lock.json next.config.js`). Runtime/source subtree hashes are retained
in the [lineage evidence](release-candidate-lineage-2026-10-22.json). The full
Jest, 42-gate, PostgreSQL, and 44/44
browser evidence on `81b8a063b` remains scoped to that historical candidate;
changes to harness and tests since then prevent treating it as the full
verification of `eaa126028`. The documentation updates in this follow-up are
downstream documentation only; they add no runtime or harness changes.

The Ubuntu verification target `94447672fe04a788b0e6aadb5deeb9d2fc85e82a`
differs from `eaa126028` only in documentation/evidence files; the application
runtime and test/source trees are unchanged. The exact comparison is retained
in the [Linux evidence record](linux-ci-evidence-2026-10-23.json).

Verification and release-decision status for this candidate:

| Gate | Status and required evidence |
|---|---|
| Local Linux and pinned-media evidence | **Core checks passed with documented skips; exact pinned bytes and media behavior verified within the bounded emulated harness. Current Production configuration remains open.** Candidate `94447672fe04a788b0e6aadb5deeb9d2fc85e82a` passed clean install, lint, all 42 workflow gates (including configured types), canonical build, coverage Jest, and required PostgreSQL suites in local Ubuntu 24.04.5 arm64; Jest skipped 241 tests across 18 suites. Historically, Linux FFmpeg 6.1.1 produced 19/26 passes and follow-up diagnostics reproduced all seven `audio_past_cut` failures; macOS FFmpeg 9.0.2 passed those cases on the same encoded bytes. In the later bounded run, one Blob SDK metadata call and one content GET read the fixed-path archive; its 151,144,252 bytes matched the tracked SHA-256. The canonical installer succeeded; a separate binary preflight verified pinned x86-64 FFmpeg/ffprobe and their version lines. The unchanged 26-test suite passed 26/26 on Debian 12 Linux ARM64 with those x86-64 binaries emulated. This does not establish a native x86-64 application stack, hosted GitHub Actions, or the active Production revision/effective pathname. See the [Linux record](linux-ci-verification-2026-10-23.md), [FFmpeg investigation](ffmpeg-media-investigation-2026-10-23.md), and [pinned Linux evidence](pinned-ffmpeg-linux-evidence-2026-10-23.json). |
| Internal staff and reviewer-role outcomes | **Open.** The `5b1656b3` guided session is a partial human observation. Complete and record the remaining staff and role-played reviewer outcomes required by the Tier 2 strategy, including stop-event disposition. The nine mock scenarios are not nine required human sessions. If an internal task is intentionally deferred, record explicit owner risk acceptance. External recruitment and a fixed participant count are not prerequisites; first-time external usability remains an evidence gap. |
| Hosted target and rollback verification | **Open; requires separate authorization.** Verify the deployment and Dataverse target classification, authentication/domains, sender mailbox, materials availability, one read-only critical path, and a functional rollback path against the intended hosted environment. The recorded READY deployment is metadata only and has not been functionally verified. Use Mode C or D only if the needed behavior cannot be established in Mode A; Mode D is considered only when A–C cannot establish required behavior. A controlled-write rehearsal requires its own target, records, allowlists, expected-write/cleanup plan, and explicit authorization. |
| Release owner decision and operating controls | **Pending.** After reviewing the evidence above, the release owner must record the deliberate promotion decision and confirm the strategy §12 operating controls: backup operator/access, incident and health rules, and freeze window. Any unchecked item needs explicit owner risk acceptance. This checklist and the existing local evidence do not authorize a push, deployment, hosted test, or live write. |

The private Blob store identity and inventory remain **UNKNOWN** in their separate
investigation. They are not a release blocker unless an actual campaign-release
dependency is established. External first-time reviewer usability is likewise
unverified, with no external recruitment prerequisite under the current owner
direction. The full campaign-readiness checklist in strategy §12 still applies:
review its remaining operating controls and record explicit owner risk acceptance
for any other item left unchecked; this short list does not imply those items passed.
