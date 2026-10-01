---
title: Review-document canonicalization extraction — C3
status: proposed
domain: architecture
kind: plan
summary: Consolidate three identical review-document canonicalizers while preserving manifest bytes, source fingerprints, and all write guards.
canonical: false
owner: product-engineering
---

# Review-document canonicalization extraction — C3

## Decision and scope

[PLANNED] Extract only the three identical private `canonicalize(value)` functions from `lib/services/review-documents/backfill-service.js`, `repair-service.js`, and `individual-file-service.js` into `lib/services/review-documents/canonicalize.js`. Export the same function name; import it directly from each existing caller. Copy the implementation without semantic changes. Keep `digest`, `sha256Json`, crypto imports, projections, manifest builders/validators, and every public export in their current files. No general-purpose serializer, dependency, compatibility wrapper, configurable option, or extra hashing abstraction.

[VERIFIED via git fetch/log and source inspection 2026-10-01] Planning base is main commit `6610aa176074f85817703d48c045d5a147e28883`, after C1, C2 and C4. The isolated planning branch is `codex/c3-review-document-canonicalization-plan`. Its source has no CodeGraph index. The three functions remain identical, at backfill:30, repair:23, and individual-file:85. The survey's C3 recommendation still applies; this document does not claim implementation or production readiness.

[PLANNED] This deliverable is a plan-only Tier 0 change. Runtime implementation is conservatively Tier 2 because hashes bind durable artifacts and authorization to reviewed source state. User approval of this plan does not authorize live repair/backfill, production writes, or merge of runtime changes.

Explicitly excluded: the separate canonicalizer in `reviewer-promotion-repair-classifier.js`; any other similarly named helper; governed DOCX ZIP/XML semantic hashing; upload/render/template behavior; auth, target proof, ETags, cleanup, retry, status vocabulary, schema versions, array ordering, or manifest DTO redesign. No database migration or data rewrite.

[VERIFIED via `lib/utils/canonical-json.js`:17–25] Do not reuse `sortKeysDeep`/`canonicalJson` or use them as the test oracle. That helper constructs objects with property assignment, whereas this domain uses `Object.fromEntries`; an own enumerable `__proto__` key has different behavior. This is a concrete compatibility reason for a domain-local helper, not a request to fix the existing utility.

## Contract and evidence

Change surface: one pure synchronous function shared by three existing services. Entry points are `scripts/backfill-review-docx-sharepoint.mjs`, `scripts/repair-review-docx-sharepoint.mjs`, and `pages/api/cron/file-review-docx.js` → scheduled individual-file filing. Persistence is operator JSON manifests, derived SharePoint files, and the existing Dataverse review-document pointer pair. The helper itself has no I/O. Consumers are manifest validation, fresh-versus-reviewed comparison, and the individual-file source-drift guard. Prior finding being verified: the survey's three identical copies can share one implementation, provided serialized output remains identical.

| Path | Verified source at planning base | Contract to preserve |
|---|---|---|
| Backfill | `backfill-service.js`:30–39, 55–137, 174–269, 271–378 | Discovery → candidate projection/order → population digest and manifest hash → validator → rebuilt reviewed projection → target preflight → per-row ensure/report. |
| Repair | `repair-service.js`:23–32, 62–144, 147–230, 232–300 | Exact one-item plan → relocation/content classification → manifest hash → validator → fresh reviewed comparison → target preflight → ensure/report. |
| Individual filing | `individual-file-service.js`:245–330, 440–463, 574–625, 721–795 | Dataverse suggestion/request/reviewer/answers → sourceState → SHA-256 fingerprint → plan → expected fingerprint comparison before document mutation. |

[VERIFIED via source] Backfill and repair use canonicalization for projection comparison as well as hashing. JSON hashes are lowercase SHA-256 over `JSON.stringify(canonicalize(value))`; no prefix or new encoding is proposed. Individual-file source fingerprints are distinct from `hashGovernedDocxContent` semantic hashes. Preserve both distinct contracts.

[VERIFIED via source] Backfill can retain per-row failures and continue later rows. Repair derives success from existing service statuses. This extraction must not change either success unit, any awaited operation, source re-read, error catch boundary, or response/report field. There is no new client state, async work, schema, enum, or persistence surface; corresponding new-surface/fan-out audits are N/A. Existing persistence/write guards remain in scope for regression tests.

[VERIFIED via source] `preflightReviewDocxWrite` allows scheduled writes only in production and backfill only in a local operator process, requires literal-on write enablement and enforcing interlock, and binds local backfill to production Dataverse. Do not promise a generic Preview or sandbox write rehearsal: current guards do not authorize one.

## Invariants and characterization before extraction

| Invariant | Evidence required before replacement |
|---|---|
| Manifest bytes and hashes unchanged | Fixed-clock complete expected JSON and literal expected SHA-256 values captured from the unmodified public backfill and repair builders. Include populationDigest, manifestHash, candidates, anomalies, summary, target, scope, and observedAt. |
| Old manifests remain consumable | Retained synthetic pre-change JSON manifests captured after the actual CLI serialization round trip (`JSON.stringify(manifest, null, 2)` plus newline, then `JSON.parse`) pass the post-change validators and mocked execution revalidation; both relocation and content repair plus backfill covered. Do not construct the expected manifests with the new helper. |
| Source fingerprint unchanged | Drive real individual-file planning with mocked adapters/Graph dependencies and fixed source data; assert a literal pre-change fingerprint. Put this literal assertion in `individual-review-file-service.test.js`, preserving real fingerprint generation rather than mocking sha256Json or planIndividualReviewFileCandidate. The backfill/repair suites mock that service and cannot prove source fingerprint compatibility. |
| Drift still blocks writes | Present valid reviewed state, then change one bound source/target field; assert existing drift result and no upload, replacement, pointer PATCH, or cleanup call. Include a valid non-drift control that reaches the intended mocked write seam. |
| Canonicalization semantics unchanged | Independent pre-change reference plus explicit expected outputs for the edge vectors below; both helper output shape and JSON/digest parity, including existing error behavior. |
| No unrelated behavior change | Runtime diff limited to copied helper, three imports, and removal of three local declarations. Existing digest wrappers, ordering, guards, projections and public exports unchanged. |

[PLANNED] First add characterization to the existing backfill, repair, and individual-file suites and run on the original source. Keep sanitized deterministic fixtures in tests; never copy production review text, identities, tokens, or local manifests. Save literal expected serialized strings/hashes, not just round trips, regex checks, or expected values computed by the production helper. A builder and validator sharing the same bug can otherwise agree on the wrong hash.

[PLANNED] Include a bare `read_failed` candidate in a backfill fixture, with `selected` and `richTextPresent` absent from the candidate plan (not populated by an eligible-plan fixture factory). Source evidence: individual-file:457 returns a bare failure, backfill:63/65 copies the missing values as undefined, and backfill CLI:118/166 writes then parses JSON. Assert the in-memory projection has undefined-valued own keys, the parsed on-disk form omits them, and the literal manifestHash/populationDigest remain valid after parsing. Recompute the parsed manifest hash using an independent frozen baseline, excluding manifestHash itself, and compare it to the original hash. A blocking read-failure manifest must still validate but reject execution before write preflight; use separate eligible manifests for successful mocked execution. Do not normalize missing fields to null.

[PLANNED] Use a test-only frozen copy of the baseline pure function as a differential oracle for direct vectors. It may be obtained from the pinned source without exporting private functions from production or asserting formatting-sensitive source slices. The reference must remain frozen and clearly labeled; literal expectations and public service fixtures independently protect against copied mistakes. Before implementation, verify all three original function bodies are identical using AST/source comparison.

Required vectors: nested objects with different insertion orders; arrays whose order matters; nested arrays and sparse slots; null, booleans, strings, numbers, negative zero and non-finite numbers; undefined at root/object/array positions; numeric-looking keys (`2`, `10`, `01`); Unicode and composed/decomposed strings without normalization; own enumerable versus inherited/non-enumerable/symbol properties; own `__proto__`/`constructor` keys; Date and other non-plain objects; custom enumerable and non-enumerable `toJSON`; BigInt and cycles as failure cases. Preserve observed behavior rather than improving it. Distinguish canonicalizer output from JSON behavior: for example, Date is traversed as an object before JSON serialization, and root undefined does not produce usable digest input. Characterize error class/stage where stable; do not pin engine-specific stack text. For the integer-like key vector, the observed serialized order of keys `2`, `10`, `01` is `2`, `10`, `01`: JavaScript integer-index enumeration wins over the intermediate lexical sort. No cycle detector, validation, coercion, prototype policy, or Date handling added.

[PLANNED] Prove at least one meaningful test fails if key sorting is removed and another fails if array order is changed. Perform mutations locally, restore source, and record results; do not ship mutation code. Direct helper parity alone is insufficient: all three public consumer paths must be exercised.

## Implementation sequence and ownership

1. Luna verifies branch/base, file ownership, exact function identity, caller inventory, relevant rules and existing test coverage; records remaining uncertainty. No live calls. If source changed since this plan, revalidate the seam before editing.
2. Luna adds and runs the pre-extraction characterization first, then performs the minimal extraction and runs focused validation. Keep tests and runtime extraction as reviewable commits.
3. Sol reviews the complete caller → manifest/fingerprint → validation/write guard contract and the test oracles. Luna addresses substantive findings; orchestrator resolves repeated cosmetic or diminishing-return loops.
4. Orchestrator performs independent diff and contract review. Claude Fable then reviews adversarially using OAuth-authenticated Claude Code only, with API-key variables removed and host execution for Keychain access. No direct model API or metered review-product substitution. Evaluate findings on evidence; rerun changed-surface tests after fixes, then obtain a bounded follow-up verdict. Do not iterate indefinitely on optional style changes.
5. Reconcile directly affected ownership documentation, commit, push, and prepare a runtime PR. No autonomous merge or production exercise under this planning task.

## Validation and documentation

[PLANNED] Baseline and post-extraction suites: `review-docx-backfill-service`, `review-docx-repair-service`, `individual-review-file-service`, `review-docx-backfill-cli`, `review-docx-repair-cli`, `file-review-docx-cron`, and `review-docx-governed-hash`; add a dedicated canonicalization suite and run `document-lifecycle-boundary.test.js`, whose import traversal covers the new leaf and named export. External dependencies remain mocked. CLI tests must prove argument/manifest handling without operator execution against live services.

[PLANNED] Run canonical build, full Jest, lint, type checking, and relevant registered gates: request-document-writers, reviewer-engagement-boundary, dataverse-access-layer, dynamics-context-boundary, route-service-boundary, secret-scan, doc-symbol-refs, build-claim-freshness, docs-catalog, harness-framing. Inspect package.json and CI_GATES_REFERENCE for exact current commands. Run each gate then its self-test sequentially; never overlap fixture-writing gates. Record failures and distinguish pre-existing warnings from new failures. Green ownership gates do not prove hash compatibility.

[PLANNED] Add the new helper's contract header and a narrow service-catalog entry. Use `/sweep` for this ownership fact: search current docs, Atlas, memory, wiki and source references to the three canonicalizers, classify matches, read full target documents before editing, and update only directly affected live ownership claims. The survey is a dated baseline; retain its historical evidence. No schema, route, enum, migration-manifest or Atlas storage-model change is proposed. If reconnaissance finds an actual changed contract, stop the extraction and report it as a separate proposal.

## Release and rollback

[PLANNED] Before runtime merge, meet Tier 2 controls from `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: branch isolation, pre-change characterization, integrated local/preview build in an approved data mode, staff rehearsal, recorded last-known-good production deployment and rollback steps, and explicit owner promotion decision.

For this operator/service seam, rehearse synthetic old-manifest consumption and no-write drift rejection locally with mocked boundaries; record tested SHA and what the rehearsal proves. This is automated evidence, not a substitute for required staff acceptance or live integration. Any additional real write rehearsal needs an explicitly approved compatible target/mode and exact allowlisted records. Do not enable flags, execute repair/backfill, mutate production, or loosen guards just to test a pure extraction. If staff rehearsal or live integration is unavailable, report the outstanding release condition plainly; do not claim full production readiness.

Record production rollback deployment ID before merge. Rollback is reverting the runtime extraction or redeploying the recorded prior good deployment. Because serialized contracts must remain identical, no data migration or manifest regeneration should be required. A hash difference is a failed acceptance test, not a reason to increment schema versions or rewrite artifacts.

## Review status and evidence limits

[VERIFIED via AST-selected source comparison] All three complete canonicalizer declarations are byte-identical. [VERIFIED via focused Jest run 2026-10-01] The seven named baseline suites passed: 82 tests, no snapshots. This is existing coverage, not the proposed hash-parity characterization. Current CLI suites cover argument parsing, result paths and backfill exit codes; they do not execute a live operator workflow. [PLANNED] New characterization, implementation, build/CI, staff acceptance and release are not performed by this plan. Live Dataverse/SharePoint state and production deployment are not probed or asserted. Fable round 1 (OAuth, `claude-fable-5-1`, session `3607d78d-c877-4e16-91b4-ca93db1efe66`) requested two changes: real on-disk manifest round-trip coverage for omitted fields, and explicit exclusion of the divergent existing serializer. Both are incorporated above. Fable round 2 returned **APPROVED**, with no substantive remaining findings; the orchestrator agrees. Both rounds used the verified OAuth session, with no API-key authentication and no permission denials. The owner explicitly authorized the review and bounded follow-ups after subscription-credit disclosure. The reviewer had read-only tools and did not run tests; the baseline and AST comparison were independently run by the orchestrator. A local pure-function probe also reproduced the `__proto__` divergence and integer-key ordering.

[VERIFIED via sequential local checks] Plan validation passed doc-symbol-refs and self-test, build-claim-freshness and self-test, docs-catalog, harness-framing and self-test, and secret-scan and self-test. These gates have bounded scan scopes and do not prove every citation or proposed runtime behavior; source inspection and review supplement them. Plan approved for implementation planning; no runtime implementation, deployment, or release approval is implied.
