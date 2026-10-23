---
title: Private Store and Release Preparation Receipt
domain: engineering-process
kind: audit
status: active
summary: "Local Ubuntu core checks passed with documented skips. Tested Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds differ on identical output bytes; exact Production artifact parity and three release decision groups remain open."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-23
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
  - docs/audits/internal-staff-rehearsal-observations-2026-10-22.md
  - docs/audits/historical-impact-concurrency-followup-2026-10-22.md
  - docs/audits/release-candidate-checklist-2026-10-22.md
  - docs/audits/release-candidate-lineage-2026-10-22.json
  - docs/audits/linux-ci-verification-2026-10-23.md
  - docs/audits/linux-ci-evidence-2026-10-23.json
  - docs/audits/ffmpeg-media-investigation-2026-10-23.md
  - docs/audits/ffmpeg-media-evidence-2026-10-23.json
  - docs/audits/blob-store-binding-evidence-2026-10-22.json
  - docs/audits/blob-retention-metadata-evidence-2026-10-22.json
---

# Private Store and Release Preparation Receipt

**Assessment date:** 2026-10-22 (America/Los_Angeles); rehearsal update 2026-10-22 (America/Los_Angeles).
**Status:** Fully gated candidate `81b8a063b` passed its recorded isolated Node 22/macOS checks: Turbopack build, browser suite, ESLint, 42 npm check gates, Jest coverage run, and selected PostgreSQL integration suites. Fixture candidate `9b2ec0060` passed its scoped build, 51-test browser suite, focused unit suites, scoped ESLint, diff check, and two headless CLI smoke runs. The assessed code candidate `eaa126028d7918c94340e75f1ea3213ad041f010` is a four-document descendant of `9b2ec0060`, with unchanged code/test and runtime/dependency trees; the `9b` scoped results therefore apply to the same code and test bytes through `eaa`. The reviewed comparison is recorded in [lineage evidence](release-candidate-lineage-2026-10-22.json). Candidate `94447672fe04a788b0e6aadb5deeb9d2fc85e82a` received local Ubuntu workflow-equivalent verification with core checks passed and documented Jest skips. Follow-up cross-decoder checks show different behavior between the tested Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds on the same encoded MP4 bytes. The initial Linux run retained one diagnostic; follow-up diagnostics reproduced all seven `audio_past_cut` failures. The exact pinned `9.0.2-23` private artifact and current Production pathname remain unverified; see the [Linux verification record](linux-ci-verification-2026-10-23.md) and [FFmpeg investigation](ffmpeg-media-investigation-2026-10-23.md). The guided human session remains the partial observation on candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638`. Three release-decision groups remain open as listed in the [release-candidate checklist](release-candidate-checklist-2026-10-22.md): disposition of internal staff/reviewer-role outcomes, authorized hosted-target and rollback verification, and the final owner promotion decision with strategy §12 operating controls. External first-time reviewer usability remains unverified and is not an external-recruitment prerequisite under current owner direction. Private Dataverse-export Blob store binding remains unknown as a separate investigation; no release dependency has been established.
**Fully gated candidate:** `81b8a063b`; **latest code/test candidate:** `9b2ec0060`; **assessed code candidate:** `eaa126028d7918c94340e75f1ea3213ad041f010`; **human observation candidate:** `5b1656b3dfad110fb5d23fc4fa2514d573e6a638`; application runtime checkpoint `4720980ed`. Earlier release evidence below includes candidate `c589cbb6e` (`codex/memory-audit-followups`) and remains scoped to that candidate.

This receipt records the evidence available for the local release candidate and
the private Dataverse-export Blob store question. It does not authorize or record
a push, deployment, production test, credential export or disclosure, live application data write, or live cleanup.
Evidence from earlier audits remains historical where indicated; it is linked
rather than recast as a result of this assessment.

In this receipt, “fully gated” refers only to the recorded local automated
checks. The `81b8a063b` results do not transfer to changed harness/test files in
later candidates. The `9b2ec0060` scoped test results apply through
`eaa126028d7918c94340e75f1ea3213ad041f010` because the intervening source-lineage
comparison found only four documentation changes. Human rehearsal, hosted
verification, and release authorization remain separate and incomplete. A
later local Ubuntu run provides workflow-equivalent core-check evidence with
documented skips. Follow-up tests show a behavior difference between the tested
Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds on the same encoded outputs,
while exact Production artifact parity remains unverified. The results do not
claim hosted GitHub Actions, amd64, or Production media evidence.

## Later fixture candidate `9b2ec0060`

**[VERIFIED via parent-reported isolated Node 22.23.4/macOS run]** The latest
fixture-only candidate passed its canonical Turbopack build, the full browser
suite (51/51, one invocation, no retries), three focused unit suites (40 tests),
scoped ESLint (exit 0), and `git diff --check` (exit 0). Sol's scoped source
review found no blocker. These results apply to candidate `9b2ec0060`; they do
not replace candidate `81b8a063b` as the candidate with the recorded full gate
set below. They do not establish Linux CI, hosted behavior, live data behavior,
or release authorization.

The browser run covers all nine declared local mock scenarios and the supported
Back → Workbench list → request-row navigation. The five fixture gaps recorded
from the 5b baseline have local mock resolutions: consistent pending-invitee
readback, shared portal/staff acceptance state, synthetic template rendering,
campaign POST/GET fixture persistence, and exact supported navigation plus
passive prefetch mocks. The earlier 5b blocked navigation path remains unknown;
the later prefetch test does not identify it. Synthetic templates use supported
placeholders, raw dates, and greeting text, not production-copy parity. Portal
token links cover Dr. Saved Reviewer only; preaccepted Dr. Accepted Reviewer has
no portal link. Locator/search navigation remains undeclared and fail-closed.
These are automation results and do not change the partial 5b human observations.

**Final local harness checks:** The committed `9b2ec0060` launcher passed
`baseline` and `reviewer-authoring` headless smoke runs with navigation status
200, respectively 16 and 3 mocked API calls, no blocked requests, and
`humanScenarioPassRecorded: false`. Both owned temporary workspaces were removed
and the launcher exited 0. These smoke receipts establish navigation and cleanup,
not scenario completion; the 51-test browser suite supplies the scenario evidence.
The preceding documentation follow-up passed 24 sequential documentation/safety
gates and self-tests. The consolidated receipt, checklist, and lineage evidence
also passed a fresh run of those 24 gates; its retained log is
`/private/tmp/wmkf-final-candidate-doc-gates.log`. No runtime code, environment,
deployment, or live system changed.

Private evidence retained on this host:

- Browser suite: `/private/tmp/wmkf-five-fixtures-browser-final.log`.
- Focused units and lint: `/private/tmp/wmkf-five-fixtures-final-static.log`;
  structured unit result: `/private/tmp/wmkf-five-fixtures-final-unit.json`.
- Documentation/safety gates: `/private/tmp/wmkf-five-fixtures-doc-gates.log`.
- Baseline launcher receipt: `/private/tmp/wmkf-reviewer-rehearsal-receipts/2026-10-23T05-00-32-542Z-b473ba89-119c-4550-a7f9-961d5aac5660.json`.
- Authoring launcher receipt: `/private/tmp/wmkf-reviewer-rehearsal-receipts/2026-10-23T05-02-27-238Z-a8cd2ee8-e4d1-4a0b-963a-64e50a292bdb.json`.

## Fully gated candidate and prior release evidence

**[VERIFIED via isolated Git archive comparison supplied for this receipt]**
The fully gated committed candidate is `81b8a063b`. It contains no
application runtime changes after runtime checkpoint `4720980ed`; its changes
since that checkpoint are documentation, test, and rehearsal preparation. The
earlier Jest evidence of 24,751 tests, configured type check, and prior build
results below were produced for `c589cbb6e`, not `81b8a063b`. The fully gated
candidate's full Jest coverage run is recorded separately below. The expanded
43/44 browser rehearsal and focused harness/fixture/CLI runs used precommit
rehearsal snapshots later committed in `81b8a063b`; its 44/44 run is recorded
separately below. Subsequent rehearsal observations use candidate
`5b1656b3dfad110fb5d23fc4fa2514d573e6a638` and do not inherit that full-gate result.

### Prior candidate `c589cbb6e`

**[VERIFIED via candidate repository comparison supplied for this receipt]** The
original runtime checkpoint was local commit `4720980ed`. Compared with `origin/main` at
`23d09e48235c1e5a7aea61e5f76715933d3701a1`, it is 28 commits ahead: 23 commits
from local main containing documentation, comments, or bootstrap-warning work,
plus five candidate commits (three documentation and two runtime). No migration,
migration-manifest, package/lock, Next.js, Vercel, or CI configuration changes
are in the candidate.

**[VERIFIED via isolated release workspace]** The candidate was exported to a
temporary directory with copy-on-write dependencies. It contains no `.env.local`
or inherited credentials; only the tracked `.env.example` is present. A Node-level
network guard rejects non-loopback connections, and telemetry is disabled; this
is not a comprehensive network sandbox for native build tools. The repository's
normal dependency tree and environment were not changed by this isolated setup.

| Evidence | Result | Limit |
|---|---|---|
| Initial Turbopack production build | Passed with the pre-existing install | That install had Next.js 16.3.8, Blob SDK 2.8.0, and Playwright 1.63.0, while the lockfile specifies 16.4.2, 2.8.2, and 1.64.1. This is not locked-dependency evidence. |
| Clean locked install | `npm ci --offline --ignore-scripts` passed in the isolated workspace; locked versions were confirmed | This confirms installability from the available cache, not runtime or deployment behavior. |
| Locked-dependency production build | Passed: canonical Turbopack build on Node 24.19.0, Next.js 16.4.2 | Migration-manifest bytes remained identical to candidate HEAD. This initial Node 24 result is supplemented by the Node 22/macOS verification below; Linux parity remains unverified. |
| Initial Node 24 Jest full run plus focused reruns | 1,431 distinct suites and 24,751 tests passed; 17 suites / 215 tests skipped | Initial full run had 38 failed suites: 30 from over-strict test interlock / mismatched auth origin, three from missing archive Git metadata, five from stale test contracts. All 38 passed together after fixture corrections and test repairs (631 tests). This is consolidated evidence, not a claim that the initial full invocation was green. |
| Initial Node 24 Mode A browser rehearsal | 36 tests passed with locked Playwright 1.64.1 and matching temporary Chromium | Node 24.19.0/macOS, route mocks, isolated credential-free app; sandbox Chromium launch was blocked, host rerun passed on port 3101. |
| Existing local test/type/gate checkpoint | Historical checkpoint reported as passing: 1,269 tests plus type and gate checks | This predates the clean locked install and is not the candidate's final verification. |
| Node version comparison | A temporary official Node 22.23.4 binary is now available; host installs remain untouched | Node 22 macOS verification below does not establish Linux CI or hosted-runtime parity. |

The candidate includes runtime repairs and is therefore held to the campaign
release controls in the [release strategy](../CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md).
Parent review and independent Sol review found no unresolved issue in the local
preparation changes. Five stale tests were repaired without runtime changes: guarded
identity upsert, enriched-person options, identity select fields, partial materials
availability, and required request binding. The private probe passed 11 mocked tests.
Sequential documentation/safety gates and available self-tests passed. The
targeted internal staff rehearsal and owner release decision remain separate
gates; neither is implied by passing automation.

## Prior Node 22 verification and human rehearsal preparation

**[VERIFIED via isolated candidate and official binary]** Prior candidate `c589cbb6e`
was exported separately with the lockfile-installed dependencies from the prior
clean offline install. The official Node.js `node-v22.23.4-darwin-arm64.tar.gz`
archive matched its published SHA-256
`c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428`.
The extracted binary reported `v22.23.4`. Download and extraction were confined to
temporary storage; no host runtime, repo dependencies, or environment files changed.

The canonical Turbopack production build and configured type check
(`tsc -p tsconfig.check.json`) passed under that binary. The package lock and
migration manifest remained byte-identical to the candidate. The full Jest run
passed in one invocation: 1,431 suites / 24,751 tests, 17 suites / 215 tests
skipped, and five snapshots passed. All 36 Playwright tests passed under Node 22
with locked Playwright 1.64.1 and matching Chromium revision 1248 on loopback
port 3102. Chromium ran outside the sandbox; the app remained credential-free
and guarded. This establishes macOS results, not Linux CI or hosted parity.
The Jest run emitted a nonblocking process-listener warning; it had zero failures.
The credential-free environment uses disposable local auth values and the same
Node-only outbound guard described above. Jest uses fixture origin port 3000 and
the normal test default for the Dataverse target interlock, while retaining DAL
enforcement and outbound protection; browser/build settings retain the interlock.
Temporary independent Git metadata supports Git-dependent fixtures without
writing to the source repository metadata.

## Guarded mock launcher and rehearsal fixtures

**[VERIFIED via source review and isolated Node 22 checks]** The headed mock
launcher now exports committed HEAD to private temporary storage, installs locked
dependencies offline without lifecycle scripts, and scrubs inherited credentials.
Its Node guard denies external connections; browser requests use a finite,
fail-closed route policy with explicit synthetic API and passive-resource mocks.
Normal staff authentication uses a throwaway synthetic session. Owned processes
and temporary files are cleaned up, with aggregate private receipts retained.
The Node guard is not a comprehensive native-process firewall.

The [controlled human rehearsal plan](controlled-reviewer-rehearsal-plan-2026-10-22.md)
and runbook name nine scenarios: baseline, lead-PD drift, three manual COI
outcomes, partial materials, saved Find exclusion, decline/reset, and reviewer
authoring. Source review corrected manual COI screening to occur at first invite,
partial materials to remain nonblocking, and submitted authoring to remain locked.
Current Stage 2b uses in-browser authoring; its former file-upload control is not
a missing rehearsal fixture. Internal staff observation is partial, not
complete; human rehearsal, hosted verification, and release authorization remain
separate gates. The later local Ubuntu core checks passed with skips. Follow-up
diagnostics reproduced all seven `audio_past_cut` failures under the tested
Linux FFmpeg 6.1.1 build; the same encoded outputs passed on the isolated macOS
FFmpeg 9.0.2 build. The pinned Production archive remains unverified, as
recorded in the [Linux verification record](linux-ci-verification-2026-10-23.md)
and [FFmpeg investigation](ffmpeg-media-investigation-2026-10-23.md).
The current owner direction uses internal
staff for staff and role-played reviewer tasks; external first-time usability
remains unverified, with no external recruitment prerequisite. See the
[guided observation record](internal-staff-rehearsal-observations-2026-10-22.md).

**[VERIFIED via isolated precommit rehearsal snapshots later committed in fully gated candidate `81b8a063b`]** The expanded browser run passed
43 of 44 tests; its one failure was an undefined schema import in the new authoring
test. After that correction and the submission-version assertion correction,
the authoring scenario passed, exercising autosave, reload, final submission,
and read-only return. This precommit snapshot evidence is not a single green
full-invocation result. Another 477 distinct existing service/component checks
passed for identity, manual COI, roster authorization, due dates, materials,
invitation sending, candidate state, and provenance selection. The three scoped
harness/fixture suites passed 35 tests, including rejected submission replay
and immutable submitted state. Scoped lint and 24 sequential documentation/safety
gates and self-tests passed on those precommit rehearsal snapshots.
Baseline and reviewer-authoring guarded CLI smoke reached their mock-backed pages
with HTTP 200 and zero blocked requests (16 and 3 mocked API calls respectively).
These CLI runs used the same precommit rehearsal snapshots; both private receipts
record navigation only, never human approval. The authoring readiness check was
corrected to use its portal heading because that page has no `main` element.
Owned temporary directories were removed after both successful runs.

**[VERIFIED via parent-reported isolated Git archive run on fully gated candidate `81b8a063b`]** The
complete 44-test browser rehearsal passed in one Node 22 invocation. This confirms
that candidate's browser fixture coverage. Playwright's `webServer` path
also completed the canonical Turbopack `next build` successfully on this candidate.
The run skipped the package `npm prebuild` step, so that package hook was not
verified by this invocation.

**[VERIFIED via fully gated candidate's isolated Node 22 checks]** Full ESLint exited
0 with zero errors and 163 warnings. The ten PostgreSQL integration suites from the CI job passed all 130 tests
in 11.731 seconds against the cached `postgres:16-alpine` image. They ran in an
owned scratch container on a random loopback port with a dummy connection URL;
the container was stopped and removed. Node ran on macOS and the database ran
in a Linux container, which is not Ubuntu CI.

**[VERIFIED via separate isolated checks on fully gated candidate `81b8a063b`]** All 42 npm check
gates and the available self-tests listed in `.github/workflows/test.yml`
passed sequentially, including the configured type check. Separately,
`npm run prebuild` passed the reviewer-reminder hold and migration-manifest
generation; the generated manifest bytes matched `81b8a063b`. These checks are
separate from the Playwright invocation, which did not run package prebuild.

**[VERIFIED via isolated Node 22 Jest coverage run on fully gated candidate `81b8a063b`]**
`npx jest --ci --coverage --watchAll=false --runInBand` exited 0 in 512.717
seconds: 1,433 suites, 24,784 tests, five snapshots passed; 17 suites / 215
tests were skipped. The run emitted a nonblocking `MaxListenersExceededWarning`.
The existing Jest configuration disables coverage thresholds, so this confirms
coverage-instrumented test execution, not threshold certification. The ten
opt-in PostgreSQL integration suites (130 tests) are reported separately above.

### Internal staff rehearsal: confirmation-dialog blocker

The first guided local baseline attempt on pre-repair candidate `345682e27` opened the invitation preview, but a
single Send click produced unreadable transient feedback and left it unchanged.
Source review traced this to the headed harness: the app requires
`window.confirm`, and Playwright dismisses dialogs without a listener. This
cancelled the action before the mocked send request. The launcher now registers
a headed-only context listener that leaves the native choice to the participant;
it does not automatically accept or dismiss. Smoke mode stays noninteractive. Parent isolated checks passed 35 focused
unit tests, scoped lint, and two Chromium dialog-contract tests using native CDP
events (not an additional Playwright dialog listener). The latter run used the
credential-free guarded copy; the shared E2E configuration still built/started
Next, while the test pages themselves used synthetic data URLs. Automated choices
prove pending/cancel/accept behavior, not visible human interaction.
The later guided follow-up on rehearsal candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638` observed OK for invitation mock send and both Cancel then OK for materials mock send. As a human observation, it does not include a participant choosing Cancel on invitation. The automated native-dialog contract now verifies cancellation behavior in isolation, without exercising the invitation UI. The [observation record](internal-staff-rehearsal-observations-2026-10-22.md) records the partial results; the interrupted pre-repair attempt was not a successful send or completed rehearsal.
The minimal synthetic preview also does not establish real invitation-copy or
Program Director clarity; its future fixture dates are not campaign evidence.

### Verification containment incident

**[VERIFIED via agent tool transcript and startup source]** One agent
mistakenly ran the new Playwright scenario directly in the main checkout,
without the required isolated environment or network preload. Next reported
loading `.env.local`, built, and started. Chromium was missing, so the test body
never ran. No stdout file or timestamped startup-result evidence was retained.
The root-checkout startup result was initially unknown; a later bounded,
read-only database observation checked for durable monitor changes.

**[VERIFIED via read-only Postgres observation at 2026-10-23 02:41:33Z]** The
observer ran `BEGIN READ ONLY` and confirmed `transaction_read_only` was on.
The database connection came from `.env.local`; no inherited `POSTGRES_URL`
was present, and no `.env.production` or `.env.production.local` files were
present. The four startup-related `system_alerts` categories showed no open
rows: migration-drift 55 total (latest created 2026-10-18 22:17:41.920564;
latest resolved 2026-10-19 00:50:35.057474), ahead 122 (latest created
2026-10-15 02:29:39.117011; latest resolved 2026-10-15 02:29:49.335504),
auth-bypass 2 (latest created 2026-09-22 02:21:05.028798; latest resolved
2026-09-22 02:21:14.083502), and tracker-missing 0. These alert timestamps
were read as raw `timestamp without time zone` values. The alert cutoff was
the literal `2026-10-22 00:00` without a timezone, with the database session
in GMT; no category had a creation or resolution at or after that cutoff.
Matching `operational_events` recovery/alert dedupe keys had two rows, zero
open, and no first-seen, last-seen, recorded, or status-changed activity since
`2026-10-22T00:00:00Z`. The latest matching event's **status change** was
`2026-10-19T00:50:35.082263Z`; this is not an event-occurrence timestamp.

This is **NO EVIDENCE OF DURABLE IMPACT in the checked alert and recovery-event
records for that window**. It does not establish that startup made no SQL write
attempts, that failed writes or effects outside these records did not occur, or
that an immutable audit captured every attempt. No email-triggering new alert
appears in the checked evidence; the mailbox was not independently checked.
No rollback, repair, or cleanup was performed. Subsequent parent verification
used credential-free isolated copies and the reviewed guard; their
missing-connection-string failures apply only to those isolated runs.

## Private Blob store investigation

**[VERIFIED via prior bounded account-metadata inspection, retained in the linked
evidence]** The account metadata exposed an unlinked export-store name candidate
with fingerprint `ffb75e44e30e` and cached count 2. A different store with
fingerprint `6060259031fd` is linked to the current project and matches the
locally configured public token, with cached count 347. These are metadata facts;
the name-only candidate does not establish the runtime DVX store or credential
binding.

**[VERIFIED via prior read-only prefix inventory]** The local public-token
inventory covered `reviewer-finder/`: 335 objects, 230,987,633 bytes, oldest
110 days, with 224 objects in the 90–179 day bucket. One SDK list invocation
was used. No content was fetched. The private store was not listed because the
local DVX credential was unavailable. There was no additional private listing
in this assessment; the earlier owner-authorized budget was at most 10 logical
list operations, of which the public inventory used one.

**[VERIFIED via inspected SDK authentication path]** Tokenless SDK resolution
checks project OIDC and `BLOB_STORE_ID` before the public Blob token. That order
does not prove that a maintenance invocation resolves to the intended private
store. Without an authorized credential-bearing runtime context, the effective
store identity and private object population remain **UNKNOWN**.

The private-only probe and its safeguards are prepared but have not been run
against a live store. Their intended bounds are: at most five SDK pages, zero
retries, a fixed private prefix, separate candidate/public-store guards, and an
aggregate-only receipt. No credential was available locally, no production
environment values were pulled or exported, and no private object was read,
listed, changed, or deleted. No retention decision follows from token expiry,
public inventory age, or cached whole-store counts.

The prior history remains in
[the historical impact and concurrency follow-up](historical-impact-concurrency-followup-2026-10-22.md),
including its earlier public inventory and private-credential limitation. The
machine-readable source records the public inventory and failed private listing
in [Blob retention evidence](blob-retention-metadata-evidence-2026-10-22.json)
and store metadata in [binding evidence](blob-store-binding-evidence-2026-10-22.json).
The credentials runbook has a corresponding tokenless-resolution clarification;
that documentation does not establish the runtime binding.

## Deployment metadata and rollback reference

**[VERIFIED via Vercel project/deployment metadata inspection]** The project
metadata identifies project `prj_56SJKzNer1aV38kKVoP8tl3X0lf3` in scope
`justin-gallivans-projects`. Its latest Production deployment reported READY is
`dpl_5S7ja8vpsdqNW2L6bk9AhXNrN8e6`, attached to commit
`23d09e48235c1e5a7aea61e5f76715933d3701a1`. The deployment metadata lists these
aliases: `reviews.wmkeck.org`, `grantees.wmkeck.org`,
`submissions.wmkeck.org`, and `applications.wmkeck.org`.

This deployment is a **rollback reference only**, not a verified functional
known-good: no hosted request, sign-in, application smoke, or Dataverse smoke
was performed. No alias change, rollback, or other deployment action was made.
If a later authorized promotion needs rollback, first verify the target
deployment and alias behavior, then restore the recorded deployment through the
approved Vercel procedure and reconcile any durable side effects. Code rollback
does not reverse data or email effects.

## Bounded action and evidence matrix

| Action | Status | Next evidence or boundary |
|---|---|---|
| Candidate source review | Fully gated candidate `81b8a063b` and fixture candidate `9b2ec0060` reviewed | Application runtime remains at `4720980ed`; the recorded human observation candidate `5b1656b3dfad110fb5d23fc4fa2514d573e6a638` is separate; hosted behavior remains unverified. |
| Latest fixture-candidate checks | Candidate `9b2ec0060` passed the recorded scoped checks | Isolated Node 22.23.4/macOS Turbopack build passed; 51/51 browser tests passed with no retries; three focused unit suites passed 40 tests; scoped ESLint and diff check exited 0. This is not the full gate set recorded for `81b8a063b`. |
| Local Ubuntu verification | Candidate `94447672f` passed configured core checks with skips; tested Linux FFmpeg 6.1.1 and macOS FFmpeg 9.0.2 builds differ on the same encoded outputs; exact Production artifact parity remains unknown | Build, 42 workflow check steps, coverage Jest (1,432 suites / 24,763 tests), and ten required PostgreSQL suites passed. Historical FFmpeg 6 suite: 19/26 with one initial `audio_past_cut` diagnostic; follow-up diagnostics reproduced all seven failures at that guard. Seven case outputs comprise four unique MP4 hashes. The isolated FFmpeg 9.0.2 host was not Linux and did not use pinned `9.0.2-23` bytes. Current private-object and Production-path checks were not performed. See the [Linux record](linux-ci-verification-2026-10-23.md) and [FFmpeg investigation](ffmpeg-media-investigation-2026-10-23.md). No hosted GitHub Actions or amd64 pass is claimed. |
| Clean locked install | Complete on prior candidate `c589cbb6e` | Completed offline in its isolated workspace. |
| Locked production build | Prior candidate `c589cbb6e` passed; fully gated candidate build passed | Prior build passed on Node 24.19.0 and Node 22.23.4/macOS. `81b8a063b` completed canonical Turbopack `next build` through Playwright `webServer`; that invocation skipped package `npm prebuild`, which passed separately with unchanged manifest bytes. |
| Full Jest coverage run | Fully gated candidate passed | Node 22: 1,433 suites / 24,784 tests, five snapshots; 17 suites / 215 tests skipped, 512.717 seconds. Jest coverage thresholds are disabled; opt-in PostgreSQL suites are separate. |
| Prior full Jest suite | Passed on prior candidate `c589cbb6e` | Node 22: 1,431 suites / 24,751 tests in one invocation; 17 suites / 215 tests skipped. Historical evidence, not evidence for fully gated `81b8a063b` or rehearsal `5b1656b3dfad110fb5d23fc4fa2514d573e6a638`. |
| Automated Mode A browser checks | Fully gated and later fixture candidates passed locally | `81b8a063b`: 44/44 browser tests passed in one Node 22 invocation. `9b2ec0060`: 51/51 passed in one Node 22.23.4/macOS invocation with no retries. Human rehearsal on `5b1656b3dfad110fb5d23fc4fa2514d573e6a638` is partial; hosted/live-data proof remains pending. |
| Full ESLint | Fully gated candidate passed | Exit 0, zero errors, 163 warnings. |
| PostgreSQL integration suites | Fully gated candidate passed in isolation | 10 opt-in suites / 130 tests passed in 11.731 seconds against cached `postgres:16-alpine` in a removed scratch container. Node was macOS; this does not establish Ubuntu CI. |
| 42 npm check gates and available self-tests | Fully gated candidate passed sequentially | Exact set listed in `.github/workflows/test.yml`, including configured types. |
| Package prebuild | Fully gated candidate passed separately | Reviewer-reminder hold and migration-manifest generation passed; generated manifest bytes matched `81b8a063b`. |
| Prior Node 22 verification | Complete on prior candidate `c589cbb6e` | Build, configured types, full Jest (1,431 suites / 24,751 tests), and its browser checks passed. |
| Private-store binding | Unknown; separate investigation | Requires a separately authorized credential-bearing context; metadata alone is insufficient. Not a release blocker without an established campaign-release dependency. |
| Private object inventory | Not run; separate investigation | Keep within the existing bounded authorization and prepared fixed-prefix safeguards. Not required for release absent an established dependency. |
| Internal staff rehearsal | Partial guided local-mock baseline on `5b1656b3dfad110fb5d23fc4fa2514d573e6a638` | In that historical 5b session, invitation preview/mock send, portal acknowledgement/acceptance/reload, and materials mock release UI were observed; assistant-driven campaign save and withdrawal readback were unverified/inconsistent. Assistant also exercised authoring UI, but it is not a human observation. Candidate `9b2ec0060` later passed all nine declared fixture scenarios automatically and repaired the campaign and withdrawal fixture readback; no new participant observation was made. See [observation record](internal-staff-rehearsal-observations-2026-10-22.md). No real email or live write; external usability remains unverified. |
| External first-time reviewer usability | Unverified | No external recruitment prerequisite under current owner direction; retain the usability evidence gap. |
| Release owner decision | Pending | Decide only after candidate checks, target evidence, and internal staff rehearsal evidence are concrete. |
| Push, deployment, intentional live mutation/cleanup | Not performed | No push/deploy or deliberate live action. The bounded read-only check found no evidence of durable impact in the checked alert/event records; its limits are documented above. |

## Exit conditions

Prior candidate `c589cbb6e` completed its recorded Node 22/macOS verification;
fully gated candidate `81b8a063b` passed its Turbopack build, 44-test browser
rehearsal, full ESLint, full Jest coverage run, selected PostgreSQL integration
suites, 42 listed npm check gates, package prebuild, and configured types on
isolated Node 22/macOS. Coverage thresholds are disabled in the Jest
configuration, so the coverage run does not certify threshold values. This is
not a release approval. The concrete remaining gates are listed in the
[release-candidate checklist](release-candidate-checklist-2026-10-22.md):
disposition of internal staff and reviewer-role outcomes, authorized hosted
target/rollback verification, and the release owner's promotion decision.
Local Ubuntu core-check evidence and the bounded decoder comparison are recorded
separately; neither is a hosted CI pass or exact Production artifact check.
External first-time reviewer usability is unverified and is not an
external-recruitment prerequisite under current owner direction.

Private-store identity and contents remain a separate evidence item. Do not mark
them verified until an authorized probe measures the intended private target.
This question is not a release blocker without an established dependency on the
private store. Any future live object or retention action requires its own
explicit scope and receipt.
