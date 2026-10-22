---
name: Dynamics Explorer schema discovery and curated annotations
description: Distinguish live Dataverse field discovery from hand-curated field descriptions in Dynamics Explorer
type: project
originSessionId: 176c13fa-41ec-4cad-a5ac-c3ad9b64cdac
status: active
scope: dynamics
last_verified: 2026-10-22
---

**Verification scope:** source and repository history were checked on 2026-10-22. No live Dataverse metadata probe was run; current tenant schema remains unverified here.

## Recall Rule

Read this when: a user reports Dynamics Explorer "doesn't know about field X," or you need to find Dataverse fields missing from Explorer's `TABLE_ANNOTATIONS`.

Do:
- For a field the model cannot find, call Dynamics Explorer `describe_table` for the table. The tool returns curated annotations plus readable live Dataverse attributes; use `full: true` for the complete additional-live-field list (`lib/services/dynamics-explorer/tools/describe-table.js:24-34,52-79,120-136`).
- Treat `TABLE_ANNOTATIONS` as curated descriptions and rules, not an exhaustive schema registry. The runtime adds live attributes not already curated; a field can therefore be discoverable without having a hand-written semantic description (`shared/config/prompts/dynamics-explorer.js:22-25`).
- When preparing a code-side curation pass, `scripts/dynamics-schema-diff.js [table ...]` remains useful to enumerate definition metadata against annotation keys, independent of record population. Review likely custom `wmkf_*`/`akoya_*` candidates and curate descriptions by hand.

Do not:
- Assume a newly discovered live attribute already has a curated description, or that a curated field list proves the live tenant schema is complete.
- Use `scripts/dynamics-schema-map.js` to enumerate all schema gaps. It is sample/population based and answers what appears in sampled data, not what the table defines.

Ground truth: runtime discovery is `lib/services/dynamics-explorer/tools/describe-table.js`; curated semantics are in `shared/config/prompts/dynamics-explorer.js`; offline code-side comparison is `scripts/dynamics-schema-diff.js` (its JSON output is gitignored). Re-query live metadata when a tenant-specific claim matters.

When fields are added to Dataverse, `TABLE_ANNOTATIONS` does not update automatically. However, the runtime `describe_table` tool fetches live readable attributes and can expose additional fields; hand-curated descriptions and live discoverability are separate contracts. The system prompt also directs the model to discover missing fields with the tool (`shared/config/prompts/dynamics-explorer.js:579-580`).

**Use:** `scripts/dynamics-schema-diff.js` (added 2026-05-05, commit `25d91e4`).
- Definition-based: queries `EntityDefinitions(LogicalName='X')/Attributes` for full attribute metadata, regardless of population.
- Diffs against keys in `TABLE_ANNOTATIONS` (handles `_xxx_value` lookup-OData form and `..N` range expansions).
- Filters out `*_base` currency shadows, `AttributeOf` subordinates, infrastructure noise, and TRASH/DEPRECATED-labeled fields.
- Output: console report grouped by attribute type + structured `scripts/dynamics-schema-diff.json` (gitignored).
- Run: `node scripts/dynamics-schema-diff.js [tableName ...]`. No args = all annotated tables.

**Different question:** `scripts/dynamics-schema-map.js` samples records to show fields observed in use; it is not a definition-based completeness check. Its population thresholds can omit sparse fields.

**Historical example:** On 2026-05-05, `wmkf_ai_summary` was missing from inline annotations and sample mapping did not surface the sparsely populated field. It was later curated into `TABLE_ANNOTATIONS`. This records why the definition-based diff was added; it does not mean the current runtime can only see annotated fields.

**How to apply:** For an interactive missing-field question, use `describe_table` and request `full: true` if the sample is incomplete. For a repository curation task, compare definitions with annotations using the diff script, then select meaningful fields and write descriptions deliberately. The old 1,200+ count was a dated raw count across six tables; much of it was system metadata or unused platform fields, so do not treat it as a current backlog.
