# Standalone transcription pilot retirement — 2026-11-19

Owner: Codex. Authorization: retire the standalone interface after inspecting the
isolated pilot; preserve the shared transcription engine and Meeting Tracker.

## Preservation inventory (read-only live check)

- Vercel project `wmkf-transcription-pilot-isolated`, ID
  `prj_v2aETCFqGBeqMshR7xoMpTcP9K2e`, is separate and has no Git connection.
  `vercel project inspect` and `vercel inspect` verified its READY Production
  deployment `dpl_EtKyWuWqTHXuXGQNUGUhTQGFrBhY` (October 1).
- Authenticated owner-scoped browser review showed one October 1 recording,
  status **Expired**. Content is inaccessible. Cleanup was requested October 8;
  local cleanup is **pending**; provider cleanup is recorded confirmed October 1.
  This does not prove physical erasure or inventory records owned by other users.
- No evaluation receipt expiry was available in the page. The aggregate CSV link
  was blocked by Chrome (`ERR_BLOCKED_BY_CLIENT`); no successful export is claimed.
- The local read-only SQL probe stopped at `local_environment_preflight_failed`,
  before connecting. Vercel Production secret values are not exportable; the env
  pull returned placeholders. No database-wide or private Blob inventory is claimed.
- Preserve the database, private Blob store, provider-deletion receipts, exact-path
  cleanup records, and operational APIs. Do not resurrect expired content or
  interpret the expired UI as proof that storage is empty. No data was deleted,
  retention changed, provider request submitted, or migration executed.

## Interface change and invariants

| Invariant | Implementation / evidence |
|---|---|
| Admin no longer advertises the pilot | Remove only its separate navigation link; navigation regression test |
| Bookmarks cannot open the old evaluation/upload workflow | Static retirement notice at the existing page; no pilot imports or requests |
| Meeting Tracker retains transcription | No change to its page, routes, services, controls, publication, or recording imports |
| Shared engine and cleanup remain available | No change to `lib/services/transcription-pilot`, callbacks, cron, Workflow, schemas, or schedules |
| Existing records remain inspectable operationally | Retain owner/superuser-protected pilot APIs and their existing expiry/authorization contracts |
| Isolated schema remains compatible | Prepare its page-only patch from deployed source `dffe18ba9`, not current main |

The shared engine includes provider submission and reconciliation, job/lease
storage, private audio handling, transcript formatting and speaker overlays,
Workflow dispatch, callbacks, recovery and cleanup. Meeting Tracker's request-bound
entry points use its own enablement policy. The pilot's historical directory name
is not evidence that those capabilities are unused.

No new persistence or async client workflow is introduced. Partial success,
helper extraction, and new status fan-out are N/A. Ordinary Layout behavior is
retained; the page test's mocked Layout proves absence of **pilot** requests only.

## Release boundary

Source changes are not evidence of a production release. The shared application
and isolated project require separate promotion and post-release verification.
The isolated project must retain its dedicated manifest, identity allowlist,
authentication, existing environment, and cleanup schedules. Its deployment must
be built from the October source with the page-only patch to avoid migrating its
runtime/database implicitly. Rollback is the preceding deployment for each project;
there are no data writes to reverse.

Independent read-only review found no runtime blocker in the UI-only change.
The unresolved local cleanup and incomplete data inventory remain operational
follow-ups; they do not authorize deleting infrastructure or records.
