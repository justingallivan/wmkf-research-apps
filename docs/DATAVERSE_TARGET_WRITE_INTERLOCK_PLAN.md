---
title: Dataverse Target and Write Interlock Design
domain: engineering-process
kind: plan
status: active
summary: "Stages 1–2 shipped in warn mode; Stage 3 observation and the deliberate Dataverse target-interlock on-mode decision remain."
canonical: false
cataloged: 2026-07-11
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
---

# Dataverse Target and Write Interlock Design

**Status: Stages 1+2 MERGED to `main` (2026-07-11, Session 355; Stage 1 at
e113b4bf, Stage 2 hook wiring at 8067de3a; full suite 5361/5361 green on the
Stage-2 branch tip). WIRED and in `warn` mode everywhere: the §5 Stage-2
rollout ran 2026-07-11 — `DATAVERSE_TARGET_INTERLOCK=warn` set in `.env.local`
and Vercel Production + Preview (verified via `vercel env ls`), production
redeployed and Ready (aliased `reviews.wmkeck.org`), zero
`[dataverse-interlock]` lines in initial logs. `warn` never blocks; the
remaining §5 step is observation across normal staff use + one cron cycle,
then the deliberate flip to `on` (§5 Stage 3).**
[RECHECKED after lib/dataverse/core/interlock.js + lib/dataverse/core/target-registry.js changes — VERIFIED via the merge diffs and four Codex adversarial review rounds (eight findings total: 2+2+3+1 across rounds, all fixed and personally diff-reviewed). This doc describes the interlock at stage/contract level, not line level.] This document turns
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §6 — the
"[PLANNED — highest-priority enabling control]" — into a concrete, buildable
design. State labels follow the strategy doc's convention: **[VERIFIED]** was
read from current source this session (2026-07-11); **[PLANNED]** is the
design; **[OWNER DECISION]** needs an explicit call before or during build.

## 1. Problem

Deployment isolation is not data isolation (strategy §2.3). A preview or local
process pointed at production Dataverse writes production data with nothing but
operator intent standing in the way. The existing enforcement layer
(`assertTrustedDalContext`, `DATAVERSE_DAL_ENFORCEMENT=on` in all environments)
answers *"is this caller trusted (post-auth)?"* — it is completely blind to
*"is this process allowed to write **this org** from **this deployment**?"*
The interlock adds that second, orthogonal axis.

## 2. Verified Current State — the Dataverse HTTP inventory

**[VERIFIED via source reads 2026-07-11, plus the disconfirming sweep in §2.4]**

### 2.1 Write funnel 1 — `DynamicsService` family (`lib/services/dynamics/*`)

- All four entity mutators call `assertTrustedDalContext` first, then
  `svc._writeFetch(url, …)`: `createRecord`, `updateRecord`, `deleteRecord`,
  `disassociate` (`lib/services/dynamics/write-core.js:131,169,275,315`).
- Changeset batches (`executeChangeset` → `_writeFetch(baseUrl + '/$batch')`,
  `lib/services/dynamics/changeset.js:121`) and the three email writes
  (`lib/services/dynamics/email.js:122,166,191`) use the same `_writeFetch`.
- Reads (`queryRecords`/`getRecord`/`countRecords`/`aggregateRecords`/
  `queryAllRecords`/`searchRecords`, `lib/services/dynamics/read-ops.js`) call
  `fetchWithTimeout` directly.
- **Every function in this family — reads and writes — ultimately calls
  `fetchWithTimeout` in `lib/services/dynamics/http.js:23`** (`_writeFetch`
  wraps it at `write-core.js:101,112`). The base URL is always
  `process.env.DYNAMICS_URL`, read at each call site.

### 2.2 Write funnel 2 — `lib/dataverse/client.js` (`createClient().call`)

- Raw `fetch` (`lib/dataverse/client.js:94`), not `fetchWithTimeout`. Runtime
  consumers: `dataverse-settings-service.js`, `dataverse-identity-map.js`,
  `dataverse-app-access-service.js` (write-guarded only by
  `assertDataverseAccess` under `DATAVERSE_DAL_UNIVERSAL`, default **off** —
  `lib/services/dynamics-context.js:207`), and `grant-cycles-dataverse.js`
  (writes: `createCycle` POST, `updateCycleById` PATCH, `archiveCycleById`
  PATCH at `lib/services/grant-cycles-dataverse.js:254-279` — no guard at all).
- Script consumers include `scripts/apply-dataverse-schema.js` (schema writes).
- **Hazard [VERIFIED]:** all four runtime consumers resolve their URL as
  `process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL`
  (e.g. `lib/services/dataverse-app-access-service.js:27`). In any environment
  where `DYNAMICS_SANDBOX_URL` is set, these four services silently target a
  **different org** than `DynamicsService` in the same process. The interlock
  must make that divergence visible, not paper over it.

### 2.3 Read-only family 3 — `lib/services/dataverse-export/*`

`fetch-client.js` (local `fetchWithTimeout` copy at `fetch-client.js:60`) and
`live-taxonomy.js` (raw `fetch` at `live-taxonomy.js:33,56`) issue
**GET-only** FetchXML/OData/metadata reads against `process.env.DYNAMICS_URL`.
No write methods exist in this family [VERIFIED via method grep].

### 2.4 Disconfirming sweep — what else touches `DYNAMICS_URL`?

A grep for `DYNAMICS_URL` across `lib/ pages/ shared/` outside the three
families above returned only:

- `lib/utils/health-checker.js:103` — token-endpoint POST to
  `login.microsoftonline.com` (scope string only; never calls the org's data
  API).
- `lib/services/notification-service.js:104` — env-presence check only.

**Conclusion [VERIFIED via this sweep]: every runtime Dataverse *write* flows
through funnel 1 or funnel 2; reads flow through those two plus the read-only
export family.** Hand-rolled `fetch` in standalone `scripts/` is outside the
runtime and out of scope (§4).

### 2.5 Existing guard idioms to reuse

- `DATAVERSE_DAL_ENFORCEMENT` (`isDalEnforcementOn`,
  `lib/services/dynamics-context.js:124`): on/off, NODE_ENV-keyed default.
- `DATAVERSE_DAL_UNIVERSAL` (`resolveDalUniversalMode`,
  `lib/services/dynamics-context.js:207`): explicit `off`/`warn`/`on`, unset →
  `off`, invalid → `off` + one console.warn. **The interlock started from this
  resolver shape but deliberately diverges on invalid values** (round-3 Codex
  finding): unset/empty → `off`, but a set-and-invalid value → `on` + one
  console.warn — a typo'd flag must never silently disable a fail-closed
  control (§3.4).

## 3. Design

### 3.1 New modules **[PLANNED]**

`lib/dataverse/core/target-registry.js` — a tracked, code-reviewed hostname
registry. [RECHECKED after lib/dataverse/core/target-registry.js change:
built on branch `interlock-stage1` per this section; hosts match the snippet
below verbatim — `git show interlock-stage1:lib/dataverse/core/target-registry.js`.] Changing an org's classification requires a commit, satisfying
strategy §12: *"Dataverse target classification is verified, not inferred from
a variable name."* Classification keys off the **actual request URL's
hostname**, never off which env var supplied it.

```js
// Exact-match hostnames. Both already appear in tracked files
// (lib/utils/health-checker.js:103 fallback; scripts/probe-sandbox-schema-perms.js:25).
export const PRODUCTION_HOSTS = ['wmkf.crm.dynamics.com'];
export const SANDBOX_HOSTS = ['orgd9e66399.crm.dynamics.com'];
```

**[RESOLVED 2026-07-11 via Global Discovery probe
(`scripts/discover-dynamics-envs.js`, read-only)]** `akoyago.crm.dynamics.com`
is NOT a real org: the app registration sees exactly two instances — `wmkf`
(display name "WM Keck Foundation **akoyaGO**" — the product name an old doc
conflated into a hostname) and sandbox `orgd9e66399`. The registry stays
as-is; `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` was corrected the same day.
Note the discovery service lists API hosts in the `<org>.api.crm.dynamics.com`
form — the registry deliberately does NOT include that form. The runtime
always uses the plain host (`DYNAMICS_URL`), so an `.api.` URL appearing at a
hook site classifies `unknown` → fails closed; if that ever surfaces in
Stage-2 warn logs, it is a signal to investigate the caller, not to blindly
extend the registry.

`lib/dataverse/core/interlock.js` — [RECHECKED after lib/dataverse/core/interlock.js change: built on branch `interlock-stage1` (incl. same-session §3.3 audit-logging amendment, commit d55b5175); exports, matrix, modes, and exceptions match this section — reviewed via `git show`.]
Pure policy logic, no Node-only imports at top level (`lib/dataverse/client.js` is reachable from client-adjacent bundle
paths per its own header comment at `client.js:11-14`, so everything it pulls
in must stay browser-import-safe). Exports:

```js
classifyDeployment()          // → 'production' | 'preview' | 'local' | 'test'
classifyTarget(url)           // → 'production' | 'sandbox' | 'unknown'
resolveInterlockMode()        // → 'off' | 'warn' | 'on'
assertDataverseOperationAllowed({ url, method, callerLabel })
```

- `classifyDeployment()`: `VERCEL_ENV === 'production'` → `production`;
  `VERCEL_ENV === 'preview'` → `preview`; `NODE_ENV === 'test'` → `test`;
  everything else (local dev, operator scripts, `vercel dev`) → `local`.
  Crons/workers run inside a deployment and inherit its class. This trusts the
  platform-set `VERCEL_ENV`; the interlock defends against **mistakes**, not a
  local adversary who exports `VERCEL_ENV=production` — that limitation is
  accepted and documented, same as every other env-keyed control in the repo.
- `classifyTarget(url)`: parse hostname; exact match against the registry;
  anything else — including a `*.crm.dynamics.com` host not in the registry —
  is `unknown`. No env-var extension of the registry, deliberately: an unknown
  org must force a reviewed commit, not a quiet env edit.
- Operation class from HTTP method: `GET`/`HEAD` → **read**; anything else
  (`POST`, `PATCH`, `DELETE`, `PUT`) → **write**. A `$batch` POST is a write —
  correct, because `executeChangeset` only carries mutations
  (`changeset.js:60` types operations as `POST|PATCH|DELETE`).

### 3.2 Policy matrix **[PLANNED — implements strategy §6]**

| Deployment | Target | Read | Write |
|---|---|---|---|
| production | production | allow | allow (existing DAL trust enforcement still applies) |
| production | sandbox | **deny** | **deny** |
| production | unknown | deny | deny |
| preview / local / test | production | allow **only if** `DATAVERSE_ALLOW_PROD_READS=yes` | deny, unless §3.3 exception |
| preview / local / test | sandbox | allow | allow |
| preview / local / test | unknown | deny | deny |

Production-app → sandbox is denied in both directions on purpose: it can only
mean the `DYNAMICS_SANDBOX_URL || DYNAMICS_URL` fallback (§2.2) or a bad env
edit has silently repointed part of the production runtime. The interlock's
job is to surface exactly that. **[OWNER DECIDED 2026-07-11 S355: deny]** —
confirmed by the owner; matches the merged implementation.

### 3.3 Exceptions — server-side, narrow, auditable, time-bounded

Never a client-supplied flag (strategy §6). Two shapes:

1. **Operator script ack** — `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"`.
   Honored only when `classifyDeployment() === 'local'`, and only when the
   embedded date equals today (UTC) — a stale ack in a forgotten `.env.local`
   line dies at midnight. Logged once per process
   (`[dataverse-interlock] PROD WRITE ACK active: <purpose>`). This is what
   keeps the interlock from breaking the real, current workflow of owner-run
   backfills/seeds against prod (e.g. `scripts/seed-phase-i-summary-prompt.js`,
   which targets `wmkf.crm.dynamics.com` via `.env.local` per its header).
2. **Mode-D rehearsal grant** — `DATAVERSE_REHEARSAL_GRANT` (JSON):
   `{ "purpose": "...", "ops": ["POST","PATCH"], "entitySets": [...],
   "recordIds": [...], "expiresAt": "ISO" }`. A write is allowed only when the
   method is in `ops`, the URL's entity set is in `entitySets`, and — for any
   URL-addressed record — the record GUID is in `recordIds`. Entity set and
   record id are parsed from the **first** `entitySet(guid)` segment after
   `/api/data/v<version>/`, so bound actions
   (`emails(guid)/Microsoft.Dynamics.CRM.SendEmail`) and
   navigation-property/`$ref` writes match against the base record, never the
   terminal path segment (Codex adversarial finding, 2026-07-11 — the
   terminal-segment parser skipped the record check on bound-action POSTs).
   **Creates cannot be record-allowlisted** (no ID exists yet); they are
   constrained by entity set only, and this fast-path applies ONLY to the
   exact collection URL (`/api/data/v<ver>/<entitySet>`, no trailing path) —
   a collection-bound action (`/contacts/Microsoft.Dynamics.CRM.SomeAction`)
   also has no key but is denied: the grant shape cannot scope what the
   action does (Codex round-2 finding). That honest gap is why Mode D still
   requires the written expected-writes list and post-run reconciliation from
   strategy §5. **`recordIds` is GUID-only** (round-2): a URL key predicate
   that is not a plain GUID — alternate key
   (`wmkf_things(wmkf_questionkey='x')`) or composite key — never matches,
   even if listed verbatim in the grant, because alternate-key writes are
   upsert channels that CREATE on first touch
   (`scripts/seed-review-questions.mjs`, `lib/external/review-answer-snapshot.js`);
   non-GUID grant entries are ignored; GUID matching is case-insensitive.
   Alt-key/upsert rehearsals are never grant-coverable in v1. Every allowed
   rehearsal write logs one structured line with the purpose. Expired or
   malformed grant → treated as absent (fail closed).
   **`$batch` is never grant-coverable in v1** — hard deny regardless of grant
   contents (a changeset bundles arbitrary sub-requests this layer never
   inspects, so no v1 grant shape could scope it; the earlier `"BATCH"` ops
   escape was removed per the round-1 Codex review — it silently dropped
   entity/record scoping). [RECHECKED after lib/dataverse/core/interlock.js change: round-1 rulings in commit b2409928, round-2 rulings (exact-collection create path, GUID-only recordIds) in commit 9bffbcd6 on `interlock-stage1`, 94/94 tests per build report; both diffs reviewed.]

### 3.4 Enforcement mode and flag

`DATAVERSE_TARGET_INTERLOCK` = `off` | `warn` | `on`. Unset or empty → `off`
(rollout requirement); **any other invalid value → `on` (deny posture) with
one console.warn naming the value** — a set-but-garbage flag must never
silently disable the control (round-3 Codex finding; diverges deliberately
from `resolveDalUniversalMode`, see §2.5). No `NODE_ENV`-keyed default —
turning this on is always a deliberate per-environment act. `warn` logs one structured
`[dataverse-interlock]` line per would-be-denied call and never throws. `on`
throws an error whose message names the deployment class, target class,
method, callerLabel, and the flag to consult — same actionable shape as
`assertTrustedDalContext`.

### 3.5 Hook points — three, matching the §2 inventory

**[MERGED to `main` at 8067de3a, 2026-07-11 S355 — wired but inert until
the env flag is set; enforcement still requires the §5 Stage-2 `warn` rollout.]**
[RECHECKED after lib/services/dynamics/http.js + lib/dataverse/client.js + lib/services/dataverse-export/fetch-client.js + lib/services/dataverse-export/live-taxonomy.js change: all four hook sites call assertDataverseOperationAllowed unconditionally per this section (commit 8278d170 + the export denial-preservation fix); denial-contract wiring tests in tests/unit/dataverse-interlock-wiring.test.js; diffs reviewed.]

1. **`fetchWithTimeout` in `lib/services/dynamics/http.js:23`.** One seam
   covers the entire DynamicsService family: reads (read-ops), writes
   (write-core), changesets, and email, present and future. URL scoping lives
   INSIDE the module (round-3 Codex finding — hook sites must not each carry
   their own skip guard): `assertDataverseOperationAllowed` first consults the
   exported `shouldInspectDataverseUrl(url)`, which inspects registry hosts,
   `*.crm.dynamics.com`, and any host matching the current
   `DYNAMICS_URL`/`DYNAMICS_SANDBOX_URL` (so a repointed env is never silently
   skipped); parseable non-Dataverse hosts (the `login.microsoftonline.com`
   token endpoint; this helper is also used by `graph-service.js` per the
   comment at `http.js:27`) no-op with no logging, and unparseable URLs flow
   into the classify/deny path (fail closed). Hook sites therefore call the
   assert unconditionally.
2. **`call()` in `lib/dataverse/client.js:67`** (skip when `dryRun`; the token
   fetch at `client.js:44` doesn't go through `call` and needs no hook). This
   also puts schema-apply scripts and any future `createClient` consumer under
   the same policy.
3. **The export family's local `fetchWithTimeout`
   (`lib/services/dataverse-export/fetch-client.js:60`)**, plus the two raw
   GETs in `live-taxonomy.js:33,56` — read-side coverage only (the family has
   no writes, §2.3). Lowest priority of the three; without it, Mode-B read
   gating simply doesn't apply to the staff export tool. Acceptable to defer
   to a later stage if Stage 2 scope needs trimming — say so in the commit if
   deferred.

The interlock is **additive** to `assertTrustedDalContext` /
`assertDataverseAccess`: those answer caller trust, this answers
deployment/target permission. Both run; neither replaces the other.

### 3.6 Env contract additions

Document in `docs/CREDENTIALS_RUNBOOK.md`. None are secrets, so none join
`lib/utils/tracked-secrets.js` (that file's own header scopes it to
rotation/expiration-tracked credentials).

| Var | Values | Where set |
|---|---|---|
| `DATAVERSE_TARGET_INTERLOCK` | `off`/`warn`/`on` | All Vercel envs + `.env.local`; rollout below |
| `DATAVERSE_ALLOW_PROD_READS` | `yes` (anything else = no) | Preview/local only, when Mode B shadow-reads are wanted |
| `DATAVERSE_PROD_WRITE_ACK` | `"<purpose> <YYYY-MM-DD>"` | Per-invocation, operator shell only — never committed, never set in Vercel |
| `DATAVERSE_REHEARSAL_GRANT` | JSON grant | Per-rehearsal, removed after; never in production env unless a Mode-D rehearsal is live |

## 4. What this design deliberately does NOT do

- **Does not touch the `DYNAMICS_SANDBOX_URL || DYNAMICS_URL` fallback** in the
  four funnel-2 services. The interlock makes a divergent target *visible and
  policy-checked*; unifying URL resolution is a separate quiet-window cleanup
  (expand first, contract later — strategy §9).
- **Does not guard raw-fetch scripts** that use neither funnel (probes,
  one-off backfills with their own `fetch`). A follow-up gate could ratchet
  those onto `createClient`, but that is not this control.
- **Does not classify by env-var name**, accept client-supplied test-mode
  flags, or add a UI toggle.
- **Does not cover non-Dataverse side effects** — email delivery mode is its
  own control (strategy §7); SharePoint, Blob, Postgres, and background jobs
  need their own (strategy §6, final paragraph).

## 5. Build and rollout plan **[PLANNED]**

Tier 2 work (Dataverse-write machinery): build on a branch, promote
deliberately (strategy §4).

1. **Stage 1 — pure policy module + tests.** `target-registry.js`,
   `interlock.js`, and a table-driven unit test enumerating the full
   deployment × target × op matrix plus exception paths (date-bounded ack,
   grant matching/expiry/malformed-JSON, mode resolution, unknown host).
   No hook wiring — zero behavior change. Landable safely.
   **[DONE 2026-07-11 S355 — RECHECKED after lib/dataverse/core/interlock.js
   change: built on branch `interlock-stage1` (commits 610b50ca, d55b5175
   audit logging, b2409928 round-1 fixes: first-segment OData parsing +
   $batch hard deny, 9bffbcd6 round-2 fixes: exact-collection create path +
   GUID-only recordIds) and MERGED to main at e113b4bf; interlock suite 94/94
   + full suite 5343/5343 green, both run firsthand.]**
2. **Stage 2 — wire the hook sites, deploy `warn` everywhere.** Add the call
   sites from §3.5; set `DATAVERSE_TARGET_INTERLOCK=warn` in production,
   preview, and `.env.local`. Observe logs across normal staff use **including
   at least one full cron cycle**; every warn line is either a real hazard or
   a policy gap to fix before Stage 3.
3. **Stage 3 — flip `on`**, preview/local first, then production. Update
   strategy doc §6 from [PLANNED] to [CURRENT], the CLAUDE.md safety
   invariants, and the agent-wiki Dataverse topic in the same pass (`/sweep`).
4. **Stage 4 (optional, later)** — a `check:dataverse-interlock` CI gate +
   self-test asserting the hook sites still call
   `assertDataverseOperationAllowed`, so a refactor can't silently drop the
   seam (same anti-regression pattern as `check:dataverse-access-layer`).

Rollback at any stage = set the flag back to `warn`/`off` (env change +
redeploy on Vercel; immediate for local/scripts).

## 6. Test plan sketch

- Table-driven policy tests (pure function — no fetch, no mocks needed).
- Characterization: `warn` never throws; `off` is a strict no-op; `on` error
  message names class/target/method/caller/flag.
- Hook tests in the style of `tests/unit/dal-enforcement.test.js`: a write via
  `DynamicsService.updateRecord` against a registry-unknown URL throws under
  `on`; a POST to `login.microsoftonline.com` is never evaluated.
- Existing suites (`dal-enforcement.test.js`,
  `dynamics-service-write-core.test.js`) must stay green untouched — the
  interlock defaults `off`, and `classifyDeployment()` returns `test` under
  Jest, for which sandbox/mock targets stay writable.

## 7. Open decisions before Stage 2 wiring

1. **[RESOLVED 2026-07-11]** `akoyago.crm.dynamics.com` — not a real org
   (Global Discovery probe; see §3.1). Registry unchanged.
2. **[OWNER DECIDED 2026-07-11 S355]** production-app → sandbox: **deny**
   (§3.2). Matches the merged implementation — no code change.
3. **[OWNER DECIDED 2026-07-11 S355]** preview deployments stay
   read-denied by default; `DATAVERSE_ALLOW_PROD_READS=yes` is set
   per-preview only while a Mode-B shadow comparison is actually running,
   and removed afterward. Matches the merged implementation — no code change.

All §7 decisions are resolved. Stage-2 wiring (§3.5, §5 Stage 2) is
unblocked.
