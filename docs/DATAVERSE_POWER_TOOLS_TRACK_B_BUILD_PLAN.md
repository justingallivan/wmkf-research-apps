# Dataverse Power Tools — Track B (Bulk Export) Build Plan

**Status:** S161 — **Phase 1 (deterministic spine) + Phase 2 (API + builder UI) IMPLEMENTED — Track B is user-reachable end-to-end.** Phase 1 = `lib/services/dataverse-export/` (constants · compiler · fetch-client · disclosure · workbook), headless-tested + Codex-converged (S160, commits `4bfd7db`/`cb662cd`). Phase 2 = `pages/api/dataverse-export/{metadata,preview,run,download}.js` + stateless confirm-token (S160, twice Codex-converged) and the forced-fan-out builder UI `pages/dataverse-bulk-export.js` (S161) over the stable `/preview`→`/run`→`/download` seam. **§10 owns the phase ledger (now: Phase 1 + 2 DONE; Phase 3 preset library is non-v1-core).** Plan history: S159 — Phase-1-ready post three design-level Codex cold rounds (v1 5 P0/10 P1; confirm 3 gaps+2 drifts; final 1 residual). v1-core engineering decisions are resolved here, not deferred. Authored against the converged design in `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` — that doc's **"Residuals — AUTHORITATIVE LIST"** owns scoping/status; this doc owns *engineering*. Do not restate status divergently here; where this plan needs a semantic determination it **binds to** the design doc by reference and names the must-not-drop specifics, it does not re-derive or restate divergently.

**Prerequisite gates (all met S159):** v1-core data/semantic gates closed — default column contract (user-confirmed + Codex-audited), per-program decline segmentation (probe-resolved), era boundary / decided-state / program-type axes / operational exclusions / test-record predicate / institution-disambiguation design input. Open items are **scoped out of v1-core**: the 121-view preset library (Phase 3 guided layer), 4 embedded-nested RDL de-nests, the orthogonal Puzzle 2c doc-rationale dimension, Track A entirely.

---

## 1. Scope of this build

**In (v1):** A read-only, plain-English **structured filter builder** over `akoya_request` that produces a **generous, trust-bounded, honestly-characterized Excel chunk** the accountable analyst refines in Excel. Two doors deferred to one: v1 is the **expert reductive door only** (the analyst holds the predicate; the tool solves *expression*, not intent).

**Out (explicitly, by design — not omissions):**
- Track A ("Find & fix" edits) — separate app, separate build, write-path-gated.
- AI natural-language on-ramp — Phase 2+ (the compiler/confirm seam is built so it slots in; v1 ships zero AI).
- The 121-view preset/"canonical slice per program family" guided layer — Phase 3, gated on the recognition working-session; **not** required for the expert builder (the dominant trusted pattern is operator-supplied filters — 28/36 RDLs are prefilter-only).
- Async/background-job export — deferred until evidence shows real exports exceed the hardened-synchronous budget.
- Bulk DOCX→text decline-rationale extraction — deferred phase; v1 surfaces a retrieval *link* only.
- Deep-history (pre-cutover) as a bulk concern — routes to Track A / Explorer find-one by design.

**One-sentence product thesis (from design doc):** force the latent ambiguities — which *type*, which *era*, what does "2021" mean, which *budget*, which *institution* — into explicit choices, then emit a reproducible, honestly-characterized chunk.

---

## 2. Architecture — the QuerySpec spine (compiler, not interpreter)

The invariant that keeps this from regressing into "Explorer 2": **a structured spec is compiled deterministically; nothing interprets intent and acts.** The AI (Phase 2) never executes, never paginates, never sees the result set — it only emits a `QuerySpec` rendered back into the builder for human confirmation.

```
[Expert builder UI]  ──emits──>  QuerySpec (structured JSON)
                                      │
                          POST /preview │  (deterministic compile + true count, NO rows)
                                      ▼
        QuerySpec → FetchXML compiler  +  semantic/disclosure engine
                                      │
                         ┌────────────┴─────────────┐
                         ▼                            ▼
              compiled FetchXML (shown)     composition preview:
              + true total (FetchXML agg)   era split · classification ·
                                            unclassified set · program
                                            roll-up in/out · est. size
                                      │
                          ── human confirm gate ──
                                      │
                          POST /run  │  (confirmed QuerySpec only)
                                      ▼
            backoff-hardened FetchXML paging → rows (buffered)
                                      ▼
            Excel artifact: Data sheet (+ per-row sentinels)
                          + Methods/Provenance sheet (baked-in honesty)
                                      ▼
   ONE POST /run = an SSE response: emits progress while paging/building,
   writes the .xlsx to a PRIVATE Vercel Blob store, terminal {ready,downloadUrl}
   → browser GETs the authenticated /api/dataverse-export/download?t=<token>
   proxy. No base64. No public Blob URL. No second model.
```

**`QuerySpec`** (the seam — versioned JSON):
```jsonc
{
  "version": 1,
  "entity": "akoya_request",
  "filters": [ { "axis": "program", "field": "akoya_programid", "op": "eq", "value": "<guid>" },
               { "axis": "dateBasis", "field": "akoya_decisiondate", "op": "between", "from": "2021-01-01", "to": "2025-12-31" },
               { "axis": "amount", "which": "awarded", "field": "akoya_grant", "op": "gt", "value": 1500000 } ],
  "programRollup": "optionB",          // wmkf_type=Program only; non-Program as separate lines
  "excludeOperational": true,           // strip Site/Office Visit/Phone, Research Reviewer
  "excludeTestRecords": true,           // default on
  "columns": { "default": true, "optIn": ["akoya_payee"] },
  "eraScope": "all"                     // provenance dimension, never a business-period filter
}
```
Every fan-out (which budget, which date-basis, which program axis) is an explicit field in the spec — there is no "smart" default that hides a choice. The builder *forces* the choice; the compiler *fails closed* on an ambiguous/absent one.

### 2.1 QuerySpec formal contract (validated server-side before compile)

**Closed axis set** (a filter `axis` outside this set ⇒ reject): `program` (`akoya_programid`, GUID-valued), `fundingCategory` (`wmkf_grantprogram`, GUID-valued — the separate model-(b) axis), `dateBasis` (`akoya_decisiondate` only; `createdon`/business-period is rejected), `amount` (requires `which` ∈ {`awarded`,`requested`,`total`,`recommended`,`invited`}), `status` (`akoya_requeststatus`, validated against the live taxonomy), `type` (`wmkf_type`), `institution` (applicant/payee account identity or AKA), `requestType` (`wmkf_request_type`/`akoya_requesttype`).

**Operators by axis-kind:** GUID/optionset → `eq`,`in`,`notnull`,`null`; money → `eq`,`gt`,`gte`,`lt`,`lte`,`between`; date → `between`,`onorafter`,`onorbefore`; string/identity → `eq`,`contains`,`in`. Any other (axis, op) pair ⇒ reject.

**Validation matrix (preview & run both run it; identical):** (1) `version` known; (2) every `filter.axis` in the closed set; (3) (axis, op) legal; (4) **filter-literal handling — NOT row classification (these are different mechanisms; do not conflate):** a GUID/optionset value in a *filter* is **compiled literally, never a 422 and never coerced** — the taxonomy is living, so a value may be brand-new or just-deactivated and is still a legitimate filter; if it is absent from the live taxonomy the **preview** surfaces it explicitly (`filter value <x> on <axis> is not in the current taxonomy — will match 0 rows unless newly added`) so the user sees it before confirming. The `UNCLASSIFIED` sentinel (§3c/§9) is a **post-query, per-returned-row** classification path for rows whose value is absent from the annotation map — it has nothing to do with filter-literal validation. (5) `dateBasis.field` ≠ `createdon` (hard reject — `createdon` is provenance, never a history filter); (6) `amount.which` present when `axis=amount`; (7) `programRollup` ∈ {`optionB`}; (8) booleans (`excludeOperational`,`excludeTestRecords`,`columns.default`) present (no implicit default that hides a choice). `eraScope` ∈ {`all`,`migrated`,`native`} and is a **provenance** filter only.

**Stable error contract** (HTTP 422, never a 500, never a silent coerce):
```jsonc
{ "error": "INVALID_QUERYSPEC",
  "violations": [ { "code": "AXIS_UNKNOWN|OP_ILLEGAL|CREATEDON_AS_DATE|AMOUNT_WHICH_MISSING|VERSION_UNKNOWN|...",
                    "path": "filters[2].op", "detail": "human-readable" } ] }
```
The builder cannot emit an invalid spec by construction; the contract exists because the spec is the public seam (Phase-2 AI will emit it) and a hand-rolled/AI spec must fail closed and legibly, never partially execute.

---

## 3. The deterministic core (`lib/services/dataverse-export/`)

### 3a. FetchXML query primitive — **the central new infrastructure**

The codebase has **no FetchXML support**: `dynamics-service.js::queryAllRecords` is OData-only, hard-capped at exactly 5,000 (`MAX_EXPORT_RECORDS`), requires a `$filter`, **throws on the first non-200, has no 429/Retry-After/backoff**, and buffers all rows. OData `/$count` silently caps at 5,000 — *that ~80% undercount is the exact trigger this tool exists to fix.* So v1's spine is a **new** primitive, not a reuse:

`lib/services/dataverse-export/fetch-client.js`
- `fetchXmlPage(entitySet, fetchXml, pagingCookie)` → one page via `?fetchXml=`, `Prefer: odata.maxpagesize=<N>` + `odata.include-annotations="*"`.
- `fetchXmlAll(fetchXml, { hardCapRows, hardBudgetMs })` → pages via the FetchXML **paging cookie** (not `@odata.nextLink`); returns `{ rows, fetched, capped, truncatedByBudget, pages }`.
- `fetchXmlAggregateCount(entity, filterFx)` → the **true total** via `<fetch aggregate="true"><attribute aggregate="count"/>`. **Never OData `/$count`.** This is a hard correctness invariant of the engine (design doc, promoted from UI concern).
- **Backoff-hardened (Codex v1 requirement):** 429 / `Retry-After` / 5xx → exponential backoff + jitter, capped retries; the broad query the tool exists to serve must *succeed*, not throw on first blip. A page that ultimately fails after retries → loud, actionable error (never a silent partial).
- Reuses `dynamics-service.js` only for the OAuth token acquisition + `fetchWithTimeout` abort wiring; the query path is independent.

**Concrete v1 limits (fixed here, not "open"):**
- FetchXML page size = **1,000** (`Prefer: odata.maxpagesize=1000` — FetchXML supports up to 5,000/page; 1,000 balances round-trips vs per-page latency/memory; one measured timing run during Phase 1 may raise it, but 1,000 is the committed default, not a TBD).
- `hardCapRows` default = **50,000** (parameterized; replaces the arbitrary 5,000). Beyond it ⇒ `capped:true` + loud-truncation UX, never silent.
- `hardBudgetMs` = **240,000** (240 s, under Vercel's 300 s ceiling with headroom for compile + XLSX write + stream start). Budget-exceed ⇒ stop paging, return `truncatedByBudget:true` with rows-so-far + the loud-truncation UX.
- In-memory ceiling: rows buffered; **abort with a loud actionable error at 200 MB resident or 250k rows**, whichever first (a "generous chunk" is hundreds–low-thousands; exceeding this means the filter is too broad — tell the user to narrow, do not OOM).
- XLSX byte ceiling: **40 MB** written-buffer; exceed ⇒ fail loud with "narrow the filter / fewer opt-in columns", not a truncated file. (The Explorer 3 MB base64 guard does not apply — Track B streams, see §5.)

**Partial-page-failure contract:** a page that still fails after the capped backoff retries ⇒ the whole run **fails loud** (`{event:'error', stage:'paging', page:N, retryable:false}`) — never a silently-short file. There is no "best-effort partial export"; a short result that looks complete is the exact plausible-wrong-answer the tool exists to prevent.

This module is testable in isolation against a fixture `QuerySpec` before any UI exists (Phase 1 exit criterion).

### 3b. QuerySpec → FetchXML compiler (`compiler.js`)

Pure function `compile(querySpec) → { fetchXml, countFetchXml, appliedRules[] }`. Encodes **every** resolved hard invariant (authority = design doc; do not re-derive):

| Invariant | Compiler behavior |
|---|---|
| **Era** | `createdon` = creation-*provenance* partition only. Business-history filters compile to `akoya_decisiondate` (fallback `wmkf_meetingdate` when null on Active/awarded), **never `createdon`**. If a spec tries to time-slice on `createdon` → compile error. |
| **Decided-state** | Implements the design-doc `akoya_requeststatus` value→class map **verbatim** (binding reference, design doc AUTHORITATIVE-LIST detail — do not re-derive). Pending\*=in-flight; \*Declined/Ineligible/Denied/Closed/\*Done/Approved=decided-terminal. **Must-not-drop ambiguous-middle resolutions (named so a reimplementation cannot silently lose them):** `Active`=awarded-in-performance (decided, not closed); `Proposal Not Invited`=terminal triage-decline (no award → declined class); `Withdrawn`=terminal no-award, **path-agnostic — the sentinel must NOT attribute a cause/actor**. Never decisiondate-presence (that is an approval stamp). A status absent from the live map ⇒ the §9 `UNCLASSIFIED` path, not a guess. |
| **Program axis** | `akoya_programid`→`akoya_program` canonical, **keyed by GUID** (duplicate program name exists; 816 legacy nulls). `wmkf_grantprogram` is a *separate* coarse funding/payment axis — offered as a distinct labeled filter, never conflated. Default = `akoya_programid` ∧ `wmkf_type=Program`. |
| **Program roll-up (Option B)** | Program grant total = `wmkf_type=Program` rows only; `Special Projects`/`Special Grants`/etc. compile as **separate reported lines**, never folded in. Emits a mandatory per-program in/out breakdown (disclosure engine). |
| **Operational exclusion** | Axis-by-axis (binding reference: design-doc AUTHORITATIVE-LIST (ii) detail — not a single predicate): exclude `wmkf_request_type ∈ {Office Visit, Site Visit, Phone}` **and** `wmkf_type = Site Visit` **and** `akoya_program = Research Reviewer` (≡ `wmkf_type = Individual`, the Jan-2026 honorarium cohort). **Sharpest single reviewer-exclusion predicate: `wmkf_grantprogram = Honorarium`.** `wmkf_type = Miscellaneous` is **real grants** — included (52 rows/$3.35M, probe-substantiated). |
| **Test records** | Default-exclude `applicant account.name = "W. M. Keck Foundation" ∧ native era` (22-row bounded; opt-in to include, with disclosure). |
| **Amount fan-out** | `which: awarded` → `akoya_grant`; `requested` → `akoya_request`; `total` → `akoya_expenses`; `recommended` → `akoya_recommendedamount`; `invited` → `wmkf_invitedamount` (explicit fields, all five — no "plus …"). Money compiles the `*_base` currency pair (+ `LE_*currencyprecision/symbol`), never the display string. Migrated `akoya_request`/`akoya_expenses` are never emitted as a real amount (migration-backfill artifact → §3c B-structural sentinel). |

The compiler returns `appliedRules[]` so the methods sheet can state, in plain English, exactly what was applied.

### 3c. Semantic / disclosure engine (`disclosure.js`)

Post-query, per-row + aggregate. Produces the **baked-in honesty** (design doc §"Disclosure-layer spec", 6 mandatory items):

1. **Era column on every row** + a methods/provenance sheet (2023-12-03 cutover, per-bucket rules, probe provenance, the ~169-row business-era cross-contamination disclosure when both dims present).
2. **Bucket-B-lifecycle nulls → status-class caption** (binding reference: design §Disclosure-layer spec; the terminal-non-award class is the **named set**, not a paraphrase), never bare blank: `Pending*` ⇒ `NOT YET DECIDED`; terminal-non-award ⇒ `DECIDED — no award` where terminal-non-award = `*Declined` / `*Ineligible` / `Denied` / `Concept Done` (the design's named set — a reimplementation must not silently shrink it); terminal-approved-but-absent ⇒ `UNKNOWN — not captured`.
3. **Bucket-B-structural** class-aware sentinel: migrated ⇒ `UNKNOWN — migration backfill`; native **Concept/interaction** ⇒ `N/A — feedback request`; native Request+Approved+has-award ⇒ `N/A — invited/discretionary award`; else `UNKNOWN — not captured`. (Migrated `akoya_request`/`akoya_expenses` are **never** exported as a real amount — migration-backfill artifact.)
4. **Bucket-D fields** excluded from default; opt-in, flagged "sparse all eras".
5. **Composition line mandatory even in expert mode**: `N rows: X migrated (pre-2023-12-03) · Y native; of native, Z in-flight (Pending*)` — counted from the status class map.
6. **Program roll-up Option-B line**: `Program $X [excludes: Special Projects $Y, Special Grants $Z — reported separately]`.

Plus the S159-resolved engine rules:
- **Decline output (per-program-segmented, never pooled):** era-aware field — migrated `akoya_denialreason` (Picklist) / native `wmkf_denialnotes` (Memo); **SoCal-area programs additionally read the third field `wmkf_socalreasonsfordecline2`**; trifurcate declined-nulls into `declined-with-reason` / `declined-triage (no reason expected: Proposal Not Invited / *Ineligible)` / `declined-reason-missing (should exist)`; **`(program-unattributed declines)` is its own fail-loud bucket** (native `akoya_programid`-null, ~9% of native declines) — never silently dropped or mis-assigned; doc-resident rationale (Puzzle 2c) → surface a retrieval **link** only (extraction deferred).
- **Primary Contact caption (mandatory):** `akoya_primarycontactid` = the institution's WMKF **foundation liaison / grant steward** (President's office for large gifts) — **NOT the PI**; the PI is `wmkf_projectleader` (see below).
- **PI column (`wmkf_projectleader`, program-conditional via a PER-PROGRAM annotation — NOT a blanket research/non-research binary):** each program carries a `pi_bearing` annotation in the semantic layer (parallel to the per-program decline rule, same Living-taxonomy discipline). Probe-derived seed (`akoya-projectleader-by-program-2026-05-17.txt`): PI-bearing = Medical Research 98%, Science & Engineering 90%, **Bridge Funding 100%** (a research *mechanism* — proves the crude "Research-program-name only" split is wrong); not-PI-bearing = Civic & Community 3% / Precollegiate 4% / Health Care 2% / discretionary-operational ~0%. Annotated PI-bearing ⇒ DEFAULT PI column; annotated not-PI-bearing ⇒ `N/A — no PI (non-research process)` sentinel, never blank; **program with no `pi_bearing` annotation ⇒ fail-loud `UNCLASSIFIED PROCESS — manual review required`** (§9), never a guessed default. Whole-entity 16/32% mig/nat is a process-pooled fiction — never used.
- **Institution disambiguation — baked into the artifact in v1 (design hard requirement, lines 149-153; NOT deferrable, NOT "leave it to Excel"):** `parentaccountid`/`akoya_defaultpayee` are ~0% (census) — no structural backstop. v1 emits `resolved_institution` + a mandatory `institution_resolution` annotation, via this **exact deterministic algorithm (specified so two implementations cannot diverge — v1 is deterministic-only, NO fuzzy/learned merge)**:
  1. **Normalize(s)** — a pure function: Unicode NFKD + strip diacritics → lowercase → strip a fixed trailing legal-suffix set (`inc`, `inc.`, `llc`, `l.l.c.`, `ltd`, `corp`, `co`, `foundation`, `fdn`, `trust`, `fund`) → strip leading `the ` → expand `univ`/`u` → `university`, `inst` → `institute` (fixed map, not heuristic) → strip all non-alphanumeric → collapse runs of space. The fixed suffix/abbrev maps are committed constants (Living-taxonomy: data, not code-logic — extendable without a code change).
  2. **Per-row key precedence** (first non-empty wins): `Normalize(wmkf_legalname)` → else `Normalize(account.akoya_aka)` → else `Normalize(account.name)`. The #1003083 case (UGA applicant vs "UGA Research Foundation, Inc." payee, both `akoya_aka="University of Georgia"`) clusters via the AKA tier.
  3. **Applicant vs payee merge:** compute the key for both the `akoya_applicantid` account and (if present) the `akoya_payee` account. Equal ⇒ one `resolved_institution`. Unequal ⇒ `resolved_institution` = the *applicant* key, `institution_resolution = "ambiguous — payee differs"`, and `wmkf_usingpayee=true` (weak positive, non-census) is noted in the methods sheet only, never used to auto-merge.
  4. **Collision/variants:** rows that produce the same key are the same cluster (exact normalized-key equality only). Distinct keys are **never** fuzzy-merged in v1 — distinct ⇒ distinct. If ≥2 raw account names share a key, `institution_resolution = "ambiguous — N variants share key"` (transparency, not an error).
  5. **`institution_resolution` ∈** {`resolved` (single account or applicant==payee key), `ambiguous — payee differs`, `ambiguous — N variants share key`, `unresolved — no legalname/aka/name`}.
  - **Fail-loud, never false-precise:** every non-`resolved` row carries the annotation; the methods sheet states the exact Normalize() rules + "deterministic exact-key only, NOT entity resolution — fuzzy/learned merge is a Phase-2 enhancement"; the composition line counts each non-`resolved` bucket. Raw `akoya_applicantid`/`akoya_payee` + AKA + legal-name columns are *also* emitted (transparency). The resolved column + annotation is the v1 deliverable — institution rollup is exactly what Excel cannot recover.

### 3d. Excel artifact writer (`workbook.js`)

ExcelJS 4.4.0 (already a dependency; reuse the `recordsToExcel` column/format conventions from `pages/api/dynamics-explorer/chat.js` but **not** its 3 MB base64 trim guard — that guard is specific to base64-over-SSE, which this plan rejected; the governing ceiling is §3a's 40 MB written-buffer, then write the buffer to Vercel Blob). Output:
- **Data sheet** — the default column contract (§4) + opted-in columns, with per-row sentinels (never bare blanks), era column, resolved-institution column.
- **Methods / Provenance sheet** — non-optional. The reproducible methods section: cutover date, `appliedRules[]` in plain English, per-bucket sentinel legend, composition line, program roll-up in/out line, decline-trifurcation legend, the test-record/operational exclusions applied, the institution-clustering caveat, true total vs returned (truncation), probe-provenance footnotes (probe-substantiated vs user-attested, tagged).

---

## 4. The column contract (S159-closed, user-confirmed, Codex-audited)

The default SET is owned by the design doc's **Artifact 1 table** (do not duplicate the list here — reference it). Build rules:

- **Default columns** = the Artifact-1 SET + S159 adds: `akoya_primarycontactid` (with the liaison caption), `account.address1_city`, `account.address1_stateorprovince`, and `wmkf_projectleader` **program-conditionally via the per-program `pi_bearing` annotation** (§3c — PI-bearing program ⇒ default PI; not-PI-bearing ⇒ `N/A — no PI` sentinel; unannotated ⇒ fail-loud).
- **Opt-in (flagged):** `akoya_payee` ("native-era only ~1% migrated; mostly mirrors applicant in sample, diverges notably e.g. fiscal-sponsor/research-foundation — taxonomy not exhaustive"). Bucket-D fields, opt-in, flagged sparse.
- **Pruned (never offered):** `akoya_purpose` (2-value boilerplate).
- Money columns export the `*_base` currency pair. Lookups export the formatted display + the resolved-entity where the engine resolves it.

---

## 5. API surface (`pages/api/dataverse-export/`)

All three routes: `requireAppAccess(req, res, 'dataverse-bulk-export')` (per-route gate — Codex packaging correction; registry membership is necessary but not sufficient). CSRF/origin via the existing `requireAppAccess` path.

| Route | Method | Behavior |
|---|---|---|
| `/api/dataverse-export/metadata` | GET | Live taxonomies (program/status/type) for the builder, enumerated from Dataverse **at request time** (Living-taxonomy: never hardcoded). Fail-loud on fetch failure (visible error, not a silent stale list). |
| `/api/dataverse-export/preview` | POST | Validate `QuerySpec` (§2.1; 422 + violation list on failure) → compiled FetchXML (returned for inspection) + **true total via FetchXML aggregate count** + composition preview (era split, classification, unclassified set, program roll-up in/out, estimated size/time + a `resultToken` binding the validated spec). **Returns NO data rows.** The human-confirm gate. |
| `/api/dataverse-export/run` | POST | Body = the `resultToken` from a prior `/preview` (server-side confirm gate — the run cannot execute a spec the user did not see previewed). **This single POST is itself an SSE response** (`Content-Type: text/event-stream`): in one invocation it re-validates → backoff-hardened FetchXML pages → builds the workbook → **writes the `.xlsx` to Vercel Blob** (project-native storage; serverless-correct — no held-in-memory file across requests, no second invocation), emitting `progress` frames throughout, then a terminal `ready` event. Hard 240 s budget; loud truncation. |

**File delivery — the ONE model (resolves the v1/v2 P0-D contradiction definitively):** there is exactly one retrieval path. `POST /run` is an SSE stream that does the work and, on success, **writes the workbook to a PRIVATE Vercel Blob store** (`access: 'private'`) and emits a terminal `{event:'ready', downloadUrl, expiresInSec, bytes}` whose `downloadUrl` is an **authenticated `/api/dataverse-export/download?t=<token>` proxy** (the browser cannot fetch a private Blob directly — `/download` re-authenticates via `requireAppAccess`, validates the short-lived token, and streams the bytes through with `Content-Disposition: attachment`). The token has TTL ≈ 1 h. **No base64-over-SSE** (rejected — unworkable at size). **No streamed `Content-Disposition` POST body** (rejected — incompatible with a progress channel on serverless: one invocation cannot both stream SSE progress *and* be the file body). **No separate progress endpoint / second GET of an in-memory file** (rejected — serverless has no shared state between invocations). **No public Blob URL fetched directly by the browser** (rejected — the export contains trust-bounded operational data; private store + authenticated proxy is the access boundary). Vercel Blob is already the project's file-storage primitive (CLAUDE.md tech stack), so this adds no new infrastructure beyond the dedicated `dvx-export-private` store (`DVX_BLOB_RW_TOKEN`). The Explorer 3 MB base64 guard does not apply and is explicitly not the model.

**SSE convention** mirrors Virtual Review Panel: `res.write(\`data: ${JSON.stringify({ event, ...data })}\\n\\n\`)`, headers `text/event-stream` / no-cache / keep-alive. Events on the `/run` stream: `{event:'progress', pages, fetched, total}`; `{event:'truncated', reason:'cap'|'budget', total, fetched}` (still proceeds to build+upload the truncated set, then `ready`); terminal success `{event:'ready', downloadUrl, expiresInSec, bytes}`; terminal failure `{event:'error', stage, message, retryable}` (no Blob written — nothing for the client to fetch; never a silently-short file). The client treats `ready` as the only signal to download and `error` as terminal-discard; there is no partial-file path because the file is only ever published to Blob *after* a fully successful build.

**API route security matrix:** `npm run check:api-routes` fails on `pages/api/**` additions without a matrix update — adding these 3 routes to `docs/API_ROUTE_SECURITY_MATRIX.md` is part of the implementation PR (catalogue grows 80→83).

---

## 6. The expert filter builder (`pages/dataverse-bulk-export.js`)

`RequireAppAccess` guard (client-side defense-in-depth; the API gate is authoritative). UI:

- **Structured filter builder** — business-vocabulary fields (not `akoya_*` logical names / optionset ints), discoverable. Every fan-out is a **forced explicit choice**, not a hidden default:
  - *Which type* (polymorphism — grant vs concept vs operational; operational excluded by default with a visible toggle).
  - *Which era scope* (provenance dimension; explicitly **not** a business-period control — the date-basis control is separate and labeled).
  - *Which date basis* (`akoya_decisiondate` default; `createdon` is **not** offered as a history filter).
  - *Which amount* (Awarded / Requested / Total project / Recommended / Invited — no bare "budget").
  - *Which program axis* (`akoya_programid` 24-program taxonomy default ∧ `wmkf_type=Program`; `wmkf_grantprogram` funding-category as a separate labeled filter).
- **Preview/confirm panel** (renders the `/preview` response): the compiled spec in plain English, the **true total prominently**, the mandatory composition line, the program roll-up in/out line, and any **unclassified / fail-loud warnings** — the user sees the gaps *before* they run.
- **Run + download**: confirm → `POST /run` (the SSE stream) → render `progress` frames → on terminal `{ready, downloadUrl}` GET the authenticated `/api/dataverse-export/download?t=<token>` proxy (browser download; proxy re-authenticates and streams from the private Blob store). **Loud truncation** if `truncated`: true total shown prominently + the offered narrowing dimensions ("8,213 match — narrow by program / year / status / institution"), never a quiet footnote (the truncated set still downloads, clearly labelled). On terminal `error`: visible message, **no download offered** (nothing was published to Blob) — the user can never mistake a failure for a short-but-complete file.

---

## 7. Packaging & access

- `shared/config/appRegistry.js`: new entry `{ key: 'dataverse-bulk-export', name: 'Dataverse Bulk Export', href: '/dataverse-bulk-export', icon: '📤', description: ..., categories: [...], features: [...] }` — mirror the Virtual Review Panel entry shape.
- Admin-assignable to a **volume-users** group via Dataverse `wmkf_appuserappaccesses` (the registry is nav/config only — Codex correction). Not superuser-only (too narrow).
- Every endpoint gated by `requireAppAccess(req, res, 'dataverse-bulk-export')`. Track A, when built, is a *separate* app key — do not bundle a read tool and a write tool under one coarse grant.

---

## 8. Engineering requirements (Codex-mandated v1 — not "later")

1. **Backoff-hardened paging is v1.** The robustness floor is *the big query must succeed*. 429/`Retry-After`/5xx → exponential backoff + jitter + capped retries; ultimate failure → loud actionable error, never a silent partial result. (Today's `queryAllRecords` throws on first non-200 — the exact broad query the tool exists for fails hardest; the new primitive must not.)
2. **Concrete sync budget + hard ceilings — fixed in §3a, not "open":** page size **1,000**, `hardBudgetMs` **240 s** (Vercel 300 s − headroom), `hardCapRows` **50,000**, in-memory abort **200 MB / 250k rows**, XLSX **40 MB**. Budget/cap-exceed → return-what's-fetched + `truncated` + loud UX, never a hang or silent cut. One Phase-1 measured timing run against a realistic broad filtered slice may *raise* page size, but the committed defaults stand without it. Async/background-job model is a **deferred** phase, built only if a genuine need exceeds what hardened-sync safely delivers.
3. **Loud, actionable truncation.** Parameterize the arbitrary 5,000 cap; surface `capped` / true `totalCount` prominently in the UI with narrowing dimensions. (The helper already returns the signals — the defect was the cap + UI not surfacing it.)
4. **True total via FetchXML aggregate, never OData `/$count`.** A correctness invariant, not a nicety — `/$count` caps at 5,000 and *looks exactly like* the triggering "~5,000 requests."

---

## 9. Living-taxonomy & fail-loud runtime contract (concrete, not a slogan)

Enforced in the metadata route + disclosure engine (design doc §"Fail-loud runtime contract"):
- Taxonomies (`akoya_program`, `wmkf_type`, `akoya_requeststatus`, …) enumerated **live at query time**, never a hardcoded list. No documentation/drift cadence required (currency is in the runtime).
- A row whose program/status/type value is **absent from the semantic-annotation map** → **included** with raw value preserved + a per-row column `UNCLASSIFIED — <axis>=<rawvalue>`. Never silently dropped, never coerced to the nearest known bucket.
- Unclassified set summarized in the composition line + methods sheet: `K rows in N unclassified <axis> value(s): [list] — included, flagged, not interpreted`.
- Unclassified value on a **process-dependent output path** (e.g. decline-reason for a program with no process annotation) → emit raw + `UNCLASSIFIED PROCESS — manual review required` + a **hard UI warning**; do not apply a default process rule.
- No swallowed exceptions: taxonomy-fetch failure / unmapped value / unannotated program is a visible, actionable, artifact-baked condition — never a log line only.

---

## 10. Phasing & what's deferred

| Phase | Content | Gate |
|---|---|---|
| **1 — Deterministic spine** ✅ **DONE (S160)** | FetchXML primitive (backoff paging + aggregate count), QuerySpec compiler, semantic/disclosure engine, Excel writer. Headless-tested (43/43); Codex cold-round folded + confirm-converged. `lib/services/dataverse-export/`, commits `4bfd7db`+`cb662cd`. | (was: none — column contract + semantic rules closed S159). Met. |
| **2 — Expert builder + API** ✅ **DONE (API layer S160, builder UI S161)** | metadata/preview/run/download routes + stateless confirm-token (S160; twice Codex-converged), the forced-fan-out builder UI `pages/dataverse-bulk-export.js` (S161), confirm gate, SSE run + PRIVATE-Blob/gated-download, appRegistry entry + Dataverse access + `docs/API_ROUTE_SECURITY_MATRIX.md` (80→84, CI-gated, S160). Track B is now user-reachable end-to-end. | None v1-core (met — spine + API + UI built/tested). |
| **3 — Guided preset library** *(deferred, not v1-core)* | Canonical trusted slice per program family (collapses the 139-view/121-shape surface). | The 121-view recognition working-session (per-program, with user/Connor/Sarah). Gates only this layer — the expert builder is fully usable without it (operator-supplied filters are the dominant trusted pattern). |
| **Later — AI on-ramp** | NL → proposed `QuerySpec` rendered back into the builder for confirmation. | Phase 2+; the compiler/confirm seam is built in v1 so this is additive, never a rewrite. |
| **Deferred** | Async/background-job export; bulk DOCX→text decline-rationale extraction (v1 surfaces a link); Track A entirely. | Evidence/scope triggers, not v1. |

---

## 11. Testing & gates

- **Probes are the fixtures.** The committed `scripts/probe-akoya-*.js` + dated evidence are the ground-truth oracle for compiler/engine unit tests (era classifier, decided-state map, program roll-up Option-B math, operational exclusion, test-record predicate, decline trifurcation incl. SoCal third field + program-unattributed bucket, the column contract). Living-taxonomy: counts are dated evidence — re-run a probe only with a *new* structural hypothesis.
- **`npm run check:api-routes`** — add the 3 routes to `docs/API_ROUTE_SECURITY_MATRIX.md` in the implementation PR (80→83); the gate fails on `pages/api/**` without it.
- **`npm run check:atlas` / `:atlas:self-test`** — read-only over already-documented entities (`akoya_request`, `akoya_program`, `account`, `contact`); no new Postgres tables. Confirm green before/after; no Atlas page additions expected (verify, don't assume).
- **Headless spine test (Phase 1 exit):** a fixture `QuerySpec` → compiled FetchXML snapshot + aggregate-count call + Excel byte-shape, with backoff simulated (injected 429s) — proves "the big query succeeds" before any UI.
- **Disclosure golden test:** a known mixed-era, mixed-program, declined-with-nulls result → assert every sentinel, the composition line, the program roll-up in/out line, the `resolved_institution`/`institution_resolution` columns, and zero bare blanks.
- **QuerySpec validation suite:** every §2.1 reject path (unknown axis, illegal op, `createdon`-as-date, missing `amount.which`, unknown version) → 422 + correct violation code. **An unknown *filter* taxonomy literal is NOT a reject and NOT `UNCLASSIFIED`** — it compiles literally and the preview surfaces a "not in current taxonomy / 0-match" warning (§2.1 point 4). The `UNCLASSIFIED` per-row sentinel is exercised **only** by the post-query disclosure golden test (a returned row whose value is absent from the annotation map) — never by the validation suite. (These are the two distinct mechanisms §2.1 de-conflates; the tests must not re-merge them.)
- **API auth tests:** each of the 3 routes returns 401/403 without `requireAppAccess('dataverse-bulk-export')`; CSRF/origin rejection; `/run` rejects a body whose `resultToken` was never previewed (server-side confirm-gate enforcement).
- **SSE + Blob-delivery test:** `/run` progress-event shape; success ⇒ a private Blob object exists + terminal `{ready, downloadUrl}` resolves to the `/api/dataverse-export/download?t=<token>` proxy; terminal `error` ⇒ **no** Blob written and no `downloadUrl` (failure can never present as a short-but-complete file); `truncated` ⇒ Blob written + labelled + `ready`; `/download` token TTL expiry behaves (returns auth-failure not a stale stream).
- **Truncation/budget tests:** injected slow pages → `truncatedByBudget` at 240 s with rows-so-far + UX; >`hardCapRows` → `capped`; oversized → loud fail, not a short file.
- **UI confirm-gate test:** `/run` cannot be invoked from the builder without a rendered `/preview` (composition line + true total + warnings shown) first.

---

## 12. Decisions resolved this revision (were Codex-flagged false-deferrals)

The prior draft parked four items as "open" that were either already resolved by the design doc or are v1-core must-decides. All resolved here — none remain open for v1:

1. **Excel delivery — RESOLVED (one model, no contradiction):** `POST /run` is an SSE stream that pages+builds in one invocation, writes the `.xlsx` to a **PRIVATE Vercel Blob store** (`dvx-export-private`), and emits a terminal `{ready, downloadUrl}` pointing at the authenticated `/api/dataverse-export/download?t=<token>` proxy (§5). Rejected alternatives explicitly enumerated there: base64-over-SSE, streamed-`Content-Disposition`-POST-body, separate-progress-endpoint/second-GET, public-Blob-URL-direct-fetch. Serverless-correct; no new infra beyond the dedicated private store.
2. **Sync budget / page size — RESOLVED (§3a/§8):** 240 s budget, 1,000/page, 50k row cap, 200 MB/250k in-memory abort, 40 MB XLSX. A Phase-1 timing run may *raise* page size; the defaults are committed regardless.
3. **`wmkf_grantprogram` filter — RESOLVED:** model (b) is settled (design doc) — v1 offers **both** `akoya_programid` (default ∧ `wmkf_type=Program`) and `wmkf_grantprogram` as separate labeled filters (§6). It is a filter control, not deferrable work; framing it as open was a scope regression.
4. **Institution clustering — RESOLVED:** v1 **bakes in** `resolved_institution` + the `institution_resolution` fail-loud annotation (§3c) — a design hard requirement (it is precisely what Excel cannot recover), not a "leave it to Excel" option. A learned heuristic is a Phase-2 enhancement; the deterministic key + fail-loud annotation is v1.

**Genuinely deferred (non-v1-core, by design — not open questions):** the 121-view preset library (Phase 3, gated on the recognition session), the AI on-ramp (Phase 2+), async/background-job export, bulk DOCX→text decline-rationale extraction, Track A. A Phase-1 measured timing run is the only empirical input outstanding and it can only *loosen* a committed default, never block the build.

---

## 13. Out-of-scope reminders (carried from the design doc)

- **Not a generic builder, not fixed templates.** A plain-English structured filter builder + mandatory disclosure; refine-in-Excel. AI is a Phase-2 on-ramp, not the core.
- **Threat model:** optimize against the *plausible* wrong answer that passes the sniff test; provenance = a reproducible methods section, not defensive armor. Users are accountable PhDs/lawyers/MBAs.
- **"Ever" is rhetorical.** Deep-history is a Track A / Explorer find-one pattern; it must not contaminate Track B's semantic layer.
- **Status & semantic determinations are owned by `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`** ("Residuals — AUTHORITATIVE LIST"). This plan references; it does not re-derive. Any drift → reconcile there first (the reconcile-don't-append discipline).
- **Provenance discipline:** probe-substantiated vs user-attested is tracked per-determination in the design doc; the methods sheet must carry that tagging through to the artifact (never present user-attested semantics as probe-proven).
