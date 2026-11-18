# Session 682 Prompt: Recover expertise roster migration on the home Mac

## Session 681 Summary — Codex, November 18, 2026

Owner parked this work until returning home. No implementation extension, live
writes, schema changes, production release, or cleanup occurred. Startup checks
passed all 72 gate/self-test runs. Owner authorized read-only production probes;
`DATAVERSE_ALLOW_PROD_READS=yes` was process-local, never written to an env file.

## Resume boundary

Owner: Codex. Branch: `codex/session-start-2026-11-18`.
Work-computer checkout: `/private/tmp/wmkf-codex-session-2026-11-18` (volatile).
Keep this handoff on this branch; another agent owns work in the shared checkout.
Do not merge the feature branch merely to carry documentation to main.

### Live evidence — November 18

[VERIFIED via `scripts/probe-expertise-migration-status.cjs`]

- Configured shared Neon database `neondb`: 39 active roster rows (26 Consultant,
  9 Board, 4 Research Program Staff), 10 Contact links, no duplicate names or links.
- No `expertise_roster_identity` or `expertise_roster_binding` tables. All seven
  consultant-feedback records still reference `expertise_roster`; one references
  excluded placeholder ID 35. No roster user triggers were present.
- Sandbox `orgd9e66399.crm.dynamics.com`: 46 profiles (38 legacy-key imports,
  5 app-key profiles, 3 direct-key profiles), 40 active and 6 inactive. All 38
  imported profiles match source names and preserved text fields exactly. Only
  source ID 35 is absent. No unsupported identity/name matching was used.
- Sandbox schema has three Active alternate keys, auditing and optimistic
  concurrency enabled. Latest profile modification: November 11. These reads do
  not prove full application integration, permissions, actor attribution or rollback.
- Production `wmkf.crm.dynamics.com`: exact `wmkf_expertiseprofile` metadata
  search returned empty; direct metadata and entity-set reads both returned 404.
  Production schema and shared-Postgres cutover have not been applied for this design.

Evidence: `docs/plans/evidence/expertise-migration-status-2026-11-18.json` and
`docs/plans/evidence/expertise-migration-status-production-2026-11-18.json`.
The November 9 handoff's no-real-import statement is superseded for sandbox by
these live observations; retain its decisions and safeguards as dated context.

### Recovery finding

[VERIFIED via Git source and remote lookup] The parked integration branch
`origin/codex/executive-summary-generation-2026-11-16`, in
`docs/plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md`, names roster commit
`a29c30826`, `roster-match-contract.js`, and
`docs/plans/data/expertise-roster/POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md`.
That commit is absent from this work Mac's object store; GitHub commit lookup
returned 422. Current remote roster refs stop at `e90babb2a` (November 10).
Searches of local code/worktree paths found no recovered implementation.
Owner believes the newer work is on the home Mac; this remains unverified.

### Commits

- `d04be4eec`: read-only probe and sanitized sandbox/shared-Postgres evidence.
- `b86d02579`: explicit production absence checks and production evidence.

## Next Items

### Parked — owner-directed home-machine resume

1. Inspect the home Mac's worktrees and Git history for `a29c30826` and the newer
   importer, numeric identity bridge, matching contract, and rehearsal receipts.
   Preserve dirty files, ignored private artifacts, existing branch tips and all
   local-only commits. Push the recovered branch before reuse or disposal.
2. Fetch this handoff branch without overwriting the recovered branch. Compare the
   recovered implementation with `e90babb2a` and current main; inventory what is
   built/tested before deciding what to implement. Do not silently rebuild from
   the older checkpoint or treat the sandbox census as full rehearsal evidence.
3. Resume implementation and isolated end-to-end/rollback rehearsal. Owner agreed
   to preparation; production writes and release remain a separate approval after
   a concrete reviewed result. Match-prompt/eligibility approval and deployment
   admission/drain remain prerequisites in the saved migration plan, subject to
   reconciliation with the recovered November 11 owner decisions and code.

### Verify Before Acting

- Re-probe targets and current source before migration. Production and sandbox
  Contact/User GUIDs are target-specific. Never copy sandbox bindings/allocations
  into shared Production Postgres. Never modify main `.env.local`.
- Preserve old roster/match history and placeholder feedback identity. No deletion,
  table retirement, fixture cleanup or production promotion is authorized here.
- Prior non-roster handoff, unresolved intake owner decisions and concurrent-stream
  boundaries: `git show 1b4519319:SESSION_PROMPT.md` (verified retrievable). Those
  are dated carryover, not current permission or a newly verified worklist.

## Verification and lifecycle

Probe ran successfully against shared Postgres, sandbox and Production, with
read-only Postgres transactions and Dataverse GETs. Syntax, diff, secret scan and
its self-test passed; scaffolding gate/self-test passed during probe preparation.
No new production capability shipped; no DEVELOPMENT_LOG milestone entry required.
CLAUDE.md unchanged. Claim-evidence report was unavailable because local state could
not be read; no observation row invented.
