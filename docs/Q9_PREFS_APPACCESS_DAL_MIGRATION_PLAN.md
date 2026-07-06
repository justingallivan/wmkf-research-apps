---
title: "Q9 Migration Plan — prefs + app-access onto the DAL"
domain: data-layer
kind: plan
status: active
summary: "Staged migration of prefs + app-access off client.js into DynamicsService adapters (DAL-plan Stage 9 Q9). Wrap-before-swap; prefs first, app-access last."
canonical: false
cataloged: 2026-07-06
owner: product-engineering
related:
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - lib/services/dataverse-prefs-service.js
  - lib/services/dataverse-app-access-service.js
  - lib/services/dynamics-service.js
  - lib/dataverse/core/entity-registry.js
---

# Q9 Migration Plan — prefs + app-access onto the DAL (adapters → DynamicsService)

**Status:** PLAN ONLY — no product code changed. Authored 2026-07-06 (Fable) against live `main`
(@478d0d20); Claude-reviewed + pillar claims verified against source (S339); promoted to durable doc.
**Owner decision:** Q9 (DAL plan Stage 9, `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md:446-448`) is now
**MIGRATE** — move `wmkf_appuserpreferences` and `wmkf_appuserappaccesses` off the unguarded
`lib/dataverse/client.js` transport into adapters routed through `DynamicsService`, overriding the
plan's "leave them" default.

Every claim below was re-probed against the live tree this session unless marked `[UNVERIFIED]`.

> **[STALE-ACCEPTED: lib/services/dynamics-service.js — line numbers only].** This plan's
> `dynamics-service.js` citations (e.g. `queryRecords :398-407`, `queryAllRecords :590`,
> `createRecord :758-763`, `checkRestriction :188-190`) were captured pre-decomposition. The
> parallel DynamicsService decomposition (Checkpoint A Stage 1, S339) extracted `auth.js` and
> shifted lines below the old auth block up by ~48. **Method-name anchors remain valid; line numbers
> are approximate** and are re-derived against live source when each Q9 stage is built (Stage 4 reads
> the current file). Reconciled fully at the Q9 worktree merge.
> **[STALE-ACCEPTED: lib/services/dynamics/auth.js — not referenced here].** Every `auth.js` in this
> plan is `lib/utils/auth.js` (the `requireAppAccess` auth hot path), NOT the newly-extracted
> `lib/services/dynamics/auth.js` — unrelated file, same basename.

---

## 1. Preconditions / probes (verified state)

### 1.1 The two services today

| Fact | Evidence |
|---|---|
| Prefs service: 7 exports (`getUserPreferences`, `setUserPreference`, `setUserPreferences`, `deleteUserPreference`, `getDecryptedApiKey`, `hasPreference`, `findRow` "for tests") | `lib/services/dataverse-prefs-service.js:185-195` |
| App-access service: 5 exports (`listAppKeysForUser`, `listAllGrantsForAdmin`, `grantApps`, `revokeApps`, `findRow` "for tests") | `lib/services/dataverse-app-access-service.js:156-163` |
| Both use `getClient()` = `getAccessToken(url)` + `createClient({resourceUrl,token})` from `lib/dataverse/client.js`, raw `client.get/post/patch/delete_` | prefs `:37-42`, app-access `:26-31` |
| Base URL resolved as `DYNAMICS_SANDBOX_URL \|\| DYNAMICS_URL` in both | prefs `:38`, app-access `:27` |
| Prefs create binds owner: `'ownerid@odata.bind': '/systemusers(<id>)'`; filters on `_ownerid_value` | prefs `:113`, `:50`, `:63` |
| App-access create binds `'wmkf_User@odata.bind'` + optional `'wmkf_GrantedBy@odata.bind'`; filters on `_wmkf_user_value` | app-access `:115-119`, `:39`, `:52` |
| Failure mode: every public fn wraps its body in try/catch → `console.error` + return falsy/empty (`{}`, `false`, `[]`, `null`, `{granted:[],error}`) | prefs `:78-81,:118-121,:133-136,:152-155,:166-169,:179-182`; app-access `:58-61,:94-97,:125-128,:150-153` |
| Interim warn-guard `assertDataverseAccess('prefs:write')` on the 3 prefs writes, `('app-access:write')` on `grantApps`/`revokeApps` — placed BEFORE the try block (so `on`-mode would throw to the route, not return falsy) | prefs `:85,:125,:140`; app-access `:101,:132` |
| Guarded-swap pin (OData Escape Consolidation Plan, owner ruling S331): both `findRow`s reject non-string key BEFORE `odata.escape` | prefs `:44-50`, app-access `:33-39`; pinned by `tests/unit/dataverse-guarded-swap-odata-escape.test.js` (asserts `TypeError` + **no `client.get` issued**, using an injected spy client) |
| Encryption (`encrypt`/`decrypt`/`maskValue`) lives in the prefs service, not the transport | prefs `:24,:71-72,:93,:165` |
| `listAllGrantsForAdmin` also reads Postgres `user_profiles` and uses `dataverse-identity-map` (`resolveProfileToSystemUser`/`resolveSystemUserToProfile`) | app-access `:20-22,:67-69,:82` |
| `getDecryptedApiKey` and `hasPreference` have **zero live callers** outside the `database-service.js` facade (pages/lib/shared grep) — dormant API surface, preserve but lowest risk | grep this session (empty result set) |

### 1.2 The critical coupling (DynamicsService context requirements)

| Fact | Evidence |
|---|---|
| `createRecord`/`updateRecord`/`deleteRecord` call `assertTrustedDalContext(...)` as their FIRST statement | `lib/services/dynamics-service.js:752` (createRecord), `:790` (updateRecord), `:896` (deleteRecord); also `:935` disassociate, `:1013` executeChangeset [VERIFIED via grep this session] |
| Write enforcement is ON in ALL environments: `DATAVERSE_DAL_ENFORCEMENT=on` explicit in prod (S330 flip); unset defaults to on outside production | `lib/services/dynamics-context.js:124-130` (`isDalEnforcementOn`) |
| **Reads are stricter than writes**: `checkRestriction` throws `'Restrictions not initialized — cannot execute query'` **unconditionally** (no flag) when no ALS context is set; called by every read (`:294,:344,:400,:448,:492,:541,:596,:666`) | `lib/services/dynamics-service.js:183-197` |
| Consequence: swapping a READ (`listAppKeysForUser`, `getUserPreferences`, `findRow`) onto DynamicsService before its caller establishes context throws in EVERY environment, flags irrelevant. This is the whole reason Q9's default was "leave them." | derived from the above, [VERIFIED] |
| The throw is then CAUGHT by the services' own try/catch → **silent degradation, not a 500**: `listAppKeysForUser` returns `[]` → every user sees "Access Not Available"; prefs read as empty. Harder to notice than a crash — warn-mode observation before swap is therefore mandatory, not optional. | prefs/app-access catch blocks cited in 1.1 |
| `withDalContext(scopeLabel, fn)` = thin DAL-labeled wrapper over `bypassDynamicsRestrictions`; performs no auth; sanctioned for post-auth entry points; "always allowed" by the context-boundary gate | `lib/dataverse/core/context.js:46-54`; `scripts/check-dynamics-context-boundary.js:45,:111-112` |
| Interim guard (`assertDataverseAccess`, `DATAVERSE_DAL_UNIVERSAL` off/warn/on, default off) uses the SAME ALS-presence predicate (`getDynamicsContext()`), so a caller wrapped for warn-mode is correctly wrapped for DynamicsService — no rework | `lib/services/dynamics-context.js:226-243` |

### 1.3 Entry-point census (re-derived this session)

Write call sites (my count: **9 call sites across 4 `pages/api` handlers**; the S338 census says "8 write entry
points" — the delta is a counting convention, e.g. `user-preferences.js` bulk-delete loop `:147` or
`prompt-override.js`'s second site folded into one entry. Not material: the wrap unit is the
route/function, and all four files are bare today except prompt-override's partial wrap):

| # | Call site | Function | Auth today | DAL context today |
|---|---|---|---|---|
| W1 | `pages/api/auth/[...nextauth].js:324` — `grantApps` inside `grantDefaultApps` (`:322-329`), invoked at `:158` and `:183` on the two new-profile-creation sign-in paths [VERIFIED via grep this session] | `grantApps` | NextAuth signIn flow | **BARE** — adjacent calls at `:160-189` are `withDalContext`-wrapped (`notification-email`, `staff-signin-reconcile`); the grant is not |
| W2 | `pages/api/app-access.js:88` | `grantApps` | `requireAuthWithProfile` (`:28`) + superuser check (`:31`) | **BARE** |
| W3 | `pages/api/app-access.js:105` | `revokeApps` | same | **BARE** |
| W4 | `pages/api/user-preferences.js:89` | `setUserPreference` | `requireAuthWithProfile` (`:25`) | **BARE** |
| W5 | `pages/api/user-preferences.js:102` | `setUserPreferences` | same | **BARE** |
| W6 | `pages/api/user-preferences.js:135` | `deleteUserPreference` | same | **BARE** |
| W7 | `pages/api/user-preferences.js:147` | `deleteUserPreference` (bulk loop) | same | **BARE** |
| W8 | `pages/api/reviewer-finder/prompt-override.js:105` | `setUserPreference` | `requireAppAccess` (`:36`) | **BARE** — the file's existing `withDalContext('prompt-override-base', …)` at `:54` scopes only `fetchCurrentPrompt`, NOT the prefs calls |
| W9 | `pages/api/reviewer-finder/prompt-override.js:116` | `setUserPreference` | same | **BARE** |

Read call sites (these become the HARD constraint post-swap — reads throw unconditionally):

| # | Call site | Function | Context today |
|---|---|---|---|
| R1 | `lib/utils/auth.js:268` inside `requireAppAccess` (`:237`) — **the auth hot path**, on every app-gated API request whose 2-min cache (`:266-271`) misses | `listAppKeysForUser` | **BARE**. `requireAppAccess` is the thing that *precedes* `withDalContext` in every converted route — it establishes none itself. This is DAL-plan Q4. |
| R2 | `pages/api/app-access.js:57` | `listAllGrantsForAdmin` | BARE |
| R3 | `pages/api/app-access.js:66` | `listAppKeysForUser` | BARE |
| R4 | `pages/api/user-preferences.js:48,:59` | `getUserPreferences` | BARE |
| R5 | `pages/api/reviewer-finder/prompt-override.js:66` | `getUserPreferences` | BARE (outside the `:54` wrap) |
| R6 | `lib/services/email-signature.js:78` | `getUserPreferences` (`.catch(() => ({}))`) | **caller-owned; 6 transitive entry points** (grep): `pages/api/workbench/grantee-deliverables/preview-invite.js`, `lib/services/review-manager/withdraw-sufficient-service.js`, `lib/services/reviewer-reminder-sweep.js`, `lib/services/workbench/grantee-deliverables/send-invite-service.js`, `lib/services/reviewer-acceptance-email.js`, `lib/services/cron/grantee-deliverable-reminders-service.js`. Several of their routes are in the `withDalContext` caller list (e.g. withdraw-sufficient, send-emails), **but per-site coverage is `[UNVERIFIED]` — Stage 1 must verify each of the 6 transitively.** |
| R7 | `lib/services/reviewer-prompt-resolver.js:58` (`readUserOverride`) | `getUserPreferences` | **BARE — CONFIRMED (S339, Codex P1)** `[VERIFIED via source]`. The resolver's only `withDalContext` scopes **just** `fetchCurrentPrompt` (`:91-92`) and CLOSES before `readUserOverride` runs at `:103`; `readUserOverride` reads prefs at `:58` inside `try{…}catch{return null}` (`:57-67`). Both consuming routes call the service OUTSIDE context: `pages/api/reviewer-finder/analyze.js:212` (`analyzeProposal`; its `withDalContext` at `:182` is a different scope, closed) and `pages/api/reviewer-finder/discover.js:496` (`generateDiscoveredReasoning`; wraps at `:182`/`:413` are unrelated, closed). **Post-swap the override read throws → caught → `null` → per-user prompt overrides SILENTLY stop applying.** Fix in Stage 1h. |
| R8 | **Full script census (S339, Codex P2 — rebuilt repo-wide):** 5 LIVE + 1 archived script call these services, NONE with a script bypass `[VERIFIED via grep scripts/ + per-file context check]`: `scripts/test-dataverse-prefs-service.js`, `scripts/test-dataverse-app-access-and-settings.js`, `scripts/test-profiles.js:57,67,72,77-78`, `scripts/test-wave1-flag-dispatch.js:78-79,99-104,140-150,177-194`, `scripts/cleanup-concept-evaluator-grants.js:55,77,92`; plus archived `scripts/archive/backfill-app-access.js` (not run — retire-in-place, note only). | live/probe/cleanup scripts | **No `enterDynamicsBypassForScript` in ANY** (verified). They work only because client.js is unguarded. Post-swap, missing context → service try/catch → `{}`/`null`/`false`/`[]`; the cleanup script would falsely report "nothing to clean." **Convert/retire each BEFORE its entity's Stage 3/4 swap — see Stage 2.5, not Stage 5.** |
| R9 | `getDecryptedApiKey` / `hasPreference` | — | zero live callers (dormant); tests/scripts only |

Facade layering (unchanged by this migration): routes → `lib/services/database-service.js:458-495`
(prefs pass-through) / `lib/services/app-access-service.js` (variable-path require) → the two
Dataverse services. The migration swaps the two services' *internals*; no route import changes.

### 1.4 Behavior-preservation subtleties (each verified)

1. **Sandbox URL discrepancy — REAL, must be probed before any code moves.**
   Services: `DYNAMICS_SANDBOX_URL || DYNAMICS_URL` (prefs `:38`, app-access `:27`).
   DynamicsService: `process.env.DYNAMICS_URL` only — token scope `dynamics-service.js:83`, every
   request URL (`:247,:306,:353,:410,:451,…,:753`). `docs/CREDENTIALS_RUNBOOK.md:102` classifies
   `DYNAMICS_SANDBOX_URL` as "Sandbox CRM instance (**probe scripts only**)". Local `.env.local`
   does NOT set it (verified). **P-1 RESOLVED — CLEARED (2026-07-06/S339)** `[VERIFIED via
   vercel env ls: only DYNAMICS_URL present across Development, Preview, Production; no
   DYNAMICS_SANDBOX_URL in any environment]`. The `SANDBOX || DYNAMICS_URL` fallback is therefore
   **dead code** in these services and the transport swap is **URL-neutral** — no org repoint, no
   data-copy needed. Delete the dead fallback as part of each service's Stage 3/4 swap. OQ-1 is
   closed.

2. **Ownership binding — preserved by construction.** `DynamicsService.createRecord` passes the
   `data` body straight through (`JSON.stringify(data)`, `dynamics-service.js:758-763`), so
   `'ownerid@odata.bind'`, `'wmkf_User@odata.bind'`, `'wmkf_GrantedBy@odata.bind'` keys survive
   byte-identically. `MSCRMCallerID` is a *separate, optional* mechanism: only sent when the
   caller passes `actingUserSystemId` AND `DYNAMICS_IMPERSONATION_ENABLED === 'true'`
   (`:127-132`). **Rule: do NOT pass `actingUserSystemId` in the new adapters** — today's writes
   send no caller-id header; behavior freeze. Characterization tests must assert request-body
   byte-equality including the bind keys.

3. **Entity registry — both entities must be registered.** `entitySet()` throws for any name
   outside `KNOWN_ENTITY_SETS` (`lib/dataverse/core/entity-registry.js:51-59`);
   `wmkf_appuserpreferences` and `wmkf_appuserappaccesses` are ABSENT from the set (`:25-44`).
   `DynamicsService.createRecord` itself takes a raw string and does NOT validate against the
   registry — but every existing adapter goes through `entitySet()` at module top (e.g.
   `adapters/system-user.js:23`, `adapters/policy.js:34-35`), and that is the house style.
   **Approach: add both names to `KNOWN_ENTITY_SETS` deliberately.** The registry's own comment
   says the set is seeded from the access census — both entities ARE census buckets (they appear
   in the Stage-0 census via client.js call attribution, DAL plan `:371-375`), and the set names
   are proven live (the current services have been writing to these exact URLs since 2026-05-12).
   No `SELECT` constants needed in the registry — keep the byte-identical `$select` strings local
   to the adapter (registry only hosts *shared* primary selects).

4. **OData escaping / guarded-swap pins — preserved, pin tests migrate deliberately.** The
   non-string-rejection-BEFORE-escape lives in each `findRow`. The pin test injects a fake
   `client` (`{get: jest.fn()}`) and asserts no `client.get` call — that shape dies when
   `findRow` stops taking a client. **The behavior-level pin (TypeError + zero transport calls)
   must survive**: the type guard moves into the adapter's find function (before any
   `DynamicsService.queryRecords` call), and the pin test is rewritten to mock DynamicsService
   and assert `queryRecords` was never invoked. Because this alters a test that encodes an
   S331 owner ruling, flag the rewrite in the commit message and reconcile the OData Escape
   Consolidation Plan doc if it names the file/line.

5. **Failure-mode contract — try/catch boundaries stay in the services.** Adapters follow house
   style ("restriction-context posture is CALLER-OWNED", throw structured `buildServiceError`
   errors — `adapters/policy.js:15-20`, `dynamics-service.js:765-768`). The two services keep
   their exact public API and their log+return-falsy catch blocks; only the code inside the try
   changes from `client.*` to adapter calls. Caller-visible behavior (including the
   `{granted:[], error: message}` shapes) is unchanged. Note the error *message text* inside
   logs changes (structured service errors vs `find pref failed: <status>`); that is log-only
   and acceptable — no route caller branches on message text [VERIFIED via
   `pages/api/user-preferences.js:89,:102,:135` (`const success =` truthy checks),
   `pages/api/reviewer-finder/prompt-override.js:105` (`const ok =`),
   `pages/api/app-access.js:88,:105` (return value not captured)].

6. **`setUserPreferences` loops over `setUserPreference`** (prefs `:127-131`) — per-key writes,
   no changeset. Keep the loop (behavior freeze; partial-success semantics identical).
   `grantApps`/`revokeApps` likewise loop per appKey — keep; do NOT introduce
   `core/changeset.js` batching in this migration.

### 1.5 Gate + test landscape

- **The brief's `scripts/dataverse-access-allowlist.json` DOES NOT EXIST.** The census gate is
  allowlist-free LAW mode: "No allowlist file, no count ratchet — this is the law"
  (`scripts/check-dataverse-access-layer.js:177,:1327`). Nothing to edit as callers move; the
  gate re-derives the census each run. Stage plan section 4 replaces the brief's allowlist step
  with "run gate + self-test, diff the census report before/after each swap".
- `check:dynamics-context-boundary`: `withDalContext` always allowed anywhere (`:45`), raw
  `bypassDynamicsRestrictions` only inside `core/context.js`, `enterDynamicsBypassForScript`
  only under `scripts/`. All planned edits are gate-conformant.
- `check:route-service-boundary`: unaffected — routes keep importing the service facades; the
  adapters are consumed by `lib/services/*`, the sanctioned layer.
- Jest pins that touch this surface: `tests/unit/dataverse-guarded-swap-odata-escape.test.js`
  (rewrites per 1.4.4), `dal-universal-guard.test.js` (flag semantics — unchanged),
  `dal-enforcement.test.js` (must stay green every stage), `nextauth-signin-dal-context.test.js`
  (extend for the grantDefaultApps wrap), `app-access-context.test.js` (jsdom UI guard — exercises
  the fetch contract, unaffected but run). Full-suite baseline: 4945 passing (S338).
- Suites + gates named in `SESSION_PROMPT.md:113-121` run at every stage boundary.

### 1.6 Open questions for the owner

- **OQ-1 — CLOSED (2026-07-06/S339).** `DYNAMICS_SANDBOX_URL` is unset in all Vercel runtime
  environments `[VERIFIED via vercel env ls: only DYNAMICS_URL across Dev/Preview/Prod]`. No org
  repoint risk; the swap is URL-neutral; no data copy needed. Nothing blocks Stage 3 on this axis.
- **OQ-2:** Warn-mode observation window length before each swap stage (recommendation: ≥3
  weekdays of prod traffic including at least one fresh staff sign-in; the S330 enforcement flip
  used a runtime-log-scan protocol — reuse it).
- **OQ-3:** After both entities migrate, the only remaining `client.js` write surfaces are
  `wmkf_appsystemsettings` (Wave 3) + `wmkf_appgrantcycles` (Wave 6) + identity-map reads. Flip
  `DATAVERSE_DAL_UNIVERSAL` to `warn`→`on` for that tail on the same schedule, or leave until
  those waves land? (This plan only *requires* `warn`.)
- **OQ-4:** Pin-test rewrite consent per 1.4.4 (S331 ruling artifact).
- **OQ-5 — RESOLVED (2026-07-06/S339): option (a) — add a bounded admin-list primitive to
  DynamicsService.** `listAllGrantsForAdmin` is an unfiltered full-entity pull that no current
  read primitive supports (`queryRecords` throws on unfiltered `>25`; `queryAllRecords` requires a
  filter — `dynamics-service.js:405-406,:591-592`). Owner chose to add the primitive (not keep
  `listAll` on `client.js`), consistent with the Q9 reversal's goal of full `client.js`
  retirement. Design (Stage 4 step 0): a `queryAllRecordsAdmin(entitySet, {select, orderby})`
  (name TBD at build) that permits an explicit no-filter pull, reuses the SAME
  `checkRestriction` context guard as the other reads, walks `@odata.nextLink`, and caps at
  `MAX_EXPORT_RECORDS` (5000) — i.e. `queryAllRecords` minus the filter requirement, gated so ONLY
  an explicit admin call reaches it. This is a DynamicsService-surface addition → coordinate with
  the decomposition (§6): it lands in the facade before Checkpoint A extracts read-ops, or in
  `read-ops`/`http` if it lands after.

---

## 2. Dependency graph (what must land before what)

```
P-1 sandbox-URL env probe (OQ-1)  ── DONE/CLEARED S339 (no SANDBOX var in any Vercel env)
                                                 │ (was: blocks any transport swap — now resolved)
Stage 1  Context wraps (Q4 + all entry points)   │
  1a  lib/utils/auth.js requireAppAccess wrap  ◄─┼── HIGHEST BLAST RADIUS (every app route)
  1b  nextauth grantDefaultApps wrap             │
  1c  user-preferences.js handler wraps          │
  1d  app-access.js handler wraps                │
  1e  prompt-override.js scope extension         │
  1f  read-side warn probes added to services    │
  1g  verify 6 email-signature transitive paths  │
  1h  reviewer-prompt-resolver override wrap    ◄─┴── CONFIRMED bare (Codex P1); +overrideUsed test
        │
        ▼
Stage 2  DATAVERSE_DAL_UNIVERSAL=warn in preview→prod; observe clean window (OQ-2)
        │   (exercise incl. a prompt-override user's analyze+discover run — the 1h path)
        ▼
Stage 2.5  Script bypass conversion (5 live R8 scripts → enterDynamicsBypassForScript / retire)
        │   per entity, BEFORE its swap (Codex P2)
        ▼
Stage 3  PREFS wave  (characterize → adapter → swap → gates → deploy → live-verify)
        │   (prefs first: OFF the auth hot path; proves the pattern)
        ▼
Stage 4  APP-ACCESS wave (same shape; auth hot path — only after prefs proven in prod)
        │
        ▼
Stage 5  Closeout: confirm R8 scripts converted, docs/wiki/plan reconcile, warn-flag posture (OQ-3)
```

Hard orderings, stated per entry point:

- **Q4/wrap-before-swap is a prerequisite, not an option.** Every row of the 1.3 tables must be
  inside a trusted context before the function it calls moves to DynamicsService. The reads make
  this absolute: `checkRestriction` throws with no flag to soften it (`dynamics-service.js:183+`).
- **R1 (`requireAppAccess`) must land before Stage 4** — it is the only context source for the
  `listAppKeysForUser` hot path. Separately, **all prefs READ paths (1c/1e route wraps + 1g
  email-signature + 1h reviewer-prompt-resolver) must land before Stage 3** — the reviewer-finder
  override read (1h) was CONFIRMED bare (Codex P1), so "prefs reads all have their own wrap" was
  FALSE as originally written; 1h closes it. 1a still lands first in Stage 1 regardless.
- **W1 (`grantDefaultApps`) must land before Stage 4** — first-sign-in grant path.
- Stage 3 and Stage 4 are **separable and independently shippable/revertible**; prefs first
  because its blast radius is bounded (prefs UI, email signature block, prompt overrides — all
  with falsy/`.catch(()=>({}))` fallbacks), while app-access failure denies every app to every
  user. Do not batch them into one commit or one deploy.

---

## 3. Stages

### Stage 0 — Preconditions (no code)
1. P-1 — **DONE (2026-07-06/S339): `DYNAMICS_SANDBOX_URL` absent from all Vercel envs** (only
   `DYNAMICS_URL` across Dev/Preview/Prod) `[VERIFIED via vercel env ls]`. Swap is URL-neutral;
   OQ-1 closed. No remaining action on this axis.
2. Baseline: full jest suite green (4945 baseline), all four gates + self-tests green, census
   report snapshot (`node scripts/check-dataverse-access-layer.js --report`) saved to scratchpad
   for before/after diffing.
3. Confirm prod still runs `DATAVERSE_DAL_ENFORCEMENT=on` and `DATAVERSE_DAL_UNIVERSAL` unset.

### Stage 1 — Context wraps (one commit per file; no transport change; zero behavior change with flag off)
Each commit: wrap + a `*-dal-context` test proving the call now executes inside ALS context
(mirror `tests/unit/nextauth-signin-dal-context.test.js`'s shape) + `check:dynamics-context-boundary`.

- **1a `lib/utils/auth.js`** — inside `requireAppAccess`, wrap ONLY the lookup:
  `withDalContext('auth-app-access-lookup', () => listAppKeysForUser(profileId))` (`auth.js:268`).
  Post-session-validation, so self-certifying per Q4 (`withDalContext` performs no auth — it
  labels a scope; NextAuth precedent `staff-signin-reconcile`). Keep the wrap NARROW (the lookup
  only, not the whole gate) so the Postgres role checks stay outside. `requireSuperuser` needs no
  wrap [VERIFIED via `auth.js:356-371`: it delegates to `requireAuthWithProfile` (session +
  Postgres, `:155-161`) and `getUserRole` (Postgres `dynamics_user_roles`, `:326-332`) — no
  Dataverse read on that path].
- **1b `pages/api/auth/[...nextauth].js`** — wrap `:324`:
  `withDalContext('staff-signin-default-grants', () => grantApps(profileId, DEFAULT_APP_GRANTS, null))`.
  Keep it inside `grantDefaultApps`'s existing try/catch (sign-in stays non-fatal, `:322-329`).
  Extend `nextauth-signin-dal-context.test.js`.
- **1c `pages/api/user-preferences.js`** — wrap the three handler bodies after
  `requireAuthWithProfile` (`:25-35`): `withDalContext('user-preferences', () => handleX(...))`
  at the dispatch, covering W4–W7 + R4 in one scope.
- **1d `pages/api/app-access.js`** — same shape after `requireAuthWithProfile` + role fetch
  (`:28-37`): scope label `'app-access-admin'`, covering W2, W3, R2, R3.
- **1e `pages/api/reviewer-finder/prompt-override.js`** — extend context to cover `:66,:105,:116`
  (either widen the handler-level wrap or add `withDalContext('prompt-override-prefs', …)` around
  the prefs block). Today's `:54` wrap covers only `fetchCurrentPrompt`.
- **1f read-side warn probes** — add `assertDataverseAccess('prefs:read')` /
  `('app-access:read')` at the top of `getUserPreferences`, `getDecryptedApiKey`,
  `hasPreference`, `listAppKeysForUser`, `listAllGrantsForAdmin` — **INSIDE the try block**
  (unlike the existing write asserts) so even a future `on` flip preserves the falsy read
  contract while DynamicsService remains the real enforcement point. Purpose: warn-mode logs
  now observe the exact paths that become throw-on-missing-context after the swap. Extend
  `dal-universal-guard.test.js` for the new labels. (The write asserts at prefs
  `:85,:125,:140` / app-access `:101,:132` stay where they are until Stage 3/4 removes them
  with the transport.)
- **1g transitive verification (no code unless a gap is found)** — for the 6
  `email-signature.js` consumers (list in 1.3 R6): trace route/cron entry → confirm the prefs
  read executes inside an existing `withDalContext`/`bypassDynamicsRestrictions` scope. Any bare
  path gets a wrap at ITS entry point (own commit). Crons must be inside their
  `verifyCronSecret`-then-context pattern. Record the per-site verdicts in the stage log — this
  list is the read-coverage proof Stage 3 depends on. (The `reviewer-prompt-resolver` path is no
  longer `[UNVERIFIED]` — it was traced and CONFIRMED bare; its fix is 1h below.)
- **1h reviewer-prompt-resolver override read — CONFIRMED BARE, concrete fix (S339, Codex P1).**
  `readUserOverride` (`lib/services/reviewer-prompt-resolver.js:55-68`) reads prefs OUTSIDE any DAL
  context (the module's `withDalContext` at `:91-92` scopes only `fetchCurrentPrompt` and closes
  before the override read at `:103`; both routes — `analyze.js:212`, `discover.js:496` — call the
  service outside context). Fix at the **service layer** per the module's own documented ownership
  ("The resolver owns the `withDalContext` wrap for its Dataverse fetch", `:20-21`): wrap the
  override read too —
  `withDalContext('reviewer-prompt-override-read', () => readUserOverride(userProfileId, promptName))`
  (or widen a single wrap to cover both the `fetchCurrentPrompt` and override reads). Do NOT push
  the wrap into the two routes (leaves the service unsafe for any future caller). **Test:** extend
  the resolver's suite to assert `overrideUsed: true` (and the stale-override branch) still resolve
  AFTER the prefs transport swap — i.e. mock DynamicsService with an ALS check that throws when
  unwrapped, proving the wrap is load-bearing. Also add reviewer-finder `analyze`/`discover` to the
  Stage 2 warn-mode exercise list (below). This commit lands in Stage 1 (inert with the flag off,
  correct under both transports).

Gates for Stage 1: `check:dynamics-context-boundary` (+ self-test), full jest suite. No census
change expected (transport untouched).

### Stage 2 — Warn-mode observation (no code)
Set `DATAVERSE_DAL_UNIVERSAL=warn` in preview, exercise: fresh sign-in (new profile), prefs
save/load, admin grant/revoke, prompt-override save, **a reviewer-finder `analyze` AND `discover`
run BY A USER WHO HAS A SAVED PROMPT OVERRIDE** (exercises the 1h path — confirms
`overrideUsed:true` and no `[dal-universal]`/`Restrictions not initialized` line), one review-email
render (signature path), cron tick. Then prod, observe OQ-2 window. **Exit criterion: zero
`[dal-universal]` lines.** Any line = a missed path; fix its wrap (return to Stage 1) before
proceeding. Leave the flag at `warn` through Stages 3–4 (it keeps observing the not-yet-migrated
entity while the first one migrates).

### Stage 2.5 — Script bypass conversion (BEFORE any transport swap; S339, Codex P2)
The 5 live scripts in 1.3 R8 read/write these services with NO trusted context and work ONLY
because client.js is unguarded today. Post-swap they silently degrade (missing context → caught →
falsy), and `cleanup-concept-evaluator-grants.js` would falsely report "nothing to clean." Before
Stage 3 touches prefs and before Stage 4 touches app-access, for EACH script that calls the
entity about to move: add an `enterDynamicsBypassForScript` bootstrap (Q3 shared-helper pattern,
`scripts/`-only per `check:dynamics-context-boundary`) or retire the script. Archived
`scripts/archive/backfill-app-access.js` is not run — leave in place, note only. Checklist item in
each swap stage; do not defer to Stage 5.

### Stage 3 — Prefs wave (order: characterize → adapter → swap → gates → deploy → verify)
1. **Characterization tests first** (must pass against CURRENT code): mock
   `lib/dataverse/client.js` (`createClient`/`getAccessToken`) and pin, for all 7 functions:
   exact request paths (`/wmkf_appuserpreferences?$filter=…&$select=…&$top=1` byte-for-byte),
   create/patch bodies incl. `'ownerid@odata.bind'`, encryption round-trip (encrypted keys list
   `:29-35`), masking on non-decrypted reads, falsy returns on transport failure and on unmapped
   profile, delete-of-absent-row returns `true` (`:146`).
2. **Adapter** `lib/dataverse/adapters/user-preference.js`: register
   `'wmkf_appuserpreferences'` in `KNOWN_ENTITY_SETS`; functions
   `findByOwnerAndKey(systemuserid, key)` (carries the S331 non-string guard first),
   `listByOwner(systemuserid)`, `create(body)`, `update(id, body)`, `remove(id)`; header comment
   documents CALLER-OWNED context posture (house style, cf. `adapters/system-user.js:14-17`).
   No `actingUserSystemId`. Adapter-level guarded-swap pin test added alongside.
   **Read-primitive constraint (Codex re-review P1, CONFIRMED `[VERIFIED via
   dynamics-service.js:398-407,:590-593]`):** `DynamicsService.queryRecords` caps
   `$top = min(top||25, 100)` and throws on `!filter && top>25`. The current per-user prefs read
   has NO `$top` (`dataverse-prefs-service.js:63-66`), so a naive `queryRecords` route would
   SILENTLY CAP at 25. `findByOwnerAndKey` (single row, `$top=1`) is fine on `queryRecords`. For
   `listByOwner` (a user's full pref set) use the **filtered paginated** primitive
   `DynamicsService.queryAllRecords(entitySet, {select, filter})` — it requires a filter (owner id
   IS the filter, so allowed) and walks `@odata.nextLink` to `MAX_EXPORT_RECORDS` (5000). Do NOT
   route `listByOwner` through `queryRecords`. Adds a characterization test with **>25 prefs for
   one owner** proving no truncation.
3. **Swap** `dataverse-prefs-service.js` internals: drop `getClient`/`client.js` imports and the
   `DYNAMICS_SANDBOX_URL` fallback; call the adapter inside the existing try/catch blocks;
   encryption stays in the service; delete the service-local `findRow` + its
   `assertDataverseAccess('prefs:write')`/`'prefs:read'` asserts (DynamicsService +
   checkRestriction now enforce for real); re-point the guarded-swap pin test per 1.4.4; keep
   `module.exports` API identical minus `findRow` **only if** nothing but the pin test imports
   it (verified: tests only) — otherwise re-export the adapter's finder under the same name.
4. Characterization tests updated to mock DynamicsService instead of client.js and pass with
   identical assertions on shapes/fallbacks (query-string equality against step-1 pins).
5. **Gates + suites**: `check:dataverse-access-layer` + self-test (census diff: prefs bucket
   moves client.js → adapter; zero new violations), `check:route-service-boundary`,
   `check:dynamics-context-boundary`, jest DAL suites + full suite.
6. **Commit, deploy preview → prod**; live-verify: prefs page round-trip, prompt-override save,
   email-signature render; log-scan for `Restrictions not initialized` / `no trusted Dataverse
   context` / `[dataverse-prefs]` errors.

### Stage 4 — App-access wave (only after Stage 3 has soaked in prod; OQ-2 window)
Same six steps for `dataverse-app-access-service.js` → `lib/dataverse/adapters/app-access.js`
(register `'wmkf_appuserappaccesses'`; mirrors for `findByUserAndApp`, `listByUser`, `listAll`,
`create` (bind keys preserved), `remove`). Postgres `user_profiles` read and identity-map calls
stay in the service (cross-store join is service logic, not adapter transport).

**Read-primitive constraint (Codex re-review P1, CONFIRMED `[VERIFIED via
dynamics-service.js:398-407,:590-593]`) — two distinct cases:**
- `findByUserAndApp` (single row, `$top=1`) and `listByUser` (per-user grants, filtered by user
  id; bounded by the app-definition count — a dozen-ish, far under any cap) → `queryRecords` is
  safe for the single-row find; use `queryAllRecords` (filtered) for `listByUser` to be
  truncation-proof.
- **`listAllGrantsForAdmin` needs a new read primitive (OQ-5 RESOLVED → option a).** It is a
  deliberately UNFILTERED full-entity pull (`dataverse-app-access-service.js:71-75`, `$top=5000`,
  all grants across all users). BOTH current DynamicsService read primitives reject it:
  `queryRecords` throws (`!filter && top>25`, `:405-406`) and `queryAllRecords` throws on the
  missing filter (`:591-592`). **Stage 4 step 0 (before the swap):** add the bounded admin
  primitive per OQ-5 (`queryAllRecordsAdmin` or similar — no-filter allowed, same
  `checkRestriction` guard, `@odata.nextLink`, 5000 cap) with its own unit test, then route the
  adapter's `listAll` through it. Do not begin the caller swap until that primitive is in and
  tested. Coordinate the DynamicsService addition with the decomposition (§6).

Extra rigor for the hot path:
- Preview E2E BEFORE prod: fresh sign-in (new profile → default grants → landing page), plus an
  existing user hitting an app route with a cold cache.
- Deploy prod at a low-traffic moment; watch logs live; the 2-min app-access cache
  (`auth.js:266-271`) means a regression surfaces within minutes, not instantly — scan for
  `[dataverse-app-access] listAppKeysForUser error` specifically, and treat ANY occurrence as
  rollback trigger (it means every affected user is being denied all apps).
- Rollback = single-commit revert of the swap commit (Stage-1 wraps stay — they are correct for
  both transports; the interim client.js path has no context requirement).

### Stage 5 — Closeout
- Script bypass conversion is DONE in Stage 2.5 (moved earlier per Codex P2) — Stage 5 only
  confirms every R8 script is converted/retired and re-runs the R8 census to prove none regressed.
- Durable-docs reconcile (`.claude/rules/durable-docs.md` / `/sweep`): DAL plan Q9 decision +
  Stage 9 gap-detail (the "in NO wave" and census claims at `:371-380` become historical), stage
  log entry; `docs/agent-wiki/topics/dataverse-dynamics.md` (client.js write surface shrinks;
  assert-count claims); `SESSION_PROMPT.md` next-items; `dynamics-context.js` header comment
  (`:184-192` names the two services as the guarded client.js write sites — now stale);
  `database-service.js`/`app-access-service.js` header comments; CREDENTIALS_RUNBOOK untouched.
- OQ-3 decision on `DATAVERSE_DAL_UNIVERSAL` posture for the remaining client.js tail
  (settings + grant-cycles + identity-map). This migration leaves the flag at `warn`.

---

## 4. Gates per stage (summary)

| Stage | Gates (sequential with their self-tests, never parallel) | Jest |
|---|---|---|
| 1 | `check:dynamics-context-boundary` (+ self-test) | new `*-dal-context` tests; `dal-universal-guard`; full suite |
| 3, 4 | `check:dataverse-access-layer` (+ self-test), `check:route-service-boundary` (+ self-test), `check:dynamics-context-boundary` (+ self-test) | characterization suites (pre- and post-swap), rewritten guarded-swap pins, `dal-enforcement`, `dynamics-service-count`*, full suite |
| 5 | all four + `npm run check:agent-invariants` if instruction files touched | full suite |

*`tests/unit/dynamics-service-count.test.js` (decomposition covering suite) may pin
DynamicsService method counts/callers — if it counts call sites, the new adapter calls may move
its numbers; reconcile deliberately, never by loosening the decomposition baseline
`[UNVERIFIED — inspect the test at Stage 3 step 5]`.

**Allowlist note (brief correction):** there is no `scripts/dataverse-access-allowlist.json`; the
census gate is allowlist-free LAW mode (`check-dataverse-access-layer.js:1327`). The "allowlist
will change as callers move" step from the brief is replaced by: snapshot the `--report` census
before each swap, diff after, and confirm the entity's bucket moved from client.js attribution to
adapter attribution with zero new violations.

## 5. Risks & rollback

| Risk | Mechanism | Mitigation |
|---|---|---|
| **Auth-path silent lockout** (highest) | post-swap missing context → `checkRestriction` throw → caught → `[]` → every user "Access Not Available"; NOT a 500, so no error-rate alarm | Stage-1 wrap of `requireAppAccess` lands first and is warn-observed (Stage 2) against the SAME ALS predicate DynamicsService uses; app-access swapped LAST (Stage 4) after prefs proves the pattern; explicit log-scan trigger on `[dataverse-app-access]` error lines; single-commit revert |
| ~~Sandbox-URL repoint~~ **RESOLVED** | services' `SANDBOX \|\| URL` fallback vs DynamicsService's `DYNAMICS_URL` | **CLOSED S339: no `DYNAMICS_SANDBOX_URL` in any Vercel env `[VERIFIED via vercel env ls]` → fallback is dead code, swap URL-neutral.** Delete the dead fallback during each swap |
| Ownership-binding regression | different create path | bind keys pass through `createRecord` body verbatim (`dynamics-service.js:758-763` [VERIFIED]); characterization asserts body bytes; never pass `actingUserSystemId` |
| **List reads truncate/throw through `queryRecords`** (Codex re-review P1, CONFIRMED) | `queryRecords` caps `$top≤100`, defaults 25, throws on unfiltered>25 (`dynamics-service.js:398-407`); per-user prefs list has no `$top`, admin `listAll` is unfiltered `$top=5000` | per-user lists use filtered `queryAllRecords`; `listAll` gets a new bounded admin primitive (OQ-5 RESOLVED → option a, Stage 4 step 0); char-tests with >25 prefs / bulk grants |
| **Prompt-override silently stops applying** (Codex P1, CONFIRMED) | `reviewer-prompt-resolver` override read is bare → post-swap throws → caught → `null` → `overrideUsed:false`, no error | **1h** wraps the read at the service layer + an `overrideUsed:true`-survives-swap test; analyze/discover added to the Stage-2 warn exercise |
| Missed read path (email-signature transitive callers, crons) | reads throw unconditionally | Stage 1g per-site verification with recorded verdicts; Stage-2 warn logs from the 1f read probes catch anything the static trace missed |
| Pin-test erosion (S331 ruling) | `findRow` signature change | behavior-level pin re-established at adapter level (TypeError + zero transport calls); owner flagged (OQ-4) |
| Prod throw via warn→on mis-sequencing | write asserts sit OUTSIDE try blocks | this plan never flips `DATAVERSE_DAL_UNIVERSAL=on`; it stays `warn` (observability) and real enforcement arrives via the transport swap, whose throws land INSIDE the service try/catch preserving falsy contracts |
| Scripts break/lie post-swap (Codex P2, CONFIRMED) | 5 live scripts have no script bypass; cleanup script would falsely report "nothing to clean" | **Stage 2.5** converts/retires each per entity BEFORE its swap (Q3 pattern); full R8 census rebuilt repo-wide |

**Rollback story per stage:** Stage 1 wraps are inert without the flag and correct under both
transports — never rolled back. Stage 3/4 swaps are each ONE commit touching one service + one
new adapter + registry line + tests; revert restores client.js transport instantly with no env
change needed (client.js path has no context requirement; `warn` flag tolerates it).

## 6. Interaction with the DynamicsService decomposition

- The keystone `dynamics/http.js` Dataverse-fetch guard is strictly post-Checkpoint-F (DAL plan
  `:414-417,:426-428`); this migration neither waits for it nor conflicts with it — DAL plan
  states steps 1–2-type work is "disjoint from the decomposition and may proceed independently"
  (`:427-428`). Decomposition is at Stage 0 DONE / Checkpoint A pending (SESSION_PROMPT S339).
- The adapters consume only the frozen DynamicsService facade surface
  (`queryRecords`/`getRecord`/`createRecord`/`updateRecord`/`deleteRecord`), which the
  decomposition preserves by contract (full-surface facade, Q2 decision). Safe to run in
  parallel **but do not interleave commits**: land each Q9 stage between decomposition
  checkpoints, and re-run the decomposition covering suites (`SESSION_PROMPT.md:117-119`) after
  each Q9 swap since both threads touch `dynamics-service.js`'s callers/tests.
- Bonus convergence: after Stage 4, the client.js "tail" shrinks to settings + grant-cycles +
  identity-map + scripts, simplifying the post-Checkpoint-F keystone rollout and making the
  Stage-9 `client.js` interim guard nearly vestigial (OQ-3).

---

## Executive summary (recommended sequence)

1. ~~Probe `DYNAMICS_SANDBOX_URL`~~ **DONE (S339): absent from all Vercel envs `[VERIFIED via
   vercel env ls]` → swap is URL-neutral, dead fallback removed during each swap.**
2. Wrap all context roots first — `requireAppAccess`'s `listAppKeysForUser` lookup (Q4),
   nextauth `grantDefaultApps`, `user-preferences.js`, `app-access.js`, `prompt-override.js`, and
   the **reviewer-prompt-resolver override read (1h — Codex P1, confirmed bare)** — one commit per
   file, each with a dal-context/`overrideUsed` test; add warn-mode read probes to the five read
   functions; verify the 6 email-signature transitive paths.
3. Flip `DATAVERSE_DAL_UNIVERSAL=warn` (preview→prod) and hold until logs are clean, because
   post-swap a context gap is a SILENT access denial (caught → falsy), not a crash. Exercise a
   prompt-override user's analyze+discover (the 1h path) in the warn window.
4. **Convert/retire the 5 live R8 scripts** to `enterDynamicsBypassForScript` per entity BEFORE
   its swap (Stage 2.5 — Codex P2), else they silently degrade / mis-report post-swap.
5. Migrate PREFS first (off the auth hot path; bounded blast radius): characterization tests →
   `adapters/user-preference.js` + registry entry → swap service internals keeping API,
   try/catch falsy contract, encryption, and the S331 non-string pin (moved to adapter level).
6. Soak, then migrate APP-ACCESS the same way, with preview sign-in E2E and live log watch;
   rollback is a one-commit revert per wave (wraps are transport-agnostic and stay).
7. Close out: confirm R8 scripts converted, census re-snapshot, durable-docs sweep (DAL plan Q9 +
   Stage 9 text, wiki, dynamics-context.js header), leave `warn` standing for the client.js tail.

---

## Review log

- **2026-07-06 (S339) — Fable draft, Claude-verified, P-1 probed.** Plan authored (Fable) against
  `main`; Claude verified the three pillar claims against source (`checkRestriction` unconditional
  throw `dynamics-service.js:188-190`; both entities absent from `KNOWN_ENTITY_SETS`; no
  allowlist file → LAW mode) and probed P-1 (`vercel env ls` → no `DYNAMICS_SANDBOX_URL` in any
  env; swap URL-neutral). Promoted to this durable doc.
- **2026-07-06 (S339) — Codex adversarial review: REFUTED-as-written → patched.** Two findings,
  both verified against source by Claude before folding in:
  - **P1 (high) CONFIRMED** — the reviewer-finder prompt-override read (`reviewer-prompt-resolver.js`
    `readUserOverride`, prefs read at `:58`) runs OUTSIDE DAL context: the module's `withDalContext`
    (`:91-92`) scopes only `fetchCurrentPrompt` and closes before the override read at `:103`; both
    routes (`analyze.js:212`, `discover.js:496`) call the service outside context. Post-swap →
    silent loss of per-user overrides. Fix: **new Stage 1h** (service-layer wrap + `overrideUsed`
    test); analyze/discover added to the Stage-2 warn exercise. The plan's prior "prefs reads all
    have their own wrap" claim was false; corrected.
  - **P2 (medium) CONFIRMED** — script census was incomplete. Rebuilt repo-wide: **5 live scripts**
    (`test-dataverse-prefs-service`, `test-dataverse-app-access-and-settings`, `test-profiles`,
    `test-wave1-flag-dispatch`, `cleanup-concept-evaluator-grants`) + 1 archived, NONE with a
    script bypass. Fix: **new Stage 2.5** converts/retires each per entity BEFORE its swap (was
    deferred to Stage 5).
  - Re-review requested from Codex over the patched plan.
- **2026-07-06 (S339) — Codex re-review: SOUND-WITH-FIXES.** Confirmed P1/P2 adequately closed by
  Stage 1h + Stage 2.5. One NEW finding, verified against source by Claude and folded in:
  - **P1-list (high) CONFIRMED** — the adapter recipe routed list reads through
    `DynamicsService.queryRecords`, which caps `$top=min(top||25,100)` and throws on unfiltered
    `>25` (`dynamics-service.js:398-407`). Per-user prefs list (no `$top`) would silently cap at
    25; admin `listAllGrantsForAdmin` (unfiltered `$top=5000`) would throw. Claude went one level
    deeper: the existing paginated primitive `queryAllRecords` (`:590`) REQUIRES a filter
    (`:591-592`), so it fixes per-user lists but CANNOT serve the unfiltered admin pull — there is
    no existing primitive for it. Fixes: Stage 3/4 recipes now use filtered `queryAllRecords` for
    per-user lists + char-tests >25; **new OQ-5** blocks Stage 4 until the `listAll` read path is
    decided (add a bounded admin primitive vs. keep only `listAll` on `client.js`).
  - Stage 1h and Stage 2.5 confirmed correct as written; no regression.
- **2026-07-06 (S339) — OQ-5 resolved by owner; plan is EXECUTION-READY.** Owner chose option (a):
  add a bounded admin-list primitive to DynamicsService for `listAllGrantsForAdmin` (full
  `client.js` retirement, matching the Q9 reversal goal). Folded into OQ-5, Stage 4 step 0, and
  the risk table. All open blockers now resolved (P-1 cleared; OQ-1 closed; OQ-5 decided). OQ-2
  (warn window) and OQ-4 (S331 pin-test consent) remain execution-time confirmations, not
  blockers. Per owner: **no further Codex review before build; Codex reviews the implementation
  after the build.** Next actor: build executor, starting Stage 1.

No decomposition checkpoint is a prerequisite; only avoid interleaving commits with it.
