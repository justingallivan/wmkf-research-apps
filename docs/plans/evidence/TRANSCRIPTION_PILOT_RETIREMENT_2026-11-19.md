# Standalone transcription pilot retirement — 2026-11-19

Owner: Codex. Authorization: retire the standalone interface after inspecting the
isolated pilot; preserve the shared transcription engine and Meeting Tracker.

## Historical initial preservation inventory (read-only live check)

- Vercel project `wmkf-transcription-pilot-isolated`, ID
  `prj_v2aETCFqGBeqMshR7xoMpTcP9K2e`, is separate and has no Git connection.
  `vercel project inspect` and `vercel inspect` verified its READY Production
  deployment `dpl_EtKyWuWqTHXuXGQNUGUhTQGFrBhY` (October 1).
- Authenticated owner-scoped browser review showed one October 1 recording,
  status **Expired**. Content is inaccessible. Cleanup was requested October 8;
  local cleanup was **pending**; provider cleanup is recorded confirmed October 1.
  This does not prove physical erasure or inventory records owned by other users.
- No evaluation receipt expiry was available in the page. The aggregate CSV link
  was blocked by Chrome (`ERR_BLOCKED_BY_CLIENT`); no successful export is claimed.
- The local read-only SQL probe stopped at `local_environment_preflight_failed`,
  before connecting. Vercel Production secret values are not exportable; the env
  pull returned placeholders. This initial check obtained no database-wide or private Blob inventory.
- Preserve the database, private Blob store, provider-deletion receipts, exact-path
  cleanup records, and operational APIs. Do not resurrect expired content or
  interpret the expired UI as proof that storage is empty. At this initial checkpoint no data was deleted,
  retention changed, provider request submitted, or migration executed.

## Authorized expired-recording cleanup — November 19 PT / November 20 UTC

**[VERIFIED via authenticated Neon Console SSO, Vercel Blob CLI/UI and application GET]**
After the owner separately authorized cleanup, the isolated `neondb` database
(project `bitter-thunder-54054042`, branch `br-late-morning-b746i4yt`) showed
exactly one `transcription_jobs` row: expired, version 130. Content/reference
purges were already recorded at `2026-11-20T03:00:34.284Z`, receipt purge on
November 1 and provider confirmation on October 1. Only the stale input-cleanup
pathname remained. The dedicated `wmkf-transcription-pilot` Blob store
(`store_Qri02A1kj96tQYR9`) was empty: zero objects and zero bytes, independently
read through `vercel blob list-stores --all --json` and authenticated store UI.

The older isolated `finishLocalCleanup` retains the input pointer while
`upload_valid_until` is non-null. The authorized SQL repair was scoped to the
exact row and expected pathname, with a version-130 compare-and-swap and guards
requiring expired status, an upload window closed for more than five minutes,
an expired lease, all other paths/pointers null, completed content/receipt/reference
purges and provider confirmation, no provider conflict, and null upload-reference
ciphertext. It cleared only the stale input-cleanup pathname, upload-validity
value and expired lease, set local-completion/updated timestamps, and incremented
the version. Exactly one row returned version 131 with local completion at
`2026-11-20T04:08:55.550532Z`.

Authenticated `/api/admin/transcription-pilot/jobs` readback confirmed version 131,
the completion timestamp, `cleanupPending:false` and `providerCleanupPending:false`.
No content deletion was necessary because the store was already empty. The audit
row and infrastructure remain; no shared application, Meeting Tracker, engine,
schema, environment or storage-resource configuration changed. This receipt does
not establish independent physical erasure at the provider. Successful evaluation export
remains unverified. Runtime rollback does not undo this deliberate cleanup repair.

## Interface change and invariants

| Invariant | Implementation / evidence |
|---|---|
| Admin no longer advertises the pilot | Remove only its separate navigation link; navigation regression test |
| Bookmarks cannot open the old evaluation/upload workflow | Static retirement notice at the existing page; no pilot imports or requests |
| Meeting Tracker retains transcription | No change to its page, routes, services, controls, publication, or recording imports |
| Shared engine and cleanup remain available | No change to `lib/services/transcription-pilot`, callbacks, cron, Workflow, schemas, or schedules |
| Existing records remain inspectable operationally | Retain owner/superuser-protected pilot APIs and their existing expiry/authorization contracts |
| Isolated schema remains compatible | Build from deployed source `dffe18ba9`, with the retirement page/test and identical dedicated manifest copied to root for packaging, not current main |

The shared engine includes provider submission and reconciliation, job/lease
storage, private audio handling, transcript formatting and speaker overlays,
Workflow dispatch, callbacks, recovery and cleanup. Meeting Tracker's request-bound
entry points use its own enablement policy. The pilot's historical directory name
is not evidence that those capabilities are unused.

No new persistence or async client workflow is introduced. Partial success,
helper extraction, and new status fan-out are N/A. Ordinary Layout behavior is
retained; the page test's mocked Layout proves absence of **pilot** requests only.

## Release boundary

**[VERIFIED via GitHub checks, Vercel API and signed-in Production browser, 2026-11-19]**
Shared [PR #653](https://github.com/justingallivan/wmkf-research-apps/pull/653)
merged as `b869fdf85a748f996a4be9e7bcf45b263f344d58` after all required checks
passed. Main CI passed 1,567 suites / 28,259 tests (27 suites / 335 tests skipped);
the separate Postgres run passed 15 suites / 189 tests. Deployment
`dpl_4RSLecBGLRxNK2fxkmrLbNSjAVyY` is READY; its `githubCommitSha` matches that
merge and its alias includes `applications.wmkeck.org`.

Signed-in Production smoke verified Admin's six workspaces without the pilot
link, the retirement notice at `/admin/transcription-pilot`, and Meeting Tracker's
Research December 2026 view with nine request cards. No live transcription or
provider submission was attempted; this proves interface retirement and Tracker
loading, not a fresh end-to-end transcription run. The preceding main deployment
`wmkfresearchapps-aijusg8vp-justin-gallivans-projects.vercel.app` (PR #652 docs
receipt) remains the runtime rollback target; rollback retains data. Shared and
isolated releases were verified separately.

**[VERIFIED via deployment/project API readback and signed-in browser, 2026-11-19]**
Isolated deployment `dpl_4cujwwr6uiVd4gyu8vSzpNS5gWdw` is READY and promoted.
Source `1b8f51787` retains the October runtime (`dffe18ba9`), adds the retirement
page and matching test, and copies the existing dedicated manifest to root
`vercel.json` for packaging. Both deployment and post-promotion project readback
show exactly daily `/api/cron/drain-transcriptions` (`0 3 * * *`) and hourly
`/api/cron/drain-transcriptions?recovery=1` (`0 * * * *`). Browser reload showed
“Transcription Pilot has been retired”; anonymous access redirected to sign-in
(307), and the isolated staged `/meeting-tracker` remained 404. Meeting Tracker
continues to belong to the main suite. The isolated page test passed.

The first candidate `dpl_7T8pr4tkSVdfyKmYnE4CPNUCBKMF` was rolled back after
project API readback exposed suite-wide crons despite the CLI local-config
argument. Rollback restored the exact two schedules before the corrected root
manifest was packaged and the final deployment promoted. The correction changes
packaging, not the intended schedules. No shared engine, API, schema, environment
or retention changes were made. Identity allowlisting and authentication remain.
Rollback remains the preceding deployment for each project; no data writes need
reversing.

**[VERIFIED via Vercel CLI, public probe and deployment inspection, 2026-11-19]**
The legacy `wmkf-transcription-pilot.vercel.app` alias was removed; its public
pilot path now returns 404. Its former target, shared Preview
`dpl_3pBYPpEuVS9pjJCKRPt2cNuyZyx6`, remains READY and its data are untouched.
Alias removal is reversible by assigning it to
`wmkfresearchapps-ph2tdnosx-justin-gallivans-projects.vercel.app`.

Independent read-only review found no runtime blocker in the UI-only change.
The subsequent authorized cleanup above resolved the local pending state and
completed the isolated job/Blob inventory. It does not authorize deleting
infrastructure or the retained audit row.

## Bounded documentation reconciliation

Mode A: interface retirement, November isolated-record availability and authorized cleanup completion only.
The Atlas, pilot plan and runbook now separate current disposition from the
historical October ready-transcript/UI acceptance records. Protected API and
cleanup contracts remain current. The historical UX audit and dated review
receipts are unchanged. Broader shared-engine architecture and unrelated schema
claims were excluded.

The Service & Utility Catalog and API route matrix reconcile the same pilot
availability/UI restatements. This is a bounded fact reconciliation, not a
whole-repository or shared-engine audit. The isolated job-table and dedicated Blob
inventories are verified above; no broader database-table inventory is claimed.
Evaluation-export availability and independent provider physical erasure remain
unverified. Empty Blob storage does not authorize infrastructure deletion.
