# Narrow Retraction Watch retention — implementation and Fable review

**SOURCE-BUILT, NOT DEPLOYED. Final Fable verdict READY FOR OWNER REVIEW; sole P2 closed, no blocking code findings.** Owner authorized retaining only legacy record IDs 13045 and 67801 with explicit provenance, implementing the smallest safe change and an ordinary OAuth-only Fable review. Migration, merge, flag activation, first production dry-run/publication and cron registration remain unexecuted and require release authorization.

## Invariants and whole-flow trace

| Invariant | Enforcement / evidence |
|---|---|
| Exactly two reviewed records, no general no-delete mode | `lib/services/retraction-retained-records.json`: reviewed backup snapshots; thirteen bibliographic fields stay frozen and authors_normalized is re-derived with the current shared normalizer. Publisher/NLM notice URL, review date, reason and backup SHA identify provenance; refresh rejects IDs outside 13045/67801 |
| Source wins when either ID returns | Stage presence check precedes retention insert. Returned upstream entry receives no retained provenance in metadata or new matches; other absent IDs are still removed |
| Honest source checksum | `source_checksum` remains SHA-256 of downloaded CSV bytes. `source_row_count` counts those rows. `row_count` is effective corpus rows. `retained_records` separately carries per-record payload hash and reviewed provenance. No modified CSV or invented combined checksum |
| Atomic and repeat-safe | Both kinds of rows share existing TEMP stage, keyed upsert, lock and commit. Dataset generation, counts and manifest commit together. Same source and same manifest use unchanged/drift guard; changed manifest publishes a new generation even with identical upstream bytes |
| Truth reaches staff | Metadata reader validates counts/manifest; coherent final whole-run fence adds `retentionProvenance` to retained matches. Both screens and PDF/Markdown/JSON expose retained-record labeling; identity remains unverified |
| No new infrastructure | Pending migration 092 (not yet applied in Production) extends the same singleton with source_row_count and retained_records plus count constraint. No extra migration/table/route/flag/queue/schedule or user-configurable override API |

Entry points: fixed disabled cron → refresh service → official CSV and fixed curated snapshots → TEMP stage → corpus and singleton → generation reader/fence → saved result JSON → Workbench/standalone UI and exports. Test dependency overrides are service-internal only and cannot be supplied through the cron route. Historical screening JSON is unchanged.

## Verification

[VERIFIED via local execution] 254 focused tests across 14 suites passed. Fifteen real isolated Postgres tests passed after the reviewer correction, including absent-record retention, returned-upstream precedence, same-source policy revision, unchanged repeat, invalid unreviewed ID refusal, rollback and actual screen provenance. UI/export tests assert visible retention label and JSON provenance. The existing full-source fixture deliberately suppresses exceptions; the separate restored-production rehearsal below exercises the DEFAULT policy.

[VERIFIED via actual restored backup] `scripts/rehearse-retraction-retention.cjs` ran only after restoring and fingerprint-verifying the 68,248-row production backup in a new loopback database. Applied pending 092 locally, then staged dry-run, published and repeated unchanged check. Results: **73,519 upstream + 2 retained = 73,521**, **5,286 additions, 1,846 changed rows, 13 removals**. The exception rows preserve original database IDs: record 13045 → id 55391; record 67801 → id 1014. Publication generation 1 and publication time stayed unchanged on repeat. Local publication took approximately 2.6 seconds; not a hosted timing guarantee. Upstream SHA-256 remains `7a729a87837985954a34326202cb98c4bff4b2b142fda8695febb613cf45a7f4`.

The reviewed snapshot archive SHA is `4fbd26264805cc2c08590fe14b295f9c31a80ae5b7e6309a45b9f1e19249092e`. Retained payload hashes: 13045 `69bd689082cf15707ced6b3162495a04215ac72bd05c9853ef0ea99a9ccc14a9`; 67801 `4443137eba2aeaadb7d227801c5996bd2bd54cd4d571e80ffc9cd5fd4d77e4b9`. These hashes cover the ordered 14 field values, not the entire upstream file or an author identity. The private backup remains outside the disposable worktree. Temporary databases are stopped/removed.

## Fable mechanism and review

Owner-approved source disclosure and possible subscription usage; OAuth only, no API credits. Host Claude CLI uses a whitelist of HOME/PATH/USER/LOGNAME/SHELL/TMPDIR/LANG/LC_ALL/TERM, ordinary `--model fable`, Read/Grep/Glob only, safe mode, no MCP servers or other agents. No token extraction, API fallback or metered review-product substitution. Reviewer is asked to inspect this delta and failure/consumer paths; it runs no tests or production probes. Initial receipt: success, model claude-fable-5-1, 45 turns, no permission denials. Verdict READY FOR OWNER REVIEW, one nonblocking P2, no P0/P1. The P2 is corrected and the bounded closure returned READY FOR OWNER REVIEW.

## Remaining live release gates

After review closure and final source checks, the two omissions are covered without deleting their evidence. Recheck exact target, backup freshness, pending migration set and sessions/locks; coordinate a quiet window and external importers. Obtain migration and merge/promotion approval. Keep refresh disabled and cron absent during promotion. Then enable/deploy with approval, run the actual production worker dry-run to verify pooler COPY/TEMP/lock behavior and hosted budget, inspect exact upstream/retained/diff manifest, and approve first publication/readback. Only then register monthly schedule separately. A later upstream correction under a DIFFERENT ID still requires human review of the two curated exceptions; no automatic DOI/title consolidation is introduced.

Contract-reconcile audits: whole flow, partial success, async generation fence, helper semantics, durable singleton/schema/manifest, documentation reconciliation and consumer fan-out are in scope. Existing transaction/generation guards cover both data sources; tests verify failure and complement branches. No paid provider-backed screen or production write was used. Remaining unknowns are operational live checks and hosted dry-run, not an assumption that source checksum includes retained rows.

## Initial Fable review — verbatim

**Verdict: READY FOR OWNER REVIEW**, with one P2 finding and no P0/P1. The retention delta does what the owner decision specifies, and the trace from frozen JSON to stage, atomic corpus+metadata, reader, whole-run fence, saved results, and both UIs plus the three standalone exports holds. The IntegrityTab has no export path of its own, so the "both screens plus PDF/Markdown/JSON" claim is accurate as written.

**What I verified in the delta**

- Raw CSV checksum is untouched by retention. Retained rows are inserted after COPY at `lib/services/retraction-refresh-service.js:157-166`, while `source_checksum` and `source_row_count` come only from `prepareCsv`. The stage count fence at line 168 and the DB check `row_count = source_row_count + jsonb_array_length(retained_records)` in migration 092 line 19 bind the counts.
- Upstream presence wins at lines 160-161, and a shrunken manifest forces a new generation through `sameRetention` at line 175. The integration test covers reappearance, revised manifest with unchanged bytes, and the unchanged no-op.
- Monthly repeat: same bytes plus same manifest takes the unchanged path, which still refuses any inserted/changed/removed drift (line 187) before touching only `last_checked_at`.
- Partial failure: the allowlist check, retained inserts, merge, delete and metadata upsert all sit inside the single advisory-locked transaction; the rollback test confirms no rows or metadata leak.
- Reader fails closed on malformed manifests and incoherent counts (`retraction-dataset.js:15-19`), and the engine attaches `retentionProvenance` only after the whole-run fence confirms a coherent recorded generation (`integrity-service.js:241-245`), before `saveScreening`. The standalone page renders only the post-fence `complete` payload (`pages/integrity-screener.js:407`).
- Policy comes only from the bundled JSON; the cron route passes no dependencies. The hardcoded ID allowlist plus provenance cross-check at line 159 rejects any other ID.
- Fresh install: `scripts/setup-database.js` already uses TEXT widths, and both reader and refresh fail closed if 092 is absent.

**P2: retained rows freeze a derived column that upstream rows re-derive every refresh**

Evidence: line 162 inserts all 14 fields from the frozen JSON, including `authors_normalized`, whereas every upstream row has that column computed by `IntegrityMatchingService.normalizeName` at line 94. The `recordSha256` at line 163 hashes the frozen values, so a normalizer change leaves the manifest, generation, and the two retained rows unchanged. The drift guard at lines 182-187 only catches derivation changes for upstream rows. Today the frozen arrays equal the current derivation for all eleven author strings, so no live retrieval loss exists. After any future normalizer change, the GIN lookup `authors_normalized @> ARRAY[term]` would miss exactly the two records the policy exists to keep, with only the LIKE fallback remaining.

Fix: derive `authors_normalized` from `data.authors` at stage time with the same normalizer `prepareCsv` uses, and compute `recordSha256` over the derived values so a derivation change publishes a new generation, matching the upstream semantics. Keep the other 13 fields frozen.

Disconfirming test: in the PG suite, spy `normalizeName` to a variant that keeps hyphens, publish with the real JSON, and assert the stored `authors_normalized` for 67801 contains "al-maqtari" and the generation bumped. Under current code this fails because the row stays "almaqtari" and the manifest is unchanged.

**Residual live release gates (not findings)**

- Migration 092 changed body under the same filename. `apply-migrations.js` skips by tracker name, so any non-production database that applied the earlier shape will lack `source_row_count` and `retained_records`. Refresh and reader fail closed there. Recheck pending status at execution and reconcile any such environment.
- The first production dry-run re-downloads the CSV. The rehearsal script's hardcoded expectations at `scripts/rehearse-retraction-retention.cjs:34` are bound to the 73,519-row snapshot and will fail on a different download even when behavior is correct. Review the actual dry-run manifest, especially `retainedCount` and the removal list.
- Controller-reported full focused suite, build and gates were still in progress. Their completion is a gate.
- Hosted pooler COPY/TEMP/advisory-lock time budget, backup freshness at execution, and Neon PITR execution carry forward unchanged from the preflight.
- Flag and cron remain unset until a verified first publication.

Controller disposition: accepted the sole P2. Stage-time author normalization now uses exactly the upstream pipeline before hashing the effective retained payload, so future normalizer changes alter the manifest and publish a new generation. The other thirteen fields remain frozen. A real database regression changes only the retained Al-Maqtari normalization and checks stored index and generation 2. The original source arrays match current derivation, so this correction leaves the measured first-refresh manifest unchanged. Reviewer fresh-install wording is interpreted precisely: absent metadata table remains explicit unrecorded legacy provenance, while a partially provisioned/old-shape metadata table fails unverified; refresh itself refuses absent schema. No new production claim follows from the review.

## Bounded Fable closure — verbatim

CLI receipt: success, model claude-fable-5-1, 20 turns, no permission denials; same host OAuth-only Read/Grep/Glob mechanism.

**Verdict: READY FOR OWNER REVIEW.** The P2 is closed.

**Why the P2 is closed**

- `lib/services/retraction-refresh-service.js:162-163` re-derives only `authors_normalized` through the same list, normalizeName, filter chain used for upstream rows at line 94. The only difference is array transport, since COPY uses a literal and INSERT uses a parameter. The other 13 fields still come straight from the frozen JSON.
- The payload hash at line 164 is computed over the derived values, so a normalizer change now alters the manifest. The manifest comparison at line 176 then forces the published branch, and the metadata upsert at lines 199-203 bumps the generation.
- The new real-PG test at `tests/integration/retraction-refresh.pg.test.js:70-77` is a genuine disconfirming test. Under the old frozen code the manifest would be identical, status would be unchanged, and generation would stay at 1. The spy patches the same module object the service calls through, and the fixture upstream author contains no matching substring, so only the retained row is affected.
- Both prescribed refinements are present: explicit retentionChanged in the outcome at line 184 for dry-run and publish, and the "upstream" word on the displayed checksum at `shared/utils/integrity-evidence.js:53`. Guide and atlas docs already describe the re-derivation.

**One known interaction to disclose, not a blocking defect**

The derived-corpus refusal at line 188 runs only in the unchanged branch. A future normalizer change that touches any retained author string now changes the manifest, routes to the published branch, and skips that refusal, so the whole re-derived upstream corpus publishes without the guard. This is inherent in the prescribed fix and the guard was always narrow, since it never fired when CSV bytes differed. The guide at line 11 still calls this a "changed curated manifest", which is now slightly inaccurate because the manifest can change with no JSON edit. If the owner wants the guard back, the published branch could apply the same refusal when the source is unchanged and changed rows exceed the retained count. That is the owner's call.

**Non-blocking notes**

- The retained-records JSON still carries `authors_normalized` arrays that are no longer read. Dead data, could confuse a later reviewer.
- No unit or e2e test pins the "(upstream" checksum label. Display-only text.

**Carried forward, not verifiable read-only**

Completion of the 15th real-PG test and the final build remain controller-reported gates. All earlier residual live release gates from the prior review stand unchanged. No production write or activation occurred.

Controller disposition: no remaining blocking finding. The unchanged/drift guard is deliberately scoped to identical upstream bytes AND identical retained manifest. A changed manifest can result from approved snapshot/provenance edits or re-derived author-index values and causes the full staged corpus to publish; inspect the actual dry-run diff. No stronger guard is claimed. Frozen JSON index arrays remain historical backup values only; stage-time indexes are always re-derived. The checksum wording is pinned by the label test.

Final controller checks: 254 focused tests / 14 suites; 15 isolated real-Postgres tests; actual restored-backup default-policy dry-run/publication/unchanged rehearsal; canonical Next build; isolated mocked Chromium provenance flow; scoped lint with zero errors; relevant staged-source gates/self-tests and type check passed before final receipt reconciliation. Production migration/promotion/worker invocation remains unexecuted. These are controller execution facts, not reviewer test executions.
