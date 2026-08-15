---
title: Workbench Observability and Read-Coalescing Staged Plan
domain: architecture
kind: plan
status: draft
summary: "Staged plan: instrument the Workbench data path, then coalesce in-request duplicate Dataverse reads. Full Data Plane deferred until measured."
canonical: false
cataloged: 2026-08-14
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md
  - docs/audits/fable-performance-refactor-evidence-2026-08-14.md
  - docs/audits/fable-security-audit-2026-08-14.md
  - docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md
  - docs/audits/claude-workbench-observability-plan-response-2026-08-15.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Workbench Observability and Read-Coalescing Staged Plan

**Status: draft plan — NOT authorized for implementation.** Produced by the Fable audit
(`docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md`). Evidence: the three
`docs/audits/fable-*-2026-08-14.md` artifacts. Every stage leaves the build green and the old path
usable. No stage is started until the owner names it and authorizes implementation (brief Phase 8).

**Revision history:** revised 2026-08-14 after Opus adversarial review
(`docs/audits/fable-refactor-plan-opus-review-2026-08-14.md`, disposition
`docs/audits/fable-refactor-plan-disposition-2026-08-14.md`); revised again **2026-08-15 after Codex
adversarial review** (`docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md`,
disposition `docs/audits/claude-workbench-observability-plan-response-2026-08-15.md`). All eight Codex
findings were independently re-verified against current source and confirmed; the corrections are
folded in below, and four further same-day Codex review passes are dispositioned in the same
response artifact (pass trail in the Contract-reconcile verdict section). Key changes: the false "Dynamics seam covers Graph" claim is replaced by a full
egress inventory; correlation is an independent pre-auth ALS, not a DAL-context field; the telemetry
event contract, sink, and failure semantics are now explicit; Stage 2's census is chunk-aware and
formula-based; T2 moved to completed history; T1 is uniformly closed.

## Why this and not the full Data Plane

The audit found **zero per-dependency timing instrumentation** in the staff path (grep-verified
negative, re-verified 2026-08-15: no middleware, no correlation header handling, one ALS in the repo
and it is the DAL restriction context). It also found a **source-certain** redundant-read pattern:
per reviewer-tab action, three sibling person-read pairs run the same `wmkf_potentialreviewers`
id-filtered query twice with disjoint `$select` (see Stage 2 for the exact chunk-aware census; the
earlier fixed "×6 across 3 routes" phrasing was not a valid count). And it found that the broad
post-mutation refreshes are **deliberate fixes for prior correctness bugs** (S213, S400/S401).

Conclusion: measure first, then remove certain-avoidable work behind stable seams, and only expand
toward the Data Plane's authoritative-response/selective-invalidation parts once Stage 1 metrics show
they pay. The two security findings the audit raised are both closed: T1 accepted by design (owner,
2026-08-15) and T2 fixed and shipped in Session 428 — see the closed-findings sections below.

## Release-tier and posture

All stages touch Dataverse-read paths → **Tier 2** under
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (branch/worktree isolation, characterization
tests first, preview rehearsal, recorded last-known-good + rollback, explicit owner merge decision).
Campaign window is **[NEEDS OWNER]** — assume the restrictive posture.

## External-egress inventory (verified 2026-08-15)

There is **no single shared transport**. Two scopes must not be conflated (third-pass correction):
**instrumentation/emission scope** — which seams get wrapped, and therefore which callers emit
events (ALL callers of a wrapped seam emit, Workbench or not) — versus **target measurement
scope** — the three named Workbench routes whose events (selected by `routeName`) feed the
measurement window. The runtime seams to Dataverse / Azure AD / Graph are:

| Seam | What it carries | Stage 1 wrapped? | Who emits once wrapped |
|---|---|---|---|
| `lib/services/dynamics/http.js:24` (`fetchWithTimeout`) | All `DynamicsService` traffic: token (`dynamics/auth.js:65`), reads (`dynamics/read-ops.js`), writes (`dynamics/write-core.js`), schema (`dynamics/schema.js`) | **Wrapped** | Every `DynamicsService` caller app-wide (routes, crons, cold-start checks) |
| `lib/services/graph-service.js:1154` (module-local `fetchWithTimeout`; **no import from dynamics/http.js** — its only import is `service-error.js`) | All Graph/SharePoint traffic incl. Azure AD token acquisition (`graph-service.js:101-135`), ~20 call sites | **Wrapped** | Every Graph caller app-wide |
| `lib/dataverse/client.js:50` (token) and `:106` (data) — raw `fetch`, no timeout helper | Second Dataverse egress. Runtime consumers: `dataverse-app-access-service.js` (the `requireAppAccess` hot path), `dataverse-settings-service.js`, `grant-cycles-dataverse.js`, `dataverse-identity-map.js` | **Wrapped** | Every `client.js` caller — **including operational scripts that require it** (2026-08-15 grep: 58 files under `scripts/` reference the module, 2 of them archived under `scripts/archive/`; a further subset uses only `loadEnvLocal`, which performs no HTTP call and emits nothing — only script invocations that reach `getAccessToken`/`createClient` emit); script-emitted events carry no correlation fields and go to the invoking terminal's stdout, not the platform log stream |
| `lib/services/dataverse-export/fetch-client.js:61` (fourth local `fetchWithTimeout` copy) and `lib/services/dataverse-export/live-taxonomy.js:38,64` (raw fetches) | Export tooling | **Not wrapped** | No emission — named so the inventory is complete |
| `lib/utils/health-checker.js:70,94,123` | Azure AD/token health probes | **Not wrapped** | No emission — named for completeness |

Only events whose `routeName` is one of the three target routes enter the measurement analysis;
everything else in the stream is emission-scope by-product, present but unselected. Any claim that
instrumenting one of these seams covers another is false and must not reappear.

---

## Stage 1 — Observability seam (measurement foundation)

1. **Objective / invariant:** add external-dependency (Dataverse + Azure AD + Graph/SharePoint)
   timing with one correlation id per HTTP request across the Workbench data path, changing **no**
   user-visible behavior. (Scope per Opus P2-7: external legs only; Postgres and client-render timing
   are later measurement, not gated by this stage.)
2. **Correlation context (corrected per Codex P1-2):** new `lib/observability/request-correlation.js`
   owning its **own dedicated `AsyncLocalStorage` instance** — fully independent of the DAL
   restriction ALS in `lib/services/dynamics-context.js`. API: `withRequestCorrelation({correlationId,
   routeName}, fn)` and `getRequestCorrelation()` (returns the store or `undefined`). It is
   established at the **first line of each target HTTP handler, before `requireAppAccess`** — this is
   mandatory because an uncached app-access lookup performs a Dataverse call inside
   `requireAppAccess` itself (`lib/utils/auth.js:321-341`, cache miss on cold instance or after the
   2-minute TTL, via `dataverse-app-access-service.js` → `lib/dataverse/client.js`). Because the two
   ALS instances are separate, entering/leaving nested or sequential `withDalContext` scopes cannot
   replace or erase the correlation store. The DAL store (`{restrictions, requestId}`, where
   `requestId` is the scope label — `dynamics-context.js:55-58`) is **not modified**; do not add
   fields to it and do not claim `withDalContext` carries correlation.
3. **Exact files:**
   - `lib/observability/request-correlation.js` (new — ALS + emit helper).
   - Wrap the three egress seams marked in scope in the inventory above:
     `lib/services/dynamics/http.js` (`fetchWithTimeout`), `lib/services/graph-service.js`
     (module-local `fetchWithTimeout`), `lib/dataverse/client.js` (both the token fetch at `:50` and
     the data fetch inside `createClient`, `:106`).
   - **Browser-import safety for `lib/dataverse/client.js` (2026-08-15 follow-up review):** the
     module is deliberately browser-import-safe — its header contract (`client.js:11-29`) defers
     `fs`/`path` behind variable-path requires because the module is reachable from a browser
     bundle via the settings-service dispatch chain, and its one static require
     (`core/interlock.js`) is bundler-safe by that module's own contract. The observability
     integration must not break this: **no top-level require of the observability module in
     `client.js`.** Integrate lazily inside the server-only call bodies (`getAccessToken` /
     `createClient`'s `call`), using the same deferred-require pattern the file already uses, and
     `lib/observability/request-correlation.js` must itself be browser-import-safe (its
     `node:async_hooks` dependency loaded lazily/guarded, never at module top level in a path a
     bundler statically traces). The production build gate below is the enforcement check.
   - Establish correlation at handler entry in the three target routes:
     `pages/api/review-manager/reviewers.js` (handler entry, before `requireAppAccess` at `:43`),
     `pages/api/reviewer-finder/my-candidates.js` (before `:47`),
     `pages/api/workbench/decline-referrals.js` (before `:32`).
     There is no existing shared route wrapper (verified — the routes hand-roll
     `requireAppAccess` → `withDalContext` inline); wrapping these three handlers directly is the
     Stage 1 scope. If a common wrapper is preferred, it is a separately reviewed change, not an
     implementer improvisation.
   - **Non-HTTP callers** (cron, cold-start `instrumentation.js`, scripts): `getRequestCorrelation()`
     returns `undefined` and events are emitted **without** `correlationId`/`routeName`. That is the
     defined behavior, not an error.
4. **Telemetry event contract (v1, provider-neutral, PII-safe):** one JSON object per dependency
   call:
   `{event: 'workbench.dependency', v: 1, eventId, correlationId?, routeName?,
   dependency: 'dataverse' | 'azuread' | 'graph' | 'unknown', resourceClass, operation, ms,
   outcome: 'success' | 'http_error' | 'timeout' | 'network_error',
   statusClass?: '2xx' | '3xx' | '4xx' | '5xx'}`.
   - `eventId` (fourth-pass addition) is a **fresh `crypto.randomUUID()` minted once per emitted
     event** — PII-free by construction, carrying no user, request, or resource identity. It exists
     solely so downstream export slices can deduplicate soundly: `correlationId` identifies a whole
     HTTP request and Vercel's `requestId` likewise spans every log line of a request, so neither —
     with or without a timestamp — can distinguish two dependency calls that complete in the same
     timestamp resolution, and full-line `sort -u` would collapse two legitimate identical calls.
     **Deduplication happens ONLY on parsed `eventId`; `requestId`+timestamp and full-line
     `sort -u` are prohibited as uniqueness keys.** Planned unit test: every emitted event has an
     `eventId`, and two events emitted by the same wrapped call site in one request carry
     different values.
   - `operation` (fifth-pass correction of the fourth-pass definition): derived as
     `String(options?.method || 'GET').toUpperCase()` matched against the fixed allowlist
     `{'GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'}`. An **omitted** method is `GET` by
     fetch semantics — and the real Dynamics/Graph read paths do omit it
     (`lib/services/dynamics/read-ops.js:82,129,179,237` pass only `{headers}`), so mapping
     missing → `'unknown'` would have mislabeled every Dynamics read; only an **invalid supplied**
     value maps to `'unknown'` (fail-closed). It is never a URL, path, query fragment, entity id,
     filename, or any caller-provided arbitrary string — the allowlist is the entire value space.
     The redaction/contract tests assert `operation` ∈ allowlist ∪ `{'unknown'}` for every emitted
     event, and include the real omitted-method Dynamics/Graph read shape (must emit `'GET'`) plus
     a seeded weird-method case (must emit `'unknown'`).
   - `event` is a **literal discriminator field inside the JSON object** (not just a prose name), so
     log filtering needs no message-shape heuristics. The event's timestamp is the platform log
     record's own timestamp (present in `vercel logs --json` output); the event body carries none.
   - `dependency` is derived from a **host-aware allowlisted classifier** (`login.microsoftonline.com`
     → `azuread`, `graph.microsoft.com` → `graph`, the configured Dynamics host → `dataverse`);
     unknown hosts → `dependency: 'unknown'` — a first-class variant of the union, not an error.
   - `resourceClass` (fifth-pass full specification) is a **fixed, closed value set** with an
     allowlisted URL-pattern classifier; anything unmatched fails closed to `'unknown'` — never a
     raw path fallback. The exact v1 value set and derivation:
     - **`dependency: 'azuread'`** → always `resourceClass: 'token'` (the URL is the
       `login.microsoftonline.com` token endpoint; no other class exists on this dependency).
     - **`dependency: 'dataverse'`** → take the first path segment after `/api/data/v9.2/`, strip
       any parenthesized key (`akoya_requests(9f8…)` → `akoya_requests`), and match **exactly**
       against the tracked entity-set allowlist:
       `{'wmkf_potentialreviewerses', 'wmkf_appreviewersuggestions', 'akoya_requests',
       'wmkf_appuserappaccesses', 'systemusers', 'wmkf_appsettingses'}` — the sets the target
       routes and the app-access/token legs actually read; the emitted value is the matched
       entity-set literal (a schema name, not data). `$batch`, `EntityDefinitions…`, and any
       unmatched segment → `'unknown'`. Extending the allowlist is a reviewed commit. **The exact
       plural entity-set spellings above are `[ASSUMED]` until the implementer confirms them from
       the adapters' request URLs — the classifier test fixtures must use the confirmed real
       URLs.**
     - **`dependency: 'graph'`** → coarse path class from the fixed set
       `{'token', 'site', 'drive', 'drive-item', 'search'}` (token endpoint → `'token'`;
       `/sites…` → `'site'`; `/drives…` root/children listing → `'drive'`; item-addressed
       content/metadata/versions/upload/delete → `'drive-item'`; `/search/query` → `'search'`);
       anything else → `'unknown'`.
     - **Total v1 value set** (the `$RESOURCE_CLASSES` list the export validation checks):
       the six Dataverse entity-set literals ∪ `{'token','site','drive','drive-item','search',
       'unknown'}`.
     - **Tests:** representative-URL fixtures for every class above **plus** hostile fixtures — a
       Dataverse read with a `$filter` embedding an email, a GUID-keyed single-record URL, a Graph
       item URL with an encoded filename, a signed/CDN-style download URL, and an unknown host —
       asserting the emitted event contains the expected class and that **no query string, id,
       filename, or path material appears in any field** of the event.
     - **Stage 2 derivability:** the Stage 2 acceptance count is mechanically
       `count(events where dependency == 'dataverse' and resourceClass == '<the confirmed
       wmkf_potentialreviewers entity set>' and routeName ∈ the three target routes)` — no log
       spelunking or URL inspection needed.
   - **Never emitted:** raw URLs, query strings (`$filter` embeds names/emails), arbitrary path
     segments, tenant identifiers, drive/item ids, filenames, signed-URL material, tokens, headers,
     request/response bodies. A redaction unit test asserts the emitted object contains none of a
     seeded set of sensitive markers.
5. **Failure semantics (explicit, per Codex P2-1; error-transformation preservation per the
   2026-08-15 follow-up review):** timing is recorded in `finally` (or equivalent) so **successes,
   non-2xx responses, timeouts, and thrown network errors are all timed**, with
   `outcome`/`statusClass` set accordingly. The wrapper returns the **original `Response` object**
   and rethrows **exactly the error the seam throws today — telemetry adds no additional wrapping
   layer**. Two of the seams already transform raw fetch throws deliberately, and that existing
   behavior is preserved unchanged: `dynamics/http.js:41-50` wraps no-response throws via
   `buildNoResponseError('dataverse', err)` so the drain's retry classifier sees structured
   `err.noResponse`/`err.isTransient`/`err.causeKind`, and `graph-service.js` does the same with
   provider tag `'graph'`. "Original error" means **that** structured error — same identity, same
   shape; the telemetry wrapper must neither re-wrap it, suppress it, nor substitute its own error
   type. `outcome` for thrown errors is **derived by inspecting** the existing structured error,
   never by replacing it, with this exact mapping (2026-08-15 third-pass correction): both helpers
   implement their timeout via `AbortController.abort()`, which `buildNoResponseError` records as
   `causeKind: 'abort'` (`lib/utils/service-error.js:88`; `'timeout'` there is reserved for
   `ETIMEDOUT`/undici header/body-timeout codes, `:89`) — and since the helpers overwrite any
   caller-provided signal (`http.js:25-30`), a helper-seen abort **is** the helper's own timeout.
   Therefore `causeKind ∈ {'abort', 'timeout'}` → `outcome: 'timeout'`; all other `causeKind`
   values (`'socket'`, `'dns'`, `'unknown'`) → `outcome: 'network_error'`. `service-error.js` is
   **not changed**; the exact existing structured error object and its public semantics are
   preserved — telemetry only reads it.
   The **timed span covers the fetch leg only**: in `dynamics/http.js` the
   `assertDataverseOperationAllowed` interlock call deliberately sits before the try block so policy
   denials propagate un-reclassified (`http.js:32-38`) — instrumentation goes inside/around the
   try, after the interlock assert, so a policy denial is neither timed as a dependency failure nor
   re-wrapped. In `lib/dataverse/client.js` (raw `fetch`, no existing transformation) errors
   propagate as thrown, unwrapped. **Only telemetry-emission failures are swallowed** (try/catch
   around the emit alone); dependency failures always propagate unchanged.
6. **Sink (chosen, per Codex P2-2): structured platform logs (Vercel).** The emitter calls exactly
   **`console.log(JSON.stringify(event))`** — never `console.log(event)`, whose inspect-format
   output (`{ event: 'workbench.dependency', … }`, unquoted keys) is not parseable JSON (verified
   locally with a Node check, 2026-08-15) — wrapped in the try/catch guard so a telemetry failure
   (including a `JSON.stringify` throw) cannot fail the request. **Planned unit test:** capture the
   emitted `console.log` argument, assert `JSON.parse` succeeds on it and that the parsed object
   contains the literal discriminator `event: 'workbench.dependency'`. The **filter of record** in
   the export workflow below is local JSON parsing of each log record's message (`fromjson?` +
   `event == "workbench.dependency"`); the server-side `--query` is only a coarse full-text
   volume-reduction hint (fourth-pass correction — exact-substring `--query` semantics were never
   verified). No new
   table, no durable write — consistent with this stage's stop condition. The existing
   `api_usage_log` is the **LLM token/cost ledger** (`docs/atlas/postgres-infra-tables.md:147-149`)
   and is **not** repurposed or imitated.
   - **Sampling scope (resolved per the 2026-08-15 follow-up review):** the three wrapped seams are
     **shared app-wide transports**, not Workbench-private — every server-side caller of
     `DynamicsService`, Graph, and `lib/dataverse/client.js` (other routes, crons, cold-start
     checks) emits events once the seams are wrapped. Sampling is therefore **100% of ALL seam
     traffic** — a choice resting on the explicitly unverified volume/cost assumption below, **not**
     on "workbench traffic" alone and not on any measured fact. Events from un-instrumented
     callers simply carry no `correlationId`/`routeName` (the defined no-correlation behavior);
     the measurement window filters on `routeName` for its three target routes. The `event` name
     `workbench.dependency` names the initiative that introduced the stream, not a scope
     restriction. **Volume/cost assumption `[ASSUMED — explicitly unverified]` (third-pass
     correction):** whole-application dependency-call volume and its platform log cost have NOT
     been measured; no evidence currently supports "low volume" as a fact. Validation: within the
     first 48 hours after enabling 100% emission, count `workbench.dependency` lines per day via
     the log-export workflow below. **Stop/re-scope threshold:** if daily event volume exceeds
     ~50,000 lines/day, or platform log throttling/truncation is observed, or a visible log-cost
     line item appears, STOP — revert (pure additive change) or land a named sampling knob as a
     reviewed follow-up. Exceeding the threshold is a stop condition, not a silent implementer
     tuning choice.
   - **Query workflow (executable, historical, fail-closed):** `vercel logs` performs a
     **historical query by default**; live streaming requires `--follow` (which this workflow does
     not use — the previous live-tail framing was wrong). Flag existence was inspected on the CLI
     installed at review time (59.0.0, 2026-08-15 — a historical observation, not a version
     requirement; see the version-agnostic rule below). Each slice:

     ```bash
     # Preconditions (one-time): `vercel login`; repo linked to the production project via
     # `vercel link` (the linked project makes --project optional; the explicit variable
     # form below also works from an unlinked checkout).
     set -euo pipefail   # errors visible and fatal; no stderr suppression anywhere
     OUT_DIR=${OUT_DIR:-$(mktemp -d)}   # or a defined scratch path; created explicitly
     PROJECT='actual-project-name-or-id'   # from `vercel project ls`; if the repo is
                                           # linked, drop the --project flag entirely
     SINCE='2026-08-20T00:00:00Z'; UNTIL='2026-08-20T01:00:00Z'; LIMIT=5000
     RAW="$OUT_DIR/raw-${SINCE}--${UNTIL}.ndjson"
     SLICE="$OUT_DIR/workbench-dependency-${SINCE}--${UNTIL}.ndjson"

     # Step 1 — capture of record: genuinely UNFILTERED. No --query here: any server-side
     # filter would make the completeness check below meaningless (fifth-pass correction —
     # the previous "RAW" capture still passed --query and was therefore server-filtered).
     vercel logs --project "$PROJECT" --environment production \
       --since "$SINCE" --until "$UNTIL" \
       --json --limit "$LIMIT" > "$RAW"

     # Step 2 — fail-closed completeness check on the truly unfiltered output, BEFORE any
     # filtering. If unfiltered volume cannot fit bounded slices even at short windows,
     # STOP: the Log Drain / dashboard-export fallback is REQUIRED — do not shrink
     # confidence by filtering server-side.
     RAW_LINES=$(wc -l < "$RAW")
     if [ "$RAW_LINES" -ge "$LIMIT" ]; then
       echo "TRUNCATED unfiltered slice ($RAW_LINES >= $LIMIT): narrow --since/--until;" >&2
       echo "if no bounded window fits, use the Log Drain / dashboard-export fallback" >&2
       exit 1
     fi

     # Step 3 — filter of record: local parse + FULL v1 contract validation. Ordinary
     # non-telemetry lines are skipped; any line CONTAINING the discriminator that fails
     # to parse or fails validation ABORTS the slice (fromjson? alone silently drops
     # malformed JSON — that is why unparseable candidates are turned into errors).
     # The atomic tmp+mv publish means a failed run leaves no usable partial slice.
     jq -c '
       def uuid: test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
       select((.message // "") | contains("\"event\":\"workbench.dependency\""))
       | ((.message | fromjson?) // error("candidate telemetry line did not parse — fail slice")) as $ev
       | if ($ev.event == "workbench.dependency")
           and ($ev.v == 1)
           and (($ev.eventId | type) == "string" and ($ev.eventId | length) > 0 and ($ev.eventId | uuid))
           and ($ev.dependency  | IN("dataverse","azuread","graph","unknown"))
           and ($ev.outcome     | IN("success","http_error","timeout","network_error"))
           and ($ev.operation   | IN("GET","POST","PATCH","PUT","DELETE","HEAD","OPTIONS","unknown"))
           and ($ev.resourceClass | IN($ARGS.named.classes | split(",")[]))
           and (($ev.ms | type) == "number" and ($ev.ms | isnan | not) and ($ev.ms | isinfinite | not) and $ev.ms >= 0)
           and (($ev.statusClass == null) or ($ev.statusClass | IN("2xx","3xx","4xx","5xx")))
           and (if $ev.outcome == "http_error" then ($ev.statusClass != null) else true end)
           and (($ev.correlationId == null) or (($ev.correlationId | type) == "string"))
           and (($ev.routeName == null) or (($ev.routeName | type) == "string"))
         then {record: ., ev: $ev}
         else error("workbench.dependency event failed v1 contract validation — fail slice")
         end
     ' --arg classes "$RESOURCE_CLASSES" < "$RAW" > "$SLICE.tmp"
     mv "$SLICE.tmp" "$SLICE"   # atomic publish

     # Step 4 — cross-slice merge + sound dedup: exactly one payload per eventId.
     # Conflicting payloads sharing an eventId are a DATA ERROR (fail), never a choice.
     jq -cs '
       group_by(.ev.eventId)
       | map(if (map(.ev) | unique | length) > 1
             then error("conflicting payloads share eventId " + .[0].ev.eventId + " — fail merge")
             else .[0] end)
       | .[]
     ' "$OUT_DIR"/workbench-dependency-*.ndjson > "$OUT_DIR/merged.ndjson.tmp"
     mv "$OUT_DIR/merged.ndjson.tmp" "$OUT_DIR/merged.ndjson"
     ```

     (`$RESOURCE_CLASSES` is the comma-joined fixed `resourceClass` value set from the envelope
     contract above, supplied by the operator; the jq argument-plumbing shape is part of the
     window-start preflight.) An optional query-assisted **triage** command
     (`vercel logs … --query 'workbench.dependency' …`) may be used to eyeball volume before
     capture, but it is **never** the capture of record and proves nothing about completeness.

     - **Time bounds:** explicit `--since`/`--until` per slice (ISO timestamps), stamped into the
       filename; per-event timestamps come from the platform log record in the `--json` output
       (the event body deliberately carries no timestamp field).
     - **What is verified vs. what must be preflighted:** `vercel logs --help` on the installed
       CLI proves the flags **exist** — it does NOT prove `--query`'s matching semantics or the exact
       `--json` record field names (`.message` etc.). At window start, **preflight against a known
       emitted event**: emit one test event, capture it with this workflow, and confirm the coarse
       query returns it and the `jq` filter isolates it, before trusting any measurement slice.
       `--limit` stays explicit (CLI default is 100 — far too low to rely on implicitly).
     - **Truncation/completeness:** checked on the RAW unfiltered line count, before local
       filtering (a post-filter count says nothing about what the server dropped). At-limit ⇒
       exit 1 ⇒ re-slice narrower. **If slices cannot be proven complete within the plan's
       retention and result limits, or the `--json` record shape cannot be confirmed in
       preflight, the REQUIRED fallback is a Log Drain or the dashboard log export — incomplete
       CLI output is not valid measurement evidence.**
     - **Deduplication:** across overlapping slices, deduplicate **only on the parsed event's
       `eventId`** (unique per emitted event by construction — see the envelope contract).
       `requestId`+timestamp and full-line `sort -u` are prohibited: a request's `requestId` spans
       all its log lines, two dependency calls can share a timestamp resolution, and identical
       legitimate calls must both count. A verified-unique platform log-record id is an acceptable
       alternative key **only if** its presence and uniqueness in the actual CLI JSON output are
       explicitly confirmed in the window-start preflight, failing closed when absent.
     - **Version contract (version-agnostic — fifth-pass correction):** the CLI installation is
       not under this plan's control and must not be treated as pinned, and CLI version churn is
       not this plan's housekeeping. The rule: **at measurement-window start, record the installed
       `vercel --version`, inspect the current `vercel logs --help`, and validate the full
       command and `--json` record shape against a known emitted event before relying on any
       slice.** Historical note: flag existence was inspected on CLI 59.0.0 during the
       third/fourth review passes — that is evidence about that inspection, not a current version
       requirement or an upgrade recommendation.
   - **Retention:** platform log retention on the current Vercel plan must be **verified at window
     start**. Historical queries can only reach records still within retention, so slices must be
     captured on a cadence shorter than the retention period; if retention proves too short for
     that cadence to be practical, the Log Drain / dashboard-export fallback becomes required.
     `[NEEDS OWNER — plan-tier retention confirmation]`
   - **Failure isolation:** emission is the try/catch-guarded `console.log` above; it cannot fail the
     request. If a durable sink is ever chosen later, that is a re-scope requiring migration, Atlas,
     retention, and privacy contracts — not an implementer option in this stage.
7. **Preconditions / characterization:** a test asserting current responses are byte-identical before
   and after (timing is additive, non-functional).
8. **Trace:** handler entry mints `{correlationId, routeName}` in the observability ALS →
   `requireAppAccess` (its cache-miss Dataverse call is inside the correlation scope) → route
   `withDalContext` scope → services/adapters → the three wrapped seams read the correlation store at
   emit time → platform log line. No authz change; no durable write.
9. **Non-goals / denylist:** no caching, no dedup, no response-shape change, no new Dataverse entity,
   no client change, no edits to `lib/services/dynamics-context.js` or
   `lib/dataverse/core/context.js`. Denylist: `shared/components/**`, all mutation services.
10. **Work order size:** one focused order (~1 new file + 3 wrapped seams + 3 route-entry lines +
    tests).
11. **Tests:** unit — wrapper emits on success, non-2xx, timeout, and thrown network error; original
    `Response`/error identity preserved when telemetry works **and when the emit itself throws**;
    redaction test (no sensitive markers). Correlation — two concurrent requests do not leak ids
    across each other; a nested `withDalContext` scope preserves the outer correlation; the uncached
    `requireAppAccess` lookup sees the same correlation id as the post-auth service reads; a non-HTTP
    caller emits a well-formed event with no correlation fields. Integration — byte-identical
    response through one multi-adapter route.
12. **Gates:** `check:dataverse-access-layer` + self-test (touching the transport), `check:types`,
    `check:api-routes` + self-test (route files change), and **`npm run build`** (production Next
    build — proves the browser-import-safety contract above survives bundling) — run serially.
13. **Performance acceptance:** wrapper overhead is negligible relative to a network call (assert no
    added awaits on the hot path beyond the original fetch); the *output* is the metric stream.
14. **Security acceptance:** events carry no PII/token/secret (redaction test); the sink is the
    existing platform log stream, not a new sensitive-content store; the correlation id is random
    (`crypto.randomUUID()`), carries no user identity, and is never write authority.
15. **Release:** Tier 2; last-known-good = pre-stage deployment; rollback = revert (pure additive).
16. **Docs:** update `docs/SECURITY_OPERATING_PLAN.md` observability section;
    `docs/SERVICE_AND_UTILITY_CATALOG.md` entry for the new module.
17. **Stop conditions / owner:** if adding the seam requires touching authz or a durable write, stop
    and re-scope.

### Stage 1 measurement window (executable decision rule, per Codex P2-3)

- **Environment:** production (the only environment with real staff usage patterns).
- **Target routes:** `/api/review-manager/reviewers`, `/api/reviewer-finder/my-candidates`,
  `/api/workbench/decline-referrals`.
- **Minimum sample:** ≥ 20 requests per route (workbench usage cadence is low — see
  `.claude-memory/project-reviewer-find-usage-cadence-blocks-observation-windows.md`; if 20 is not
  reached in 2 calendar weeks, report the shortfall rather than extrapolating).
- **Aggregation:** per route × dependency × resourceClass: request count, dependency-call count per
  request, p50 and p95 of `ms`, outcome counts.
- **What the window decides:** the **Deferred section** (Data Plane invalidation work) remains
  latency-gated on this data. **Stage 2 is NOT latency-gated:** its duplicate reads are
  source-certain (verified again 2026-08-15), so Stage 2 proceeds on owner authorization regardless
  of measured latency; the window supplies the **before/after verification baseline** for Stage 2's
  acceptance (dependency-call counts per route), not its justification.
- **Route-level honesty:** the three routes are three separate HTTP requests; a per-request
  correlation id cannot by itself prove they came from one client tab action. Route-level
  measurement is sufficient for this plan's decisions and is what is claimed. No action-level id is
  added in Stage 1.

## Stage 2 — Merge the disjoint-`$select` sibling reads

**Why the original request-scoped-cache design was dropped (Opus P1-1, unchanged):** the
duplicate-read contributors are separate HTTP requests with separate `withDalContext` scopes, and
each sibling pair runs concurrently in `Promise.all` with **disjoint `$select`**, so any
request-scoped or select-keyed cache dedupes zero of them. The real fix is a local query merge; it
needs no cache, no `withDalContext` edit, no flag.

**Census (corrected per Codex P1-3, verified against source 2026-08-15).** Three mergeable sibling
pairs exist across **two** services, plus one unmergeable single read in a third:

| Site | Reads today | Id set | Mergeable? |
|---|---|---|---|
| `lib/services/review-manager/reviewers-service.js:225-228` (pair defined at `:498-512`, `:542-555`) | `fetchPotentialReviewers` + `fetchResearchersByPerson`, same id OR-chain, disjoint `$select` | suggestion reviewer ids | **Yes — pair 1** |
| `lib/services/reviewer-finder/my-candidates-service.js:166-180` (definitions `:381-395`, `:418-432`) | same pair | **active**-candidate ids | **Yes — pair 2** |
| `lib/services/reviewer-finder/my-candidates-service.js:437-443` (`projectRemovedCandidates`) | same pair, invoked again | **removed**-candidate ids (distinct set, single-request mode only) | **Yes — pair 3 (separate merge; do NOT union with active ids)** |
| `lib/services/workbench/decline-referrals-service.js:123` (helper `:42-57`) | **one** person read (`fetchReviewerPeople`) | referral person ids | **No — nothing to merge; explicitly unchanged** |

The previously named `lib/services/reviewer-finder/decline-referrals-service.js` **does not exist**;
the decline service lives under `lib/services/workbench/`. Any fixed count ("6→3", "1/1/1 across
three routes") is invalid: the fetch helpers chunk id filters at 25 ids per query:
six `const CHUNK = 25` sites (`reviewers-service.js:502,545`, `my-candidates-service.js:384,400,421`,
`decline-referrals-service.js:45`), five of them person-read helpers — `my-candidates-service.js:400`
is `fetchApplicantAkas`, a different entity, outside every pair — and every helper short-circuits
empty id sets to zero queries.

**Chunk-aware acceptance contract.** With `q(n) = ceil(n / 25)` and empty sets contributing zero:

```text
before = 2·q(reviewers) + 2·q(active) + 2·q(removed) + q(decline)
after  =   q(reviewers) +   q(active) +   q(removed) + q(decline)
```

(All sets nonempty and within one chunk → 7→4. The merge halves the pair queries; the decline read
is unchanged.)

1. **Objective / invariant:** in each of the three pair sites, replace the concurrent
   `fetchPotentialReviewers` + `fetchResearchersByPerson` pair (same entity, same OR-chain id
   filter, disjoint `$select`) with **one superset-`$select` read of `wmkf_potentialreviewers`**,
   projecting the same fields the two projections produce today, with **identical response data**.
   Chunking at 25 ids and the empty-set short-circuit are preserved at the service-helper layer
   (that is where they live — not in the adapter).
2. **Preconditions:** Stage 1 events exist (before/after call counts are observable per route); a
   characterization test capturing the exact current response of `getReviewers`, `getMyCandidates`,
   and the decline-referrals listing for one fixture request.
3. **Exact files:** `lib/services/review-manager/reviewers-service.js` (merge pair 1),
   `lib/services/reviewer-finder/my-candidates-service.js` (merge pair 2 and, separately, pair 3 —
   the removed-candidate id set stays a distinct query set),
   `lib/services/workbench/decline-referrals-service.js` (**unchanged** — listed only to record the
   explicit non-goal). **No** new helper, **no** `context.js` change.
4. **Trace:** caller → service → single merged chunked read per id set → existing projection. No
   authz change; reads only.
5. **Contracts:** the merged `$select` is the union of the two prior selects, so every field the
   current projections read is present. **Partial-failure guard (Opus P4d):**
   `my-candidates-service.js:176-179` deliberately catches `aggregateReviewHistory` failures so
   history loss doesn't fail the list — that is a *different* read and must stay a separate
   fail-soft call; do NOT fold it into the merged fail-hard person read. `fetchApplicantAkas` is a
   different entity and stays separate.
6. **Non-goals / denylist:** no cross-request cache, no ALS memo, no client cache, no invalidation,
   no mutation-path change, no change to the deliberate broad post-mutation `refreshAll` (S213
   correctness invariant), no decline-referrals change. Denylist: all mutation services,
   `shared/components/**`, `lib/dataverse/core/context.js`.
7. **Work order size:** one order per service (2 total), each a local read merge.
8. **Tests:** characterization test passes byte-identical; adapter call-count tests assert the
   formula (not a fixed number) across fixtures: active-only, removed-only, combined, empty sets,
   and a >25-id set (two chunks); a test proving the merged projection returns every field the two
   prior projections did.
9. **Gates:** `check:dataverse-access-layer` + self-test, `check:types`, reviewer test suites.
10. **Performance acceptance:** Stage-1 events show per-route `wmkf_potentialreviewers` query counts
    matching the `after` formula with responses unchanged. A response-equality assertion alone is
    NOT acceptance — the call-count tests above are required.
11. **Security acceptance:** no authority change; the merged read uses the same filter and the same
    DAL path, so restriction/interlock behavior is unchanged.
12. **Release:** Tier 2; rollback = plain revert (local change, no flag).
13. **Docs:** Atlas note if the read-path description changes.
14. **Stop conditions:** if the two projections turn out to read genuinely different row *sets* (not
    just different fields of the same rows), stop — the merge is unsound and they are not
    duplicates.

## Closed security findings (history — no prospective work)

### T1 — Reviewer merge authorization: CLOSED, accepted by design (owner, 2026-08-15)

The owner decided (2026-08-15) to keep the merge org-open: **there is no technical ownership of
requests or data in Dataverse**, so a request-scoped or PD-scoped merge fence has nothing to key on
and app-level access is the correct and only meaningful boundary. The data-only block predicate
(`reviewer-merge.js:242-265`) remains the safety mechanism. Characterization (retained for the
record): `merge-candidates.js:23` guards with `requireAppAccess('reviewer-finder','reviewers')`
only; no `requestId`; `actingUserSystemId` is write attribution; the merge also writes
`akoya_request` applicant slots (`reviewer-merge.js:472-481`). This is accepted risk, not an open
gap, and **not a stage of this plan**. See
`.claude-memory/project-merge-candidates-authorization-gap.md` (status: closed). Do not reopen
without a new owner decision.

### T2 — Cron reminder token eligibility: FIXED AND SHIPPED (Session 428) — history only

The formerly planned "Stage 4" repair **shipped in Session 428** and is verified in current source
(2026-08-15): both reminder sweep queries carry the null-safe eligibility filter
(`lib/services/reviewer-reminder-sweep.js:120,204` → `selectedAndNotRevokedFilter()` at
`lib/dataverse/adapters/reviewer-suggestion.js:108-110`, the two-branch
`eq false or eq null` form, never `ne true`); the cron marker+token is a single ETag-guarded
`mintAndStore` PATCH (`reviewer-reminder-sweep.js:283-343`, 412 → `claimFailed`, no send); and both
filters have regression coverage (`tests/unit/reviewer-reminder-sweep.test.js:134-143,439-448`).
There is **no prospective T2 work in this plan.** Residual follow-up (verifier-deselect hardening —
whether deselection alone should invalidate an existing link) is tracked in `SESSION_PROMPT.md` as
an owner decision, outside this plan.

## Deferred (evidence-gated, not scheduled)

Authoritative mutation responses (`patchReviewers` returning the confirmed record) and selective
invalidation are the Data Plane's remaining parts. They are deferred until the Stage 1 measurement
window shows the broad `refreshAll` is a measured cost worth the added invalidation complexity — and
any such change must preserve the S213/S400/S401 correctness invariants. Component decomposition
(ReviewerSearchSection) is deferred until a measured render cost justifies it.

## Contract-reconcile verdict

**Mode A, 2026-08-15, fifth pass (post-Codex fifth review, findings R1–R7 folded in): READY WITH
NAMED CHANGES.** The fifth pass verified: the capture of record is now genuinely unfiltered (no
`--query`; server filtering would void the completeness check; query-assisted capture survives
only as an optional triage command that proves nothing); the example is executable (a real
`PROJECT` variable contract or the linked-project variant, `set -euo pipefail`, visible stderr);
local filtering is genuinely fail-closed — discriminator-containing lines that fail `fromjson` or
the full v1 contract validation (event/v/eventId-UUID/allowlists/finite-nonnegative
`ms`/statusClass-outcome consistency/optional-field types) abort the slice, output publishes
atomically via tmp+`mv`, and an executable eventId merge step fails on conflicting payloads
sharing one id; `operation` derivation matches fetch semantics (omitted method ⇒ `GET` — the real
Dynamics read shape, `read-ops.js:82,129,179,237`; only invalid supplied values ⇒ `'unknown'`);
`resourceClass` has a fully specified closed value set and URL-pattern classifier (exact plural
entity-set spellings `[ASSUMED]` pending implementer confirmation from real request URLs), with
hostile-URL leak tests and the Stage 2 count mechanically derivable from
dependency+resourceClass+routeName; the CLI contract is version-agnostic (record version, inspect
help, preflight against a known emitted event at window start — no pinning claim, no upgrade
housekeeping); and the script inventory is described by caller class (58 grep matches, 2
archived; `loadEnvLocal`-only importers emit nothing) instead of a brittle single count. The
fourth-pass paragraph below is superseded where it conflicts (its `--query`-bearing "RAW"
workflow, missing-method→unknown rule, 59.0.0 pinning language, and bare "56" count).

**Prior pass (fourth, same date):** The fourth pass verified: event deduplication is now sound — a per-event
`eventId` (`crypto.randomUUID()`) is part of the v1 envelope and is the only permitted dedup key
(`requestId`+timestamp and full-line `sort -u` are prohibited; a verified-unique platform
log-record id is acceptable only after explicit window-start preflight, failing closed when
absent); the export workflow no longer overclaims `--query` semantics — the server query is a
coarse full-text volume-reduction hint, the filter of record is local `jq` parsing of `.message`
via `fromjson?` with fail-closed handling of malformed/missing-field events, and truncation is
checked on the RAW unfiltered line count before any filtering; `operation` is now a fixed
allowlisted HTTP-method enum with fail-closed `'unknown'`, covered by the redaction/contract
tests; the CLI contract stays pinned to the tested 59.0.0 (59.1.3 published — no silent upgrade;
upgrade ⇒ full revalidation), with flag existence separated from the query/JSON-shape semantics
that a window-start preflight against a known emitted event must confirm; and the `client.js`
script-consumer count is corrected to the independently verified 56. Named changes remain the
owner items listed at the end of this section; the third-pass "no claim contradicted by current
source" statement is superseded by this paragraph for the Q1–Q3 surfaces.

**Prior pass (third, same date):** The third pass verified: thrown-error `outcome` mapping matches the
actual `service-error.js` classification (`AbortError` → `causeKind: 'abort'`, `:88` — helper
timeouts are aborts, so `abort`/`timeout` both map to `outcome: 'timeout'`; `service-error.js`
unchanged); the emitter contract is exactly `console.log(JSON.stringify(event))` with a planned
parse-and-discriminator unit test (the `console.log(object)` inspect format was locally
demonstrated to be non-JSON); the log-export workflow is a fail-closed **historical** query
verified against installed Vercel CLI `59.0.0` (`--project`/`--environment production`/
`--since`/`--until`/`--query`/`--json`/explicit `--limit`, truncation ⇒ exit 1, Log Drain /
dashboard export as the required fallback when completeness cannot be proven, version re-check at
window start); the egress inventory now separates instrumentation/emission scope (all wrapped-seam
callers, scripts included) from target measurement scope (the three Workbench routes); and the
100%-sampling volume/cost assumption is explicitly unverified with a 48-hour validation and a
concrete stop/re-scope threshold.

**Prior pass (second, same date):** The follow-up pass verified: telemetry preserves the transports'
existing structured error transformations (`buildNoResponseError` at `dynamics/http.js:41-50` and
the Graph equivalent) and adds no wrapping of its own, with the timed span excluding the pre-try
interlock assert; the `lib/dataverse/client.js` integration is lazy/server-only per that module's
browser-import contract (`client.js:11-29`), enforced by the new `npm run build` gate; the event
contract carries an explicit `event: 'workbench.dependency'` discriminator and a first-class
`'unknown'` dependency variant; sampling is stated as 100% of all shared-seam traffic (the seams
are app-wide, not Workbench-private — the volume justification was later re-labeled an unverified
assumption by the third pass); and the log-export workflow is
an executable bounded capture-slice command with link preconditions, JSON output, time bounds,
filtering, and volume handling (CLI flag shapes `[ASSUMED]` pending window-start confirmation).
Named changes (owner
items, not rework): (1) campaign window/release posture `[NEEDS OWNER]`; (2) Vercel plan log
retention confirmed at measurement-window start; (3) implementation itself remains unauthorized
until the owner names a stage (brief Phase 8). Verified across both passes: the egress inventory matches
source (three in-scope seams, each with its own transport; no shared-coverage claim); the
correlation design uses a new independent ALS whose lifecycle cannot be disturbed by DAL scopes and
begins before the pre-auth Dataverse lookup it must observe; the event contract, sink, and failure
semantics are explicit and PII-safe; Stage 2's census and formula match the verified source sites
(three pairs, decline unchanged at its correct `lib/services/workbench/` path, chunking preserved at
the service layer); T1 and T2 are uniformly closed with no prospective work. No live-state claim in
this document is presented as built runtime state; the plan remains a **draft NOT authorized for
implementation**.
