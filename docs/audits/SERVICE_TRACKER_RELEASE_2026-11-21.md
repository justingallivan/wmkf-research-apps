# External service tracker production release — November 21, 2026

[VERIFIED] PR [#668](https://github.com/justingallivan/wmkf-research-apps/pull/668) merged as `b7521a287133e7e5603f87846f77a7c43ebd8194` after all PR checks passed. Vercel deployment `dpl_FoyYfjH4Cyz3DkdqW4ymAKUNPMAe` reached Ready and received the production aliases, including `applications.wmkeck.org` and `wmkfresearch.vercel.app`.

## Delivered

Admin → Operations → External services maintains the private service inventory, review schedules, and editable dated decisions. The seed has 26 services and the completed AssemblyAI review. Microsoft, GitHub, and Zoom are excluded from cost review under corporate contracts. The tracker makes no provider calls or configuration changes and reprocesses no recordings.

## Evidence

- Claude Opus reviewed the final runtime patch through the owner's OAuth subscription and returned READY; no API-key review or Ultrareview was used. Two optional test-coverage suggestions were nonblocking.
- Rebased branch: 78 focused tests passed. CI: 28,364 tests passed (346 skipped), plus 200 PostgreSQL integration tests across 16 suites. Production build, type checks, repository gates, and security checks passed.
- Existing local credentials matched the documented production database target; no production credentials were downloaded or displayed. The canonical `scripts/apply-migrations.js` applied exactly 106 and 107: two applied, 102 skipped. Post-deployment read-only probe found both tables, 26 services, one review, and no pending migrations.
- Initial release guard refused before writes because the tracker already contained `097_shared_prompt_jobs.sql`, absent from main. Source at `cc9e2d2a4` established this as the separate parked Executor trial migration. The release guard explicitly preserved that known tracker entry and still required exactly 106–107 pending. No Executor data or tracker row was changed.
- Production API without a session returned HTTP 307 to sign-in with `Cache-Control: no-store, max-age=0`. Available browser also showed sign-in. Authenticated superuser read/save/reload is not claimed.
- A bounded Vercel query for errors on `/api/admin/external-services` in this deployment returned zero records through 20:58:51 UTC. This is a short post-release observation, not authenticated route execution or sustained monitoring proof.
- Rollback deployment: `dpl_7JVe7ZV3PV7KztRB7XK21LXbJHAs` (`wmkfresearchapps-e81ps1iuc-justin-gallivans-projects.vercel.app`). Rolling back code must retain the additive tables and any operator records; code rollback is not data rollback.

## Scoped changed-fact reconciliation

Sweep Mode A: tracker deployment and schema state only. Source → migration/store → guarded route → Admin consumer is documented in the [Atlas](../atlas/postgres-external-services.md). Production evidence above supersedes the branch-only statements in that page, the Atlas index, and the route-security matrix. Service catalog statements already agree; the earlier AssemblyAI review remains a historical statement about what that review itself introduced. No current tracker-not-deployed claim remains in these surfaces. The seed is a repository-based inventory, not verified account usage. Authenticated hosted save/reload and quality observation on the next natural transcription remain open.
