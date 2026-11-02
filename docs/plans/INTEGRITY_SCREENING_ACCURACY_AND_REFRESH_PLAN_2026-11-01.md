---
title: Integrity screening accuracy and monthly Retraction Watch refresh
domain: integrity-screener
kind: plan
status: active
summary: "Reject conflicting author names, replace identity-confidence claims, validate PubPeer evidence, and safely refresh Retraction Watch monthly. Screening implementation authorized on the isolated branch; Fable review required before merge. Production changes remain unapproved."
canonical: false
cataloged: 2026-11-01
owner: product-engineering
related:
  - docs/guides/INTEGRITY_SCREENER.md
  - docs/atlas/postgres-infra-tables.md
  - docs/agent-wiki/topics/integrity-screener.md
---

# Integrity screening accuracy and monthly Retraction Watch refresh

## 1. Scope, authority, and status

[VERIFIED via branch, reviews and authorized preflight] Owner: Codex. Branch: `codex/integrity-screening-discussion`. Worktree: `/private/tmp/wmkf-integrity-screening`. Justin authorized implementation on this isolated branch on 2026-11-02, starting with Increment A and requiring Fable review before merge or production work. Increment A is source-built, tested, and Fable-reviewed as READY FOR OWNER REVIEW; it is not merged or deployed. Increment B is source-built with isolated tests, full official-CSV rehearsal, passing release checks and Fable READY FOR OWNER REVIEW. Justin authorized read-only production preflight, which is recorded in the [preflight receipt](../audits/integrity-production-preflight-2026-11-02.md). Migration 092 was applied only in a disposable loopback database. No production migration, import, merge or schedule activation has been performed; production reads were explicitly authorized for the preflight.

[VERIFIED via owner messages, 2026-11-01] Justin requested three initial fixes after inspecting request 1002852: reject conflicting names, use honest identity labels, and validate PubPeer sources. He additionally requested a Retraction Watch update and selected a **monthly** refresh. The proposed timing is **the 1st of every month at 06:00 UTC**, expression `0 6 1 * *`; only the monthly cadence was owner-selected, while the exact time is a planning default.

[PLANNED] Deliver two bounded increments: A, screening accuracy and source reporting; B, safe reference-data refresh and scheduling. Complete A independently of B where possible. Full ORCID/publication/coauthor-based identity resolution, dismissal persistence, a direct PubPeer API, general news-classifier redesign, automatic applicant screening, funding gates, and unrelated Reviewer Finder work are out of scope. No new paid provider calls are needed to test the implementation offline. Live re-screening is a separate explicitly approved application operation.

## 2. Historical baseline evidence and uncertainty — before implementation

| Claim | Evidence inspected | Status |
|---|---|---|
| Surname-only matching admits conflicting full given names at score 50 | `lib/services/integrity-matching-service.js`, `calculateNameMatch`, Tier 7; local reproduction returned matches for Anthony Leung / Robert A Leung and Scott Bailey / Aileen M Bailey | VERIFIED via source and local execution |
| An exact normalized name receives score 100 without identity evidence | Same helper, Tier 1; local reproduction returned 100 for Yuan He / Yuan He | VERIFIED via source and local execution |
| Common-name detection is a finite list, does not include Yuan He, and is not an identity gate | Matching service `COMMON_NAMES` / `isCommonName`; engine places the boolean in results; UI displays a warning | VERIFIED via source and local execution |
| Retraction Watch records are counted as concerns whenever a name match is returned | `lib/services/integrity-service.js`, `screenApplicants` and `processSearchResults` | VERIFIED via source |
| Paper-wide affiliation can increase a score; mismatched affiliation leaves the score unchanged | `processSearchResults`; matching service `adjustConfidenceForInstitution` | VERIFIED via source; does not establish per-author affiliation |
| PubPeer requests include a site restriction, but returned hostnames are not validated | `searchPubPeer` and `serpSearch` in `lib/services/integrity-service.js` | VERIFIED via source; cause of the actual provider response is UNKNOWN |
| Workbench accepts coverage version 1 with searched=true and no source errors for approval | `lib/services/workbench/integrity-service.js`, `hasCompleteSourceCoverage` | VERIFIED via source |
| Screens and review decisions persist in Postgres, separate from the reference corpus | Workbench service reads/writes `integrity_screenings` and `integrity_screening_reviews`; engine queries `retractions` | VERIFIED via source; production schema not freshly probed |
| Existing importer reads a local CSV, upserts by record_id, and optionally deletes all live rows first | `scripts/import-retraction-watch.js` | VERIFIED via source; the optional clear is not the default |
| Importer can skip malformed rows, catch row write failures, and still print success | Same script, CSV loop, processBatch, and final summary | VERIFIED via source |
| No repository Retraction Watch refresh cron was found | Inspected `vercel.json`; searched pages, services, scripts, workflows, docs, and memory for import-retraction-watch, refresh-retractions, and retraction_watch.csv | VERIFIED via bounded repository search; external schedulers UNKNOWN |
| Crossref distributes a full CSV updated each working day through its GitLab repository | https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/ | VERIFIED via official documentation retrieved this session |
| Older Crossref Labs delivery can be stale | https://www.crossref.org/labs/retraction-watch | VERIFIED via official notice retrieved this session |
| Current production corpus row count, latest full import, target database, active external schedules, and backup availability | No production query or deployment inspection performed | UNKNOWN; execution prerequisites, not asserted from historical Atlas counts |

[VERIFIED via source] The end-to-end entry points are the standalone `pages/integrity-screener.js` and its screen/history APIs, and `shared/components/workbench/IntegrityTab.js` through `pages/api/workbench/integrity/[requestId]/run.js`. The shared engine produces source results; standalone saving is historically fail-soft, while the Workbench service explicitly awaits its request-linked INSERT. Workbench history returns the saved JSON and append-only staff decisions. Standalone PDF, Markdown, and JSON exports are generated in the page. The new cron will be a separate reference-data writer, not a screening or staff-decision writer.

## 3. Increment A implementation contract (source-built and reviewed, not deployed)

### A1. Reject definite name conflicts before permissive matching

[PLANNED] Reject empty/unusable input first. Preserve raw punctuation/case for parsing initials and separators before normalization. A definite given-name conflict requires two complete given names that are neither equal, compatible initials, recognized variants, a supported name-order swap, nor a prefix of one another. Evaluate explicit middle-name/initial conflicts before any first/last-only success path. Shared surnames and similar string lengths are insufficient evidence. A missing middle name is absence of evidence, not a conflict. Prefix pairs such as Yu He / Yuan He remain `ambiguous_name` candidates, not asserted romanization variants or confirmed identities.

[PLANNED] Preserve valid initials and name variants as **candidates**, not confirmed identities. Do not invent a universal parsing rule for compound surnames or unfamiliar name orders: retain an explicit ambiguous outcome where the existing parser cannot support a safe conclusion. Remove the surname-plus-length acceptance rule. Institution similarity cannot rescue an explicit name conflict. A mismatch with the current institution alone must not exclude a possible prior affiliation.

[PLANNED] Regression fixtures include the two reported conflicting-name pairs, exact Yuan He, prefix pairs, full name versus initial, compact initials (RA Leung), a supported nickname, reversed full names, absent middle name, conflicting middle initial, compound/hyphenated names, accents, blank values, and malformed names. Single-token names can match only the same complete single-token name as ambiguous evidence; a token alone does not match everyone with that surname. Corpus author separators are semicolons; do not split an individual author at commas before interpreting Last, First or a suffix. Include comma-order and suffix fixtures. Test the final engine inclusion/count, not just the helper score. Fix only matching rules necessary for these contracts; do not expand the nickname registry or create a new identity service.

### A2. Describe the evidence without pretending to verify identity

[PLANNED] Keep name-similarity scores internal for ordering where useful. Remove percentage/probability and high/medium/low identity badges from staff presentation and human-readable exports. New records carry versioned evidence semantics and an explicit `identityStatus: unverified`; name evidence can be `exact_name`, `compatible_initials`, `recognized_variant`, or `ambiguous_name`. These proposed keys are a result-JSON contract, not new identity facts. Unknown values display "Identity unverified" rather than falling through to an affirmative label.

| Evidence | Staff-facing description |
|---|---|
| Identical normalized names | Exact name match · identity unverified |
| Compatible abbreviated given names | Initials match · identity unverified |
| Recognized full-name variant | Name variant · identity unverified |
| Supported but ambiguous candidate | Possible namesake · identity unverified |
| Old record without new evidence metadata | Earlier matching rules · identity not established |

[PLANNED] Show matched author, title, DOI, paper-wide affiliation clearly identified as such, action (correction/retraction/etc.), and reasons together. Add concise wording that an identified correction or retraction does not by itself establish misconduct. Do not label the paper's affiliation as verified affiliation for this author.

[PLANNED] New result summaries distinguish potential Retraction Watch records from source-level PubPeer/news flags. Existing `matchCount` is a compatibility total of heterogeneous review items, not a count of verified allegations. Do not relabel its total as a count of papers. Suppressed conflicting-name candidates do not contribute to new saved totals. No expanding common-name list is needed to make uncertainty visible for everyone.

[PLANNED] Apply presentation and JSON semantics consistently in Workbench, standalone UI, PDF, Markdown, and JSON exports, including empty/error paths. JSON may retain a legacy numeric field for compatibility only when explicitly described as a heuristic name-similarity score; it must carry no probability-of-identity claim.

### A3. Enforce PubPeer evidence boundaries

[PLANNED] Validate parsed URLs before merging evidence, counting, storing raw results, or sending content to the summarizer. Initial allowlist: HTTPS `pubpeer.com` and `www.pubpeer.com` with no credentials or unexpected port. Explicitly reject suffix lookalikes, embedded credentials, malformed URLs, and unsupported schemes. Do not fetch redirects or scraped pages as part of this change. Valid-domain results still require relevant discussion content; a search/profile/help page is not itself evidence of an integrity concern.

[PLANNED] Validate each broad and narrow search response independently, before dedupe. Both searches are required when an institution is supplied. Keep the current two-phase strategy, including the prior-affiliation search, without increasing search volume.

| Provider outcome | New behavior |
|---|---|
| Successful, structurally valid search containing only accepted PubPeer URLs | Analyze accepted evidence; retain exact links and normal coverage reporting |
| Successful, provider-confirmed empty response | Report "No PubPeer results returned by the indexed search"; this is not a full direct PubPeer database check |
| Any off-domain or unusable result, including mixed valid/invalid results | Mark the source incomplete with a fixed source-validation error; do not summarize it as clean or complete |
| Provider failure/malformed response | Existing explicit source error; never a clean result |

[PLANNED] For contamination, retain only safe diagnostic counts/reason codes, not unrelated pages as findings. No automatic retries or paid diagnostic queries. A mixed-response strict policy avoids counting a provider-relaxed query as a complete site-restricted search. Valid hostnames alone do not establish identity, source completeness, or misconduct.

[PLANNED] PubPeer retrieval and summary failure reporting must use the strict validation path in both standalone and Workbench callers. Preserve standalone fail-soft saving, not its current conversion of failed PubPeer fetches to empty results or failed summaries to positive flags. A failed PubPeer fetch/analysis is an explicit source error in either UI. The general news sentinel-string classifier remains out of scope and its source-level flag must not be described as a verified positive finding. An invalid source does not establish misconduct or require staff to choose hold; it remains incomplete until a successful new search, with no automatic retry or spending.

### A4. Versioning, history, and approval

[PLANNED] Introduce explicit new matching/result semantics and strict coverage version 2. New Workbench runs use version 2. The server, not browser state, validates per-person source shape, new policy version, searched flags, and errors before accepting a new approval. New incomplete PubPeer runs remain saved and reviewable with an error, may be placed on hold, and cannot receive approval. All-source-failed runs must remain visibly incomplete, never "no concerns".

[PLANNED] Old saved JSON, counts, timestamps, and appended decisions are immutable. Split coverage evaluation into completeness under a run's recorded policy for historical status, and eligibility under version 2 for a new approval. Older runs show the legacy-rules notice. A previously recorded approval remains an historical approval and is explicitly labeled as reviewed under earlier rules; this change does not silently revoke it. Preserve current roster-changed, unavailable-identity, latest-decision and hold precedence. An older run without a current prior approval requires a new screen before a new approval can be recorded; its reason says "Screened under earlier rules; run a new screen," rather than falsely claiming it had source errors. A newer hold on a formerly approved run must not be bypassed by finding an earlier approval. A new screen returns the request to the normal latest-run review flow. Add approved-v1 fixtures to service and real-Postgres integration tests.

[PLANNED] Preserve existing caller authentication, request-owned roster, per-request history, staff authority, and standalone versus Workbench save semantics. Retain existing generation/mounted/request guards across every new async result or failure update. No new funding decision or progression requirement is introduced.

## 4. Increment B implementation contract (source-built; review in progress, not deployed)

### B1. Execution preflight and schema

[PLANNED] Before live reads/writes, identify the exact application database and environment without printing credentials. Record existing schema/indexes, aggregate row count, minimum/maximum `last_updated`, and any import evidence; these timestamps are row-write times and do not prove a successful complete dataset import. Inspect external scheduler configuration if accessible. Verify recovery/backup before publishing the first refresh. Never use fresh-install setup against the populated database.

[PLANNED] Add a small proposed `retraction_dataset` singleton metadata table through the next available existing-DB migration and fresh-install schema parity. Store a monotonically increasing publication generation, published source URL, SHA-256, upstream revision when obtainable, successful publication timestamp, last successful full-source check timestamp, row count, and format/policy version. Record per-attempt success/failure through existing `maintenance_runs`. Source revision is optional; a checksum is mandatory and must identify the bytes actually imported. Do not infer a revision for preexisting data: label its provenance unknown until the first successful managed refresh. The first dry run reports the actual CSV header diff and width violations per column against the live schema. Widen only columns demonstrated too narrow (to TEXT where appropriate) in the reviewed migration before publication; do not silently truncate or skip fields. Header/width checks are verified for the inspected source in section 10 and the production preflight; revalidate actual downloaded bytes at execution.

### B2. Download, stage, validate, publish

[PLANNED] Use a fixed official HTTPS source under `gitlab.com/crossref/retraction-watch-data`, not a caller-supplied URL or Labs API. Pin or record the actual upstream revision when available and always hash the downloaded bytes. Constrain redirects to approved source hosts, bound download bytes and elapsed time, and stream with a proper CSV parser supporting quoted commas and embedded newlines. Validate required headers, field widths/types, unique nonempty record IDs, dates, and normalized authors; do not silently skip failed rows.

[PLANNED] Reuse the existing `pg`, `csv-parse`, `pg-copy-streams`, and `withVerifyFullSslmode` primitives without changing the IRS service. Download/parse outside the database transaction. Then use one dedicated client and one explicit transaction: acquire a fixed `pg_try_advisory_xact_lock`, create a TEMP staging table with ON COMMIT DROP, load via COPY or bounded bulk INSERT, validate against the current locked dataset, and publish before commit. No fixed shared staging name, session-level advisory lock, or TEMP table spanning transaction boundaries; those are unsafe with transaction-mode pooling. On contention report skipped/busy, not success. Bound transaction, statement, connection and lock times; rollback/release on failure. Rehearsal must verify the actual target connection/pooling mode, not infer safety from a dedicated JavaScript client alone.

[PLANNED] Require a nonempty complete parse, no duplicate IDs or rejected records, and a proposed minimum of 90% of the current row count before automatic publication. A larger drop requires an operator review of the source diff; it must not be silently accepted or permanently prevent a legitimate reviewed correction. Exact resource limits and the first-run row-count baseline are measured in rehearsal, not assumed from old Atlas counts.

[PLANNED] Publish validated data and singleton metadata in one transaction against the existing `retractions` table, preserving table identity, indexes, constraints, and privileges. Before choosing the final merge statements, inspect consumers and foreign keys of `retractions.id` and `record_id`; preserve stable IDs where referenced. Apply keyed updates/inserts and explicitly account for source removals. The first production publication presents inserted/changed/removed counts for approval. No clear-first production import. No changes to screening histories or review decisions.

[PLANNED] Compare checksums under the publication lock. Identical checksum: skip rewriting the corpus, generation and publication timestamp; advance only the successful full-source check timestamp and record the unchanged check in maintenance reporting. A changed publication increments the generation in the same transaction, including a rollback to previously seen source bytes, so A→B→A cannot evade a reader check. A failed attempt cannot advance the published metadata. Existing maintenance methods swallow write errors; do not rely on their promise resolving as durable proof. For this service, use an explicit checked persistence result/readback and an existing-system alert on logging failure without changing global maintenance semantics. Published singleton metadata remains durable provenance; prunable maintenance logs are operational history. A logging failure after publication is distinct from a failed import; never report committed data as untouched.

### B3. Bind screening provenance to the corpus actually read

[PLANNED] Preserve the existing per-person streamed engine sequence and pool queries. Read publication generation/metadata once before the first corpus read and again after the last person's Retraction Watch query, covering all people and every fallback query. Only if the generation is unchanged may the run claim that dataset provenance. If it differs, disappears, or cannot be checked, mark **every** person's Retraction Watch source incomplete with a fixed error, attach no coherent-generation claim, and recompute final source status/counts. Do not merely compare per-person checksums: that could mix generations across a run or miss A→B→A. Metadata and corpus change atomically under B2. While managed provenance is in use, concurrent legacy/unmanaged corpus writes are prohibited operationally and excluded from any coherence claim; the manual importer does not obey this protocol.

[PLANNED] Source results streamed before the final generation check are provisional. The final complete event must replace them with the corrected whole-run results in standalone state and exports, while Workbench persists the corrected array. On a generation change no new approval can pass, no earlier emitted candidate becomes a final clean result, and no automatic paid retry occurs. Missing metadata before the first managed publication is an explicit unknown-provenance baseline, not a fabricated generation; first publication mid-run must be detected. Unit and real-Postgres concurrency tests cover all these branches. No read transaction or connection is held across external searches.

[PLANNED] Embed immutable generation/checksum/publication metadata in each person's `sources.retraction_watch.dataset`, keeping `results` a per-person array of roster length. Show it on current runs, history, and exports. Existing runs say "Dataset version not recorded." Show the last successful publication date and last successful full-source check date, with a stale-data warning when the latter is over 45 days old (an unchanged but freshly verified source is not stale); the warning does not pretend the corpus is empty and does not introduce a new approval block. Failed refresh alerts explain that previous reference data remains available only when publication did not commit.

### B4. Cron and operational boundary

[PLANNED] Add `/api/cron/refresh-retractions` using a strict bearer-secret check without the shared helper's development bypass, plus an explicit `VERCEL_ENV === 'production'` route gate. Preview/dev must refuse even with a valid secret. Keep this route thin. An out-of-route service/CLI rehearsal entry accepts an explicitly selected test database connection (never printed) and performs the same validation/publication logic without a production environment. The route cannot accept a database URL from a request. No auto-screening or changes to staff decisions. Use existing maintenance reporting/alerts; no new notification destination or external message is authorized by this plan.

[PLANNED] Provide a dry-run path that downloads, validates, reports the proposed diff, and leaves the live corpus/metadata unchanged. It may write a clearly labeled maintenance attempt. Measure full download/parse/stage/publish runtime and memory on the full dataset in an isolated test database. Configure the function time budget only after measured fit with margin. If a single function cannot fit, stop and return a revised execution proposal rather than silently adding a queue/workflow or shipping a timeout-prone cron.

[PLANNED] After source approval, rehearse against an isolated database, then obtain exact live migration/initial-refresh authorization. **The `vercel.json` cron entry is activation**: add `0 6 1 * *` in a separate later commit/promotion only after the first controlled production refresh and readback succeeds. Keep the old manual importer outside the automatic path; do not delete or retire it in this task. Document its unsafe partial-success/clear-first behavior and its incompatibility with managed provenance; it is not a fallback or concurrent writer for the managed cron.

## 5. File surfaces and verification

| Increment | Intended files/surfaces | Required proof |
|---|---|---|
| A: matcher and evidence | `lib/services/integrity-matching-service.js`, `lib/services/integrity-service.js`; associated unit tests and matching diagnostic script if affected | Reported conflicting names excluded end to end; supported names retained; unknown inputs cannot become verified identities |
| A: consumers and review | Workbench service, `shared/components/workbench/IntegrityTab.js`, `pages/integrity-screener.js`, source prompt only if necessary; existing route/service/UI tests | All UI/export/history branches use honest evidence labels; new approval fails on incomplete/version-1 runs; legacy approved history preserved |
| B: reference refresh | New focused Retraction Watch refresh service + cron route/rehearsal entry + tests; next available migration/manifest; `scripts/setup-database.js`; separate later `vercel.json` activation commit | CSV correctness, header/width validation, complete-stage validation, stable IDs, atomic rollback, lock contention, unchanged checksum, interrupted publish, strict production-only route authentication, measured runtime |
| B: source provenance | Shared engine's Retraction Watch query seam and final complete event, result JSON, Workbench and standalone consumers/exports | Stable generation across every person's reads or explicit whole-run source error; no transaction remains open during external searches; old provenance remains unknown |
| Documentation | Atlas infrastructure page, guide, Integrity wiki, service catalog, API security matrix, CI route/count pointers and generated docs catalog where applicable | Source-led sweep of changed behavior; no planned behavior presented as shipped |

[PLANNED] Required relevant gates: `check:api-routes`, `check:atlas`, `check:migrations-manifest`, `check:status-enum-parity`, `check:prompt-injection-tagging` if prompt/LLM surfaces change, `check:model-override-warming` if model routing changes, `check:doc-currency`, `check:fact-consistency`, `check:canonical-pointers`, `check:docs-catalog`, `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:secret-scan`, and `check:types`. Run each gate followed by its defined self-test sequentially. Inspect current package scripts at implementation time. Run scoped Jest tests, existing request-history/security tests, lint, and the canonical build before promotion. New schema claims require real isolated-Postgres integration tests, not SQL-string assertions alone.

[PLANNED] Test matrices must include real negative fixtures: unrelated results actually present before exclusion; contaminated PubPeer pages alongside valid pages; a mid-import failure with a previously populated live corpus; concurrent readers spanning publication; and a committed publication followed by a maintenance-log failure. Offline fixtures establish mechanism, not the current live provider behavior.

[PLANNED] Confidence/evidence consumer checks include `tests/unit/workbench-integrity-tab.test.js`, `tests/e2e/workbench-integrity.spec.js`, and `scripts/test-retractions.js`, in addition to the engine, standalone exports and review-service tests. Diagnostic scripts must describe heuristic similarity truthfully as well.

## 6. Historical planning contract-reconcile audit disposition

| Audit | Planning disposition |
|---|---|
| Whole-flow | Source entry points, shared helper, saved JSON, review gate, history and exports traced; proposed cron→stage→corpus→reader path specified above |
| Partial success | Source failures remain explicit; cannot approve incomplete new runs. Import requires fully valid staging; row skipping cannot become success. Publication and logging outcomes separated |
| Async/stale state | Preserve existing Workbench generation guards; fence all corpus reads with one monotonically increasing publication generation; invalidate provisional streamed output on a changed generation; transaction-scoped publisher lock and time budget. Actual implementation still requires post-await audit |
| Helper semantics | Name similarity is not identity; paper-wide institution is not per-author evidence; no extraction may collapse these distinctions. Shared engine retains standalone/Workbench save differences |
| Durable surfaces | Result versions/metadata, new dataset metadata table, route/migration/index/Atlas/matrix/catalog coverage identified; exact migration number and live schema UNKNOWN until preflight |
| Docs reconciliation | Bounded source-led search completed for corpus/import/schedule claims; no runtime fact has changed. Future implementation invokes sweep for actual changes; historical counts remain historical |
| Symbol-consumer fan-out | `confidence`, `confidenceLevel`, `isCommonName`, `matchCount`, `hasConcerns`, `sourceCoverageVersion`, and searched/error consumers identified. New evidence keys and corpus metadata require explicit unknown/legacy handling in all readers |

## 7. Acceptance and release sequence

[PLANNED] A is acceptable when the two conflicting-name examples are excluded, Yuan He is never presented as a verified person based only on his name, exported labels agree with UI, contaminated PubPeer results cannot pass coverage, and old staff approvals/history are preserved without granting new approvals under old rules.

[PLANNED] B is acceptable when a full-dataset rehearsal meets resource budgets, failed imports leave corpus and metadata intact, readers either report one coherent generation or explicit incomplete coverage, unchanged files do not republish, provenance is truthful, and the initial authorized live refresh reads back correctly before cron enablement.

[PLANNED] Work stays on the feature branch. Relevant red gates block the affected surface. No merge to `main` (which deploys), production migration/import, provider-credit-consuming re-screen, or cron activation is authorized by writing or reviewing this plan. Justin accepted implementation on 2026-11-02; source work and read-only production preflight are authorized, while merge and production writes remain unapproved. Fable review is source-only; live state remains UNKNOWN unless separately probed.

## 8. Initial independent plan review — historical

[VERIFIED via owner messages and CLI receipt, 2026-11-01 Pacific] Justin requested and explicitly approved source disclosure and potential subscription usage for an ordinary Claude Fable review, **OAuth only, no API credits**. The initial automatic approval rejection was resolved by that explicit disclosure/approval; the subsequent invocation ran successfully. No alternate product, model, or authentication fallback was used.

[VERIFIED via host authentication check, 2026-11-01] Claude reports a signed-in first-party subscription OAuth session. No token was read or exported. The planned review limits Fable to Read/Grep/Glob, disables customizations and MCP servers, and excludes project/provider credentials from the child environment.

[VERIFIED via CLI result] Fable (`claude-fable-5-1`) reviewed initial plan commit `704da4145` using Read/Grep/Glob only. Result: **READY WITH NAMED CHANGES**, no P0 findings, seven P1 recommendations. Success, 46 turns, no permission denials. The [verbatim review and mechanism receipt](../audits/integrity-screening-plan-fable-review-2026-11-01.md) distinguish reviewer assertions from controller-verified findings. This is a source review, not production verification.

| Initial Fable finding | Controller disposition in this revision |
|---|---|
| P1-1: split historical completeness from new-approval eligibility | ACCEPTED; A4 specifies both predicates, latest-decision precedence, old-rule explanation and approved-v1 tests. Verified current status-before-approval ordering in Workbench service |
| P1-2: preserve prefix/compacted initials/single-token ambiguity | ACCEPTED WITH LIMITS; A1 defines exact conflict exceptions and ambiguous outcomes. Existing prefix support verified; the claim that such pairs are commonly romanization variants is untested and not adopted |
| P1-3: treat off-domain-only PubPeer results as clean empty coverage | DECLINED; a transport-successful off-domain response does not prove a valid constrained search. No saved/live response was inspected by Fable, so its claimed relaxed-query cause and availability prediction remain assumptions. A3 retains explicit incomplete coverage; standalone PubPeer false-empty behavior is corrected too. Any later relaxation needs provider-specific evidence and a separate plan decision |
| P1-4: field widths can block strict import | ACCEPTED AS PREFLIGHT; source schema has narrow columns, but actual CSV violations are untested. B1 requires header/width report and widening only demonstrated incompatible fields, never silent truncation |
| P1-5: session locks/shared staging and transaction pooling | ACCEPTED WITH CORRECTION; TEMP staging, transaction-scoped lock and publication are all inside one explicit bounded transaction. A dedicated client alone cannot make session-scoped TEMP tables safe across transactions under a pooler |
| P1-6: avoid restructuring streamed engine into a long snapshot read phase | ACCEPTED WITH STRONGER FENCE; B3 preserves per-person sequence, checks one monotonic generation across the entire run, and corrects final streamed/saved output on a change. Per-person checksums alone are insufficient. No claim of a database snapshot is retained |
| P1-7: strict route auth, separate test-service entry, provenance DTO placement | ACCEPTED; B3/B4 specify per-person source metadata, no development auth bypass, production route gate, and out-of-route isolated rehearsal |

[PLANNED] P2 dispositions: explicit standalone PubPeer failure handling; semicolon-aware author parsing and comma/suffix tests; news classifier limitations remain named out of scope; checked maintenance persistence and post-commit failure reporting; cron schedule in a separate activation commit; source header/width validation; diagnostic/UI/e2e fan-out tests. Retain the stable-ID/foreign-key preflight instead of trusting an absence claim without a fresh live schema check. Do not expand this task into a general identity resolver.

[VERIFIED via bounded source-led reconciliation] This revision updates the whole plan's affected contract, tables, acceptance criteria and async audit together; the initial review is explicitly historical. Runtime guidance remains current behavior because no runtime fact changed. Unknowns remain production schema/corpus freshness, actual provider responses, complete-source CSV compatibility, pooling configuration and measured resource fit. No whole-repository or live-state audit is claimed.

## 9. Historical screening checkpoint — before Increment B implementation, 2026-11-02

[VERIFIED via source, local tests and OAuth-only Fable reviews] Increment A is implemented on this branch. The first implementation commit is `1ab370793`; `d3780341d` addresses the first review, and the final retrieval correction closes the remaining source-to-matcher recall gap. Both raw and expanded search terms are retained. The final independent verdict is **READY FOR OWNER REVIEW**; see the [complete implementation review and verification receipt](../audits/integrity-screening-implementation-fable-review-2026-11-02.md).

[VERIFIED via local execution] Final source: 223 tests across 12 scoped Jest suites, 41 diagnostic assertions, canonical Next build, lint with zero errors, type check, and relevant gates/self-tests. Isolated Postgres integration (four tests) and mocked Chromium Workbench flow (one test) passed after the approval/UI corrections. No application-provider calls, production reads/writes, migrations, merges, or new cron schedules were performed. No historical screening JSON, count or staff decision was rewritten.

[PLANNED] Increment B remains separate. Production corpus/schema/freshness preflight, reference-data service and metadata migration, isolated full-dataset rehearsal, controlled initial refresh, and later monthly schedule activation remain outstanding. Owner authorization to implement does not authorize merging or accessing production; those boundaries remain in force.

## 10. Current managed-refresh checkpoint — 2026-11-02

[VERIFIED via source and isolated execution] Justin authorized Increment B implementation. The managed refresh service, strict disabled worker, loopback-only rehearsal script, metadata reader/generation fence, UI/export provenance and migration 092 are source-built. No cron schedule is registered. Function duration configuration alone does not activate a schedule. Final source gates/build passed; Fable closure review returned READY FOR OWNER REVIEW with no P0/P1 findings. The two nonblocking final regression/reporting recommendations were implemented and tested; see the [refresh review receipt](../audits/retraction-refresh-fable-review-2026-11-02.md). Production activation remains unapproved.

[VERIFIED via official CSV and local rehearsal] The official source download is 67,793,090 bytes / 73,519 records, SHA-256 `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`. Publisher and subject reach 500 and 263 characters; migration 092 widens only those demonstrated VARCHAR(255) fields. The temporary Postgres rehearsal covered dry-run, full publication, unchanged checks, rollback, stable IDs, locking, protected deletions, audit-after-commit failure and actual A→B→A screening invalidation. A full-source indexed publication took about 12 seconds, and an actual service download took about 12.5 seconds. These are local evidence, not production row counts, schema verification or hosted performance guarantees.

[PARTIAL] Read-only production target/schema/corpus/scheduler preflight and seven-day PITR checks are complete; see the [preflight receipt](../audits/integrity-production-preflight-2026-11-02.md). Tested scoped recovery and external-writer quiet-window confirmation, migration approval/application, initial controlled dry-run and publication/readback, and a separate monthly `0 6 1 * *` activation commit remain outstanding. The source worker additionally requires literal `RETRACTION_REFRESH_ENABLED=on`; Preview/dev and unset/invalid flags fail closed. See [operating guide](../guides/RETRACTION_WATCH_REFRESH.md) and [metadata Atlas](../atlas/postgres-retraction-dataset.md).
