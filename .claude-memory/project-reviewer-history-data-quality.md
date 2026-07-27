---
name: Reviewer lifecycle counts — historical data quality
description: Pre-J26 proposals have incomplete invited/accepted/declined data; only J26+ where staff used the tools is reliable
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
status: active
scope: reviewer
last_verified: 2026-07-12 — migration 018 (DROP reviewer_suggestions + drain tables, 337 rows backed up first) confirmed present in lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql, verified 2026-06-04/S219; the pre-J26 adoption-history caveat is organizational and unchanged
---

## Recall Rule

Read this when: interpreting or building on reviewer invited/accepted/declined counts.

Do:
- Trust counts only on J26+ proposals where the ledger row exists.
- Filter to J26+ cycles before building alerts/triage on accept rates.
- Treat pre-J26 zeros as "unknown", not "no reviewers invited".

Do not:
- Read pre-J26 zeros (or J26 mixed-adoption zeros) as real zero invitations.
- Assume the W3–W6 backfill invented missing history — pre-J26 gaps remain gaps.

Ground truth: Dataverse `wmkf_appreviewersuggestion` (backfilled from the Postgres `reviewer_suggestions` table, which was DROPPED 2026-06-04 via migration 018 after backfill), `wmkf_potentialreviewer1..5` slot fallback.

[VERIFIED 2026-07-27 via
`lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`,
`docs/atlas/dataverse-wmkf-appreviewersuggestion.md`, and current proposal
reader fallback source]. The adoption-history caveat is organizational evidence;
cycle reliability must be re-measured before analytics use.

**Reality:** Current Workbench counts and retained legacy readers source
invited/accepted/declined state from **Dataverse
`wmkf_appreviewersuggestion`**. The W3–W6 cutover backfilled historical
Postgres data where it existed. That data begins when staff used the tool to
save candidates (J26, with mixed adoption), so the caveat is about adoption
history, not current storage.

**What this means:**
- **Pre-J26 proposals** (J25, J24, …) have no rows from the tool — picker falls back to slot population from `wmkf_potentialreviewer1..5`. Shows "5 invited" honestly but no accept/decline breakdown.
- **J26 mixed adoption** — some PDs used the tool, others didn't; their proposals will show 0 invited even when reviews actually happened.
- **D26 onward** is expected to be reliable as adoption stabilizes and the Dataverse-native entry path encourages tool use.

**Don't:**
- Treat pre-J26 zeros as "no reviewers were invited" — it just means we don't know.
- Build alerts/triage on accept rates without filtering to J26+ cycles.

**Do:**
- Trust counts on J26+ proposals where the row exists.
- The W3-W6 backfill migrated historical Postgres rows into `wmkf_appreviewersuggestion` without inventing missing data; pre-J26 gaps remain gaps. The source Postgres `reviewer_suggestions` table was DROPPED 2026-06-04 (migration 018); Dataverse is the sole store.
