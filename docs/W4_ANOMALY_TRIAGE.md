---
title: "W4 Anomaly Triage — `reviewer_suggestions` PG↔DV"
domain: dataverse
kind: history
status: active
summary: "Parity script: scripts/backfill-reviewer-suggestions-parity.js Rerun timestamp: 2026-05-12T22:02:01Z (this session)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/backfill-reviewer-suggestions-parity.js
  - scripts/backfill-reviewer-suggestions-to-dataverse.js
  - scripts/reconcile-reviewer-migration.js
---

# W4 Anomaly Triage — `reviewer_suggestions` PG↔DV

**Day 1 deliverable. Date:** 2026-05-12.
**Parity script:** `scripts/backfill-reviewer-suggestions-parity.js`
**Rerun timestamp:** 2026-05-12T22:02:01Z (this session)

## Summary

| Class | Count | Disposition |
|---|---|---|
| A — already in Dataverse | 329 | no action |
| B — active cycle, would backfill | 0 | n/a |
| C2 — closed + engaged, backfill | 0 | n/a |
| C1 — closed + no engagement, discard | 0 | n/a |
| **Anomaly** | **8** | **all accept-loss; see per-row table** |

Live total: 337 PG rows. All 8 anomalies are J26 + `selected=true`. Two of these 8 are the source of the W3 acceptance gate 6/7/8 J26 PG=331 vs DV=329 informational drift.

## Why all 8 are accept-loss

The parity script can't AUTOMATICALLY classify these because (Codex S147 W4-Day-1 review Q1 — sharper phrasing):

- **Missing email (4 rows):** the documented canonical key for `wmkf_potentialreviewer` upsert is email. Recovering these would require fuzzy name + affiliation matching against Dataverse contacts — possible in principle but risks false-positive matches against unrelated researchers.
- **Missing request_number (4 rows):** request lookup needs `akoya_requestnum`. Recovering these would require triangulating from cycle + email + proposal title slug to a specific `akoya_request` — possible in principle but title-slug matching against `akoya_title` is fuzzy and error-prone.

Both classes pre-date the current `save-candidates.js` writer contract, which enforces both fields on insert.

**Engagement check (verifying "no engagement beyond selected"):** the SELECT used to surface the table below pulled `selected, invited, accepted, declined, email_sent_at, response_type`. For all 8 rows, ONLY `selected=true` was set; every other engagement column was null. The rows are abandoned discovery-flow saves — researcher was clicked but never invited.

Project-owner decision: **manual recovery is technically possible but not worth the risk/effort for 8 historical, never-invited rows.** Accept loss, retain only the aggregate evidence below, and do not block W4 on a recovery pass. If a future audit decides any of these warrants recovery, the protected operational backup—not this public repository—remains the appropriate evidence source.

## Aggregate dispositions

| Missing anchor | Count | Engagement | Disposition |
|---|---:|---|---|
| Reviewer email | 4 | selected only; never invited | accept-loss (cannot safely upsert a potential reviewer) |
| Request number | 4 | selected only; never invited | accept-loss (cannot safely anchor the suggestion to a request) |

The original production-derived row identifiers, request numbers, names, and
email addresses are intentionally excluded from the tracked document. This
aggregate is sufficient to explain and reproduce the migration disposition;
any row-level follow-up must use access-controlled operational evidence.

## Operational implication for W4

- `scripts/backfill-reviewer-suggestions-to-dataverse.js` (Day 2 build): **the 8 accept-loss rows are NOT backfill candidates and the script will NOT attempt to write them.** Its dry-run output for this dataset reports 0 write candidates. The script is built for the safety contract (idempotent, dry-run-first, alt-key idempotency) so that any FUTURE row that somehow fails writer enforcement has a recovery path. Today there is nothing to write.
- `scripts/reconcile-reviewer-migration.js` (Day 2 build) must report these 8 PG rows in its "unmatchable" bucket when run against active-cycle data. The drift of 2 selected-J26 rows (W3 acceptance gate 6/7/8) is the matchable-side accounting view of the same accept-loss set. The reconcile contract treats unmatchable rows as a separate bucket from active-cycle drift, so the cutover gate (`0 active-cycle drift` on matchable rows) stays clean. **New unmatchables beyond this documented 8 fail the gate** (Codex W4-Day-1 Q2): the contract enumerates dynamically; this doc's "8" is a baseline observation, not a fixed expected constant.
- W4 acceptance does **not** block on closing these 8. They're historical PG-only rows that lose their context when the Postgres table is decommissioned — the loss is documented, time-bound to the 14-day post-cutover read-only window, and recoverable from the Postgres backup if anyone later cares.

## Cross-reference

- Plan §"Reviewer suggestions backfill" → "Identity contract" — the lookup chain that makes these rows unrecoverable
- Plan §"Acceptance tests + reconciliation reports" → first row — uses `request_number` join (NOT `proposal_id`), which is why these rows fail classification
- W3 acceptance gate 6/7/8 (commit 80f19a0) — surfaces the J26 +2 drift these explain
