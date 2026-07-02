---
name: project-dynamics-explorer-reuse-power-tools
description: Compact guardrail for extending Dynamics Explorer with existing Power Tools taxonomy, validation, and count infrastructure.
metadata:
  type: project
  status: active
  scope: dynamics
  last_verified: 2026-07-02 against repository source/docs, not live Dataverse
---

# Dynamics Explorer Reuse / Power Tools

## Recall Rule

Read this when changing Dynamics Explorer schema discovery, OData validation, counts, taxonomy, table routing, tool serialization, or when considering reuse of Dataverse Power Tools assets. This memory is a guardrail; source, tests, docs, and fresh probes are authoritative.

## Do

- Treat the Path A Explorer reliability work as implemented in source and extend it rather than rebuilding parallel behavior.
- Verify current behavior in `lib/services/dynamics-explorer-taxonomy.js`, `lib/services/dynamics-odata-validator.js`, `lib/services/dynamics-service.js`, `pages/api/dynamics-explorer/chat.js`, and the related tests before making claims.
- Reuse Power Tools assets where they fit, especially taxonomy/constants and FetchXML export helpers. Confirm the caller has the same query shape before reusing a helper.
- Preserve restriction guards at the Explorer injection boundary because lower-level taxonomy and FetchXML helpers can bypass `checkRestriction`.
- Keep operational log tables such as `wmkf_ai_run` out of Explorer user-facing schema/query paths unless source/docs deliberately change that policy.
- Treat real soak as pending unless current traffic/probe evidence says otherwise.

## Do Not

- Do not rederive Explorer schema from hand-transcribed static annotations when live discovery is available.
- Do not reintroduce OData `$count` for large-table counts; verify the current count helper shape in source.
- Do not treat old analysis in this memory as current failure distribution. Re-run the relevant probe or analyze script.
- Do not paste chronological slice history, old validator rollout notes, old error-distribution notes, old probe summaries, or commit/session ledgers back into active memory.

## Current Source-Backed Guardrails

- [VERIFIED via repo source 2026-07-02] `pages/api/dynamics-explorer/chat.js` imports `buildResolvedTaxonomyPromptBlock` and `validateODataCall`, and `count_records` calls `DynamicsService.countRecords`.
- [VERIFIED via repo source 2026-07-02] `DynamicsService.countRecords` uses `$apply=...countdistinct` on the primary key instead of Dataverse `/$count`.
- [VERIFIED via repo source 2026-07-02] `buildResolvedTaxonomyPromptBlock` filters taxonomy sources against active table-level restrictions before injection.
- [VERIFIED via repo source/tests 2026-07-02] Explorer denies direct `wmkf_ai_run` schema access and strips `wmkf_ai_run` Dataverse Search hits before returning tool results.

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

## History

The long Slice A1-A5 chronology was intentionally demoted out of active recall on 2026-07-02 per `docs/audits/memory-trim-package-dynamics-power-tools-2026-07-02.md`. Recover historical narrative from git/audit docs; keep this file small.
