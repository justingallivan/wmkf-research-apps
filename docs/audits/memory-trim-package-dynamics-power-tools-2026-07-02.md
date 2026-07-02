# Memory Trim Package - Dynamics / Power Tools - 2026-07-02

Status: draft trim package. This document intentionally makes no `.claude-memory` edits.

Use this package after the active Claude worktree is merged, abandoned, or explicitly coordinated. As of this draft, Claude's nested worktree was still active at `.claude/worktrees/session-314`, so the memory files below should not be edited from the main checkout.

## Scope

This package covers two oversized active memories:

- `.claude-memory/project-dataverse-power-tools.md`
- `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`

The goal is to keep each active memory as a small routing and guardrail note, while demoting chronological build diaries, probe logs, and dated status ledgers out of the active recall path.

## Application Rules

When applying this package:

1. Verify no other agent is actively editing `.claude-memory`.
2. Read the current memory file before replacing text.
3. Keep only source-backed routing, current invariants, and "do not repeat this mistake" warnings in active memory.
4. Do not retain dated counts, old probe results, session histories, or phase ledgers as active truth.
5. Point to source, Atlas, docs, tests, and audits for details instead of restating them.
6. Update `last_verified` only after verifying the cited source files still support the compact memory.
7. Run the gates listed in this document before committing the memory edits.

## Proposed Trim: Dataverse Power Tools

Target: `.claude-memory/project-dataverse-power-tools.md`

Recommendation: keep active, but replace the oversized build diary with a compact routing note.

Suggested active content shape:

```markdown
---
status: active
last_verified: YYYY-MM-DD against source/docs, not live Dataverse unless stated
---

# Dataverse Power Tools

Recall Rule: Read this when working on Dataverse Power Tools, Dataverse bulk export, Track B QuerySpec/FetchXML export, Track A write-tool planning, Dataverse era classification, or per-program completeness. This memory is an orientation guardrail; source, Atlas, docs, and probes are authoritative.

## Do

- Read `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`, `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`, and `docs/guides/DATAVERSE_BULK_EXPORT.md` before changing Power Tools behavior.
- Treat Track B Phase 1/2 as implemented in source: `lib/services/dataverse-export/`, `pages/api/dataverse-export/`, and `pages/dataverse-bulk-export.js`. Verify current source before claiming runtime status.
- Use QuerySpec and deterministic compile paths for export planning. Preview/run counts must use FetchXML aggregate or `RetrieveTotalRecordCount`, not OData `$count`.
- Time-slice business history on business dates such as `akoya_decisiondate`; do not use `createdon` as a proxy for grant era.
- Treat Dataverse taxonomy, program completeness, migrated/native classification, and status maps as live-data questions. Re-probe or cite current docs before making operational claims.
- Keep Track A write-tool work separate from Track B export work unless the current source/docs explicitly connect them.

## Do Not

- Do not trust this memory for current Dataverse counts, per-program stats, status maps, era cutovers, or field completeness.
- Do not export migrated-100% amount fields as real values without source/probe confirmation.
- Do not paste chronological build ledgers, old session histories, or one-off probe results back into active memory.

## Ground Truth

- `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`
- `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`
- `docs/guides/DATAVERSE_BULK_EXPORT.md`
- `lib/services/dataverse-export/`
- `pages/api/dataverse-export/`
- `pages/dataverse-bulk-export.js`
- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/agent-wiki/topics/dataverse-dynamics.md`
- `.claude-memory/dataverse-export-floor-scoping.md` for floor-scoping and deferred AI semantics
```

Demote from active memory:

- The long chronological build diary currently carrying Track B phase-by-phase history.
- Old live probe results, old table counts, old status taxonomies, and old field-completeness snapshots.
- Session or commit narrative that is useful only as history.

Retain only if rewritten as a current guardrail:

- OData `$count` is unsafe for these export counts.
- `createdon` is not a business-era date.
- Migrated/native is creation provenance, not a value-quality guarantee.
- Program-level segmentation is required for process-dependent interpretation.

## Proposed Trim: Dynamics Explorer Reuse / Power Tools

Target: `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`

Recommendation: keep active, but narrow to "extend existing Explorer/Power Tools infrastructure; do not rebuild it."

Suggested active content shape:

```markdown
---
status: active
last_verified: YYYY-MM-DD against source/docs, not live Dataverse unless stated
---

# Dynamics Explorer Reuse / Power Tools

Recall Rule: Read this when changing Dynamics Explorer schema discovery, OData validation, counts, taxonomy, table routing, tool serialization, or when considering reuse of Dataverse Power Tools assets. This memory is a guardrail; source, tests, docs, and probes are authoritative.

## Do

- Treat the Path A Explorer reliability work as implemented in source and extend it rather than rebuilding parallel behavior.
- Verify current behavior in `lib/services/dynamics-explorer-taxonomy.js`, `lib/services/dynamics-odata-validator.js`, `lib/services/dynamics-service.js`, `pages/api/dynamics-explorer/chat.js`, and the related tests before making claims.
- Reuse Power Tools assets where they fit, especially taxonomy/constants and FetchXML export helpers. Confirm the caller has the same query shape before reusing a helper.
- Preserve restriction guards at the Explorer injection boundary because lower-level taxonomy and FetchXML helpers can bypass `checkRestriction`.
- Keep operational log tables such as `wmkf_ai_run` out of Explorer user-facing schema/query paths unless the source/docs deliberately change that policy.
- Treat real soak as pending unless current traffic/probe evidence says otherwise.

## Do Not

- Do not rederive Explorer schema from hand-transcribed static annotations when live discovery is available.
- Do not reintroduce OData `$count` for large-table counts; use the current count helper shape and verify it in source.
- Do not treat old analysis in this memory as current failure distribution. Re-run the relevant probe or analyze script.
- Do not paste chronological slice history back into active memory.

## Ground Truth

- `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md`
- `docs/DYNAMICS_EXPLORER_ODATA_VALIDATOR_DESIGN.md`
- `pages/api/dynamics-explorer/chat.js`
- `shared/config/prompts/dynamics-explorer.js`
- `lib/services/dynamics-explorer-taxonomy.js`
- `lib/services/dynamics-odata-validator.js`
- `lib/services/dynamics-service.js`
- `tests/integration/dynamics-explorer-tool-serialization.test.js`
- `tests/unit/dynamics-explorer-prompt.test.js`
- `docs/agent-wiki/topics/dataverse-dynamics.md`
```

Demote from active memory:

- Slice A1-A5 chronology except for the compact fact that current source should be extended, not rebuilt.
- Old validator rollout notes, old error-distribution notes, old probe summaries, and old commit/session ledgers.
- Detailed implementation narrative already recoverable from source, tests, and the Path A plan.

Retain only if rewritten as a current guardrail:

- Dynamic schema/taxonomy is preferred over static hand transcription.
- Count helpers must avoid OData `$count` for large tables.
- Restriction enforcement belongs at the user-facing injection boundary.
- Real soak requires current evidence.

## Verification Checklist

After applying memory edits, run these sequentially:

```bash
npm run check:memory-router
npm run check:memory-router:self-test
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
git diff --check
```

If the final memory edits change durable facts outside memory routing, use `/sweep` before claiming completion.

## Residual Questions

- Whether the old chronological bodies should be deleted outright or moved to a closed historical archive depends on the memory cleanup convention chosen for `.claude-memory`.
- Track A write-tool planning may deserve its own small active memory if current source/docs show it is still a near-term build surface.
- The Explorer soak caveat should be removed only after current traffic or probe evidence supports it.
