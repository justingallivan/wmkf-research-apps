# Integrity monthly refresh activation — 2026-11-02

Owner explicitly requested activation after verified first publication. Source configuration adds only `/api/cron/refresh-retractions` at `0 6 1 * *` (the 1st of each month, 06:00 UTC). Deployment/live cron verification is pending. The verified initial corpus has 73,521 records and generation 1; audit 282049 completed. No manual refresh is needed for scheduling.

Contract: Vercel scheduler supplies existing CRON_SECRET bearer authentication; the route requires Production plus RETRACTION_REFRESH_ENABLED=on. The reviewed service validates the complete source, uses an advisory-locked atomic corpus/metadata transaction, retains the two reviewed records with provenance, and records maintenance audit/alerts. It changes global reference data, never runs applicant screening or sends emails. Concurrent workers return busy; unchanged source and manifest only advance last_checked_at, preserving generation. No runtime code or credentials change.

Invariants: preserve every preexisting schedule and the reviewer-reminders hold; add exactly one monthly entry; pin the precise expression in the cron census; verify publication metadata and enablement before promotion; use OAuth-only read-only Fable review; require all relevant release checks and verify the deployed registry. Rollback is a separate commit removing this schedule; reverting the schedule does not undo already published data.

Local verification: all 18 cron-census tests passed; reviewer-reminder hold gate and self-test passed. Fable review and CI/deployment receipts will be recorded here when available.
