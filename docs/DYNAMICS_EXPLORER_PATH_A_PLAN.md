# Dynamics Explorer — Path A Plan: Live Ground Truth

**Status:** DRAFT, Codex-reviewed + folded (S200, 2026-05-29). Pre-implementation design.
**Scope:** Incremental hardening of the existing agentic Dynamics Explorer. Keeps the LLM-tool-use paradigm; does NOT build the deterministic structured-query tool (that is **Path B**, a separate additive tier that reuses the same live primitives this plan wires in).

> **Codex review folded (S200).** The first draft made three factual API errors (now corrected): `picklistOptions` is **not** exported from `live-taxonomy.js`; `live-taxonomy` has **no** cache; and `count_records` uses `/$count` (which *throws* on complex filters), not `@odata.count` (the `@odata.count` 5,000-row silent cap lives in `queryRecords`/export estimate mode). Review also: A3 is deferred (needs OData→FetchXML), A1 reworked to cover inline-schema tables, and cache/restriction/token-budget/prompt-injection risks added. See §6 + §9.

---

## 1. Problem (verified current state)

Dynamics Explorer fails frequently because its schema knowledge is **hand-transcribed**, and the prompt instructs the model to **trust baked-in constants over live data**. Verified against the live tree:

- `describeTable` (`pages/api/dynamics-explorer/chat.js:597-625`) returns **only** the hand-written `TABLE_ANNOTATIONS`. For `akoya_request` that is **82 annotated of 579 total attributes** (`scripts/dynamics-schema-diff.json` → `{total:579, interesting:364, annotated:82, missing:283}`; "283 missing" is the gap *within the 364 interesting subset*, not 579−82). The model is told "Do NOT guess field names" — so any real field a human didn't transcribe is invisible.
- Live metadata discovery **already exists and is unused by the agent**: `DynamicsService.getEntityAttributes` (`lib/services/dynamics-service.js:303-347`, `EntityDefinitions/Attributes`, `IsValidForRead`-filtered, **6h cached** via `FIELD_CACHE_TTL` `:48-60`) and `getEntityRelationships` (`:352-398`). The LLM `describe_table` path never calls them.
- **Hardcoded program GUIDs** in the prompt (`shared/config/prompts/dynamics-explorer.js:567-572`) plus a **"VOCABULARY FIRST — use the hardcoded GUIDs, do not re-derive"** rule (`:546`). Environment-specific GUIDs baked into a prompt → silently wrong/empty if they drift.
- **Hardcoded option-set integer codes** (`:552-555`), incl. the `wmkf_request_type eq 100000001` default that gates almost every query.
- **Count paths are two different bugs**, not one: `count_records` → `DynamicsService.countRecords` uses `/{entitySet}/$count` (`:485-507`), which **throws an Edm.Int32 error on complex filters** (the export flow already works around this by sampling 3 records, `chat.js:~1684`). Separately, `queryRecords` `totalCount` reads `@odata.count` (`:442`), which **silently caps at 5,000**. `aggregateRecords` uses OData `$apply` (`:522-569`), subject to the 50,000-row aggregate limit. All three can mislead.

**Codex's `1a20a3a`** ("Fix Dynamics Explorer contact grant retrieval") fixed one concrete bug — contact→requests now ORs across all 11 grantee-side role fields instead of only `_akoya_primarycontactid_value` — and added good anti-confabulation / anti-premature-"not found" prompt rules. But it is **per-bug hand-patching**: it hardcoded an 11-field role list into the filter, growing the "a renamed/removed field → 400" surface from 1 field to 11. Path A makes this class of fix **systematic** rather than one-off.

## 2. Goal / non-goals

**Goal:** replace hand-maintained schema knowledge and baked GUIDs/codes with **live discovery**, and replace ad-hoc domain heuristics with the **probe-verified ground truth** already captured for the Dataverse Power Tools build — without changing the agentic paradigm.

**Non-goals:**
- Path B (deterministic `compiler.js`-backed structured-query tool). Separate plan.
- Deleting `TABLE_ANNOTATIONS` — it carries curated semantics and **dirty-data rules** live metadata cannot know (e.g. the leading-space `" Ineligible"` value, `Paid/PAID` casing). We **augment** it with live fields, never replace it.
- Rewriting the tool set or the SSE loop.

## 3. Reused Power Tools assets (`lib/services/dataverse-export/`) — with the work each needs to be reusable

| Asset | Exposes today | Adapter/work needed for Explorer reuse |
|---|---|---|
| `live-taxonomy.js` | **exports only** `fetchLiveTaxonomy()`, `buildResolver()` (`:151`). `picklistOptions` is file-local (`:50`). **No cache.** Hardcodes `ENTITY_SET='akoya_requests'`. Bypasses `checkRestriction` (direct `getAccessToken`+`fetch`). | Export `picklistOptions` if called directly; **add a cache** (owner+TTL+fail-loud); adapter from resolver field names (`akoya_programid`, `wmkf_grantprogram`) → OData lookup `_value` fields; **restriction/security decision** (§6). Scope is program/request-type/status only — NOT a generic schema resolver. |
| `fetch-client.js` | `fetchXmlAggregateCount(entitySet, countFetchXml, alias)`, paging-cookie pagination, 429 backoff. Also bypasses `checkRestriction`. | **Requires FetchXML input.** Explorer passes OData `$filter` strings → needs an OData→FetchXML shim (see A3, deferred). |
| `constants.js` | era cutover (2023-12-03), status→class map, per-program PI/primary-contact/donor footguns (`:379-404`) | Import selected exports **by reference**; generate an Explorer-specific prompt summary — do NOT transcribe values (drift). |
| `scripts/dynamics-schema-diff.js` (+ `.json`) | The catalog of which fields the annotations miss. | Re-run for a fresh gap snapshot. |

## 4. Phases

Ordered by leverage ÷ paradigm-risk. **Slice 1 = A1 + A2.** A3 deferred (prerequisite below). A4/A5 follow.

### A1 — Live schema into the model (highest leverage) — REWORKED
The first draft only touched `describe_table`, but the prompt tells the model that **inline-schema tables already have "full field details" and should query directly** (`prompts:537-538`), and `akoya_request` — the largest-gap table — is one of the five inline tables (`prompts:470`). So `describe_table`-only changes miss exactly the worst case. A1 therefore has two parts:
- **A1a (describe_table):** for a known table, return curated `fields`+`rules` verbatim **plus** a compact `additionalLiveFields` summary from `getEntityAttributes` (logicalName/type for `IsValidForRead` attrs not in the curated set). Allow fall-through to live attributes for tables not in `TABLE_ANNOTATIONS` (respecting restrictions). **Gate the full field list behind `describe_table({ full: true })`** (Codex rec); default response = curated + `additionalLiveFieldCount`, staying within the 12k-char result cap (`chat.js:65-73`).
- **A1b (inline tables):** soften the "you already know the fields, query directly" rule so the model knows it can call `describe_table` for fields beyond the curated inline set — OR augment the inline schema blocks themselves with a capped live-field addendum. Decide in review; without A1b, the five inline tables keep guessing.
- **Test:** `describe_table('akoya_request', {full:true})` surfaces a real field absent from annotations; restriction enforced; default response stays under the char cap.

### A2 — Live program / option-set resolution (kills the stale-constant class; shared with Path B)
Replace baked GUIDs/codes with values resolved live at request time.
- Build a **cached** taxonomy layer (the cache `live-taxonomy.js` lacks): owner = a small module, TTL ~6h (mirror `FIELD_CACHE_TTL`), **fail-loud** if taxonomy can't be fetched (never silently fall back to stale baked GUIDs).
- Use the **actually-exported** API (`fetchLiveTaxonomy` + `buildResolver`); export `picklistOptions` only if a direct option-set call is needed.
- **Inject a server-side resolved prompt block** (small canonical name→GUID + name→optionvalue mappings) replacing `prompts:552-572`. Do **not** inject raw unrestricted taxonomy wholesale; **escape** live names (they come from Dataverse records — see prompt-injection risk §6). Drop the "VOCABULARY FIRST trust the GUIDs" framing.
- Add an **adapter** mapping resolver field names → OData lookup `_value` fields.
- **Couple prompt changes with prompt-contract tests** (A2 edits the `buildSystemPrompt` path, `chat.js:128`).
- **Test:** a rotated GUID no longer breaks a program filter; resolved codes drive `wmkf_request_type`; fail-loud on taxonomy fetch failure.

### A3 — Robust counts — DEFERRED (prerequisite required)
`count_records` (`/$count`, throws on complex filters) and `@odata.count`-based estimates (silent 5,000 cap) are both unreliable, and `fetchXmlAggregateCount` is the robust replacement (true count, fail-loud past the aggregate limit) — **but it takes FetchXML, and Explorer produces OData `$filter` strings.** A3 is therefore **blocked on an OData-filter→FetchXML shim** (a focused converter, or selective reuse of `compiler.js` condition-building). **Defer A3** until that shim is scoped as its own sub-phase; do not attempt it in slice 1.

### A4 — Footgun guardrails from `constants.js` (replace `_note` guesses)
Fold the probe-verified domain facts into the prompt's domain guidance + disambiguation logic, **imported by reference** from `constants.js:379-404` (generate an Explorer prompt summary; don't copy values):
- `akoya_primarycontactid` = foundation **liaison, not PI**; `wmkf_projectleader` PI-fill is **program-conditional** (~98% Medical Research, ~0% elsewhere) → prevents the "0 results ⇒ no PI" confabulation and the contact-role conflation Codex just hand-fixed.
- Era cutover (2023-12-03) + status→class map.
- **Reconcile the `akoya_folio` drift:** prompt says `contains()` for `Paid/PAID`; memory `akoya-payment-field-semantics` + `constants.js` say `akoya_folio = "PAID"`. Fix the prompt to the probe-verified value.

### A5 — Fail-loud instead of round-burning (prerequisite: structured errors)
Turn schema mismatch into an actionable signal. **Prerequisite:** today tool errors are truncated plain strings (`chat.js:203-208`) — A5 first needs typed error classification (unknown-field vs other). Then: unknown-field → return the live field list (from A1) for deterministic correction; unmapped taxonomy value → `UNCLASSIFIED` sentinel surfaced, not silently dropped.

## 5. Sequencing & dependencies

```
A1 (a: describe_table + b: inline tables) ─┐  Slice 1 (highest-leverage, independent of each other)
A2 (cached live taxonomy + resolved prompt)─┘
A3 (robust counts) — DEFERRED → needs OData→FetchXML shim sub-phase
A4 (guardrails) — independent; benefits from A2
A5 (fail-loud) — needs typed errors (prereq) + A1's live field list
```
A2's cached-taxonomy layer is the **shared foundation with Path B**.

## 6. Risks (expanded per review)

- **Token budget (HIGH):** `describe_table` 12k-char cap (`chat.js:65-73`), `maxTokens: 2048` responses (`:415-420`), five inline schemas already in the system prompt. Resolved maps + live fields can crowd out useful context → need a field-budget strategy + the `full:true` gate.
- **Restriction inconsistency (HIGH):** `live-taxonomy`/`fetch-client` bypass `checkRestriction` (direct fetch), while Explorer fails closed without `withDynamicsContext` (`dynamics-context.js:4-8`). A2 must define a **security policy**: does resolved taxonomy expose restricted table names/labels? Route reuse through the restriction context or whitelist the program/request-type/status taxonomy as non-sensitive.
- **Cache correctness (MEDIUM):** A2 must own the taxonomy cache (TTL, invalidation, fail-loud) since the source module has none.
- **Prompt-injection (MEDIUM):** live program/type **names** from Dataverse records injected into the *system prompt*; the current untrusted-content boundary wraps only tool results (`chat.js:220-230`), not system-prompt metadata. Escape/validate injected names.
- **Test breakage (MEDIUM):** integration tests mock `buildSystemPrompt`/`TOOL_DEFINITIONS`/`TABLE_ANNOTATIONS` (`tests/integration/dynamics-explorer-tool-serialization.test.js:30-34`); live paths need new tests, not just the mocks.
- **Do not delete `TABLE_ANNOTATIONS`** — curated dirty-data rules have no live-metadata equivalent.

## 7. Testing

Per-phase unit/integration tests on the existing harness. Each phase ships with a test that would have caught its target failure. A2 + A1 require **prompt-token-budget tests** before shipping.

## 8. Decisions (Codex recommendations adopted)

1. **A1 token cost:** gate full live fields behind `describe_table({ full: true })`; default = curated + `additionalLiveFieldCount`.
2. **A2 surface:** server-side resolved prompt block for the small canonical mappings; escape live names; prompt-contract tests. No wholesale taxonomy injection.
3. **Slice scope:** ship **A1 + A2** first; **defer A3** until the OData→FetchXML shim is scoped.
4. **A4 provenance:** import `constants.js:379-404` exports by reference; generate an Explorer-specific summary, don't duplicate values.

## 9. Remaining open questions

- **A1b:** soften the inline-"query directly" rule, or augment the inline schema blocks with capped live fields? (Determines whether the five biggest-gap tables benefit.)
- **A3 shim:** purpose-built OData→FetchXML converter vs. selective `compiler.js` reuse — scope as its own design.
- **A2 security:** confirm program/request-type/status taxonomy is non-restricted, or route through `withDynamicsContext`.
