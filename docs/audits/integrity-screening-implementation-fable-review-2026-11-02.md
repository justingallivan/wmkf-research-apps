---
title: Fable review of Integrity screening implementation
domain: integrity-screener
kind: audit
status: active
summary: "OAuth-only read-only Fable review of screening Increment A and controller correction evidence; no production or refresh changes."
canonical: false
cataloged: 2026-11-02
owner: product-engineering
related:
  - docs/plans/INTEGRITY_SCREENING_ACCURACY_AND_REFRESH_PLAN_2026-11-01.md
---

# Screening Increment A — independent review

[VERIFIED via CLI receipt, 2026-11-02] Fable reviewed the source snapshot committed as `1ab370793`. Requested `fable`, reported only `claude-fable-5-1`, first-party provider, through host-verified `claude.ai` subscription OAuth. Child environment excluded all project/API credentials. Read/Grep/Glob only, safe mode, empty strict MCP configuration, no fallback model, no other agents. Success, 43 turns, 612331 ms, no permission denials. Session `12ead4f1-0adc-4c7e-8eaa-76ae41212695`. CLI list-price estimates are accounting metadata, not evidence of API-credit use. Owner authorization covers this OAuth review, not API credits or production access.

[HISTORICAL REVIEW] Initial verdict: NEEDS FIXES, one P1 and six P2 findings. The source and test corrections below are controller changes after that review. The reviewer received the test state at launch, so its build/Postgres limits below describe its evidence, not later controller checks.

## Initial review (verbatim)

Review complete. Tool access (Read, Grep, Glob) succeeded throughout; no shell, writes, probes, or other agents were used. Everything below is a source-only review. Real Postgres integration, the canonical build, and real SerpApi/PubPeer behavior remain unverified per the controller's evidence.

## Verdict: NEEDS FIXES

One P1 recall regression introduced by this change, plus six P2 items the owner can accept or schedule. The core contracts of Increment A are otherwise met, and I found no P0.

## What I confirmed against the plan

- **Conflicting names excluded end to end.** All similarity, surname-plus-length and surname-only tiers are gone, and the `string-similarity` import was removed (`lib/services/integrity-matching-service.js:286-329`). The engine-level test excludes both reported pairs and keeps Yuan He as an unverified exact-name candidate (`tests/unit/integrity-service-strict-sources.test.js:270-281`). Institution adjustment only applies to already-matched candidates, so it cannot rescue a rejected pair.
- **Semicolon author split matches the importer.** The engine now splits on semicolons only (`lib/services/integrity-service.js:328`), consistent with the importer's parser (`scripts/import-retraction-watch.js:68-75`), so Last, First entries and suffixes survive.
- **PubPeer allowlist is shared by both callers.** Validation runs inside the shared `searchPubPeer` before dedupe, summarization, or raw-result storage (`lib/services/integrity-service.js:403-416`). Strict mode is forced for PubPeer even in standalone (`:389`), mixed responses fail, empty responses use the indexed-search wording, and failures carry only a fixed message plus a count (`:162-168`).
- **Approval eligibility is server-side and split from historical completeness.** Version 1 remains complete for history, version 2 is required for a new approval, and shape checks fail closed (`lib/services/workbench/integrity-service.js:235-262`, `:602-604`). Hold and identity/roster precedence are unchanged. Legacy approved-v1 stays approved in the unit test and the pg test fixture.
- **Labels never go affirmative on unknown data.** The shared helper returns the legacy or "Identity unverified" label for anything not explicitly version 2 (`shared/utils/integrity-evidence.js:4-15`). Standalone now always renders the PubPeer and news cards, so unsearched sources show as incomplete rather than disappearing (`pages/integrity-screener.js:256-273`).
- **No consumer string-matches the old summary text.** Grep for the retired wording found only the engine and fixtures.
- **Unmodified characterization tests remain consistent** with the new matcher (Robert/Bob at 90 as a variant, Chris/Christopher matches) at `tests/unit/normalizer-characterization/person-name-normalizers.test.js:275-297`. They were outside the controller's scoped run and should be executed.

## Findings

**P1-1. Initials expansion silently drops previously surfaced candidates.** The expansion at `lib/services/integrity-matching-service.js:227` rewrites any leading two or three capital letters followed by a Title-case word. An all-caps surname such as "LI Wei" becomes "L I Wei", parsed as first "l", middle "i", last "wei". Against the search "Wei Li", the swap rule is skipped because the candidate now has a middle token (`:300`), and the surname check at `:308` returns no match. Under the previous code this pair matched by name-order swap. That is a recall regression the plan's acceptance criterion "supported names retained" does not allow, and it is exactly the "universal parsing rule for unfamiliar name orders" A1 says not to invent. I cannot verify read-only whether the corpus or Dataverse contains all-caps surnames, so that is a named limit.
Required fix: make the expansion non-destructive. Evaluate both the expanded and unexpanded parse and keep the stronger candidate, or label the pair `ambiguous_name` when only one parse matches.
Disconfirming test: assert that `calculateNameMatch('Wei Li', 'LI Wei')` matches as `ambiguous_name`, while `('Robert A Leung', 'RA Leung')` still returns `compatible_initials` and `('Anthony Leung', 'RA Leung')` still returns no match.

**P2-1. Misaligned middle tokens are treated as a definite conflict.** The positional comparison at `:311-314` rejects "John A Smith" against "John Paul A Smith" because index zero compares "a" with "paul". The plan treats a missing middle name as absence of evidence; misalignment is being treated as conflict and the result is exclusion, not an ambiguous outcome.
Required fix: declare conflict only when both sides have the same middle-token count and a positional pair is incompatible; otherwise fall through as `ambiguous_name`.
Disconfirming test: `calculateNameMatch('John A Smith', 'John Paul A Smith').matches` is true, while `('John A Smith', 'John B Smith')` stays false.

**P2-2. Initials-only exact strings are labelled "Exact name match".** "A Leung" versus "A Leung" reaches `:315` and returns `exact_name` at 100. The evidence is one initial plus a surname.
Required fix: if the first token is a single letter, return `compatible_initials` instead.
Disconfirming test: `calculateNameMatch('A Leung', 'A Leung').nameEvidence === 'compatible_initials'`.

**P2-3. Categorical `confidenceLevel` still written on version-2 matches.** `lib/services/integrity-service.js:368` emits high/medium/low on every new record, and it lands in saved rows and the standalone JSON export (`pages/integrity-screener.js:551-560`). The `confidenceMeaning` disclaimer covers the numeric field only. Plan A2 permits a described numeric legacy field, not a categorical identity label. No in-repo reader remains after the IntegrityTab change.
Required fix: stop writing `confidenceLevel` on version-2 matches, or extend the disclaimer to name it.
Disconfirming test: the engine fixture's match has no `confidenceLevel`, and the exported JSON does not contain `"confidenceLevel": "high"`.

**P2-4. Historical version-1 approvals carry no "earlier rules" label at review level.** `lib/services/workbench/integrity-service.js:394-396` sets `reason` to null for approved status. Plan A4 requires the historical approval to be explicitly labelled as reviewed under earlier rules; only the per-person matching notice appears.
Required fix: when status is approved and the run is not eligible under version 2, set a reason such as "Approved under earlier rules; a new screen is required for any new approval."
Disconfirming test: the approved-v1 context test asserts `review.reason` matches "earlier rules".

**P2-5. e2e fixture encodes a scenario the server now rejects.** `tests/e2e/workbench-integrity.spec.js:15` uses `sourceCoverageVersion: 1` with no result-level `matchingVersion`, yet the mocked review returns `canApprove: true` (`:72`). It passes only because the API is mocked, and it will show the legacy notice beside an approval button.
Required fix: update the fixture to the version-2 shape with result-level `matchingVersion` and PubPeer `sourceValidationVersion`.
Disconfirming assertion: `page.getByText('Earlier matching rules')` has count 0 after the run.

**P2-6. Incomplete labels sit inside green badges in standalone.** The applicant badge (`pages/integrity-screener.js:199-201`), the empty Retraction Watch badge (`:239-241`) and the AI card badge (`:123-125`) keep success styling while the text says "Incomplete". Text is honest; colour is not.
Required fix: switch to amber classes when `integrityIncomplete` or `source.error` is true.
Disconfirming test: in the jsdom test, the element containing "Incomplete source" has no class containing `bg-green`.

## Named limits for the owner

- **Standalone news remains fail-soft.** A SERP failure returns an empty list (`lib/services/integrity-service.js:639`) and becomes "No relevant news found." with `error: null` (`:518-524`), so a standalone applicant can show "No concerns reported" for news after a provider failure. A Haiku failure returns the "Unable to analyze" string (`:702`), which the sentinel at `:535` counts as a concern. Plan A3 scopes the standalone correction to PubPeer and names the news classifier out of scope, so this is a documented acceptance rather than a defect, but it does not satisfy "no false clean source" for that one source.
- **Unverified in this review:** real Postgres integration (`tests/integration/integrity-screening-reviews.pg.test.js` skipped without a database), the canonical build, and the CJS helper imported via ESM syntax in `pages/integrity-screener.js:7` and `shared/components/workbench/IntegrityTab.js:4` under the Next bundler. Jest passed; the build is the remaining check. `Object.hasOwn` is already used in 20+ runtime files, so it is not a new compatibility risk.
- **Real provider behaviour** for PubPeer and SerpApi remains unknown; offline fixtures establish mechanism only. The owner's conservative fail-incomplete policy for mixed responses is implemented as specified and I am not asking to relax it.

## Controller corrections and verification

[VERIFIED via source and tests, 2026-11-02] Commit `d3780341d` addresses the initial findings. All seven are accepted:

| Finding | Correction | Disconfirming test/result |
|---|---|---|
| P1 initials expansion loses uppercase surnames | Evaluate raw and expanded parses non-destructively; keep compatible candidate | Wei Li / LI Wei retained as ambiguous; RA Leung retains compatible-initials evidence for Robert A, but not Anthony |
| P2 misaligned middle names | Only equal-length middle arrays establish positional conflict | John A / John Paul A retained as ambiguous; John A / John B rejected |
| P2 initials-only exact label | Single given initial uses initials evidence even for identical strings | A Leung / A Leung labels compatible initials |
| P2 categorical confidence | New engine records omit confidenceLevel | Engine output test asserts field absent; human exports have no percentage |
| P2 historical approval explanation | Historical approved-v1 review reason says earlier rules | Legacy approval context has approved status, canApprove false, and earlier-rules reason |
| P2 impossible e2e fixture | Current-policy result, matching, and PubPeer markers in mocked response | Browser test passes with no earlier-rules notice on the new run |
| P2 green incomplete badges | Incomplete source/result badges use amber | Standalone jsdom regression asserts no bg-green for the incomplete source |

[VERIFIED via local commands after corrections] Twelve scoped Jest suites passed, 221 tests, including normalizer characterization; the matching diagnostic passed 41 assertions. The real-Postgres integration suite passed four tests in an isolated loopback-only temporary Postgres 18.6 cluster under `/private/tmp`, then shut down with no pid file remaining. No shared database was used. The mocked Chromium Workbench test passed once against the corrected canonical Next build. Every API call is mocked or aborted. Lint reported zero errors (190 existing repository warnings); the canonical `npm run build`, type check, and scoped repository gates passed. Browser/shared-memory restrictions on the first attempts were resolved through approved host reruns, not by weakening application checks.

[VERIFIED via scoped gate log] API-route, Atlas, status/enum parity, prompt-injection tagging, model-override warming, doc currency, fact consistency, canonical pointers, docs catalog, doc-symbol refs, build-claim freshness, agent wiki, secret scan, scaffolding, and types all passed; each defined self-test ran after its own gate, sequentially. These are scoped checks, not a claim of full-repository test coverage.

## Contract-reconcile implementation audit

| Audit | Evidence and boundary |
|---|---|
| Whole flow | Authenticated standalone/Workbench callers → shared matcher/engine → existing screening JSON → history/review policy → both UIs and all export formats. No route, schema, staff identity, or request-roster input contract changed |
| Partial success | Failed/contaminated PubPeer results carry errors and no raw unrelated evidence; current-policy server approval rejects incomplete/unknown metadata. Source errors remain visible in UI/PDF/Markdown/JSON. Standalone saving remains fail-soft; existing news classification limits remain out of scope |
| Async/stale state | No new UI await/state paths. Existing request generation/mounted guards and awaited Workbench persistence remain; PubPeer strict timeout/error path applies to standalone too. Existing context-change tests passed |
| Helper semantics | Shared browser-safe labels do not infer identity, severities, persistence or approval from a score. Raw/expanded name parsing only generates unverified candidates; tests protect definite conflicts and valid names |
| Durable surfaces | Existing JSON gains explicit policy/evidence tags; no new table, column, route, or migration in Increment A (schema/migration work N/A). Atlas, guide, wiki, matrix, service/utility catalogue, and plan describe source-built/not-deployed state |
| Doc reconciliation | Bounded Mode A sweep for changed confidence/coverage facts: source/tests and affected guide/wiki/Atlas/matrix/catalogue/normalizer-inventory restatements checked; historical review text explicitly marked historical. Branch-source facts are not claimed as deployed behavior; no live external-state audit |
| Symbol fan-out | matchingVersion, nameEvidence, identityStatus, confidenceLevel, sourceCoverageVersion, matchCount and source searched/error fields checked across engine, decision gate, history, Workbench, standalone, exports and diagnostics. Unknown values stay unverified/incomplete; old approvals keep original policy completeness and precedence |

[VERIFIED via second Fable receipt] The second review closed six findings and the matcher-side part of P1, but found the same destructive parsing in the retrieval builders. The current correction preserves both raw and expanded database terms/text patterns and adds an engine test with the real builders. Ambiguous compact-initial exact strings now stay ambiguous, not full-name evidence. The final focused review below closes the residual P1 and returns READY FOR OWNER REVIEW. No merge, push, production mutation, provider-backed application re-screen, or monthly refresh/cron activation has occurred. The production age/content of Retraction Watch and actual SerpAPI/PubPeer responses remain unverified. The monthly refresh is still Increment B.

## Second Fable review (verbatim)

[VERIFIED via CLI receipt] Same OAuth-only mechanism and model, success, 28 turns, 470892 ms, no permission denials. Session `93e48ee1-38af-4dcd-8341-d49bd46713a1`. This reviewed commit `d3780341d`; the retrieval correction follows this result.

## Fable closure review: Integrity screening Increment A corrections

Tool access held throughout. One grep result was truncated to disk by the harness and re-run with a narrower scope. No shell, writes, probes, web, or other agents. Source-only evidence; build, browser, Postgres, and provider behaviour not verified here.

## Verdict: NEEDS FIXES

One residual item under P1-1 still silently drops a previously working retrieval path. Everything else closes, and the reported false positives stay excluded on every parse combination.

## Finding-by-finding closure

| Finding | Status | Evidence |
|---|---|---|
| P1-1 Destructive initials expansion | **Partially closed** | Matcher side closed: `calculateNameMatch` evaluates all four expand/no-expand parse combinations and keeps the highest (`lib/services/integrity-matching-service.js:286-298`). The three disconfirming tests exist and hold by trace (`tests/unit/integrity-matching-identity.test.js:41-43`). The finding's stated scenario (applicant "Wei Li", corpus "LI Wei") works end to end because the search name is not expanded and the array term `li wei` still fetches the row. Residual: see below. |
| P2-1 Misaligned middle tokens | **Closed** | Conflict requires equal-length middle arrays (`:324-327`). "John A Smith" vs "John Paul A Smith" matches as `ambiguous_name`; "John A Smith" vs "John B Smith" and "John Alice Smith" vs "John Amanda Smith" stay rejected (`identity.test.js:7-8, 44-45`). |
| P2-2 Initials-only exact strings labelled Exact | **Partially closed, non-blocking** | Single-letter case fixed (`:329-330`, test `:46`). Compact initials escape via the unexpanded parse: "RA Leung" vs "RA Leung" (and "R.A. Leung" vs "RA Leung", since dots are stripped) normalise to first token `ra`, hit `search.full === candidate.full` with length 2, and return `exact_name` at 100, which wins the reduce at `:298` over the expanded parse's `compatible_initials` 85. Label only; the candidate is correct. Disconfirming test: `calculateNameMatch('RA Leung', 'RA Leung').nameEvidence === 'compatible_initials'`. Owner's call. |
| P2-3 Categorical `confidenceLevel` on v2 matches | **Closed** | No writer remains in the engine (`lib/services/integrity-service.js:353-374`) and no reader in `IntegrityTab.js` or `pages/integrity-screener.js`. Engine test asserts absence (`strict-sources.test.js:280`). The `confidenceLevel: 'high'` at `tests/unit/workbench-integrity-tab.test.js:60` is a legacy v1 fixture, not a writer. The standalone export test does not literally assert absence; the fixture simply omits the field. |
| P2-4 Approved-v1 lacks "earlier rules" reason | **Closed** | `lib/services/workbench/integrity-service.js:396` sets the reason when not eligible under v2; `needs_review` on a v1 run also says earlier rules (`:399-400`). Tests at `workbench-integrity-review-service.test.js:346, 350`. Rendered at `IntegrityTab.js:433`. |
| P2-5 e2e fixture encodes a rejected scenario | **Closed** | Fixture is v2 with `sourceCoverageVersion`, result-level `matchingVersion`, match evidence fields, and PubPeer `sourceValidationVersion` (`tests/e2e/workbench-integrity.spec.js:15, 20, 24`). Legacy-notice count asserted zero (`:120`). |
| P2-6 Incomplete labels in green badges | **Closed** | Amber on error or unsearched at `pages/integrity-screener.js:123`, `:199`, `:239`. jsdom test asserts no `bg-green` on "Incomplete source" (`integrity-standalone-evidence.test.js:65`). The test exercises only the AI card badge; the other two are correct by source. |

**False-positive regression check.** Anthony Leung / Robert A Leung, Scott Bailey / Aileen M Bailey, and both reverse directions contain no all-caps token, so all four parse combinations are identical and reach the final `noMatch` at `:344`. Anthony Leung vs RA Leung rejects under both candidate parses. Robert A Leung vs RB Leung rejects via the equal-length middle conflict. Supported candidates retained: Yuan He exact, Wei Zhang / Zhang Wei swap, Robert / Bob variant, John A Smith / John Smith, and both compact initials forms (`identity.test.js:14-26`). The unmodified characterization tests remain consistent (`person-name-normalizers.test.js:275-297`). The PubPeer allowlist and fail-incomplete policy are unchanged (`integrity-service.js:387-416`).

## Blocking residual under P1-1

**Same root cause, two callers the fix did not reach.** `extractNameParts` still defaults to destructive expansion (`integrity-matching-service.js:224`), and both retrieval builders call it with that default (`:429` and `:478`). For an applicant name with a leading two- or three-letter all-caps surname such as "LI Wei", "KIM Min", or "WU Ming":

- `buildDatabaseSearchTerms('LI Wei')` yields `l i wei`, `wei`, `l wei`, `wei l`. The importer stores whole normalised author strings (`scripts/import-retraction-watch.js:55-75`), so the array-contains query at `integrity-service.js:278` matches none of them. Before `1ab370793` the term `li wei` hit the index exactly.
- The only remaining path is `LOWER(authors) LIKE '%l%wei%'` with `LIMIT 25` and no `ORDER BY` (`integrity-service.js:296-303`). That pattern matches a large arbitrary slice of the corpus, so the real row is not reliably returned.
- If the row is never fetched, the corrected matcher is unreachable, even though `calculateNameMatch('LI Wei', 'Li Wei')` would return exact via the unexpanded parse.

Frequency of all-caps surnames in Dataverse remains unverified read-only, as in the original finding. The point is that this was a working path before the change set and the drop is silent.

**Required fix.** Build database terms and text patterns from both parses, or skip expansion in the two retrieval builders since the matcher now handles initials itself. Retrieval only widens candidate rows and every row still passes through `calculateNameMatch`, so the Leung and Bailey exclusions cannot be reintroduced by this change.

**Disconfirming test.** `buildDatabaseSearchTerms('LI Wei')` contains `'li wei'` and `'wei li'`, while `buildDatabaseSearchTerms('RA Leung')` still contains `'r a leung'`. No current test covers this, because `strict-sources.test.js:14` mocks `buildDatabaseSearchTerms` outright.

## Non-blocking note

A "Last, First" corpus entry with compact initials such as "Leung, RA" is not expanded because the regex is start-anchored, so it does not match "Robert A Leung" under any parse. This predates the corrections and is not a reintroduced false positive. Recorded for the owner, not raised as a finding.

## Final focused closure (verbatim)

[VERIFIED via CLI receipt] Same OAuth-only mechanism and `claude-fable-5-1` model, success, 13 turns, 196896 ms, no permission denials. Session `f0e94326-b40c-411c-ad90-535353592972`. Scope: the residual retrieval correction after `d3780341d`. No new review product, model fallback, API-key authentication or live probe was used.

**Verdict: READY FOR OWNER REVIEW.** Source-only review. I did not execute any tests, so the 142 and 41 pass counts are your statements, not my evidence.

**Residual P1 closed on source.**
- `extractNameParts` now defaults to non-expansion at `lib/services/integrity-matching-service.js:224`.
- Both builders union the raw and expanded parses at `lib/services/integrity-matching-service.js:435` and `lib/services/integrity-matching-service.js:490`. For the applicant written LI Wei the database terms include the raw string the importer stores, since the importer only lowercases and strips punctuation at `scripts/import-retraction-watch.js:53`.
- The callers at `lib/services/integrity-service.js:264` and `lib/services/integrity-service.js:292` still pass one argument, so they get the union.

**Candidate retrieval traced end to end.** The engine test at `tests/unit/integrity-service-strict-sources.test.js:284` restores the real builders. The array query has one interpolation, so the mock's second argument is the term and only the raw term returns the row. The LIKE fallback never receives that value, so the test cannot pass through the text path. The returned row then survives the matcher: the raw-versus-raw parse scores exact, and the alternative-parse guard at `lib/services/integrity-matching-service.js:301` downgrades the evidence to ambiguous. The test asserts identity status only. I confirmed the ambiguous label by reading the source, not by an assertion.

**Leung and Bailey stay rejected.** Retrieval only widens rows. Every row passes through the matcher at `lib/services/integrity-service.js:330`. Those names never hit the expansion regex, so all four parses are identical and fall through to no match at `lib/services/integrity-matching-service.js:351`. Disconfirming tests are `tests/unit/integrity-matching-identity.test.js:5` and `tests/unit/integrity-service-strict-sources.test.js:270`.

**No material defect introduced.** One non-blocking side effect: the default change also affects `isCommonName`, so an all-caps-surname applicant like WEI Wang can now trigger the common-name warning where it previously missed. That is the correct direction.

## Current checkpoint

[VERIFIED via final local execution] Final source passes 223 tests in 12 scoped Jest suites, 41 matching diagnostic assertions, lint on the final changed matcher/test files and the repository type check, and a fresh canonical Next build. The four real-Postgres tests and mocked Chromium test passed after the approval/UI corrections; the subsequent change only touched pure matching/retrieval helpers and their tests, so those unrelated checks were not repeated. The existing successful gate/self-test evidence above remains scoped to its registered surfaces; final documentation checks follow the review-record update.

[VERIFIED via source and reviews] Increment A is source-built and READY FOR OWNER REVIEW. Required findings are closed. This is not permission to merge or proof of actual provider behavior or dataset freshness. Increment B (managed monthly corpus refresh, new schema, source provenance and cron activation) remains planned and has not been implemented here. No shared database or production request was accessed for this increment. Existing saved results for request 1002852 remain unchanged; the new rules apply to future screens once deliberately deployed.

[ASSUMED/UNVERIFIED] Actual SerpAPI relaxation behavior, full PubPeer index coverage, current production corpus contents and freshness. Standalone news keeps its preexisting fail-soft/sentinel classification behavior, as explicitly scoped out of Increment A; the PubPeer correction must not be represented as a general news-classifier fix.
