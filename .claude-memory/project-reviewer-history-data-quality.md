---
name: Reviewer lifecycle counts — historical data quality
description: Pre-J26 proposals have incomplete invited/accepted/declined data; only J26+ where staff used the tools is reliable
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
---
**Reality:** Reviewer lifecycle counts shown in `/reviewer-finder` (invited / accepted / declined) come from **Dataverse `wmkf_appreviewersuggestion`** (post-W3-W6 cutover 2026-05-12) — backfilled from the historical Postgres `reviewer_suggestions` table where data existed. That data only starts being populated when staff used the tool to save candidates — which began in **J26** for the Foundation, and not all staff used it that cycle either. The data-quality caveat below is unchanged by the storage migration; it's about adoption history, not where the rows live now.

**What this means:**
- **Pre-J26 proposals** (J25, J24, …) have no rows from the tool — picker falls back to slot population from `wmkf_potentialreviewer1..5`. Shows "5 invited" honestly but no accept/decline breakdown.
- **J26 mixed adoption** — some PDs used the tool, others didn't; their proposals will show 0 invited even when reviews actually happened.
- **D26 onward** is expected to be reliable as adoption stabilizes and the Dataverse-native entry path encourages tool use.

**Don't:**
- Treat pre-J26 zeros as "no reviewers were invited" — it just means we don't know.
- Build alerts/triage on accept rates without filtering to J26+ cycles.

**Do:**
- Trust counts on J26+ proposals where the row exists.
- The W3-W6 backfill migrated historical Postgres rows into `wmkf_appreviewersuggestion` without inventing missing data; pre-J26 gaps remain gaps. Postgres `reviewer_suggestions` is drain-only.
