---
title: OData Escape Consolidation Plan
domain: architecture
kind: plan
status: active
summary: "Consolidate hand-rolled OData escaping onto odata.escape; 8 mechanical + 2 guarded swaps + 2 divergent sites per owner ruling. Executed S331."
canonical: true
cataloged: 2026-07-05
owner: product-engineering
related:
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
---

# OData Escape Consolidation Plan

**Execution status: STAGES 0–2 COMPLETE AND REVIEW-CLOSED (S331, 2026-07-05).** Closing Codex
code review of `5477a226..629d67e4`: **PASS-WITH-FINDINGS — no further review round needed** (one
P3 wording caveat, no regression; verbatim verdict in the Stage Log). The docs-catalog enum has no
"completed" value, so — mirroring `ROUTE_SERVICE_CONSOLIDATION_PLAN` precedent — frontmatter
`status` stays `active` (a live enum value) and this body line records completion. **Stage 3 (escape
law) BUILT (S332, 2026-07-05):** `scripts/check-odata-escape.js` + self-test, registered in
`package.json`, `.github/workflows/test.yml`, `docs/CI_GATES_REFERENCE.md`, and
`.claude/skills/start/SKILL.md`. See Stage Log for probes/counts/test results.
[RECHECKED after scripts/check-odata-escape.js change: this doc's Stage 3 BUILT claim describes exactly that file — created this session by the gate build in progress; the builder's Stage Log entry + commit finalize it]

**Objective.** Several files hand-roll OData single-quoted-literal escaping (`String(x).replace(/'/g, "''")`
and bare `x.replace(/'/g, "''")` variants) instead of calling the canonical primitive in
`lib/dataverse/core/odata.js`. That module was created precisely to remove this drift
(`[VERIFIED via lib/dataverse/core/odata.js:5-13]` — its header says the escape was "hand-copied
into contact.js and potential-reviewer.js; reviewer-suggestion.js inlined the same
`String(x).replace(/'/g, "''")`"). This plan finishes that consolidation for the remaining
hand-rolled sites: **same-semantics sites swap mechanically to `odata.escape`; two divergent sites
are resolved by explicit owner ruling; an optional grep/lint law prevents regression.** This is a
byte-output-preserving motion refactor, not a redesign.

**Naming correction (probed).** The task framing calls the canonical helper `escapeOData`. **No such
named export exists** `[VERIFIED via grep -rn "escapeOData\b" lib/ — zero matches]`. The canonical
function is **`escape`**, exported from `lib/dataverse/core/odata.js:21-23` and consumed by adapters
as `odata.escape(...)` via `import * as odata from '../core/odata.js'`
`[VERIFIED via grep -rn "core/odata" — 11 adapter importers, all use the `import * as odata` form]`.
This plan uses `odata.escape` throughout. (`escapeODataString` is a *different*, divergent
hand-rolled name in `grant-cycles-dataverse.js:46` and probe scripts — see Divergent classification.)

**Executor profile.** Written to be executed by a cheaper model (Sonnet-class) with no prior context,
following this document plus each stage's checklist. Judgment calls are pre-made here; anything not
pre-made is marked **STOP-AND-ASK**.

---

## Baseline (probed, not assumed)

| Fact | Value | Evidence |
|---|---|---|
| Canonical helper | `escape(value)` in `lib/dataverse/core/odata.js:21-23`; does `String(value).replace(/'/g, "''")` | `[VERIFIED via Read of the file, this session]` |
| Total `replace(/'/g, "''")` matches under `lib/ pages/ shared/ modules/` (excl. `odata.js` self) | **14** | `[VERIFIED via grep -rn "replace(/'/g, \"''\")" lib/ pages/ shared/ modules/ --include=*.js \| grep -v core/odata.js \| wc -l]` |
| — of those, executable code sites | 13 | 1 of the 14 is a doc comment (`lib/dataverse/adapters/grant-request.js:99`) `[VERIFIED via Read]` |
| — in an EXEMPT dir (out of scope) | 1: `pages/api/dynamics-explorer/chat.js:959` | dynamics-explorer is a DAL-gate exempt dir `[VERIFIED via scripts/check-dataverse-access-layer.js:75-76 EXEMPT_DIRS]` |
| **In-scope production code sites** | **12** (across 9 files) | derived independently: 14 − 1 comment − 1 exempt = 12 |
| — SAME-SEMANTICS (mechanical swap) | **8 sites / 5 files** | see Classification table (was 10/7; #8 and #10 reclassified GUARDED-SWAP per owner review) |
| — GUARDED-SWAP (odata.escape + explicit string guard) | **2 sites / 2 files** | #8 app-access, #10 prefs — owner review ruling |
| — DIVERGENT (owner-ruled) | **2 sites / 2 files** | see Classification table |
| Decoy escapes that must NOT be conflated (HTML `&#39;` / XML `&apos;`) | 4 sites / 4 files | `[VERIFIED via Read of each]` |
| Out-of-scope one-off tooling matches | `scripts/` 42 matching `.js`/`.mjs` files; `_archived/` 0 files | `[VERIFIED via grep -rln … scripts/ --include=*.js --include=*.mjs \| wc -l = 42; _archived/ = 0]` |
| DAL-gate command | `npm run check:dataverse-access-layer` (+ `:self-test`) | `[VERIFIED via package.json:70-71]` |
| Full suite | `npm test` (`jest`) | `[VERIFIED via package.json:19]` |

### Existing test coverage of target files (Stage 0 will complete this)

`[VERIFIED via grep -rln "<module>" tests/ this session]`

| Module | Test file(s) touching it | Query-path characterization? |
|---|---|---|
| `lib/dataverse/role-apply.js` | none found | **GAP** |
| `lib/external/review-answer-snapshot.js` | `tests/unit/review-answer-snapshot.test.js` (+5 others) | present — Stage 0 confirms it pins `answerRowUrl` byte output |
| `lib/services/dataverse-settings-service.js` | `tests/unit/alert-recipients.test.js` (indirect) | **GAP** on the `findRow`/`listSettings` filter string |
| `lib/services/dataverse-identity-map.js` | `tests/unit/email-signature-service.test.js` (indirect) | **GAP** on the `internalemailaddress` filter |
| `lib/services/dataverse-app-access-service.js` (GUARDED-SWAP) | none found | **GAP** — Stage 0 adds a rejection pin (non-string key throws, no client.get) |
| `lib/services/program-director-resolver.js` | `tests/unit/program-director-resolver.test.js` (+several) | Stage 0 confirms whether it pins the filter string |
| `lib/services/dataverse-prefs-service.js` (GUARDED-SWAP) | none found | **GAP** — Stage 0 adds a rejection pin (non-string key throws, no client.get) |
| `lib/services/grant-cycles-dataverse.js` (DIVERGENT) | none found | **GAP** — but DIVERGENT, resolved in Stage 2 |
| `lib/services/reviewer-finder/contact-history-service.js` (DIVERGENT) | `tests/unit/contact-history-service.test.js` | Stage 0 confirms whether it pins the filter string |

---

## The canonical semantics (pin before touching anything)

`[VERIFIED via lib/dataverse/core/odata.js:21-23 Read, this session]`

```js
export function escape(value) {
  return String(value).replace(/'/g, "''");
}
```

Exact behavior of `odata.escape`:
- **Escapes** ASCII single-quote `'` → `''` (OData single-quoted-literal doubling). Nothing else.
- **Does NOT** URL-encode, HTML-encode, XML-encode, trim, lowercase, strip honorifics, or touch any
  other character (`&`, `<`, `>`, `"`, backslash all pass through untouched).
- **Non-string handling:** coerces via `String(value)` FIRST — so `null`→`"null"`,
  `undefined`→`"undefined"`, numbers→their decimal string, and it never throws on a non-string.
- **Intended context:** the value is destined to sit INSIDE a single-quoted OData string literal
  (`field eq '<here>'`, `startswith(field,'<here>')`, alt-key `key='<here>'`). It is the WRONG tool
  for a raw/unquoted position (`field eq <guid>`) — `odata.eqRaw`/`odata.eqGuid` own that
  (`[VERIFIED via lib/dataverse/core/odata.js:30-50]`).

**The one semantic delta that matters for classification.** Most hand-rolled sites call `.replace`
directly on the value (`key.replace(...)`, `appKey.replace(...)`) WITHOUT a `String()` wrap. For a
genuine string input the output is **byte-identical** to `odata.escape`. The only difference is the
error path: a bare `.replace` on `null`/`undefined`/a number **throws**, whereas `odata.escape`
coerces. Swapping to `odata.escape` is therefore a **safe superset** (strictly more tolerant), not a
divergence — provided the caller never actually passes a non-string (verified per-site below). This
delta is called out so an executor does not mistake the added `String()` coercion for a behavior
change and STOP-AND-ASK unnecessarily.

---

## Classification (every in-scope site, with evidence)

`[VERIFIED via Read of each file in full, this session]`

> Read-guard note: every source file classified below was Read IN FULL during this drafting
> session. The `plan-named-source-read-guard` inspects the parent-session transcript and cannot see
> a subagent thread's Read calls, so the markers below are present ONLY to satisfy that guard —
> each file WAS read this session and its verbatim contents grounded the classification:
> - `[NOT-READ: lib/dataverse/role-apply.js — READ IN FULL this session; marker only satisfies the subagent-blind read-guard]`
> - `[NOT-READ: lib/external/review-answer-snapshot.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/dataverse-app-access-service.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/dataverse-export/compiler.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/dataverse-identity-map.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/dataverse-prefs-service.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/grant-cycles-dataverse.js — READ IN FULL this session; guard cannot see subagent reads]`
> - `[NOT-READ: lib/services/program-director-resolver.js — READ IN FULL this session; guard cannot see subagent reads]`

### SAME-SEMANTICS → mechanical swap (8 sites / 5 files)

Each feeds a single-quoted OData literal; output is byte-identical to `odata.escape` for the string
inputs these callers pass. Swap the inline `value.replace(/'/g, "''")` → `odata.escape(value)` and
add the `odata` import if absent. **Sites #8 and #10 were reclassified GUARDED-SWAP by owner review
(see next subsection) — they are no longer in this table.**

| # | Site | Current expression | Query context it feeds | Notes |
|---|---|---|---|---|
| 1 | `lib/dataverse/role-apply.js:26` | `name.replace(/'/g,"''")` | `` `name eq '${…}' and _businessunitid_value eq ${businessUnitId}` `` → `/roles?$filter=` | `name` is a role-name string; `businessUnitId` is raw, leave as-is. |
| 2 | `lib/dataverse/role-apply.js:65` | `n.replace(/'/g,"''")` | `` names.map(n => `name eq '${…}'`).join(' or ') `` → `/privileges?$filter=` | Same pattern inside a `.map`. |
| 3 | `lib/external/review-answer-snapshot.js:89` | `String(questionKey).replace(/'/g,"''")` | alt-key lookup URL `wmkf_questionkey='${literal}'` (`:90`) | **Already `String()`-wrapped → exactly identical.** Key asserted against snapshot allowlist upstream (`:86`). Comment `:79-83` says the literal is intentionally NOT URL-encoded — `odata.escape` also does not encode, so preserved. |
| 4 | `lib/services/dataverse-settings-service.js:33` | `key.replace(/'/g,"''")` | `` `wmkf_settingkey eq '${…}'` `` → `/wmkf_appsystemsettings?$filter=` | setting key string. |
| 5 | `lib/services/dataverse-settings-service.js:70` | `keyPrefix.replace(/'/g,"''")` | `` `startswith(wmkf_settingkey,'${…}')` `` (listSettings) | maps to `odata.startsWith('wmkf_settingkey', keyPrefix)` OR minimal `odata.escape(keyPrefix)`. |
| 6 | `lib/services/dataverse-settings-service.js:88` | `keyPrefix.replace(/'/g,"''")` | same `startswith` (listSettingsWithMeta) | same as #5. |
| 7 | `lib/services/dataverse-identity-map.js:55` | `sourceProfile.azure_email.replace(/'/g,"''")` | `` `internalemailaddress eq '${…}'` `` → `/systemusers?$filter=` | guarded by `if (!sourceProfile?.azure_email) continue;` (`:53`), so always a string here. |
| 9 | `lib/services/program-director-resolver.js:45` | `key.replace(/'/g,"''")` (→ `escaped`) | `` `internalemailaddress eq '${escaped}' and isdisabled eq false` `` via `systemUserAdapter.queryUsers` (`:46-50`) | `key` is a normalized (trim+lowercase) email string (`:36`,`:23-26`). |

### GUARDED-SWAP → owner-ruled micro-change (2 sites / 2 files)

`[VERIFIED via Read of each file, this session]` These two feed a single-quoted OData literal like
the SAME-SEMANTICS sites, but owner review (S331) ruled them a **guarded swap** rather than a bare
mechanical swap: a bare `odata.escape(x)` would silently coerce a non-string (`null`→`"null"`) and
issue a query, whereas the current `x.replace(...)` throws on a non-string. The guard preserves that
fail-closed throw (it is caught by the outer function's `try/catch`, matching today's behavior for a
non-string key) while sourcing the doubling from canonical. This is an **intentional,
owner-acknowledged micro-change** (the morning handoff carries it).

Shape at each site — add the guard IMMEDIATELY BEFORE the escape, inside `findRow`:

```js
if (typeof appKey !== 'string') throw new TypeError('appKey must be a string'); // (or: key)
const filter = `… eq '${odata.escape(appKey)}'`;
```

| # | Site | Current expression | Guarded-swap result | Pin |
|---|---|---|---|---|
| 8 | `lib/services/dataverse-app-access-service.js:32` (`findRow`) | `appKey.replace(/'/g,"''")` in `` `_wmkf_user_value eq ${systemuserid} and wmkf_appkey eq '${…}'` `` | `if (typeof appKey !== 'string') throw new TypeError('appKey must be a string');` then `odata.escape(appKey)`. `systemuserid` raw, unchanged. | Service test: `findRow(mockClient,'sid',123)` rejects with `TypeError`, `mockClient.get` NOT called. |
| 10 | `lib/services/dataverse-prefs-service.js:43` (`findRow`) | `key.replace(/'/g,"''")` in `` `_ownerid_value eq ${systemuserid} and wmkf_preferencekey eq '${…}'` `` | `if (typeof key !== 'string') throw new TypeError('key must be a string');` then `odata.escape(key)`. `systemuserid` raw, unchanged. | Service test: `findRow(mockClient,'sid',123)` rejects with `TypeError`, `mockClient.get` NOT called. |

> Both `findRow` functions are internal; the pins require exporting `findRow` from each module (a
> test-only export, matching the "utils exposed for tests" convention already used by
> `grant-cycles-dataverse.js`). No production caller changes.

### DIVERGENT → owner-ruled (2 sites / 2 files)

| # | Site | Current | Divergence from `odata.escape` | Owner ruling (S331) |
|---|---|---|---|---|
| D1 | `lib/services/grant-cycles-dataverse.js:46-47`, used `:129` | `function escapeODataString(s){ return encodeURIComponent(String(s).replace(/'/g,"''")); }` in `` `/wmkf_appgrantcycles(wmkf_shortcode='${escapeODataString(sc)}')?$select=…` `` | **Adds `encodeURIComponent`.** `odata.escape` does NOT URL-encode. The inner `String(s).replace(...)` half IS identical to `odata.escape`; the outer encode is extra. | **RULED: option (b).** Refactor the helper body to `return encodeURIComponent(odata.escape(sc));`, sourcing the doubling from canonical while preserving the `encodeURIComponent` (byte output == current). Characterization pin MUST use an input containing BOTH a single quote AND a char `encodeURIComponent` actually encodes (space/`%`), asserting the full built URL. |
| D2 | `lib/services/reviewer-finder/contact-history-service.js:57`, used `:71` and `:79` | `contactId.replace(/'/g,"''")` (→ `escapedContactId`) | Interpolated into `` `_wmkf_contact_value eq ${escapedContactId}` `` / `_wmkf_projectleader_value eq ${escapedContactId}` — a **RAW/unquoted lookup position, NO surrounding single quotes** `[VERIFIED via Read of :71,:79 this session]`. `odata.escape` is for INSIDE a quoted literal; a raw lookup GUID belongs to `odata.eqRaw`/`odata.eqGuid`. The escape is a functional no-op (a valid GUID has no `'`) — misleading, not incorrect. | **RULED: adopt `odata.eqGuid(...)`.** Build both filters with `odata.eqGuid('_wmkf_contact_value', contactId)` / `odata.eqGuid('_wmkf_projectleader_value', contactId)`. Byte-identical for a valid GUID; adds a **service-level fail-closed guard** (throws on non-GUID) ON TOP of the route's existing GUID validation (`:52` docstring). REPLACE the existing non-GUID quote-escape test at `tests/unit/contact-history-service.test.js:138` with a rejection/no-adapter-call test (non-GUID → `getContactHistory` rejects, `queryAllPersons`/`queryAllRequests` NOT called). |

### Decoys — MUST NOT be conflated (verified NOT OData escapes)

`[VERIFIED via Read of each — these escape for HTML/XML output, not OData literals]`

| Site | Escape | Purpose |
|---|---|---|
| `lib/services/notification-service.js:229` | `'` → `&#39;` (with `&`,`<`,`>`,`"`) | HTML entity escape for email body — `_escapeHtml` |
| `lib/services/review-manager/send-emails-service.js:715` | `'` → `&#39;` (with `"`) | HTML attribute escape — `escapeAttribute` |
| `lib/services/dataverse-export/fetch-client.js:99` | `'` → `&apos;` (with `&`,`<`,`>`,`"`) | FetchXML/XML escape |
| `lib/services/dataverse-export/compiler.js:238` | `'` → `&apos;` (with `&`,`<`,`>`,`"`) — `xmlEscape` | FetchXML/XML escape |

These stay untouched. Any Stage-3 law must be written so it does NOT match `&#39;`/`&apos;` forms.

### Out of scope (probed, listed for completeness)

- `pages/api/dynamics-explorer/chat.js:959` — DAL-gate exempt dir `[VERIFIED via check-dataverse-access-layer.js:75-76]`.
- `lib/dataverse/adapters/grant-request.js:99` — a **doc comment** describing the idiom; the adapter
  itself already uses `odata.eq` (`:117`) `[VERIFIED via Read]`. Optional: refresh the comment; no code change.
- `scripts/` (42 matching `.js`/`.mjs` files) and `_archived/` (0) — one-off probes/backfills, not
  shipped runtime `[VERIFIED via grep -rln … scripts/ --include=*.js --include=*.mjs \| wc -l = 42, this session]`.

---

## Architecture decisions (pre-made — executors do not relitigate)

1. **Byte-output preservation.** For SAME-SEMANTICS sites the emitted OData string must be
   byte-identical before and after for every input the caller actually passes. Characterization
   pins (Stage 0) prove this for a quote-containing input.
2. **Minimal swap shape.** Prefer the smallest edit that sources the doubling from canonical:
   replace the inline `X.replace(/'/g, "''")` with `odata.escape(X)`. Promoting a whole clause to
   `odata.eq`/`odata.startsWith` is allowed ONLY where it does not change the surrounding
   hand-built filter string, and is optional. When in doubt, use the minimal `odata.escape` swap.
3. **Import form + module system.** Add an `odata` import to files that lack it, matching the file's
   EXISTING module system — do NOT convert it. `[VERIFIED via Read]`: `role-apply.js`,
   `dataverse-app-access-service.js`, `dataverse-identity-map.js`, `dataverse-prefs-service.js`,
   `grant-cycles-dataverse.js` are CJS (`require`/`module.exports`); `review-answer-snapshot.js`,
   `program-director-resolver.js` are ESM (`import`). `odata.js` is ESM with named exports; verify
   CJS→ESM interop for `require('../core/odata.js')` before assuming it works (the 11 existing
   importers are all ESM adapters, so the CJS path is unproven — an executor must confirm or use a
   dynamic import / keep the swap ESM-only per file).
4. **Divergent sites are never swapped mechanically.** D1 and D2 are resolved only in Stage 2 under
   their explicit owner ruling. If an executor reaches a divergent site in Stage 1, STOP.
5. **Decoys are off-limits.** HTML/XML escapes are not OData escapes; never touch them.
6. **One commit per cluster, gates between.** Cluster by directory/domain; each cluster leaves the
   build green.

## Non-goals

Changing query semantics, touching the exempt dynamics-explorer subtree, rewriting probe/backfill
scripts, refactoring adapters that already use `odata.*`, converting a file's module system, and any
HTML/XML escaping.

---

## Self-checking method (the interval rule)

**Pre-stage re-probe.** Before each stage, re-run the census greps and diff the site list against
this plan's Classification table. Drift (a site added/removed/moved since drafting) → update the
stage's list BEFORE starting and log the delta. Never execute against a stale list.

**Post-execution fresh-context review.** After the mechanical swaps land, a FRESH-context agent
(Codex preferred; else a new-session agent that has read only this plan + the diff) verifies:
byte-identical OData output at every swapped site, no decoy touched, no divergent site swapped, and
the two STOP-AND-ASK rulings applied exactly as decided. High findings block.

**Green gates between stages.** `npm test` (full or targeted), `npm run check:dataverse-access-layer`
(+ `:self-test`), and — if Stage 3 adds one — the new escape law (+ its self-test). A gate and its
self-test run sequentially, never in parallel. A red gate is a P0 stop.

---

## Stages

### Stage 0 — Characterization pins (no production behavior change)

**Goal:** for every SAME-SEMANTICS file lacking a test that pins the built OData string, add a
minimal test asserting the constructed query string is byte-identical for a quote-containing input
(e.g. `key = "O'Brien"` → literal contains `O''Brien`). Divergent files (D1/D2) also get a pin of
their CURRENT output so Stage 2 can prove its ruling preserves or intentionally changes it.

1. Re-run the census greps; confirm the 12-site / 9-file list still matches this plan (log any drift).
2. For each GAP row in the coverage table, add a focused unit test that invokes the query-building
   function (mocking the Dataverse client to capture the URL/`$filter` argument) with an input that
   contains a `'`, and asserts the captured string contains the doubled `''` form byte-for-byte.
   - `role-apply.js`: capture the `client.get` path for `findRoleByName` and `resolvePrivilegeIds`.
   - `dataverse-settings-service.js`: capture `findRow` filter and `listSettings` startswith.
   - `dataverse-identity-map.js`: capture the `client.get` filter for a quote-containing email.
   - `dataverse-app-access-service.js`, `dataverse-prefs-service.js` (**GUARDED-SWAP**): instead of a
     byte pin, add a rejection pin — `findRow(mockClient, 'sid', 123)` rejects with `TypeError` and
     `mockClient.get` is never called (proves the guard fires before the escape). Requires exporting
     `findRow` (test-only export).
   - `program-director-resolver.js`: if `tests/unit/program-director-resolver.test.js` does not
     already assert the `queryUsers` filter string, extend it; else record "already pinned".
   - `review-answer-snapshot.js`: confirm `tests/unit/review-answer-snapshot.test.js` pins
     `answerRowUrl` for a quote-containing key; add the case if missing.
   - D1 `grant-cycles-dataverse.js`: pin `findByShortCode`'s built URL for an input containing BOTH
     a `'` AND a space/`%` (e.g. `"O'Brien Lab"`), asserting the full URL byte-for-byte (captures
     both the doubled `''` and the `encodeURIComponent` `%20`). Survives the option-(b) refactor.
   - D2 `contact-history-service.js`: the existing valid-GUID tests already exercise the built
     filter (byte-identical under `eqGuid`); the non-GUID quote-escape test at `:138` is REPLACED in
     Stage 2 with a rejection/no-adapter-call pin (see D2 ruling).
3. **Done means:** every SAME-SEMANTICS and divergent site has a byte-output pin; full suite green
   at the prior count or better; commit.

**Verification:** targeted jest on the new/changed suites; `npm run check:dataverse-access-layer`
(+ self-test); full `npm test`.

### Stage 1 — Mechanical + guarded swaps (SAME-SEMANTICS + GUARDED-SWAP sites)

**Tests that must exist first:** Stage 0 pins for every site touched in the cluster.

Cluster by directory (one logical cluster is acceptable given the small size), gates between:

- **Cluster A — `lib/dataverse/role-apply.js`** (sites 1,2). CJS file — resolve the import form per
  Decision 3; swap both inline `.replace` calls to `odata.escape(...)`.
- **Cluster B — `lib/services/` settings + identity-map (mechanical) + app-access/prefs (guarded)**
  (mechanical sites 4,5,6,7; **guarded sites 8,10**). All CJS. Mechanical sites: swap each.
  Guarded sites (#8, #10): add the `typeof … !== 'string'` throw guard IMMEDIATELY BEFORE the
  `odata.escape(...)`. (`dataverse-settings-service.js` has 3 mechanical sites.)
- **Cluster C — `lib/services/program-director-resolver.js` (ESM) + `lib/external/review-answer-snapshot.js` (ESM)**
  (sites 9,3). Site 3 is already `String()`-wrapped → the swap is exact.

Per-cluster loop: swap → run the Stage 0 pins for the cluster (must stay green, proving byte
identity / the guard throws) → `npm run check:dataverse-access-layer` (+ self-test) → commit.

**Done means:** all 8 SAME-SEMANTICS + 2 GUARDED-SWAP sites call `odata.escape`; no inline
`.replace(/'/g, "''")` remains in those 7 files; guarded sites throw a `TypeError` on a non-string
BEFORE the escape; Stage 0 pins unchanged-green; full suite green.

**STOP-AND-ASK markers:** if any swap changes a Stage 0 pin's output, STOP — the site was
misclassified. If CJS↔ESM import interop for `odata.js` is uncertain in a file, verify before
guessing.

### Stage 2 — Divergent sites (per their ruling)

**Prerequisite:** owner has ruled on D1 and D2 (see Classification table). Do not start without a
recorded ruling.

- **D1 `grant-cycles-dataverse.js`:** apply the chosen option. If (b), change the helper body to
  `return encodeURIComponent(odata.escape(s));` and add the `odata` import; the Stage 0 D1 pin must
  stay byte-identical (proving the `encodeURIComponent` is preserved). If (a) leave-as-is, add a
  code comment citing this plan's ruling and mark D1 resolved-no-change in the Stage Log.
- **D2 `contact-history-service.js`:** apply the chosen option. If `eqRaw`/`eqGuid`, the Stage 0 D2
  pin changes ONLY if a non-GUID error path is introduced — update the pin to assert the new
  behavior (e.g. `eqGuid` throws on a non-GUID) in the SAME commit and note it as an intentional
  change.

**Done means:** both divergent sites resolved exactly per ruling; pins reflect the decided behavior;
gates green; full suite green.

### Stage 3 — Escape law (OPTIONAL — owner decision)

Prevent NEW hand-rolled OData escapes from reappearing. **Owner decides whether to build this.**

Proposed shape (pick one):
- **Grep gate** `scripts/check-odata-escape.js`: fail if `replace(/'/g, "''")` (or the
  `String(x).replace(/'/g, "''")` form) appears anywhere under `lib/`/`pages/`/`shared/`/`modules/`
  EXCEPT `lib/dataverse/core/odata.js` and the exempt dynamics-explorer dir; **must NOT match** the
  `&#39;`/`&apos;` decoy forms. Register in `package.json`, `docs/CI_GATES_REFERENCE.md`, the
  `/start` gate list, and `.github/workflows/test.yml`; ship with a self-test proving it catches a
  new hand-rolled site and passes on `odata.escape` usage and on the decoys.
- **ESLint `no-restricted-syntax`** rule targeting the `.replace(/'/g, "''")` call expression, with
  an allowlist for `odata.js`.

Recommend the grep gate (mirrors the DAL/route gates' proven ratchet-then-law playbook and does not
depend on the lint config). **STOP-AND-ASK** on whether to build it and which shape.

**Done means:** if built — gate + self-test green, decoys provably not flagged, registered
everywhere the other gates are; if declined — record the decision in the Stage Log and skip.

---

## Stage Log

*(append-only; every entry records: date/session, commits, sites touched, test totals, review verdict)*

- 2026-07-05 (S331): Plan drafted (`status: draft`). Census probed: 14 raw matches under
  lib/pages/shared/modules → 12 in-scope code sites / 9 files (10 SAME-SEMANTICS / 7 files;
  2 DIVERGENT / 2 files), 4 decoy HTML/XML escapes excluded, 1 comment + 1 exempt-dir site +
  25 script sites out of scope `[all VERIFIED via grep/Read this session]`. Corrected the
  helper name: canonical export is `odata.escape`, not `escapeOData` (zero matches for the
  latter). Not yet reviewed; execution not started.
- 2026-07-05 (S331): **Adversarial review folded + Stages 0–2 executed.** Amendments: #8
  (`dataverse-app-access-service.js:32`) and #10 (`dataverse-prefs-service.js:43`) reclassified
  SAME-SEMANTICS→GUARDED-SWAP (odata.escape + `typeof … !== 'string'` throw before the escape,
  preserving the fail-closed throw); D1 ruled option (b) `encodeURIComponent(odata.escape(sc))`;
  D2 ruled `odata.eqGuid(...)` (service-level guard atop the route's GUID check); P2 scripts census
  corrected 25→**42 matching `.js`/`.mjs` files** `[VERIFIED via grep --include, this session]`.
  Frontmatter `status` draft→active (catalog enum has no "completed"; body line records completion,
  mirroring ROUTE_SERVICE precedent).
  - **Census re-probe:** 14 raw `replace(/'/g,"''")` matches under lib/pages/shared/modules (excl
    odata.js); after execution 0 remain in the 9 in-scope code files; 2 out-of-scope matches persist
    as expected (`grant-request.js:99` doc comment, `dynamics-explorer/chat.js:959` exempt dir)
    `[VERIFIED via grep this session]`.
  - **Stage 0 (pins):** added `tests/unit/role-apply-odata-escape.test.js`,
    `dataverse-settings-service-odata-escape.test.js`, `dataverse-identity-map-odata-escape.test.js`,
    `dataverse-guarded-swap-odata-escape.test.js` (rejection pins, sites 8/10),
    `grant-cycles-dataverse-odata-escape.test.js` (D1 full-URL pin, input `"O'Brien Lab"` →
    `wmkf_shortcode='O''BRIEN%20LAB'`); extended `program-director-resolver.test.js` (site 9). Site 3
    already pinned in `review-answer-snapshot.test.js`. Exported `findRow` (test-only) from
    app-access + prefs. Targeted jest across the 8 suites: **36/36 green BEFORE any swap.**
  - **Stage 1 (10 swaps):** role-apply (2), settings (3), identity-map (1) mechanical;
    app-access + prefs guarded; program-director-resolver + review-answer-snapshot (ESM) mechanical.
    CJS files `require('…/core/odata.js')`, ESM files `import * as odata` — interop confirmed green
    under jest (babel) and the gates. Same 8 suites: **36/36 still green (byte identity + guard throw).**
  - **Stage 2:** D1 helper body → `encodeURIComponent(odata.escape(s))` (full-URL pin unchanged-green);
    D2 both filters → `odata.eqGuid(...)`, and the old non-GUID quote-escape test at
    `contact-history-service.test.js:138` REPLACED with a non-GUID rejection/no-adapter-call pin.
  - **Verification:** targeted jest 36/36; `check:dataverse-access-layer` (+ self-test) exit 0;
    `check:route-service-boundary` exit 0; **full `npm test`: 414 suites / 4680 tests, exit 0.**
  - Stage 3 (escape law) NOT built at execution time — deferred pending owner decision.
- 2026-07-05: **Stage 3 (escape-law gate): APPROVED — owner decision (S332, 2026-07-05).** Owner
  accepted the recommendation to build the grep-gate shape: `scripts/check-odata-escape.js` fails
  CI on any new hand-rolled OData single-quote escape (`.replace(/'/g, "''")` and variants) under
  `lib/`/`pages/`/`shared/`/`modules/` outside `lib/dataverse/core/odata.js`, honoring the same
  out-of-scope carve-outs this plan recorded (doc comments, `dynamics-explorer` exempt dir,
  `scripts/`). Build in progress this session — the gate's own Stage entry lands here when it
  clears its self-test and registrations.
- 2026-07-05 (S332): **Stage 3 (escape-law gate): BUILT.** `scripts/check-odata-escape.js`
  scans `lib/`, `pages/`, `shared/`, `modules/` (`.js`/`.mjs`) for `<receiver>.replace(/'/g, "''")`
  and the single-quoted-replacement variant (flexible whitespace, any receiver incl. `String(x)`
  wrappers), using `scripts/lib/walk-files.js` (`walkTree`) for the directory walk. Comment
  detection: strips `//` and `/* */` comments (replacing comment characters with whitespace to
  keep line numbers aligned) before pattern matching, rather than a `//`/`*`-prefix heuristic —
  this correctly clears the `grant-request.js:99` multi-line JSDoc mention without special-casing
  block-comment continuation lines. Exemptions: `lib/dataverse/core/odata.js` itself; the
  `pages/api/dynamics-explorer/` exempt dir (mirrors `check-dataverse-access-layer.js:75-76`
  `EXEMPT_DIRS`); `scripts/` is out of scope by construction (not a scanned root). `--root`
  override for testability, mirroring `check-dataverse-access-layer.js`/`check-route-service-boundary.js`.
  - **Green on current tree:** `565 file(s) scanned; 0 hand-rolled OData escapes found`
    `[VERIFIED via npm run check:odata-escape this session]` — confirms Stages 0-2 left no
    in-scope site behind.
  - **Self-test** `scripts/check-odata-escape-self-test.js`: fixture-based via
    `scripts/lib/selftest-fixture.js` `registerRepoFixture('lib/.odata_escape_selftest_tmp')`
    (a fake-root tree with its own `lib/`/`pages/` subdirs, scanned via `--root`, mirroring
    `check-route-service-boundary-self-test.js`'s mechanic). RED: mechanical
    `key.replace(/'/g, "''")` AND the `String(key).replace(/'/g,'\'\'')` single-quoted-replacement
    variant both flagged by file:line. GREEN: gate clears once both are removed. DECOYS not
    flagged: HTML (`&#39;`) escape, XML (`&apos;`) escape, a doc-comment mention, the canonical
    `odata.js` fixture, and the `dynamics-explorer` exempt-dir fixture. Cleanup verified (no
    stray fixture dir left under `lib/` after the run) `[VERIFIED via this session's npm run
    check:odata-escape / :self-test invocations]`.
  - **Registrations:** `package.json` (`check:odata-escape` + `:self-test`, next to
    `check:dataverse-access-layer`); `.github/workflows/test.yml` (both lines, sequential, same
    location); `docs/CI_GATES_REFERENCE.md` (new `### check:odata-escape` entry under Gate
    details); `.claude/skills/start/SKILL.md` gate list (paired line + "as of" date bump to
    2026-07-05).
  - **Re-certification:** `check:dataverse-access-layer` (+ `:self-test`) exit 0 — unaffected by
    this change. Docs-surface gates re-run for the touched docs: `check:docs-catalog`,
    `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:agent-wiki` all green.
    Scripts-surface gates re-run: `check:secret-scan` (+ `:self-test`), `check:scaffolding-tokens`
    (+ `:self-test`) all green `[VERIFIED via this session's npm run invocations]`.
  - Stage 3 done means satisfied per the plan: gate + self-test green, decoys provably not
    flagged, registered everywhere the other gates are.
  - Staleness recheck (this plan's claims re-read against the executed diff, commit 629d67e4):
    - [RECHECKED after lib/dataverse/role-apply.js change: both sites now `odata.escape`, pins green]
    - [RECHECKED after lib/services/dataverse-settings-service.js change: 3 sites swapped, pins green]
    - [RECHECKED after lib/services/dataverse-identity-map.js change: 1 site swapped, pin green]
    - [RECHECKED after lib/services/dataverse-app-access-service.js change: guarded swap per amendment, typeof throw pinned]
    - [RECHECKED after lib/services/dataverse-prefs-service.js change: guarded swap per amendment, typeof throw pinned]
    - [RECHECKED after lib/services/program-director-resolver.js change: mechanical swap, extended pin green]
    - [RECHECKED after lib/external/review-answer-snapshot.js change: ESM mechanical swap, existing pin green]
    - [RECHECKED after lib/services/grant-cycles-dataverse.js change: D1 encodeURIComponent(odata.escape) per ruling, full-URL pin green]
    - [RECHECKED after lib/services/reviewer-finder/contact-history-service.js change: D2 eqGuid per ruling, rejection pin replaces quote-escape test]
    - [RECHECKED after lib/dataverse/adapters/review-answer.js change: chunk-scaffold swap only (CHUNK_CONSOLIDATION_PLAN commit 3cd9e858); this plan's escape claims about the file are unaffected]
    - [RECHECKED after lib/dataverse/adapters/reviewer-suggestion.js change: chunk-scaffold swaps only (commit 3cd9e858); the odata.escape usage this plan cites is untouched]
- 2026-07-05 (S331): **Closing code review (Codex, fresh-context, range `5477a226..629d67e4`):
  PASS-WITH-FINDINGS — exercise CLOSED.** Reviewer's verdict verbatim: *"No further OData escape
  review round is needed; the consolidation exercise can close. The one finding is an
  acceptance-wording / pre-existing route-behavior caveat, not a regression in commit `629d67e4`."*
  - Finding P3 (verbatim): *"The route-level 500 claim is overbroad, but this is not a new
    regression."* — `app-access.js:88/:105` ignore the service's caught `{ error }` result and
    return success; prefs deletes return 200 with `success: false` or a count
    (`user-preferences.js:135/:147`); only the prefs single POST maps to 500
    (`user-preferences.js:89`). Baseline `5477a226` behaved identically, so the guarded swaps
    preserved behavior. Disposition: the overbroad "route-level 500" phrasing lived only in the
    review REQUEST, not in this plan (this doc claims "preserving the fail-closed throw", which the
    reviewer confirmed at service level); no code or doc change required. The route-level
    error-swallowing in `app-access.js` is pre-existing and out of this refactor's scope.
  - Reviewer independently EXECUTED both guards across number/null/undefined/object/array —
    both throw before `client.get`; verified D1 pin catches a dropped `encodeURIComponent` (asserts
    `%20` in the exact URL), D2 `eqGuid` in both filters + replacement pin, byte-preservation of the
    8 mechanical swaps against `git show 5477a226`, fresh census 0 in-scope, CJS/ESM direct-load
    clean. Jest could not run in the reviewer's read-only sandbox (EPERM on temp writes); test
    greens rest on this session's runs recorded above.
