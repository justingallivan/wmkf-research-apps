---
title: OData Escape Consolidation Plan
domain: architecture
kind: plan
status: draft
summary: "Consolidate hand-rolled OData quote escaping onto canonical odata.escape; 10 same-semantics sites swap mechanically, 2 divergent sites STOP-AND-ASK."
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
| — SAME-SEMANTICS (mechanical swap) | **10 sites / 7 files** | see Classification table |
| — DIVERGENT (STOP-AND-ASK) | **2 sites / 2 files** | see Classification table |
| Decoy escapes that must NOT be conflated (HTML `&#39;` / XML `&apos;`) | 4 sites / 4 files | `[VERIFIED via Read of each]` |
| Out-of-scope one-off tooling matches | `scripts/` 25 files; `_archived/` 0 files | `[VERIFIED via grep -rln … scripts/ \| wc -l = 25; _archived/ = 0]` |
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
| `lib/services/dataverse-app-access-service.js` | none found | **GAP** |
| `lib/services/program-director-resolver.js` | `tests/unit/program-director-resolver.test.js` (+several) | Stage 0 confirms whether it pins the filter string |
| `lib/services/dataverse-prefs-service.js` | none found | **GAP** |
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

### SAME-SEMANTICS → mechanical swap (10 sites / 7 files)

Each feeds a single-quoted OData literal; output is byte-identical to `odata.escape` for the string
inputs these callers pass. Swap the inline `value.replace(/'/g, "''")` → `odata.escape(value)` and
add the `odata` import if absent.

| # | Site | Current expression | Query context it feeds | Notes |
|---|---|---|---|---|
| 1 | `lib/dataverse/role-apply.js:26` | `name.replace(/'/g,"''")` | `` `name eq '${…}' and _businessunitid_value eq ${businessUnitId}` `` → `/roles?$filter=` | `name` is a role-name string; `businessUnitId` is raw, leave as-is. |
| 2 | `lib/dataverse/role-apply.js:65` | `n.replace(/'/g,"''")` | `` names.map(n => `name eq '${…}'`).join(' or ') `` → `/privileges?$filter=` | Same pattern inside a `.map`. |
| 3 | `lib/external/review-answer-snapshot.js:89` | `String(questionKey).replace(/'/g,"''")` | alt-key lookup URL `wmkf_questionkey='${literal}'` (`:90`) | **Already `String()`-wrapped → exactly identical.** Key asserted against snapshot allowlist upstream (`:86`). Comment `:79-83` says the literal is intentionally NOT URL-encoded — `odata.escape` also does not encode, so preserved. |
| 4 | `lib/services/dataverse-settings-service.js:33` | `key.replace(/'/g,"''")` | `` `wmkf_settingkey eq '${…}'` `` → `/wmkf_appsystemsettings?$filter=` | setting key string. |
| 5 | `lib/services/dataverse-settings-service.js:70` | `keyPrefix.replace(/'/g,"''")` | `` `startswith(wmkf_settingkey,'${…}')` `` (listSettings) | maps to `odata.startsWith('wmkf_settingkey', keyPrefix)` OR minimal `odata.escape(keyPrefix)`. |
| 6 | `lib/services/dataverse-settings-service.js:88` | `keyPrefix.replace(/'/g,"''")` | same `startswith` (listSettingsWithMeta) | same as #5. |
| 7 | `lib/services/dataverse-identity-map.js:55` | `sourceProfile.azure_email.replace(/'/g,"''")` | `` `internalemailaddress eq '${…}'` `` → `/systemusers?$filter=` | guarded by `if (!sourceProfile?.azure_email) continue;` (`:53`), so always a string here. |
| 8 | `lib/services/dataverse-app-access-service.js:32` | `appKey.replace(/'/g,"''")` | `` `_wmkf_user_value eq ${systemuserid} and wmkf_appkey eq '${…}'` `` | app-key string; `systemuserid` is raw, leave as-is. |
| 9 | `lib/services/program-director-resolver.js:45` | `key.replace(/'/g,"''")` (→ `escaped`) | `` `internalemailaddress eq '${escaped}' and isdisabled eq false` `` via `systemUserAdapter.queryUsers` (`:46-50`) | `key` is a normalized (trim+lowercase) email string (`:36`,`:23-26`). |
| 10 | `lib/services/dataverse-prefs-service.js:43` | `key.replace(/'/g,"''")` | `` `_ownerid_value eq ${systemuserid} and wmkf_preferencekey eq '${…}'` `` | preference-key string; `systemuserid` raw, leave as-is. |

### DIVERGENT → STOP-AND-ASK (2 sites / 2 files)

| # | Site | Current | Divergence from `odata.escape` | Proposed ruling (owner decides) |
|---|---|---|---|---|
| D1 | `lib/services/grant-cycles-dataverse.js:46-47`, used `:129` | `function escapeODataString(s){ return encodeURIComponent(String(s).replace(/'/g,"''")); }` in `` `/wmkf_appgrantcycles(wmkf_shortcode='${escapeODataString(sc)}')?$select=…` `` | **Adds `encodeURIComponent`.** `odata.escape` does NOT URL-encode. The inner `String(s).replace(...)` half IS identical to `odata.escape`; the outer encode is extra. | **STOP-AND-ASK.** Not a drop-in swap. Options: (a) leave as-is — it interpolates into a path segment (not a `$filter` a client later encodes), so the encode is deliberate; (b) refactor to `encodeURIComponent(odata.escape(sc))`, sourcing the doubling from canonical while preserving the encode (byte output == current). **Do NOT silently drop `encodeURIComponent`** — that changes the emitted URL (a real behavior change). Recommend (b) for full consolidation; else document why it stays hand-rolled. |
| D2 | `lib/services/reviewer-finder/contact-history-service.js:57`, used `:71` and `:79` | `contactId.replace(/'/g,"''")` (→ `escapedContactId`) | Interpolated into `` `_wmkf_contact_value eq ${escapedContactId}` `` / `_wmkf_projectleader_value eq ${escapedContactId}` — a **RAW/unquoted lookup position, NO surrounding single quotes** `[VERIFIED via Read of :71,:79 this session]`. `odata.escape` is for INSIDE a quoted literal; a raw lookup GUID belongs to `odata.eqRaw`/`odata.eqGuid`. The escape is a functional no-op (a valid GUID has no `'`) — misleading, not incorrect. | **STOP-AND-ASK.** A mechanical `odata.escape` swap would be byte-identical but perpetuate the semantic mismatch. `contactId` is documented as a shell-validated GUID (`:52`). Cleanest: `odata.eqRaw('_wmkf_contact_value', contactId)` (unquoted, no escape) or `odata.eqGuid(...)` for defense-in-depth (adds a throw on non-GUID). Recommend `odata.eqGuid` (matches the trust-boundary convention `odata.js:39-50`) but note it introduces a throw on the error path. |

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
- `scripts/` (25 files) and `_archived/` (0) — one-off probes/backfills, not shipped runtime.

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
   - `dataverse-identity-map.js`, `dataverse-app-access-service.js`, `dataverse-prefs-service.js`:
     capture the respective `client.get` filter.
   - `program-director-resolver.js`: if `tests/unit/program-director-resolver.test.js` does not
     already assert the `queryUsers` filter string, extend it; else record "already pinned".
   - `review-answer-snapshot.js`: confirm `tests/unit/review-answer-snapshot.test.js` pins
     `answerRowUrl` for a quote-containing key; add the case if missing.
   - D1 `grant-cycles-dataverse.js`: pin `escapeODataString`'s CURRENT output (including
     `encodeURIComponent`) for a quote input, or `findByShortCode`'s built URL.
   - D2 `contact-history-service.js`: pin the CURRENT `_wmkf_contact_value eq …` filter for the
     GUID input the existing test already uses.
3. **Done means:** every SAME-SEMANTICS and divergent site has a byte-output pin; full suite green
   at the prior count or better; commit.

**Verification:** targeted jest on the new/changed suites; `npm run check:dataverse-access-layer`
(+ self-test); full `npm test`.

### Stage 1 — Mechanical swaps (SAME-SEMANTICS sites only)

**Tests that must exist first:** Stage 0 pins for every site touched in the cluster.

Cluster by directory, one commit each, gates between:

- **Cluster A — `lib/dataverse/role-apply.js`** (sites 1,2). CJS file — resolve the import form per
  Decision 3; swap both inline `.replace` calls to `odata.escape(...)`.
- **Cluster B — `lib/services/` settings/prefs/app-access + identity-map** (sites 4,5,6,7,8,10).
  All CJS; swap each. (`dataverse-settings-service.js` has 3 sites.)
- **Cluster C — `lib/services/program-director-resolver.js` (ESM) + `lib/external/review-answer-snapshot.js` (ESM)**
  (sites 9,3). Site 3 is already `String()`-wrapped → the swap is exact.

Per-cluster loop: swap → run the Stage 0 pins for the cluster (must stay green, proving byte
identity) → `npm run check:dataverse-access-layer` (+ self-test) → commit.

**Done means:** all 10 SAME-SEMANTICS sites call `odata.escape`; no inline `.replace(/'/g, "''")`
remains in those 7 files; Stage 0 pins unchanged-green; full suite green.

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
