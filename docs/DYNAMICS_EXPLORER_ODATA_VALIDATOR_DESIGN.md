---
title: "Dynamics Explorer — OData Pre-flight Validator (design)"
domain: dataverse
kind: spec
status: active
summary: "Status: DRAFT, Codex-reviewed + folded (S200, 2026-05-29). Pre-implementation design, grounded in production failure data."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/analyze-dynamics-explorer-failures.js
  - lib/services/dataverse-export/compiler.js
---

# Dynamics Explorer — OData Pre-flight Validator (design)

**Status:** DRAFT, Codex-reviewed + folded (S200, 2026-05-29). Pre-implementation design, grounded in production failure data.
**Relationship to Path A:** this is the data-driven re-prioritization of the Path A plan. A2 (live taxonomy) shipped. This validator is the highest-leverage *next* slice and **reuses A1's live schema** as its field-name oracle. It supersedes A3/A4/A5 as the next target.

> **Codex review folded (S200).** Key corrections, each verified against the live code: (1) **`aggregate` was missing** from scope — it's a model-supplied-OData tool (`chat.js:498` → `aggregateRecords` builds `$apply=filter(...)`); added. (2) The live tool is **`get_entity`** (`chat.js:467`), not `get_record` (that name only appears in historical `dynamics_query_log` rows); it's an *identifier* validator, not an OData-expression one. (3) **GUID auto-quoting DROPPED** — server-built filters use *unquoted* GUIDs on lookup `_value` fields (`_akoya_applicantid_value eq ${accountId}`, `chat.js:935/1054/1092/1133/1208/1435`), proving unquoted is valid; quoting would be harmful. The real GUID bug is *request-number-where-GUID-expected*. (4) **Restriction checks do NOT cover `filter`/`orderby`** (`checkRestriction` only inspects select/field/group_by/expand, `chat.js:2225-2268`) — so the validator must actively *block* restricted fields it finds in filters, making it a security enhancement, not just suppress suggestions. (5) `$expand` subtrees, `ContainValues` namespace functions, escaped quotes, `orderby` suffixes, and lambda aliases are tokenizer false-reject traps. (6) Validate *effective* values (post-`sanitizeSelect`/`statecode` injection/`cleanSelect`), not raw model input. (7) In-flight schema-fetch coalescing + a distinct log marker. (8) fiscalyear via static prompt hint, not live sampling (taxonomy has no fiscalyear path).

---

## 1. The data (why this, not A3/A4/A5)

`scripts/analyze-dynamics-explorer-failures.js` over `dynamics_query_log` (1,467 tool calls, 2026-02-12 → 05-29):

- **392 errored tool calls** (`record_count = -1`), concentrated on `query_records` (194), `export_csv` (85), `count_records` (65), almost all `akoya_request`.
- **No denials at all** (zero active restrictions in prod — the restriction-leak hardening was defensive, not addressing a live failure).

Reading the actual `query_params` of the 392 errors, the failure is **the model producing invalid OData**, in two big themes:

**Theme A — hallucinated / wrong field + entity names (the largest theme):**
- `akoya_name` and `akoya_requestnumber` used for the request number (real field is `akoya_requestnum`; the annotation *explicitly* warns against both wrong forms — the model ignores it).
- `akoya_applicationid`, `akoya_requesttype`, `akoya_applicantidname` — invented fields.
- `akoya_grant` (30 errored rows) — wrong field name.
- Non-existent entities: `akoya_proposal`, `akoya_concept`.
- Lookup field without `_value`: `wmkf_potentialreviewer1` in `$select`.

**Theme B — GUID / literal handling:**
- Request **number** where a **GUID** is required: `_regardingobjectid_value eq '1002051'`, `get_entity` identifier `'1002508'`. (NOT unquoted-GUID — unquoted GUIDs are valid; see Codex fold #3.)
- Unsupported constructs: OData `year()/month()/day()` date functions (27), `_formatted` fields in filters (20), `contains()` on lookup `_value` (9), SQL subqueries (rare).
- `akoya_fiscalyear` format guessing (`'D26'` vs `'December 2026'`) — co-occurs with 88 errored rows.

Pattern counts (overlapping buckets, indicative): fiscalyear 88, akoya_grant 30, date-fn 27, `_formatted` 20, contains-on-lookup 9; **251 "uncategorized" are dominated by Theme A wrong-name + Theme B request-number-as-GUID issues** (sampled directly).

**Takeaway:** the failures are wrong field/entity names and GUID/literal mistakes — exactly the class a **pre-flight validator backed by live schema** can catch *before* the Dataverse round-trip, returning a precise correction instead of an opaque error the model round-storms against.

## 2. Goal / non-goals

**Goal:** intercept the OData-emitting tool calls — **`query_records`, `count_records`, `export_csv`, `aggregate`** (model-supplied OData) — and validate field names, entity names, and GUID/literal shapes against live schema **before** calling Dataverse. `get_entity` is validated as an *identifier* input (not an OData expression). On violation, return a **precise, actionable correction hint** (not the raw Dataverse error). Auto-correct is **not** done in v1 (see §3).

**Non-goals:**
- NOT the full deterministic query *compiler* (Path B). This validates the model's free OData; it doesn't replace it.
- NOT auto-rewriting queries (no `year()`→range, no GUID re-quoting) — those are semantic transforms, not syntax fixes.
- Not changing the agentic loop.

## 3. Checks (priority order = data weight)

1. **Field-name validation** (Theme A, biggest): extract field tokens from the **effective** `select`/`filter`/`orderby`/`group_by` (post-sanitization — see §4) and validate each against `getEntityAttributes(table)` (live, 6h-cached — the A1 mechanism). Unknown field → reject:
   `Field "akoya_name" does not exist on akoya_request. Did you mean: akoya_requestnum? (nearest live fields: …)` — closest-match list via Levenshtein over the live logical names (post restriction-filter, §5). Catches akoya_name / akoya_requestnumber / akoya_applicationid / akoya_requesttype / akoya_grant.
2. **Entity-name validation**: unknown `table_name` → reject with the known/annotated entity list. Catches `akoya_proposal`, `akoya_concept`.
3. **Restricted-field enforcement in filter/orderby** (security — closes a real gap): `checkRestriction` does **not** inspect `filter`/`orderby` (`chat.js:2225-2268`). The validator's token extraction must therefore **block** (deny) a restricted field found anywhere in filter/orderby, and its "did you mean" suggestions must never surface a restricted name (reuse the Slice 1 restricted-set + redaction).
4. **GUID / literal validation** (Theme B, REVISED): unquoted GUIDs are valid — do NOT touch them. Instead detect a **non-GUID where a GUID is required**: a lookup `_value` field (or a `get_entity` identifier targeting a GUID id) compared to a value matching a request-number shape (`^\d{5,7}$`) → reject: `_regardingobjectid_value needs a GUID, not a request number. Resolve the request first (get_entity / query by akoya_requestnum), then filter by its id.`
5. **Unsupported-construct rejection** (deterministic): `year()/month()/day()` → "use a date range"; `_formatted` in a filter → "filter the raw lookup `_value` (GUID) or underlying field"; `contains()` on a lookup `_value` → "lookups hold GUIDs; use eq '<guid>'"; `in (select …)` subquery → "not supported; do it in two steps".
6. **Lookup `$select` form**: a bare lookup nav field (`wmkf_potentialreviewer1`) in `$select` → hint to use `_wmkf_potentialreviewer1_value`.
7. **fiscalyear format help**: a **static prompt rule** giving the canonical label format (`"December 2026"`) — NOT live sampling (taxonomy has no fiscalyear path). Lower-confidence; prompt-side, not a validator reject.

Every reject logs to `dynamics_query_log` with a **distinct validator marker** (separate from `record_count = -1` Dynamics errors and `wasDenied` security denials) so the catch-rate is measurable.

## 4. Where it hooks

A single `validateODataCall(name, input, ctx)` invoked in `executeTool` (`chat.js:462`) immediately before the `DynamicsService.*` call, for `query_records` / `count_records` / `export_csv` / `aggregate`; `get_entity` runs the identifier-only check. **Validate the EFFECTIVE query, not raw model input** — `query_records` runs `sanitizeSelect` + injects `statecode eq 0` (`chat.js:444/455`), `export_csv` computes `cleanSelect`/`effectiveFilter` internally (`chat.js:1738`). The validator must see what Dynamics sees, so it runs after those transforms (or the transforms are refactored to produce the effective query the validator consumes). `get_related` is server-built OData — validate only model-supplied `source_id`/`date_from`/`date_to`, never the generated filter. Returns `{ ok }` or `{ reject: hint }`; a reject becomes the `tool_result` content (model self-corrects), counted as a validator catch.

## 5. Reuse

- **Live schema:** `DynamicsService.getEntityAttributes(table)` (the A1 mechanism) is the field-name oracle — cached. The validator is the *enforcement* layer A1's data makes possible. **Add in-flight promise coalescing** to the schema cache (`chat.js`/`dynamics-service.js:313` caches completed data, not in-flight promises) so parallel tool calls on the same table don't stampede metadata fetches.
- **Restricted-field set:** the Slice 1 restriction/redaction logic — for both blocking restricted fields in filters and scrubbing suggestions.
- **A2 resolved taxonomy:** the "lookup needs a GUID" hint can point at the resolved program/status block.
- **Field-token extraction:** a focused OData expression tokenizer (ideas from `lib/services/dataverse-export/compiler.js`, but reading OData not building FetchXML).

## 6. The tokenizer (the hard part) — explicit false-reject guards

A tolerant state machine, **reject only on high confidence; unknown shapes pass through** (a missed token just isn't validated; a false reject is worse than status quo). Mandatory test fixtures, each a known trap:
- **String literals incl. escaped quotes**: `contains(wmkf_abstract,'O''Connor mentioned akoya_name')` must NOT extract `akoya_name` from inside the literal. Handle `''` escaping.
- **`$expand` subtrees**: `primarycontactid($select=fullname,emailaddress1)` — nav properties + related-entity fields are NOT in the base table's attributes. Exclude `$expand` subtrees from base-table validation (or do nav-aware traversal); the base-table validator must not see them.
- **Namespace functions**: `Microsoft.Dynamics.CRM.ContainValues(PropertyName='wmkf_programareaserved_research',PropertyValues=['707510017'])` — don't reject `Microsoft`/`Dynamics`/`CRM`; extract the field from `PropertyName='…'`.
- **`orderby` suffixes**: `createdon desc` — `desc`/`asc` are not fields.
- **Lambda aliases**: `x/any(c:c/fullname eq 'X')` — the lambda variable `c` and nav paths are not base fields.

## 7. Validation / measurement

- Unit tests per check + the tokenizer fixtures above (wrong field → reject + suggestion; request-number-as-GUID → reject; year()/`_formatted`/contains-on-lookup → reject; restricted field in filter → deny; valid `$expand`/`ContainValues`/escaped-literal/`orderby` → PASS, no false reject).
- Re-run `analyze-dynamics-explorer-failures.js` after a soak: errored-call rate should drop; validator-marker catches should appear (catches moved from opaque Dataverse errors to actionable hints).

## 8. Decisions (Codex recommendations adopted)

1. **Tokenizer:** tolerant state machine with the §6 fixtures; ship no behavior for unknown shapes.
2. **GUID:** **no auto-correct** in v1 (unquoted GUIDs are valid per server code; quoting is harmful). Reject only the request-number-where-GUID-required case. No `year()`→range rewrite.
3. **fiscalyear:** static prompt-rule hint, not live sampling.
4. **Restriction:** the validator actively denies restricted fields found in `filter`/`orderby` (closing the `checkRestriction` gap), with scrubbed suggestions.
5. **Logging:** distinct validator-catch marker, separate from `wasDenied` and `record_count = -1`.

## 9. Open questions

- **Effective-query refactor vs. re-parse:** cleanest is for `query_records`/`export_csv` to expose the effective `{select, filter, orderby}` they build, and the validator consumes that — vs. the validator re-deriving it. Decide during build.
- **`get_entity` identifier check depth:** how strictly to detect "this identifier is a request number, not a GUID, on a GUID-id path" without false-positiving on legitimately numeric identifiers.
