---
name: Dataverse Power Tools - scoped Dataverse edit/export guardrail
description: Compact routing note for Dataverse Power Tools Track A field-edit planning and Track B bulk filtered export.
type: project
originSessionId: S156
status: active
scope: dataverse
last_verified: 2026-07-02 against repository source/docs, not live Dataverse
---

# Dataverse Power Tools

## Recall Rule

Read this when working on Dataverse Power Tools, Dataverse bulk export, Track B QuerySpec/FetchXML export, Track A write-tool planning, Dataverse era classification, or per-program completeness. This memory is an orientation guardrail; source, Atlas, docs, tests, and fresh probes are authoritative.

## Do

- Read `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`, `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`, and `docs/guides/DATAVERSE_BULK_EXPORT.md` before changing Power Tools behavior.
- Treat Track B Phase 1/2 as implemented in source: `lib/services/dataverse-export/`, `pages/api/dataverse-export/`, and `pages/dataverse-bulk-export.js`. Verify current source before claiming runtime status.
- Use QuerySpec and deterministic compile paths for export planning. Preview/run counts must use FetchXML aggregate or `RetrieveTotalRecordCount`, not OData `$count`.
- Time-slice business history on business dates such as `akoya_decisiondate`; do not use `createdon` as a proxy for grant era.
- Treat Dataverse taxonomy, program completeness, migrated/native classification, status maps, and exact counts as live-data questions. Re-probe or cite current docs/source before making operational claims.
- Keep Track A write-tool work separate from Track B export work unless current source/docs explicitly connect them.
- For Phase 3 and AI on-ramp semantics, read `.claude-memory/dataverse-export-floor-scoping.md`; do not infer them from this compact note.

## Do Not

- Do not trust this memory for current Dataverse counts, per-program stats, status maps, era cutovers, or field completeness.
- Do not export migrated-100% amount fields as real values without source/probe confirmation.
- Do not paste chronological build ledgers, old session histories, dated probe snapshots, or one-off table counts back into active memory.

## Current Source-Backed Guardrails

- [VERIFIED via repo source 2026-07-02] Track B export code exists under `lib/services/dataverse-export/` and the route surface exists under `pages/api/dataverse-export/`.
- [VERIFIED via repo source 2026-07-02] Preview/run use FetchXML aggregate counts and a preview-minted `resultToken`; run writes to the private `DVX_BLOB_RW_TOKEN` Blob store and download is an authenticated proxy.
- [VERIFIED via repo source 2026-07-02] `compiler.js` rejects `createdon` as a business-history `dateBasis` field and requires `akoya_decisiondate`.
- [VERIFIED via repo docs/source 2026-07-02] Migrated/native is creation provenance, not a value-quality or business-era guarantee; program-level segmentation is required for process-dependent interpretation.

## Ground Truth

- `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`
- `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`
- `docs/guides/DATAVERSE_BULK_EXPORT.md`
- `lib/services/dataverse-export/`
- `pages/api/dataverse-export/`
- `pages/dataverse-bulk-export.js`
- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/agent-wiki/topics/dataverse-dynamics.md`
- `.claude-memory/dataverse-export-floor-scoping.md`

## History

The long Track B build diary and old probe ledger were intentionally demoted out of active recall on 2026-07-02 per `docs/audits/memory-trim-package-dynamics-power-tools-2026-07-02.md`. Recover historical narrative from git/audit docs; keep this file small.
