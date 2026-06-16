# Workbench Triage Field — build plan (S260)

> **Status:** Pre-implementation. Drafted 2026-06-15 (S260) from the design thread with Justin.
>
> **v2 (2026-06-15): Codex pre-impl review folded in.** Accepted all findings: the route's auth is now a
> HARD server-side manage gate (was the BLOCKER); the backfill is a 3-bucket partition that also catches
> allowlisted rows already at `Phase II Pending`; the picklist gets explicit numeric option values; the
> allowlist's cycle-picker role is replaced before deletion; rollout is staged (delete allowlist last);
> option labels chosen to avoid the `Active` collision; Atlas/API-matrix/canonical-count fan-out enumerated.
>
> Complements `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` (the workbench shell) and
> `docs/REQUEST_WORKBENCH_SCOPING.md` (the tier-2 "triage lens" this is the data backbone for).

## Why

The Workbench dashboard's "going-forward" subset is driven by a **manual committed allowlist**
(`shared/config/d26Allowlist.js`) — a D26 throwaway. It papers over two gaps: there's **no home for
triage state** (internal winnowing lives in a hand spreadsheet; proposals stay officially "alive" until
the board blesses the slate, so official status can't declutter), and **the dashboard can't simplify as
the cycle progresses**. **Decision (Justin, S260):** build a real **triage field** this cycle — limited
options now, cleanly extensible — replacing the allowlist's two jobs (declutter + surface-despite-status)
with a durable per-proposal field, and seeding the J27 triage lens.

## The lifecycle signals (reconciled — keep distinct)

| Signal | Field | Meaning | Owner / when |
|---|---|---|---|
| **Triage** (this build) | `wmkf_triagestatus` (new) | staff winnowing — in-contention vs set-aside; **reversible, visibility-only** | staff/lead PD, ongoing, pre-board |
| **Invited** | `wmkf_phaseistatus` → Invited | board blessed the slate → **"expect the Phase II proposal"** | board chairs, at the blessing meeting |
| **Phase II proposal arrived** | `akoya_requeststatus` = `Phase II Pending` | the **Phase II proposal has actually arrived** | set when the doc lands |
| **Phase II advance (J27)** | phase trigger (future) | official advance-to-Phase-II working state | J27 |

Triage drives **dashboard visibility only** — it is NOT Invited, NOT "Phase II proposal arrived." The
`Phase II Pending` = doc-arrival signal also feeds a separate **active-document-switch design** (Phase I→II
proposal) that is **not yet written** — cross-reference only, out of scope here.

## Scope — v1 (this cycle), deliberately minimal

One authoritative field, lead-PD-editable (HARD server gate). **NOT** the two-layer recommendation/decision
split, and **NOT** the long-list→short-list gradient — those are the **J27 expansion**. The picklist is
additively extensible, so J27 adds values without a migration.

## 1. Dataverse field

- **Field:** `wmkf_triagestatus` on the **core `akoya_request`** entity.
- **Type:** picklist (local option set), with **explicit numeric option values** (Codex #1 — the schema
  requires them; labels alone are insufficient). Mirror the `wmkf_applicantdisposition` convention:
  - `Advancing` = **100000000** (in contention → shown)
  - `Set aside` = **100000001** (winnowed out → hidden)
  - `null` = **untriaged** (no option — absence is the third state, shown by default)
  - Export shared constants (value↔meaning) for the route/backfill/dashboard; never compare on label.
  - Labels chosen to avoid the **collision** with `akoya_requeststatus = 'Active'` (awarded grant) — do NOT
    use `Active`.
- **Deploy:** isolated schema wave (mirror `lib/dataverse/schema/wave2-fieldprimer/akoya_request-fieldprimer.json`
  + `scripts/apply-dataverse-schema.js`; string-wave loads only that dir — Codex #1 VERIFIED). **NOT**
  `--wave=2 --execute` (duplicate-relationship drift hazard — `project-dataverse-schema-deploy-gotchas` #6).
  Precedent: `wmkf_ai_fieldprimer` self-deployed to `akoya_request` this way; publisher prefix `wmkf` (solution.json).
- **MUST carry NO PowerAutomate trigger** (verify post-deploy).
- Atlas: add `wmkf_triagestatus` to `docs/atlas/dataverse-akoya-request.md` (`check:atlas`).

## 2. One-time backfill — 3-bucket partition (idempotent, dry-run first)

Codex #2/#3: `Advancing` must key off **allowlist membership, not status** — an allowlisted row that has
already moved to `Phase II Pending` must still be `Advancing`, or the new query hides it.

- **Bucket A — `Advancing`:** every request number in `D26_ALLOWLIST_REQUEST_NUMS` **minus `1002788`**
  (the test request), **regardless of current `akoya_requeststatus`** (catches already-advanced rows).
- **Bucket B — `Set aside`:** D26 cycle proposals with `akoya_requeststatus = 'Phase I Pending'` **not in**
  the allowlist (the non-promoted set). `1002788` lands here (D26 Phase I Pending, excluded from A) → hidden.
- **Untriaged (`null`):** everything else — untouched.
- **Dry-run (default) reports three counts** before any write: A (allowlist→Advancing, split Phase I vs
  already-Phase-II), B (Phase-I-non-allowlist→Set aside), and **aborts** on (i) any allowlist number not
  found, or (ii) row-count drift beyond an expected bound. `--execute` to write.
- Script: `scripts/backfill-d26-triage.mjs` — idempotent (skip rows already at the target value),
  restriction-bypassed; `queryAllRecords` paginates (caps 5,000 — safe for D26). The "~200" is the scoping
  doc's D26 long-list estimate; the dry-run proves the real count before execute.

## 3. Dashboard (`pages/api/workbench/dashboard.js` + `pages/workbench.js`)

- **Visibility default:** show `Advancing` + `untriaged`, **hide `Set aside`**; toggle reveals Set aside.
- **Replaces both allowlist branches:** query cycle proposals where `wmkf_triagestatus ne 100000001`
  (Set aside), so `Advancing` rows show **regardless of `akoya_requeststatus`** (Phase I or Phase II) +
  the existing scope (my/all) filter. The `'Phase II Pending'` status branch is **removed** — its rows are
  now `Advancing` (guaranteed by Bucket A), so triage subsumes it. `Phase II Pending` becomes an
  informational row badge ("Phase II proposal in"), not a filter.
- **Cycle picker (Codex #3 — must replace before deleting the allowlist):** the picker default + "always
  include D26" behavior currently depends on the allowlist (`dashboard.js:123-149`). Replace with
  cycle-derivation from live data (cycles that have proposals, via the existing `meetingDateToCycleCode` /
  grant-cycle path), defaulting to the current open cycle — so D26 doesn't vanish for PDs once the allowlist
  is gone. **This is a hard precondition of allowlist deletion.**
- **Per-row triage flip** — lead PD sets `Advancing`/`Set aside` inline; UI gated via `computeCanManage`,
  but the WRITE is hard-gated server-side (§4).
- The "going-forward" pill becomes the `Advancing` indicator (distinct from the official **Invited** milestone).

## 4. New write route — HARD server-side manage gate (Codex #4 BLOCKER)

- **`POST /api/workbench/triage`** `{ requestId, triageStatus }` → writes `wmkf_triagestatus` on `akoya_request`.
- `requireAppAccess('reviewers')` (app gate) **AND** a **hard server-side manage check** — this writes an
  **authoritative visibility field**, so the fail-open/UI-only `canManage` posture (acceptable for org-open
  reviewer-workflow APIs, S207) is **NOT** acceptable here. Resolve the request, compare
  `_wmkf_programdirector_value` to `access.session.user.dynamicsSystemuserId`, **allow superuser, else 403**.
- `requestId` **GUID-validated** before it becomes a record-id selector (`check:trust-boundary-guid`;
  `updateRecord` interpolates raw ids — `dynamics-service.js:821-824`).
- Validate `triageStatus` against the **numeric option set** (reject anything else, 400).
- `bypassDynamicsRestrictions`. Sanitized errors.
- Updates **decision #2** below: lead PD + superuser, **hard-enforced** (not soft). Connor edits in Dataverse if needed.

## 5. Retire the allowlist — staged, last (Codex #5)

Order: **deploy field → dry-run + execute backfill → switch dashboard (keep `d26Allowlist.js` constants as
verification fallback) → delete the allowlist + union branch ONLY after prod dashboard row counts match the
verified backfill.** Replace the allowlist-union regression tests (`tests/integration/workbench-routes.test.js:81-112`)
with triage-equivalent assertions before retirement. Reconcile docs on deletion: `REQUEST_WORKBENCH_BUILD_PLAN.md`
(Appendix A + allowlist refs), scoping doc, `project-reviewer-apps-redesign-direction` / memory; run `/sweep`.

## Risks / gates / tests
- **Prod schema change on the core entity** — feasible (field-primer precedent), isolated wave, no PA trigger.
- **Bulk backfill** to ~200 prod rows — 3-bucket dry-run + abort-on-drift + idempotent.
- **New write route** — GUID-validated, **hard manage gate**, option-value validated.
- **Gates (sequential gate→self-test):** `check:atlas` (+ self-test), `check:api-routes` (+ self-test),
  `check:trust-boundary-guid` (+ self-test), `check:fact-consistency` (+ self-test; route + requireAppAccess
  counts change — refresh `CANONICAL_COUNTS` + reconcile literal restatements), `check:status-enum-parity`
  (if a triage value↔label/consumer map is added), `check:doc-currency`.
- **Tests:** field-deploy idempotency; backfill dry-run/execute idempotency + 3-bucket split + `1002788`
  exclusion + already-Phase-II→Advancing; the write route (auth, **non-lead-PD → 403**, GUID-400, bad-value-400,
  superuser-allowed, write); dashboard visibility for **all four complements** (Advancing+Phase I shown,
  Advancing+Phase II shown, Set aside hidden, untriaged shown); cycle-picker still surfaces/defaults D26.

## v1 decisions (DECIDED S260)
1. **Values:** `Advancing` (100000000) / `Set aside` (100000001) / null = untriaged. Non-colliding (Codex #6).
2. **Edit gate:** lead PD + superuser, **HARD server-side enforced** (Codex #4); Connor edits in Dataverse if needed.
3. **Status branch:** triage **replaces** the `'Phase II Pending'` dashboard visibility branch (rows are
   `Advancing` via Bucket A); `Phase II Pending` becomes a badge, not a filter.
4. **Test request `1002788`:** excluded from `Advancing` → `Set aside` (hidden).

## J27 forward path (NOT this cycle)
- Add states (long-list → short-list → final gradient).
- Add the **PD-recommendation layer** (provisional, distributed) separate from the **authoritative flip**
  (policy-deferred: PD self-promote or coordinator bulk "apply recommendations" at end of deliberations).
- This field is the seed of the **tier-2 triage lens** (`REQUEST_WORKBENCH_SCOPING.md` §4).
