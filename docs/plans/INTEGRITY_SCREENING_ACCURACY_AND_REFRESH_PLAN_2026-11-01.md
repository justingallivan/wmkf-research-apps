---
title: Integrity screening accuracy and monthly Retraction Watch refresh
domain: integrity-screener
kind: plan
status: planned
summary: "Reject conflicting author names, replace identity-confidence claims, validate PubPeer evidence, and safely refresh Retraction Watch monthly. Implementation and live changes are not authorized by this plan."
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

[PLANNED] Owner: Codex. Branch: `codex/integrity-screening-discussion`. Worktree: `/private/tmp/wmkf-integrity-screening`. This is a proposal for owner review before implementation; no runtime changes, migrations, imports, scheduled jobs, or production probes have been executed for this plan.

[VERIFIED via owner messages, 2026-11-01] Justin requested three initial fixes after inspecting request 1002852: reject conflicting names, use honest identity labels, and validate PubPeer sources. He additionally requested a Retraction Watch update and selected a **monthly** refresh. The proposed timing is **the 1st of every month at 06:00 UTC**, expression `0 6 1 * *`; only the monthly cadence was owner-selected, while the exact time is a planning default.

[PLANNED] Deliver two bounded increments: A, screening accuracy and source reporting; B, safe reference-data refresh and scheduling. Complete A independently of B where possible. Full ORCID/publication/coauthor-based identity resolution, dismissal persistence, a direct PubPeer API, general news-classifier redesign, automatic applicant screening, funding gates, and unrelated Reviewer Finder work are out of scope. No new paid provider calls are needed to test the implementation offline. Live re-screening is a separate explicitly approved application operation.

## 2. Evidence and uncertainty

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

## 3. Increment A: matching and source honesty

### A1. Reject definite name conflicts before permissive matching

[PLANNED] Normalize first, handle exact names, compatible initials, recognized variants, and supported full-name order swaps deliberately, then reject incompatible complete given names before fuzzy fallbacks. Shared surnames and similar string lengths are insufficient evidence. Conflicting explicit middle names/initials must not be ignored by a first/last-only match. A missing middle name is absence of evidence, not a conflict.

[PLANNED] Preserve valid initials and name variants as **candidates**, not confirmed identities. Do not invent a universal parsing rule for compound surnames or unfamiliar name orders: retain an explicit ambiguous outcome where the existing parser cannot support a safe conclusion. Remove the surname-plus-length acceptance rule. Institution similarity cannot rescue an explicit name conflict. A mismatch with the current institution alone must not exclude a possible prior affiliation.

[PLANNED] Regression fixtures include the two reported conflicting-name pairs, exact Yuan He, full name versus initial, a supported nickname, reversed full names, absent middle name, conflicting middle initial, compound/hyphenated names, accents, blank values, and malformed names. Test the final engine inclusion/count, not just the helper score. Fix only matching rules necessary for these contracts; do not expand the nickname registry or create a new identity service.

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

### A4. Versioning, history, and approval

[PLANNED] Introduce explicit new matching/result semantics and strict coverage version 2. New Workbench runs use version 2. The server, not browser state, validates per-person source shape, new policy version, searched flags, and errors before accepting a new approval. New incomplete PubPeer runs remain saved and reviewable with an error, may be placed on hold, and cannot receive approval. All-source-failed runs must remain visibly incomplete, never "no concerns".

[PLANNED] Old saved JSON, counts, timestamps, and appended decisions are immutable. Older runs show the legacy-rules notice. A previously recorded approval remains an historical approval and is explicitly labeled as reviewed under earlier rules; this change does not silently revoke it. An older run without a prior approval requires a new screen before a new approval can be recorded. A new screen returns the request to the normal latest-run review flow. Test status precedence so compatibility does not accidentally invalidate an old approval merely because version 1 is no longer eligible for a new decision.

[PLANNED] Preserve existing caller authentication, request-owned roster, per-request history, staff authority, and standalone versus Workbench save semantics. Retain existing generation/mounted/request guards across every new async result or failure update. No new funding decision or progression requirement is introduced.

## 4. Increment B: monthly reference-data refresh

### B1. Execution preflight and schema

[PLANNED] Before live reads/writes, identify the exact application database and environment without printing credentials. Record existing schema/indexes, aggregate row count, minimum/maximum `last_updated`, and any import evidence; these timestamps are row-write times and do not prove a successful complete dataset import. Inspect external scheduler configuration if accessible. Verify recovery/backup before publishing the first refresh. Never use fresh-install setup against the populated database.

[PLANNED] Add a small proposed `retraction_dataset` singleton metadata table through the next available existing-DB migration and fresh-install schema parity. Store the published source URL, SHA-256, upstream revision when obtainable, successful publication timestamp, row count, and format/policy version. Record per-attempt success/failure through existing `maintenance_runs`. Source revision is optional; a checksum is mandatory and must identify the bytes actually imported. Do not infer a revision for preexisting data: label its provenance unknown until the first successful managed refresh.

### B2. Download, stage, validate, publish

[PLANNED] Use a fixed official HTTPS source under `gitlab.com/crossref/retraction-watch-data`, not a caller-supplied URL or Labs API. Pin or record the actual upstream revision when available and always hash the downloaded bytes. Constrain redirects to approved source hosts, bound download bytes and elapsed time, and stream with a proper CSV parser supporting quoted commas and embedded newlines. Validate required headers, field widths/types, unique nonempty record IDs, dates, and normalized authors; do not silently skip failed rows.

[PLANNED] Stage data on a dedicated database connection using bulk COPY or bounded bulk INSERT. Serialize concurrent publishers with a database advisory lock held by that connection. On lock contention, report skipped/busy; do not claim refresh success. Cap connection and statement times. Clean up staging/temp resources on success and failure; interruption must not leave the live corpus cleared or partially replaced.

[PLANNED] Require a nonempty complete parse, no duplicate IDs or rejected records, and a proposed minimum of 90% of the current row count before automatic publication. A larger drop requires an operator review of the source diff; it must not be silently accepted or permanently prevent a legitimate reviewed correction. Exact resource limits and the first-run row-count baseline are measured in rehearsal, not assumed from old Atlas counts.

[PLANNED] Publish validated data and singleton metadata in one transaction against the existing `retractions` table, preserving table identity, indexes, constraints, and privileges. Before choosing the final merge statements, inspect consumers and foreign keys of `retractions.id` and `record_id`; preserve stable IDs where referenced. Apply keyed updates/inserts and explicitly account for source removals. The first production publication presents inserted/changed/removed counts for approval. No clear-first production import. No changes to screening histories or review decisions.

[PLANNED] Identical checksum: skip rewriting the corpus and its publication timestamp; record a successful unchanged check separately in maintenance reporting. A failed attempt cannot advance the published metadata. Failure recording itself must not falsely imply corpus publication failed after commit: the atomic published metadata is authoritative, and a later maintenance-log failure is reported separately. Do not describe a completed publication as safely untouched.

### B3. Bind screening provenance to the corpus actually read

[PLANNED] Every new screen records dataset metadata from the same database snapshot as its Retraction Watch queries. Prepare all people’s Retraction Watch results in a short repeatable-read, read-only transaction using a dedicated client, then close it **before** SerpAPI/LLM calls. The engine's corpus availability check and all fallback searches must use that client, not a separate global pool query. This avoids a monthly publication mixing corpus generations within one saved run and avoids holding a database transaction through paid network calls.

[PLANNED] Save immutable checksum/publication metadata with result JSON and show it on current runs, history, and exports. Existing runs say "Dataset version not recorded." Show the last successful publication date and a stale-data warning after 45 days; the warning does not pretend the corpus is empty and does not introduce a new approval block. Failed refresh alerts explain that previous reference data remains available only when publication did not commit.

### B4. Cron and operational boundary

[PLANNED] Add `/api/cron/refresh-retractions` using authenticated cron access and a production-only write policy; Preview/dev must refuse this scheduled writer even if a secret is present. Configure `0 6 1 * *` in `vercel.json` only for deliberate production promotion. No auto-screening or changes to staff decisions. Use existing maintenance reporting/alerts; no new notification destination or external message is authorized by this plan.

[PLANNED] Provide a dry-run path that downloads, validates, reports the proposed diff, and leaves the live corpus/metadata unchanged. It may write a clearly labeled maintenance attempt. Measure full download/parse/stage/publish runtime and memory on the full dataset in an isolated test database. Configure the function time budget only after measured fit with margin. If a single function cannot fit, stop and return a revised execution proposal rather than silently adding a queue/workflow or shipping a timeout-prone cron.

[PLANNED] After source approval, rehearse against an isolated database, then obtain exact live migration/initial-refresh authorization. Enable the monthly schedule only after the first controlled production refresh and readback succeeds. Keep the old manual importer outside the automatic path; do not delete or retire it in this task. Document its unsafe partial-success/clear-first behavior so it is not a fallback for the managed cron.

## 5. File surfaces and verification

| Increment | Intended files/surfaces | Required proof |
|---|---|---|
| A: matcher and evidence | `lib/services/integrity-matching-service.js`, `lib/services/integrity-service.js`; associated unit tests and matching diagnostic script if affected | Reported conflicting names excluded end to end; supported names retained; unknown inputs cannot become verified identities |
| A: consumers and review | Workbench service, `shared/components/workbench/IntegrityTab.js`, `pages/integrity-screener.js`, source prompt only if necessary; existing route/service/UI tests | All UI/export/history branches use honest evidence labels; new approval fails on incomplete/version-1 runs; legacy approved history preserved |
| B: reference refresh | New focused Retraction Watch refresh service + cron route + tests; next available migration/manifest; `scripts/setup-database.js`; `vercel.json` | CSV correctness, complete-stage validation, stable IDs, atomic rollback, lock contention, unchanged checksum, interrupted publish, production-only authentication, measured runtime |
| B: source provenance | Shared engine's Retraction Watch query seam, result JSON, Workbench and standalone consumers/exports | One corpus snapshot per run under concurrent refresh; no transaction remains open during external searches; old provenance remains unknown |
| Documentation | Atlas infrastructure page, guide, Integrity wiki, service catalog, API security matrix, CI route/count pointers and generated docs catalog where applicable | Source-led sweep of changed behavior; no planned behavior presented as shipped |

[PLANNED] Required relevant gates: `check:api-routes`, `check:atlas`, `check:migrations-manifest`, `check:status-enum-parity`, `check:prompt-injection-tagging` if prompt/LLM surfaces change, `check:model-override-warming` if model routing changes, `check:doc-currency`, `check:fact-consistency`, `check:canonical-pointers`, `check:docs-catalog`, `check:doc-symbol-refs`, `check:build-claim-freshness`, `check:secret-scan`, and `check:types`. Run each gate followed by its defined self-test sequentially. Inspect current package scripts at implementation time. Run scoped Jest tests, existing request-history/security tests, lint, and the canonical build before promotion. New schema claims require real isolated-Postgres integration tests, not SQL-string assertions alone.

[PLANNED] Test matrices must include real negative fixtures: unrelated results actually present before exclusion; contaminated PubPeer pages alongside valid pages; a mid-import failure with a previously populated live corpus; concurrent readers spanning publication; and a committed publication followed by a maintenance-log failure. Offline fixtures establish mechanism, not the current live provider behavior.

## 6. Contract-reconcile audit disposition

| Audit | Planning disposition |
|---|---|
| Whole-flow | Source entry points, shared helper, saved JSON, review gate, history and exports traced; proposed cron→stage→corpus→reader path specified above |
| Partial success | Source failures remain explicit; cannot approve incomplete new runs. Import requires fully valid staging; row skipping cannot become success. Publication and logging outcomes separated |
| Async/stale state | Preserve existing Workbench generation guards; bind corpus metadata/results in one database snapshot; enforce job lock and time budget. Actual implementation still requires post-await audit |
| Helper semantics | Name similarity is not identity; paper-wide institution is not per-author evidence; no extraction may collapse these distinctions. Shared engine retains standalone/Workbench save differences |
| Durable surfaces | Result versions/metadata, new dataset metadata table, route/migration/index/Atlas/matrix/catalog coverage identified; exact migration number and live schema UNKNOWN until preflight |
| Docs reconciliation | Bounded source-led search completed for corpus/import/schedule claims; no runtime fact has changed. Future implementation invokes sweep for actual changes; historical counts remain historical |
| Symbol-consumer fan-out | `confidence`, `confidenceLevel`, `isCommonName`, `matchCount`, `hasConcerns`, `sourceCoverageVersion`, and searched/error consumers identified. New evidence keys and corpus metadata require explicit unknown/legacy handling in all readers |

## 7. Acceptance and release sequence

[PLANNED] A is acceptable when the two conflicting-name examples are excluded, Yuan He is never presented as a verified person based only on his name, exported labels agree with UI, contaminated PubPeer results cannot pass coverage, and old staff approvals/history are preserved without granting new approvals under old rules.

[PLANNED] B is acceptable when a full-dataset rehearsal meets resource budgets, failed imports leave corpus and metadata intact, readers see one coherent generation, unchanged files do not republish, provenance is truthful, and the initial authorized live refresh reads back correctly before cron enablement.

[PLANNED] Work stays on the feature branch. Relevant red gates block the affected surface. No merge to `main` (which deploys), production migration/import, provider-credit-consuming re-screen, or cron activation is authorized by writing or reviewing this plan. Implementation begins only after Justin accepts the reviewed plan. Fable review is source-only; live state remains UNKNOWN unless separately probed.

## 8. Independent review

[PLANNED] Justin requested an ordinary Claude Fable review through subscription OAuth. Review must be read-only, challenge the actual source prerequisites and whole flow, identify material omissions and scope creep, and return severity-ranked findings with evidence. Do not use provider API keys, Ultrareview, alternate models/products, external writes, or paid application probes. Review result and owner disposition will be recorded here after receipt.

[VERIFIED via host authentication check, 2026-11-01] Claude reports a signed-in first-party subscription OAuth session. No token was read or exported. The planned review limits Fable to Read/Grep/Glob, disables customizations and MCP servers, and excludes project/provider credentials from the child environment.

[VERIFIED via automatic approval review, 2026-11-01] The review invocation was rejected before execution. The stated reason was repository source disclosure to the external Claude/Fable service and possible metered subscription credit use without explicit approval after disclosure. No Fable result or verdict exists. The review is **PENDING OWNER APPROVAL** for those concrete effects; no alternate model/product or execution workaround was attempted. This document must not be described as Fable-reviewed until an actual result is received and adjudicated.
