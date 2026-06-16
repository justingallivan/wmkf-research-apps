# Workbench Triage Field — build plan (S260)

> **Status:** Pre-implementation. Drafted 2026-06-15 (S260) from the design thread with Justin.
>
> **v4 (2026-06-15): Codex review round 3 folded in.**
>
> **v2 (2026-06-15): Codex pre-impl review round 1 folded in.** Hard server-side manage gate (was the
> BLOCKER); membership-keyed 3-bucket backfill; explicit numeric option values; cycle-picker replacement
> before allowlist deletion; staged rollout; non-colliding labels (`Advancing`/`Set aside`).
>
> **v3 (2026-06-15): Codex review round 2 folded in.** Closed the six spec gaps: shared-constants module
> named; **null-inclusive dashboard query (the correctness trap — Dataverse-observed bare `ne` drops null rows)**; null-PD
> auth behavior; concrete cycle-fallback source; numeric backfill abort thresholds; pre-deploy field-shape
> metadata probe; exact scope-interaction + show-Set-aside query. Defaults chosen for the two judgment items
> (abort bounds, "current open cycle" source) are marked `[DEFAULT — confirm at impl]`.
>
> Complements `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` (the workbench shell) and
> `docs/REQUEST_WORKBENCH_SCOPING.md` (the tier-2 "triage lens" this is the data backbone for).

## Why

The Workbench dashboard's "going-forward" subset is driven by a **manual committed allowlist**
(`shared/config/d26Allowlist.js`) — a D26 throwaway. It papers over two gaps: there's **no home for
triage state** (winnowing lives in a hand spreadsheet; proposals stay officially "alive" until the board
blesses the slate, so official status can't declutter), and **the dashboard can't simplify as the cycle
progresses**. **Decision (Justin, S260):** build a real **triage field** this cycle — limited options now,
cleanly extensible — replacing the allowlist's two jobs (declutter + surface-despite-status) with a durable
per-proposal field, and seeding the J27 triage lens.

## The lifecycle signals (reconciled — keep distinct)

| Signal | Field | Meaning | Owner / when |
|---|---|---|---|
| **Triage** (this build) | `wmkf_triagestatus` (new) | staff winnowing — in-contention vs set-aside; **reversible, visibility-only** | staff/lead PD, ongoing, pre-board |
| **Invited** | `wmkf_phaseistatus` → Invited | board blessed the slate → **"expect the Phase II proposal"** | board chairs, at the blessing meeting |
| **Phase II proposal arrived** | `akoya_requeststatus` = `Phase II Pending` | the **Phase II proposal has actually arrived** | set when the doc lands |
| **Phase II advance (J27)** | phase trigger (future) | official advance-to-Phase-II working state | J27 |

Triage drives **dashboard visibility only**. The `Phase II Pending` = doc-arrival signal also feeds a
separate **active-document-switch design** (Phase I→II proposal) that is **not yet written** — cross-ref only.

## Scope — v1 (this cycle), deliberately minimal

One authoritative field, lead-PD-editable (HARD server gate). **NOT** the recommendation/decision split,
**NOT** the long-list→short-list gradient — those are the **J27 expansion**. The picklist is additively
extensible (J27 adds values without a migration).

## 0. Shared constants (Codex r2 F1)

- New dependency-free module **`shared/config/triageStatus.js`** (importable client + server):
  `TRIAGE_STATUS = { ADVANCING: 100000000, SET_ASIDE: 100000001 }`, `TRIAGE_LABEL` (value→label),
  `isValidTriageValue(v)`. The route, backfill, dashboard query, and UI all import from here — **never
  compare on label, never inline the magic numbers.**
- Import triage constants **directly** from `shared/config/triageStatus.js`, **NOT** from
  `shared/config/index.js`: that barrel re-exports a server-only loader (`lib/services/model-override-loader`
  via `shared/config/index.js` line ~12), which would pull server-side dependencies into a client bundle.
  `shared/config/triageStatus.js` must remain dependency-free.

## 1. Dataverse field

- **Field:** `wmkf_triagestatus` on the **core `akoya_request`** entity; picklist (local option set) with
  **explicit numeric values** (schema-apply requires them — `schema-apply.js:125`): `Advancing`=100000000,
  `Set aside`=100000001; `null` = untriaged (no option). Labels avoid the `akoya_requeststatus='Active'` collision.
- **Pre-deploy metadata probe (Codex r2 RISK C):** schema-apply is **creation-only** — it will NOT reconcile
  a divergent pre-existing field (`schema-apply.js:264-276`). Use `scripts/probe-picklist.js` as the pattern,
  but not directly as the preflight: it exits non-zero when the field is **ABSENT**, and absent is the allowed
  creation path. The preflight needs a thin wrapper script with a 3-way exit contract: field **ABSENT** →
  proceed (create); field **EXISTS** with exactly {100000000 Advancing, 100000001 Set aside} → proceed
  (idempotent no-op); field **EXISTS** with a **DIVERGENT** option set → **ABORT** (manual reconciliation
  required, because schema-apply is creation-only per `lib/dataverse/schema-apply.js:264`).
- **Deploy:** isolated schema wave (mirror `lib/dataverse/schema/wave2-fieldprimer/…` + `scripts/apply-dataverse-schema.js`,
  string-wave loads only that dir). **NOT** `--wave=2 --execute` (duplicate-relationship drift hazard). Precedent:
  `wmkf_ai_fieldprimer` self-deployed to `akoya_request`; publisher prefix `wmkf`. **MUST carry NO PowerAutomate
  trigger** (verify post-deploy).
- Atlas: add `wmkf_triagestatus` to `docs/atlas/dataverse-akoya-request.md` (`check:atlas`).

## 2. One-time backfill — 3-bucket, membership-keyed (idempotent, dry-run first)

`Advancing` keys off **allowlist membership, not status** — an allowlisted row already at `Phase II Pending`
must still be `Advancing` or the new query hides it.

- **Bucket A — `Advancing`:** every number in `D26_ALLOWLIST_REQUEST_NUMS` **minus `1002788`**, regardless
  of current `akoya_requeststatus`.
- **Bucket B — `Set aside`:** D26 cycle proposals with `akoya_requeststatus = 'Phase I Pending'` **not in**
  the allowlist. `1002788` lands here → hidden.
- **Untriaged (`null`):** everything else — untouched.
- **Abort thresholds (Codex r2 RISK B) `[DEFAULT — confirm at impl]`:** expected Bucket A =
  `D26_ALLOWLIST_REQUEST_NUMS.length − (1002788 present ? 1 : 0)` (computed from the array, not a literal).
  **Abort if** any allowlist number is unresolved in Dataverse, **or** resolved Bucket A ≠ expected. Bucket B
  is variable — print it; **require `--force` if Bucket B is 0 or > 400** (sanity range around the scoping
  doc's ~200 D26 long-list; the dry-run proves the real number).
- Script `scripts/backfill-d26-triage.mjs`: **dry-run by default** (reports A split Phase-I-vs-already-Phase-II,
  B, and the abort checks), `--execute` to write; idempotent (skip rows already at target); restriction-bypassed;
  `queryAllRecords` paginates (caps 5,000 — safe for D26).

## 3. Dashboard (`pages/api/workbench/dashboard.js` + `pages/workbench.js`)

- **Visibility query (Codex r2 RISK E — the correctness trap):** Dataverse-observed behavior (not an OData-spec
  guarantee) is that a bare `ne` drops null rows, so an untriaged row would be wrongly hidden. The clause MUST be
  **`(wmkf_triagestatus eq null or wmkf_triagestatus ne 100000001)`** to show `Advancing` + `untriaged`, hide
  `Set aside`. This mirrors the repo's existing `notExcludedFilter()` pattern in
  `lib/dataverse/adapters/reviewer-suggestion.js:135`, also used in
  `lib/services/grant-cycles-dataverse.js:185` and pinned by
  `tests/unit/reviewer-suggestion-disposition.test.js:65`; reuse that pattern rather than inventing a new
  filter. **Probe this live** before relying on it (confirm null rows are included) + a test fixture.
- **Scope interaction (Codex r2 RISK D):** the full default filter is
  `(<cycle>) and (wmkf_triagestatus eq null or wmkf_triagestatus ne 100000001)` plus, when `scope=my`,
  `and _wmkf_programdirector_value eq {pd}` — all parenthesized so the `or` can't leak. The **"show Set aside"
  toggle** (`?includeSetAside=1`) omits the triage clause entirely (all triage states), scope still applied.
- **Replaces both allowlist branches:** the `'Phase II Pending'` status branch is removed (its rows are
  `Advancing` via Bucket A). `Phase II Pending` becomes an informational row badge, not a filter.
- **Cycle picker replacement (Codex r2 RISK A) `[DEFAULT — confirm at impl]`:** the picker default + "always
  include D26" is allowlist-driven (`dashboard.js:123-149`). Replace with cycle derivation from the existing
  cycle source (`lib/services/grant-cycles-dataverse.js` / `wmkf_appgrantcycle`), using the fields it already
  exposes on `wmkf_appgrantcycle`: `id`, `name`, `shortCode`, `reviewDeadline`, `isActive`,
  `fiscalYearCode`. **Default algorithm:** among cycles with `isActive === true`, pick the one with the
  nearest upcoming `reviewDeadline` (fallback: nearest meeting date). D26 lists naturally because it has Phase I
  Pending proposals. Confirm at impl that no cycle with proposals can drop out, and that a zero-proposal cycle
  still lists (empty state). **Hard precondition of
  allowlist deletion.**
- **Per-row triage flip** — lead PD sets `Advancing`/`Set aside`; UI gated via `computeCanManage`, WRITE
  hard-gated server-side (§4). The "going-forward" pill becomes the `Advancing` indicator.

## 4. New write route — HARD server-side manage gate (Codex r1 BLOCKER, r2 F4)

- **`POST /api/workbench/triage`** `{ requestId, triageStatus }` → writes `wmkf_triagestatus` on `akoya_request`.
- `requireAppAccess('reviewers')` (app gate) **AND** a hard server-side manage check — this writes an
  **authoritative visibility field**, so the fail-open/UI-only `canManage` posture (S207, for org-open
  reviewer-workflow APIs) is **NOT** acceptable. `requireAppAccess` (`lib/utils/auth.js`) returns only
  `{ profileId, session }`; it bypasses app checks for superusers but does **NOT** expose an `isSuperuser`
  flag. The route must explicitly derive superuser status server-side using the canonical helper in
  `lib/utils/auth.js`: import `getUserRole` and treat `(await getUserRole(access.profileId)) === 'superuser'`
  as the superuser check (or use `requireSuperuser` only for superuser-only flows). Resolve the request;
  **allow iff** derived superuser status **or** (`_wmkf_programdirector_value` is non-null **and** equals
  `access.session.user.dynamicsSystemuserId`).
  **A null/absent `_wmkf_programdirector_value` → 403 for non-superusers (superuser only)** (Codex r2 F4).
- `requestId` **GUID-validated** before it becomes a record-id selector (`check:trust-boundary-guid`).
- Validate `triageStatus` via `isValidTriageValue` (numeric option set) → 400 otherwise.
- `bypassDynamicsRestrictions`; sanitized errors.
- Updates **decision #2**: lead PD + superuser, **hard-enforced**. Connor edits in Dataverse if needed.

## 5. Retire the allowlist — staged, LAST (Codex r1/r2 F5)

Order: **deploy field → dry-run + execute backfill → switch dashboard (keep `d26Allowlist.js` constants as
verification fallback) → delete the allowlist + union branch ONLY after prod dashboard row counts match the
verified backfill.** Replace the allowlist-union regression tests (`tests/integration/workbench-routes.test.js:81-114`)
with triage-equivalent assertions before retirement. On deletion reconcile docs (`REQUEST_WORKBENCH_BUILD_PLAN.md`
Appendix A + refs, scoping doc, `project-reviewer-apps-redesign-direction`/memory); run `/sweep`.

## Risks / gates / tests
- Prod schema change on the core entity — feasible (field-primer precedent), isolated wave, **metadata-probe first**, no PA trigger.
- Bulk backfill ~200 prod rows — 3-bucket dry-run + abort thresholds + idempotent.
- New write route — GUID-validated, **hard manage gate** (incl. null-PD 403), option-value validated.
- **Gates (sequential gate→self-test):** `check:atlas`, `check:api-routes`, `check:trust-boundary-guid`,
  `check:fact-consistency` (route + requireAppAccess counts change — refresh `CANONICAL_COUNTS` + reconcile
  restatements), `check:status-enum-parity` (if a triage value↔label/consumer map is registered), `check:doc-currency`.
- **Tests:** field metadata-probe abort-on-divergence; backfill dry-run/execute idempotency + 3-bucket split +
  `1002788` exclusion + already-Phase-II→Advancing + abort-threshold logic; **the null-inclusive query returns
  untriaged rows** (live probe + fixture); route auth (**non-lead-PD → 403**, **null-PD non-superuser → 403**,
  superuser allowed, GUID-400, bad-value-400, write); dashboard four complements (Advancing+Phase I shown,
  Advancing+Phase II shown, Set aside hidden, untriaged shown) + the show-Set-aside toggle + scope=my/all
  parenthesization; cycle picker still surfaces/defaults the open cycle without the allowlist.

## v1 decisions (DECIDED S260)
1. **Values:** `Advancing` (100000000) / `Set aside` (100000001) / null = untriaged. Constants in `shared/config/triageStatus.js`.
2. **Edit gate:** lead PD + superuser, **HARD server-side enforced** (null-PD → superuser-only); Connor edits in Dataverse if needed.
3. **Status branch:** triage **replaces** the `'Phase II Pending'` dashboard visibility branch; it becomes a badge.
4. **Test request `1002788`:** excluded from `Advancing` → `Set aside` (hidden).

## J27 forward path (NOT this cycle)
- Add states (long-list → short-list → final gradient).
- Add the **PD-recommendation layer** (provisional, distributed) separate from the **authoritative flip**
  (policy-deferred: PD self-promote or coordinator bulk "apply recommendations").
- Seed of the **tier-2 triage lens** (`REQUEST_WORKBENCH_SCOPING.md` §4).
