---
title: Shared email placeholder extraction
status: implemented
domain: architecture
kind: plan
summary: Four email modules now share the unchanged pure replacement operation. Sol, orchestrator and Fable approved; local validation passed. Promotion remains owner-gated.
canonical: false
owner: product-engineering
---

# Shared email placeholder extraction

## Implementation record

[VERIFIED via commits/tests] Tests-first commits `62ee517ba` and `79a086b7f` characterize the public callers. Extraction commit `0d04ea007` adds the dependency-free helper, direct tests and catalog entry. Luna reports nine focused suites / 80 tests passing. Removing the sort failed the shorter-key-first overlap test; the mutation was restored and the suite passed again. Baseline plain-Node import/render passed on Node v26.6.0, with only the existing typeless-package warning.

[VERIFIED via independent source comparison] The orchestrator compared Babel-generated ASTs against `31c3ace4a`: each extracted function body is unchanged, and each remaining module is unchanged after excluding its removed local declaration and added helper import. Comments are excluded from that comparison. This proves the mechanical source change, not live email delivery.

[VERIFIED reviews] Sol approved `0d04ea007` without substantive findings. After the orchestrator's independent review, Fable approved the implementation through host OAuth session `4725549f-e8d6-4319-b47b-a8ccfe54a3cb`, with no required changes. Both Claude reviews used the requested Fable model through subscription authentication with API-key/provider overrides removed, read-only tools and no substitute review product. Optional documentation notes were addressed: source verification date refreshed and the exercised Node runtime recorded. The plain-Node test uses the installed runtime and tolerates typeless-package warnings; CI's Node 20 job independently exercises that import path. No package-wide module-type or runtime-version change is included.

[VERIFIED local validation] Full Jest passed **1,191 suites / 18,800 tests / 5 snapshots**, with 6 suites / 98 tests skipped. Canonical `npm run build`, `npm run check:types`, and lint passed (0 errors / 123 existing warnings, none in changed files). Build retained two dynamic-filesystem tracing warnings and the Node experimental localStorage warning. All eight scoped gates and their available self-tests passed sequentially: reviewer-reminder-hold, dataverse-access-layer, reviewer-engagement-boundary, doc-symbol-refs, build-claim-freshness, docs-catalog, secret-scan, and harness-framing. The PR's CI result is separate from these local results; no live delivery, token minting, database or provider test was performed.

[VERIFIED bounded `/sweep`, Mode A] Changed fact: four server modules use `lib/utils/email-placeholders.js` while retaining their token dictionaries. Source and caller comparison establish the fact; persistence is N/A. Exact symbol/ownership searches across docs, memory, wiki and session found four durable surfaces: this plan, the service catalog and token-syntax memory are AGREE after the structural updates; the original survey's extra-candidate row is HISTORICAL under its explicit baseline boundary. Its separate reassessment PR #390 remains dated to `31c3ace4a`. In-scope source headers and the raw-Node comment match the implementation. Tests and final diff disconfirm any change to caller dictionaries or the helper algorithm. No remaining live stale ownership claim was found in this bounded domain; other email policy, stored defaults and live operational state were excluded. The old preview-script copies remain deliberately separate.

[VERIFIED overlap recheck] Main advanced to `b763e3d8f` during this build through two Factory-plan documentation commits only; none overlaps this change. Open PR #332 still has no overlap with the five runtime files. Its service-catalog overlap is separate and should be rechecked at merge time.

[PROMOTION PENDING] Code reviews and local validation are complete. No merge or production deployment has occurred. Owner acceptance of the bounded Mode A rehearsal, a named last-known-good production deployment and explicit merge authorization remain outstanding under the release boundary below.

## Approved plan (historical design)

The following records the approved pre-implementation design. Planned labels describe that decision point; the implementation record above determines current progress. The release boundary remains active until the owner fulfills it.

## Scope and evidence

[VERIFIED via fetched main and source] Baseline `31c3ace4a1c4e27090f296d7d41940c7d6cdfd7a`; isolated branch `codex/email-placeholder-helper`. The four local functions have identical bodies: `lib/external/reviewer-reminder-email.js:41`, `lib/external/reviewer-withdraw-email.js:18`, `lib/external/grantee-invite-email.js:75`, and `lib/services/reviewer-acceptance-email.js:34` (named `applyTemplatePlaceholders` there). They convert the template with `String(template || '')`, sort `Object.entries(replacements)` by descending key length, then sequentially use `split(key).join(String(value ?? ''))`.

[VERIFIED via caller search] Nine substitution calls are in scope: reminder respond/due/thank-you bodies and thank-you subject; withdrawal body; grantee reminder and draft bodies; acceptance subject and body. The grantee module is also imported by plain-Node scripts, including `scripts/probe-grantee-reminder-state.mjs`. `scripts/preview-emails.mjs` contains separate inlined copies: those are excluded from this four-module extraction. This is not a claim of repository-wide deduplication.

[VERIFIED via GitHub PR file list, 2026-10-01] Open PR #332 touches reminder callers, notice code and the service catalog, but none of these four runtime modules. Recheck before final handoff; resolve catalog overlap locally if necessary without changing that PR's runtime work. PR #390 separately refreshes the original survey at this baseline; this branch does not depend on it.

## Planned implementation and invariants

[PLANNED] Add `lib/utils/email-placeholders.js`, a dependency-free ESM module exporting `applyPlaceholders(template, replacements)`. Copy the existing function body unchanged. Replace the four local declarations with explicit relative `.js` imports; use an import alias `applyPlaceholders as applyTemplatePlaceholders` in acceptance so its call sites remain unchanged. Add an authoritative source header and one service/utility catalog entry. Correct the grantee surname comment's already-stale “import-free” wording only as needed to explain plain-Node compatibility.

| Invariant | Surface | Verification |
|---|---|---|
| Template coercion remains `String(template || '')`; nullish values become empty, false/zero values remain strings | Shared helper | Explicit expected-output cases for nullish/falsy template and replacement inputs |
| Longer keys run first; equal-length keys retain entry order; replacement chaining remains sequential | Shared helper and grantee overlapping deadline tokens | Overlap and equal-length chaining cases with distinguishable expected outputs |
| Replacement text is literal, including dollar syntax; unknown tokens remain untouched | Shared helper and rendered emails | Dollar, punctuation, repeated token and unknown-token cases |
| Existing behavior for empty keys and absent replacement maps is unchanged | Shared helper | Pin current split/join behavior and existing Object.entries errors; no new validation/defaults |
| All token dictionaries, defaults, signatures, dates, escaping, notices, link policies, subjects and public exports remain unchanged | Four callers | Public-builder/render characterization before extraction, existing email suites, and final mechanical diff review |
| Plain Node resolves the new helper through the grantee module | Helper/grantee import | Isolated child-process import/render test using explicit `.js`, no transpiler or live service imports |
| No new reads, writes, sends, configuration, async work or provider calls | All changed runtime code | Dependency-free helper and bounded final source review |

[PLANNED] No regex replacement, recursive expansion, token validation, new escaping, fallback behavior, generic template engine, send/scheduler refactor, or migration of other copies. Unexpected inputs retain existing behavior, including throws; this is not a hardening change.

## Build and verification sequence

1. Luna reads the approved plan, adds public-renderer characterization tests that run against the existing implementation, and commits that passing baseline before changing runtime code. Reuse existing mocked dependencies; never send an email or query live storage. Cover each of the four modules: body-only legacy automation-marker stripping; raw reminder/withdraw subjects versus the thank-you two-token subject map and acceptance full subject map; acceptance withdrawal-token versus appended-paragraph paths; and blank draft signatures versus populated grantee reminder signatures. Include HTML/link behavior rather than testing only a private helper. Before extraction, run a bare-Node grantee import/render pre-check and record runtime/result. If it already fails, report the pre-existing limitation and compare resolution to that baseline; do not change package module type or restructure imports.
2. Luna extracts the unchanged body, adds direct helper tests for the invariant matrix, and runs the focused suite again. The direct helper overlap fixture must insert the shorter key first (for example `{ a: "short", ab: "long" }` with template `ab a`); the equal-length chaining fixture must insert `a` before `b` and map `a` to `b`, then `b` to `done`. Include the plain-Node grantee import/render test with exit-status and absence-of-`ERR_MODULE_NOT_FOUND` assertions, not empty stderr; typeless-package warnings are allowed. Import only grantee and the zero-import helper there, not the other three modules. Verify dropping the sort makes the direct helper overlap test fail (the existing public maps would not detect that mutation); restore and rerun.
3. Run the full Jest suite once, `npm run build` (canonical Turbopack; host retry only if the documented sandbox worker-port failure occurs), `npm run check:types`, and lint. Relevant gates and available self-tests run sequentially: reviewer-reminder-hold, dataverse-access-layer, reviewer-engagement-boundary, doc-symbol-refs, build-claim-freshness, docs-catalog, secret-scan and harness-framing. Report pre-existing warnings separately; relevant failures block completion. CI supplies the independent build/integration result; no interactive preview rehearsal is planned and CI does not replace owner acceptance of the bounded Mode A rehearsal.
4. Sol reviews Luna's implementation and evidence read-only. Luna fixes substantive findings and reruns affected checks. The orchestrator then reviews the final diff and evidence independently.
5. Fable conducts an adversarial implementation review through the existing host OAuth subscription only, with API-key/provider overrides removed. No Ultrareview or substitute product. Resolve substantive findings with Luna/Sol; cap ordinary follow-up at two rounds and have the orchestrator take over incremental cleanup rather than expand scope.
6. Reconcile the implementation record and in-scope helper ownership documentation using a bounded `/sweep`, commit and push a reviewed PR. Do not merge or deploy in this task.

## Contract reconciliation

[VERIFIED source; PLANNED extraction] Entry points are existing email builders/renderers used by reminder, thank-you, withdrawal and acceptance services, plus grantee reminder draft/scheduled-email callers. Their template and replacement dictionaries enter the pure operation; returned strings then enter the existing renderer or subject output. Persistence in the helper is **none**. Existing downstream send/token/ledger boundaries stay in their original callers; no route, payload, auth, database or response shape changes. Partial-success, async/stale-state, schema/status fan-out and migration audits are N/A for the new synchronous helper. Helper semantics and caller-specific differences are the relevant audits; tests must distinguish failures rather than mirror the implementation.

[PLANNED bounded sweep] Changed fact: four modules share one replacement operation. Inspect source headers, service catalog, `.claude-memory/project-email-template-token-syntax.md`, survey/plan references and named-symbol restatements across docs, memory, wiki, source and tests. Preserve explicitly dated survey findings as baseline evidence. Reconcile live ownership statements without broad email documentation cleanup. No external deployment, provider or stored-template facts will be inferred from mocked tests.

## Release boundary

[PLANNED] Conservatively treat the change as Tier 2 because it serves external email flows. Mode A characterization/import/render tests provide isolated rehearsal evidence for this mechanical seam; they do not prove live delivery or constitute staff/naive-user rehearsal. Before promotion, the owner must explicitly accept this bounded rehearsal as sufficient for the unchanged flows or request further rehearsal, name the last-known-good production deployment, and authorize merge. Final reporting must keep these open requirements distinct from code-review readiness. No live sends, token minting, Dataverse changes, deployment or environment edits are authorized. Revert the extraction commit (or eventual PR merge) to restore the former implementation; this change creates no data requiring rollback, and reverting code cannot undo emails already sent by normal operation.

## Review status

[VERIFIED review] Fable reviewed through host OAuth session `8e62b38b-42ae-4786-8999-1e280571cc0e` and returned READY TO IMPLEMENT with two named test-design requirements: reverse insertion order for the overlap fixture, and perform a baseline plain-Node check with warning-tolerant assertions. Both requirements are incorporated above. The orchestrator agrees; implementation is authorized within this plan. No production-readiness approval is implied. Existing baseline: seven focused email suites passed 64 tests before implementation.
