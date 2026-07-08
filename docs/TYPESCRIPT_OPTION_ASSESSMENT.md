---
title: The TypeScript Option — Assessment
domain: architecture
kind: decision
status: draft
summary: "Whether/how to adopt TypeScript, the lever behind the Invariant Map's rung-1 finding. Recommends a scoped checkJs gate on the selector core, not file renames."
---

# The TypeScript Option — Assessment

> Produced 2026-07-07 by Fable orchestration as the follow-on to
> `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` (§4 decision 1). Read-only assessment; no code
> changed. Method: two parallel Opus investigators over the actual repo — one mapping each
> invariant surface to its TS mechanism, one auditing the tooling/CI/build friction — plus
> direct verification of the gate-extension-sensitivity and build-coupling claims. Every
> `file:line` below was read this session by an investigator or by Fable; treat as a pointer to
> re-verify before acting (`main` auto-deploys, line numbers drift).

> **Implementation status (S342).** Phase 0 + Phase 1 SHIPPED as a single standalone
> `check:types` gate (`tsconfig.check.json`, wired into `.github/workflows/test.yml`). Covered +
> `@ts-check`'d: `lib/utils/guid.js` (branded `Guid`), `lib/dataverse/core/changeset.js`,
> `lib/services/dynamics/read-ops.js` (branded `recordId` on `getRecord`),
> `lib/services/dynamics-service.js` (the FACADE — read wrappers restored from `...args` to real
> typed signatures; write selectors `updateRecord`/`updateIfEmpty`/`deleteRecord`/`disassociate`
> brand `recordId` as `Guid`), `lib/utils/actor-ref.js` (branded `ActorRef`),
> `lib/services/workbench/triage-service.js`, `lib/services/reviewer-rollup.js` (enum
> exhaustiveness), and the `pages/api/workbench/triage.js` call-site. Two disconfirming checks
> confirmed the gate BITES end-to-end: a raw `string` is rejected for `Guid` through the PUBLIC
> `DynamicsService.getRecord/updateRecord/deleteRecord(...)` facade (not only the internal module),
> and for `ActorRef` through `setTriageStatus`. Facade coverage was completed this session in
> response to a Codex adversarial-review finding (the earlier module-only gate could pass while raw
> selector strings compiled through the untyped facade). Phase 2 (`.ts` migration) remains a
> separate future owner decision, unchanged.

## 0. Bottom line (read this first)

**Recommend: YES to TypeScript's *type-checker*, NO to a `.ts` file migration — at least to start.**
Adopt a scoped **`checkJs` + JSDoc-branded-types gate** over the identity/selector core, run as
a standalone `tsc --noEmit` CI check. This buys the single thing plain JS cannot give — a
compiler-forced branded type on the GUID trust boundary and the actor identity — **without
renaming a single file**, which matters more here than in a normal codebase for one specific
reason surfaced below.

**Two findings reframe the whole question:**

1. **The map's #1 target is not a TypeScript win.** The highest-blast-radius class in the map
   — DAL entity-write outside trusted context (#1, Tier-A first target) — guards *the presence
   of an active `AsyncLocalStorage` store*: `assertTrustedDalContext` throws when
   `getDynamicsContext()` is falsy [VERIFIED via `lib/services/dynamics-context.js:141`]. "Is
   this call site running inside `withDalContext`?" is a **runtime property a type system cannot
   see.** TS does **not** lift #1. That work stays a runtime-assert-at-a-chokepoint job
   regardless of this decision. TS and the map's top priority are orthogonal — do not let a TS
   project delay #1.

2. **Renaming a file to `.ts` is a security-gate regression here, not a neutral refactor.**
   Five of the repo's own `check:*` gates filter their file set to `.js`/`.mjs` and would
   **silently stop scanning** a renamed `.ts` file (fail-open): `check-trust-boundary-guid` (the
   GUID gate itself, `full.endsWith('.js')` [VERIFIED via `scripts/check-trust-boundary-guid.js:116`]),
   `check-odata-escape` (`JS_EXT_RE=/\.(?:js|mjs)$/`, excludes ts/tsx), `check-route-lifecycle-auth`,
   `check-model-override-warming`, and `check-api-route-security-matrix` (`.filter(f=>f.endsWith('.js'))`
   [VERIFIED via `scripts/check-api-route-security-matrix.js:85`]). Four also parse with
   `@babel/parser` `plugins:['jsx']` and no `typescript` plugin, so a `.ts` file forced through
   would *throw*. **The incremental-rename strategy that is normally the safe default is the
   dangerous one in this repo.** This is the decisive constraint on strategy selection.

Together: the payoff (branded types) is real and reachable; the standard delivery mechanism
(rename to `.ts`) is uniquely hostile here; therefore deliver the payoff *through `checkJs` on
`.js` files*, which sidesteps both the gate regression and the Next build coupling.

## 1. What TypeScript unlocks on the ladder

The map's headline: rung 1 ("impossible by construction") needs branded/nominal types,
exhaustiveness, or module-visibility — none of which plain JS has. Each liftable invariant
mapped to the concrete TS mechanism and its attach point:

| Map # | Invariant | TS mechanism | Attach point (read this session) | Lift |
|---|---|---|---|---|
| **#2** | **Client id → Dataverse selector (IDOR/injection)** | **Branded** `type Guid = string & {__brand:'Guid'}`; `isGuid` becomes `value is Guid`; selectors *require* `Guid` | `isGuid` [`lib/utils/guid.js:22`]; `recordId` interpolated **raw** into `${entitySet}(${recordId})` [`dynamics-service.js:347/359,694,796,835`]; `changeset.buildOperationUrl` [`changeset.js:41`] | **2 → 1.** A raw `string` from `req.body` can no longer reach a selector; only a value that passed `isGuid` narrowing compiles. Cleanest rung-1 payoff in the repo. |
| **#10** | **Identity-provenance spoof (branded ActorRef)** | Branded `ActorRef` minted **only** by the auth resolvers; write APIs require it | `requireAppAccess` returns `{profileId, session}` [`lib/utils/auth.js:238`]; actor id is `session.user.dynamicsSystemuserId`; **0** `req.body.profileId` sites in `pages/api` [VERIFIED via grep this session] | **4 → 1.** Already 0 live violations. TS converts a *tested-clean* invariant into a *structural* one — value is preventing regression, not fixing a live bug. |
| **#7** | **API-route authorization coverage** | Discriminated union on a `defineApiRoute({access})` decl + `Record<Method,Access>` forcing a per-method decision | No wrapper today — inline `requireAppAccess(req,res,...keys)` per handler; 93 of 146 routes call it [VERIFIED via grep] | **3 → 2 (→1 with the wrapper).** TS makes the declaration *shape* mandatory; cannot alone prove record-ownership. Bundled with the wrapper refactor the map scopes "large." Gated on this decision (map §4). |
| **#15** | **Status/enum producer↔consumer parity** | Union + exhaustive `switch` with `const _:never=x` default; `Record<Stage,Label>` forces full coverage | `reviewer-rollup.js` `deriveWorkRemaining`/`WORK_REMAINING_LABEL` → `pages/workbench.js` `STAGE_META`; `dataverse-export/constants.js` `STATUS_CLASS` → `StatusTab.js` `CLASS_META` [pairs read from `scripts/check-status-enum-parity.js:80,96,112`] | **2 → 1 per pair.** The `never`-check *is* the exhaustiveness `check:status-enum-parity` emulates by hand. |
| **#11** | Model capability↔pricing parity (sub-invariant) | `... as const` + `Record<ModelId,{caps;price}>` so an id with no price won't compile | model registry/resolver (`model-resolver.js`, CJS) | **3 → partial 1** for the parity slice; open-world "is this a real id" half stays runtime (live `/v1/models`). Matches map scoping. |
| **#5,#9,#1** | Warming race; restriction-context; **DAL trusted context** | **None (structural mismatch).** Guard *runtime state* — an ALS store active, a cache warmed — not a value's type | `assertTrustedDalContext` gates on `getDynamicsContext()!==null` [`dynamics-context.js:141`] | **No lift.** Stays a runtime chokepoint. #1/#5/#9 are TS-independent. |
| — | **Secret server-side-only** | The `server-only` npm package (build-time throw on client import) — a *bundler* mechanism, not a type | Today: import-graph isolation + `require(variablePath)` tracer-evasion [`lib/dataverse/client.js:11-23`] | **Marginal.** `server-only` works in plain JS too; TS adds little. Not a TS-justifying class. |

**Top three unlocks, ranked:** (1) **#2 branded `Guid`** — live injection surface, tiny attach
point, cleanest rung-1; (2) **#10 branded `ActorRef`** — makes a clean-but-fragile invariant
structural; (3) **#15 enum exhaustiveness** — replaces a bespoke gate with a compiler guarantee.
All three are branded-type / exhaustiveness wins — exactly the JS gap the map named.

## 2. What TypeScript does NOT unlock (keeping scope honest)

- **#1 DAL context, #9 restriction context, #5 warming race** — runtime-state invariants; no
  type lift. **These include the map's #1 Tier-A target.** A TS project must not be sold as
  advancing #1.
- **#7 record-ownership** — TS forces the declaration *shape* but not "owns this record"; still
  a runtime check.
- **ESM friend-visibility** — the map's "expose to one sibling only" wish (#3, #5) is not stock
  TS. TS's win is branding, not encapsulation.

## 3. Migration strategy options

Judged on effort, risk, reversibility, the `check:*` suite, and the Next/Vercel build. CJS/ESM
split is a real complication for (b)/(c): `lib/dataverse/client.js`,
`lib/services/model-override-loader.js`, `model-resolver.js` are **CommonJS** while their
consumers are ESM [VERIFIED via investigator reads]; 330 imports carry explicit `.js`
specifiers, 1310 are extensionless (bundler-resolved); `use-extensionless.mjs` does **not** try
`.ts` [VERIFIED via `scripts/lib/use-extensionless.mjs`].

### (a) `checkJs` + JSDoc types — NO renames  ✅ recommended
`@ts-check` pragmas (or a scoped `checkJs` config) on chosen `.js` files; branded types via
JSDoc `@typedef`; `tsc --noEmit` as a **new standalone CI gate**.
- **Effort:** small, incremental, file-by-file. Near-zero groundwork exists (only **2**
  `@typedef` and **0** `@ts-check` across `lib/`+`shared/` today [VERIFIED via grep]) — but
  nothing to undo either.
- **Risk:** low. Files stay `.js`, so **every existing gate keeps scanning them** — no
  fail-open. Jest untouched (`testMatch` is `.js`-globbed; no `.ts` appears).
- **Vercel build:** **untouched — if** the config is *not* named `tsconfig.json`. Next 16
  auto-detects a root `tsconfig.json`/any `.ts` and injects a build-time type-check with **no
  `ignoreBuildErrors` set today** [VERIFIED via `next.config.js` grep — none]. Use a dedicated
  `tsconfig.check.json` run only by the gate; leave the repo root free of `tsconfig.json` so
  `next build` never sees TS.
- **Reversibility:** total. Delete the gate + config + pragmas.
- **Limit:** JSDoc branding is verbose (`@typedef {string & {__brand:'Guid'}} Guid`); ergonomics
  worse than `.ts`. Fine for a *core* of a few files; not for breadth.

### (b) Gradual `allowJs` + incremental `.ts` conversion
Root `tsconfig.json` (`allowJs:true`), rename slice-by-slice.
- **Effort:** medium-to-large, front-loaded with hazard. The first `.ts` file (or `tsconfig.json`)
  makes `next build` type-check **all** `allowJs` sources — including the JSX-in-`.js` pages —
  and will fail the Vercel build unless `typescript:{ignoreBuildErrors:true}` is set, which then
  **disables type-checking as a build gate repo-wide**, undercutting the point.
- **Risk:** **high and security-relevant.** Each renamed `.ts` file silently exits the
  `.js`-globbed gates (§0 finding 2) — renaming the *very files you want to brand* (selectors,
  routes) removes them from the gates that currently protect them. Also desyncs the hardcoded
  `'...js'` path literals in gates (e.g. `dynamics-service.js` in
  `check-dataverse-access-layer.js:67-72`).
- **Prerequisite:** the five fail-open gates must first migrate to `scripts/lib/ast-scan-core.js`
  `parseModule` (its `PARSER_PLUGINS` include `typescript`, `JS_EXT_RE` includes ts/tsx — three
  gates already use it and are TS-ready [VERIFIED via investigator]) and the `.js`-literal
  anchors made extension-agnostic. That gate-hardening is the true cost of (b).
- **Reversibility:** poor once dozens of files are renamed and specifiers rewritten.

### (c) Big-bang
Convert the whole tree (~1400 `.js` files [VERIFIED via `git ls-files` count]).
- **Effort:** very large. **Risk:** highest — gates, the 330 explicit-`.js` specifiers,
  `use-extensionless.mjs`, Jest globs, and the two-agent (Claude + Codex) workflow break at once.
  **Reversibility:** effectively none. **Not recommended** for a solo-owner, auto-deploying,
  security-gated repo.

## 4. Cost & risk (whichever path)

- **Build/tooling:** `typescript` is not a direct dep (only transitive peer ranges via
  `eslint-config-next` [VERIFIED via lockfile grep]); adding it is trivial. **typescript-eslint
  auto-activates** once a `tsconfig.json` exists — on a lint baseline already ~100 findings, a
  new wave. Option (a)'s non-root config name avoids this.
- **~5000-test suite:** **low risk.** Jest runs through `next/jest` → SWC, which compiles TS
  natively [VERIFIED via `jest.config.js:3` + investigator]; no Babel transform to add. But
  `testMatch`/`collectCoverageFrom` are `.js`-globbed — `.ts` tests silently uncollected
  (option b/c only). 458 `*.test.js` files today [VERIFIED via count].
- **The `check:*` gates:** the central cost, quantified in §3. Three TS-ready
  (`check-dataverse-access-layer`, `check-dynamics-context-boundary`, `check-route-service-boundary`);
  five fail-open on rename. Option (a) pays none of this; (b)/(c) must harden all five first.
- **Vercel deploy:** the Next-16 auto-typecheck coupling (§3a/b). A real trap if a `.ts` file
  lands unplanned.
- **Contributor workflow (Claude + Codex):** both agents edit this repo. A partial `.ts`
  migration means both must track which files are `.ts` vs `.js`, each file's import style, and
  which gates still cover which files — load the `checkJs` path avoids entirely.

## 5. Recommendation

**Phase 0 (now, if the owner wants the payoff): scoped `checkJs` branded-type gate — option (a).**
Deliver #2 and #10 (the two highest-value branded-type unlocks) on the existing `.js` files, via
a standalone `tsc --noEmit` CI check. No renames, no Vercel coupling, no gate regression, fully
reversible.

**Proposed first slice (lowest blast radius, implementable by a later session):**
1. In `lib/utils/guid.js`, add JSDoc `@typedef {string & {__brand:'Guid'}} Guid` and annotate
   `isGuid` as a type guard (`@returns {value is Guid}`).
2. Add `@ts-check` to `lib/utils/guid.js`, `lib/services/dynamics-service.js`, and
   `lib/dataverse/core/changeset.js`; annotate the selector signatures
   (`getRecord/updateRecord/deleteRecord/disassociate/queryRecords`, `buildOperationUrl`) to
   require `Guid`, not `string`.
3. Add `tsconfig.check.json` (`checkJs`, `allowJs`, `noEmit`, `strict`,
   `moduleResolution:'bundler'` to tolerate extensionless imports, `include:` only the annotated
   files) + a `check:types` npm script + one line in `.github/workflows/test.yml`. **Do not**
   create a root `tsconfig.json` (keeps `next build` TS-free).
4. Fix the duplicate `isGuid` at `lib/bill/onboard-reviewer-service.js:359` (a local re-decl of
   the canonical guard [VERIFIED via grep] — the exact "sibling declaration drifts" trap the map
   warns about) by importing the branded one.
   - **DONE S342, with a gotcha (Codex adversarial-review catch).** The local guard did an
     *untrimmed* exact test; the canonical `isGuid` *trims* before testing. A naive swap therefore
     silently made `validateOnboardInput` accept surrounding-whitespace ids while still using the
     raw (untrimmed) value in reservation / contact reads / akoya_request PATCHes — a fail-fast
     regression. Resolved by a local `isCanonicalGuid` (`isGuid(v) && v === v.trim()`) so
     whitespace ids are rejected at validation as before. Lesson: when deduping a guard onto a
     canonical one, diff their *semantics* (trim, case, empties), not just their names.

This lifts **class #2** (the IDOR/`$filter`-injection boundary, map Tier-A #3) toward
compile-time rung 1 on ~3 annotated files + 1 CI line — the thing the map says JS structurally
cannot do — while touching nothing the Vercel build or the other gates depend on.

**Phase 1 (only if Phase 0 proves its worth):** extend the same `checkJs` core to
`lib/utils/auth.js` for branded `ActorRef` (#10), and to the enum pairs for `never`-exhaustiveness
(#15).

**Phase 2 (large; a separate owner decision):** a true `.ts` migration — *only after* the five
fail-open gates migrate to `ast-scan-core`'s `parseModule` and the `.js`-literal anchors become
extension-agnostic. Until that gate-hardening is done, renaming files to `.ts` trades a compiler
guarantee for a silent hole in the very security gates this program exists to keep.

**Explicit "not yet" on the migration, "yes" on the checker.** The branded-type payoff is real
and worth having; the file-rename vehicle is uniquely costly in this repo and buys nothing the
`checkJs` gate doesn't. Take the payoff, skip the vehicle — and keep #1 (DAL) on its own
runtime-assert track, since TS does not touch it.
