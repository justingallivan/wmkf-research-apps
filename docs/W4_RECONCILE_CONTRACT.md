---
title: "W4 Reconcile Contract — `scripts/reconcile-reviewer-migration.js`"
domain: dataverse
kind: source-of-truth
status: canonical
summary: "Designed-on-paper before building (Codex S147 pre-W4 review Q1 BLOCKER: the identity contract must be unambiguous before code lands)."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/reconcile-reviewer-migration.js
  - docs/W4_ANOMALY_TRIAGE.md
  - lib/services/review-upload.js
  - lib/dataverse/client.js
---

# W4 Reconcile Contract — `scripts/reconcile-reviewer-migration.js`

**Day 1 deliverable. Date:** 2026-05-12.

Designed-on-paper before building (Codex S147 pre-W4 review Q1 BLOCKER: the
identity contract must be unambiguous before code lands).

## Purpose

Pre/post-cutover parity report for `reviewer_suggestions` PG ↔ DV. Run before:
- declaring any drain target retired
- dropping the Postgres `reviewer_suggestions` table

Gate semantic: **0 active-cycle drift** after excluding the documented unmatchable rows in `docs/W4_ANOMALY_TRIAGE.md`.

## Identity contract

**The join key is `akoya_requestnum` (a.k.a. `request_number` on PG side), NOT `proposal_id`** (which is a title-slug, NOT a request identifier — see plan §"Reviewer suggestions backfill" → "Identity contract").

**PG side:**
```sql
SELECT
  rs.request_number,
  COUNT(*) AS pg_count
FROM reviewer_suggestions rs
JOIN grant_cycles gc ON gc.id = rs.grant_cycle_id
WHERE gc.is_active = true
  AND rs.selected = true
  AND rs.request_number IS NOT NULL  -- excludes the 4 missing-request anomalies
  AND rs.researcher_id IN (SELECT id FROM researchers WHERE email IS NOT NULL)  -- excludes the 4 missing-email anomalies
GROUP BY rs.request_number;
```

**DV side:** for each active cycle code derived from `grant_cycles.short_code`:
```
GET /wmkf_appreviewersuggestions?$filter=wmkf_grantcyclecode eq '<CODE>' and wmkf_selected eq true&$expand=wmkf_Request($select=akoya_requestnum)&$select=_wmkf_request_value
```

**Navigation property note (Codex W4-Day-1 Q3):** the single-valued nav property `wmkf_Request` (PascalCase) is the same one used by `lib/services/review-upload.js:114` for the request join. Verified in working code; no metadata-discovery dance needed.

**Pagination:** Dataverse pages OData queries at the `Prefer: odata.maxpagesize` header value. Follow `@odata.nextLink` until exhausted before aggregating, or per-page client-side aggregation will undercount. The W3 helper's `fetchCounts` did NOT need to paginate because it used `$apply/groupby` (server-side aggregation); reconcile uses per-row reads and MUST paginate.

Aggregate client-side by the expanded `akoya_requestnum`.

**Join key normalization:** both sides emit `request_number` as a string. PG returns `VARCHAR`; DV returns string from `akoya_requestnum`. No case-folding needed (both are numeric strings like `"1002365"`).

## Algorithm

1. Load active grant cycles from PG (`SELECT short_code FROM grant_cycles WHERE is_active = true`). Currently 10 cycles after W3 collapse: D23, D24, D25, D26, D27, J23, J24, J25, J26, J27.
2. Load active grant cycles from DV (`listCycles({ includeArchived: false })` via the W3 helper). Must equal the PG set; mismatch is a hard error (would mean W3 cutover desynced).
3. **Dynamic anomaly enumeration (per Codex W4-Day-1 Q2 + Q7).** Re-run the parity classification logic LIVE rather than trusting the baseline count of 8 from `W4_ANOMALY_TRIAGE.md`. For each active cycle, partition PG rows into:
   - **Matchable** (has email AND has request_number AND request_number resolves to an `akoya_request`)
   - **Unmatchable: missing_email** (count tracked separately)
   - **Unmatchable: missing_request** (count tracked separately)
   - **Unmatchable: orphan_request** (has request_number but no matching `akoya_request` — new class, would indicate a NEW anomaly post-W4)
4. For each active cycle:
   - PG matchable count by `request_number`
   - DV count by `akoya_requestnum` (per OData query above, paginated via `@odata.nextLink` until exhausted)
   - Per-`request_number` delta
5. Surface the unmatchable bucket **broken out by class AND cycle**. The DOCUMENTED expected unmatchables (8 J26 rows per `W4_ANOMALY_TRIAGE.md`) and any NEWLY-OBSERVED unmatchables are reported separately. A new unmatchable that didn't exist at the Day-1 baseline is a NEW signal that the gate must surface — not silently absorb.
6. Summary block:
   - Total active-cycle drift = sum of |delta| across matchable rows
   - **PG-side excess** = sum of positive deltas (matchable PG rows without a DV counterpart — cutover-loss risk)
   - **DV-side excess** = sum of negative deltas (DV ahead of PG — normal post-W1 native writes; informational only)
   - Unmatchable count: documented baseline N=8 (as of 2026-05-12) vs. observed today
   - Verdict (refined post-Day-2-build): PASS if **PG-side excess** ≤ threshold AND observed unmatchable count ≤ documented baseline; FAIL otherwise. **The plan's "0 rows drift" wording is refined to "0 PG-side excess"** — strict-symmetric drift is operationally impossible post-W1 cutover since `save-candidates.js` writes DV-only; DV will always have rows PG doesn't.

**"8" is a 2026-05-12 baseline value, not a fixed expected constant.** A future run that observes 7 unmatchables is fine (one got fixed somehow); a run that observes 9 unmatchables is a NEW anomaly requiring triage and a doc update.

## Inputs (CLI flags)

| Flag | Effect |
|---|---|
| (default) | DRY-RUN — report only; never writes |
| `--include-inactive` | Also report inactive-cycle drift (informational; never gates) |
| `--threshold N` | Treat active-cycle drift ≤ N as WARN instead of FAIL (use for post-cutover-but-pre-drop windows where read drift is expected) |
| `--json` | Emit machine-readable JSON output for CI integration |

## Output

```
# Reviewer migration reconcile
Generated: <timestamp>

## Active cycle parity
| cycle | request_number | PG | DV | delta |
|---|---|---|---|---|
| J26 | 1002181 | 5 | 5 | 0 |
| J26 | 1002185 | 4 | 4 | 0 |
| ... | ... | ... | ... | ... |

## Unmatchable rows (excluded from active-cycle gate)
Count: 8 (per W4_ANOMALY_TRIAGE.md)

## Verdict
Active-cycle drift: 0 rows
PASS — cutover gate clean.
```

Exit code:
- `0` if active-cycle drift == 0 AND observed unmatchable count ≤ documented baseline
- `1` if drift > 0 (or > threshold if specified), OR new unmatchables appeared (above documented baseline)
- `2` if a transport/integration error prevented the run

**Partial-failure semantics (Codex W4-Day-1 Q4).** If any per-cycle read fails (timeout, transient 5xx after retry-budget exhausted, auth failure mid-run), **abort with exit `2`** — do NOT continue with partial DV data and emit a `1`. Partial data conflates "real drift" with "unknown parity"; the gate must distinguish these. Any partial DV cycle table is marked non-authoritative in the output.

## What it does NOT do

- Per-field comparison (e.g., `email_sent_at` equality). The plan's acceptance table has separate rows for per-field comparison (Group A); this script is the cutover gate, not the field-by-field diff. Build a separate `reconcile-reviewer-fields.js` if/when needed.
- Junction parity (`wmkf_apprequestperson`). Junction is post-pilot scope.
- Suggestion-level mutation. Read-only by contract.

## Edge cases

- **A cycle exists in PG but not DV (or vice versa):** hard error. Means W3 cutover state is inconsistent; fix grant_cycles first.
- **A PG request_number doesn't resolve to an `akoya_request`:** logged as unmatchable. Should never happen for active-cycle data since `save-candidates.js` enforces request existence on write.
- **DV suggestion's `_wmkf_request_value` resolves to a deleted `akoya_request`:** treat as orphan; log informationally; does not affect gate.
- **`wmkf_grantcyclecode` mismatches the request's `akoya_fiscalyear`:** likely indicates a stale shortcode write. Log but don't gate — W3 §"Acceptance tests" → "Meeting-date → shortcode parity" already covers the request-side derivation.

## Build constraints (for the Day 2 implementer)

- Use the `lib/dataverse/client.js` helper (matches W3 grant-cycles pattern) rather than `DynamicsService` — keeps this script transport-agnostic and easy to run from CI.
- Token caching: not needed; single invocation per run.
- Throttling: defensive 429-retry per the W3 step-5 followup pattern (`TRANSIENT_RETRY_STATUSES`).
- Idempotency: trivially read-only.

## Cross-reference

- Plan §"Acceptance tests + reconciliation reports" → first row — this script's gate spec
- `docs/W4_ANOMALY_TRIAGE.md` — the 8 unmatchable rows excluded from the gate
- Plan §"Identity contract" — the canonical mapping this contract implements
