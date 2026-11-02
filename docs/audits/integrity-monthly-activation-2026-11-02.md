# Integrity monthly refresh activation — 2026-11-02

Owner explicitly requested activation after verified first publication. Source configuration adds only `/api/cron/refresh-retractions` at `0 6 1 * *` (the 1st of each month, 06:00 UTC). Deployment/live cron verification passed; current result is below. The verified initial corpus has 73,521 records and generation 1; audit 282049 completed. No manual refresh is needed for scheduling.

Contract: Vercel scheduler supplies existing CRON_SECRET bearer authentication; the route requires Production plus RETRACTION_REFRESH_ENABLED=on. The reviewed service validates the complete source, uses an advisory-locked atomic corpus/metadata transaction, retains the two reviewed records with provenance, and records maintenance audit/alerts. It changes global reference data, never runs applicant screening or sends emails. Concurrent workers return busy; unchanged source and manifest only advance last_checked_at, preserving generation. No runtime code or credentials change.

Invariants: preserve every preexisting schedule and the reviewer-reminders hold; add exactly one monthly entry; pin the precise expression in the cron census; verify publication metadata and enablement before promotion; use OAuth-only read-only Fable review; require all relevant release checks and verify the deployed registry. Rollback is a separate commit removing this schedule; reverting the schedule does not undo already published data.

Local verification: all 18 cron-census tests passed; reviewer-reminder hold gate and self-test passed. Fable review and CI/deployment receipts are recorded below.

## Read-only Fable review

Host OAuth status: claude.ai Team subscription; API/provider keys excluded from child environment. Model claude-fable-5-1, 29 turns, no permission denials; Read/Grep/Glob only, no MCP servers. Verdict **READY TO ACTIVATE**, no P0/P1. P2 stale Atlas/route wording corrected; the activation receipt exists and configuration/test changes are committed together. The review is reproduced below with its cron-only census wording clarified.

**Verdict: READY TO ACTIVATE.** No P0 or P1 found from source. Two readback obligations remain before activation is complete, plus P2 doc drift. No edits were made and no tools beyond reads were used. The plan file could not be written because Write is disabled in this session, so this message is the deliverable.

**Trace, all verified via source**

- **Authorization.** The route compares the bearer header against the cron secret with a constant-time check, returns 503 when unset and 401 on mismatch, and has no development bypass. It also requires production for both environment variables and the literal `on` flag. The same bearer contract is used by all 30 other scheduled cron routes through `lib/utils/cron-auth.js`, so the scheduler-to-route link is already load-bearing in production.
- **Schedule.** The vercel.json entry is a GET with no query, so `dryRun` is undefined and the service runs a real publish. Duration ceiling stays 300 seconds in both vercel.json and route config, against a 240-second service budget.
- **Census.** The test pins the cron-only route census, 33 entries, 32 unique paths, the exact refresh-retractions pin, and scheduled-set equality. Reviewer reminders and site-visit reminders remain unscheduled, and neither path appears in vercel.json, so the incident hold is preserved.
- **Atomic write.** One transaction holds an advisory lock, stages via TEMP COPY, does a keyed upsert and delete, then upserts the generation row. A single COMMIT publishes corpus and metadata together. Guards refuse header changes, width mismatches, a row drop over 10 percent, removals with foreign-key references, and derived drift on unchanged bytes.
- **Audit and consumer.** A maintenance row opens before download and closes after commit. Audit failure after commit reports `auditRecorded=false` and raises a cron-failure alert. The screening service reads the dataset before and after corpus queries and clears provisional matches if the generation changed mid-screen. The worker touches no screens, histories, or emails.

**Partial success and idempotence**

- Unchanged bytes with the same manifest only advance the last-checked timestamp, with no generation bump. Re-runs are safe.
- A concurrent run returns busy with a 202 and `success: false`, and no double publish.
- A lost COMMIT acknowledgement reports publication as uncertain and alerts. Vercel cron does not retry, so an operator reads metadata before any retry.
- Expected and non-blocking: a screen in flight at 06:00 UTC on the 1st gets its Retraction Watch matches cleared with a rerun prompt. A normalizer change with unchanged bytes refuses publication and alerts. A success does not auto-resolve a prior failure alert because the keys differ.

**Verification obligations before calling it activated**

1. [ASSUMED per your statement] The other 30 cron expressions are unchanged. The census pins counts and three exact entries, not every expression. Confirm the diff against main for vercel.json shows only the one added entry.
2. After merge and deploy: Ready production deployment contains the entry, the inspectable cron registry shows the path at `0 6 1 * *`, and the flag is still literal `on`. First run is 2026-12-01 06:00 UTC. Expect generation 2 with a completed refresh audit row, or an unchanged run, and no refresh alert.

**P2 documentation drift, not fixed**

- `docs/atlas/postgres-retraction-dataset.md:23` says vercel.json sets only a duration ceiling and not a schedule, in the same paragraph that says the schedule is source-configured.
- `docs/atlas/postgres-infra-tables.md:232` still says manual-only and that no production publication was run.
- `docs/guides/RETRACTION_WATCH_REFRESH.md:31` cites an activation receipt that does not yet exist in the audits folder.
- The route header comment says no schedule is registered. Cosmetic once this lands.
- The guide, Atlas, and security matrix already claim the schedule is source-configured while the two config files are uncommitted. Commit both working-tree files together so docs never merge ahead of the config.

Production schedule is not live yet. Final activation depends on the merge, the deployment, and the registry readback above.

Controller disposition: exact vercel.json diff against main contains only the single added monthly entry. Deployment/registry/flag readback remains required.

## Verified production activation

[VERIFIED via PR #605, all release checks and direct Vercel/database readback, 2026-11-02] PR #605 merged at 21:03:48 UTC as c7f6b4370acb2adf04380e7e7c2bd07e4b9169eb. Exact reviewed head 7ba52449962bbeaec9e82b501fb71016ddda89d6 passed every check, including Tests workflow 41523723606 (full application suite and PostgreSQL-16 integration). The config diff preserves every prior schedule and setting and adds exactly the intended entry. Fable returned READY TO ACTIVATE; its P2 documentation corrections are included.

Production deployment dpl_HgFkJLkH88aeuLTJV8qh1RjPa92N is READY at that merge SHA; applications.wmkeck.org resolves to the same production deployment. The live inspectable cron registry contains exactly one /api/cron/refresh-retractions entry at **0 6 1 * ***. Production RETRACTION_REFRESH_ENABLED is literal on; the existing bearer credential is unchanged. No secret values are recorded here.

Independent read-only database checks pass: 73,521 records, singleton generation 1, exact approved source checksum, source count 73,519, both retained provenance entries and stable primary keys, and completed initial publication audit 282049. Full-row hash remains bdb7e1cce9ff5da5e8fae3395101000335a64ccd5b0b94a55239ef5db2189bea. No manual refresh, new publication, provider-backed screening or email was invoked during activation.

**Active cadence:** the 1st of each month at 06:00 UTC. **Next run:** December 1, 2026 at 06:00 UTC, equivalent to November 30 at 10:00 p.m. Pacific Standard Time. First actual scheduled execution is future and has not been observed; its maintenance audit will distinguish publication, unchanged source, busy or failure. The prior schedule-off checkpoints remain historical. Dirty unrelated main-checkout work was preserved.
