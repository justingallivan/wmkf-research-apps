# Dynamics Explorer — OData Pre-flight Validator (design)

**Status:** DRAFT for review (S200, 2026-05-29). Pre-implementation design, grounded in production failure data.
**Relationship to Path A:** this is the data-driven re-prioritization of the Path A plan. A2 (live taxonomy) shipped. This validator is the highest-leverage *next* slice and **reuses A1's live schema** as its field-name oracle. It supersedes A3/A4/A5 as the next target.

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
- Request **number** where a **GUID** is required: `_regardingobjectid_value eq '1002051'`, `get_record record_id:'1002508'`.
- **Unquoted GUIDs**: `_akoya_applicantid_value eq ae7e3b60-c18f-…` (no quotes).
- Unsupported constructs: OData `year()/month()/day()` date functions (27), `_formatted` fields in filters (20), `contains()` on lookup `_value` (9), SQL subqueries (rare).
- `akoya_fiscalyear` format guessing (`'D26'` vs `'December 2026'`) — co-occurs with 88 errored rows.

Pattern counts (overlapping buckets, indicative): fiscalyear 88, akoya_grant 30, date-fn 27, `_formatted` 20, contains-on-lookup 9; **251 "uncategorized" are dominated by Theme A wrong-name + Theme B GUID/number/quoting issues** (sampled directly).

**Takeaway:** the failures are wrong field/entity names and GUID/literal mistakes — exactly the class a **pre-flight validator backed by live schema** can catch *before* the Dataverse round-trip, returning a precise correction instead of an opaque error the model round-storms against.

## 2. Goal / non-goals

**Goal:** intercept the OData-emitting tool calls (`query_records`, `count_records`, `export_csv`, `get_record`, `get_related` where applicable) and validate field names, entity names, and GUID/literal shapes against live schema **before** calling Dataverse. On violation, return a **precise, actionable correction hint** (not the raw Dataverse error). Auto-correct only where unambiguous and safe.

**Non-goals:**
- NOT the full deterministic query *compiler* (Path B). This validates/corrects the model's free OData; it doesn't replace it.
- Not a new restriction mechanism (restriction checks already run; the validator runs after them).
- Not changing the agentic loop.

## 3. Checks (priority order = data weight)

1. **Field-name validation** (Theme A, biggest): parse field tokens out of `select`, `filter`, `orderby`, `group_by`; validate each against `getEntityAttributes(table)` (live, 6h-cached — already wired for A1). Unknown field → reject:
   `Field "akoya_name" does not exist on akoya_request. Did you mean: akoya_requestnum? (nearest live fields: …)` — include a short closest-match list (Levenshtein over live logical names) so the model corrects in one step.
2. **Entity-name validation**: unknown `table_name` → reject with the annotated/known entity list (reuse describe_table's listing). Catches `akoya_proposal`, `akoya_concept`.
3. **GUID / literal validation** (Theme B):
   - A bare GUID literal must be quoted in OData → **auto-quote** `eq <guid>` → `eq '<guid>'` (unambiguous, safe).
   - A lookup `_value` field compared to a non-GUID that looks like a request number (`^\d{6,7}$`) → reject: `_regardingobjectid_value needs a GUID, not a request number. Resolve the request first (get_entity), then filter by its id.`
   - `get_record record_id` that isn't a GUID → same.
4. **Unsupported-construct rejection** (deterministic):
   - `year()/month()/day()` → `Dataverse does not support date functions. Use a range: wmkf_meetingdate ge '2026-12-01T…' and le '2026-12-31T…'`.
   - `_formatted` in a filter → `Cannot filter on _formatted; filter the raw lookup _value (GUID) or the underlying field`.
   - `contains()` on a lookup `_value` → `Lookup fields hold GUIDs; use eq '<guid>', not contains()`.
   - `in (select …)` subquery → `Subqueries are not supported; do it in two steps`.
5. **Lookup `$select` form**: a bare lookup nav field (`wmkf_potentialreviewer1`) in `$select` → hint to use `_wmkf_potentialreviewer1_value`.
6. **fiscalyear format help**: when a filter touches `akoya_fiscalyear`, surface the canonical label format (e.g. `"December 2026"`, from a small live distinct-value sample or the resolved-taxonomy layer) so the model stops guessing `D26`. (Lower-confidence; could be a prompt rule instead.)

Every rejection logs to `dynamics_query_log` with a distinct `denial_reason`-style marker so we can measure the validator's hit-rate post-ship.

## 4. Where it hooks

A single `validateODataCall(name, input, { liveFields })` invoked in `executeTool` (`chat.js`) immediately before the `DynamicsService.*` call for each OData-emitting tool. Returns `{ ok }` or `{ corrected: input }` or `{ reject: hint }`. A reject becomes the `tool_result` content (so the model self-corrects), counted as a validator catch — NOT an opaque error.

## 5. Reuse

- **Live schema:** `DynamicsService.getEntityAttributes(table)` (the A1 mechanism) is the field-name oracle — already cached. The validator is the *enforcement* layer A1's data makes possible.
- **A2 resolved taxonomy:** for program/grantprogram/type/status GUIDs the model still needs; the validator's "lookup needs a GUID" hint can point at the resolved block.
- **Field-token parsing:** a focused OData-expression field extractor (selective reuse of ideas from `lib/services/dataverse-export/compiler.js`, but reading OData not building FetchXML).

## 6. Risks / open questions

- **Field extraction from arbitrary OData** is the hard part — `filter` can nest functions, `and/or`, `$expand` nested `$select`. Start with a tolerant tokenizer (extract `[a-z][a-z0-9_]+` tokens that sit in field position, ignore string literals/operators/functions); over-permissive is safe (a missed token just isn't validated), over-strict is not (don't reject a valid field). Bias to **reject only on high confidence**; unknown-shape → pass through (current behavior).
- **Auto-correct vs reject:** auto-correct ONLY the unambiguous GUID-quoting case; everything else returns a hint and lets the model retry (no silent query rewriting that could change semantics).
- **Closest-match suggestions** must come from the live attribute list (post field-restriction filtering — reuse the redaction/restriction gate from Slice 1 so we don't suggest a restricted field name).
- **Perf:** one `getEntityAttributes` per validated call, cached 6h — negligible after warm.
- **Don't double-reject restricted fields** — the restriction layer already denies those; the validator runs after and uses the same restricted-set so its "did you mean" never surfaces a restricted name.

## 7. Validation / measurement

- Unit tests per check (wrong field → reject + suggestion; unquoted GUID → auto-quote; request-number-as-GUID → reject; year() → reject; _formatted-in-filter → reject; valid query → pass).
- Re-run `analyze-dynamics-explorer-failures.js` after a soak period: errored-call rate should drop and validator `reject` markers should appear (catches moved from opaque Dataverse errors to actionable hints).

## 8. Open decisions for review

1. Field-extraction approach: tolerant tokenizer (recommended, ship-fast) vs. a stricter OData parser.
2. fiscalyear format: live distinct-value sample injected vs. a static prompt rule (it's a label convention).
3. Auto-correct scope: GUID-quoting only (recommended) vs. also rewriting `year()` → range (riskier).
