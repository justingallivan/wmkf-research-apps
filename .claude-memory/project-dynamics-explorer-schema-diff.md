---
name: Dynamics Explorer schema discovery — prefer the diff tool
description: How to find Dataverse fields missing from Dynamics Explorer's inline annotations; which script to use and which to avoid for that purpose
type: project
originSessionId: 176c13fa-41ec-4cad-a5ac-c3ad9b64cdac
---
When fields are added to Dataverse, Dynamics Explorer's `TABLE_ANNOTATIONS` (`shared/config/prompts/dynamics-explorer.js`) does NOT update automatically. The model only "knows" about hand-curated fields. Use the right tool to find the gap.

**Use:** `scripts/dynamics-schema-diff.js` (added 2026-05-05, commit `25d91e4`).
- Definition-based: queries `EntityDefinitions(LogicalName='X')/Attributes` for full attribute metadata, regardless of population.
- Diffs against keys in `TABLE_ANNOTATIONS` (handles `_xxx_value` lookup-OData form and `..N` range expansions).
- Filters out `*_base` currency shadows, `AttributeOf` subordinates, infrastructure noise, and TRASH/DEPRECATED-labeled fields.
- Output: console report grouped by attribute type + structured `scripts/dynamics-schema-diff.json` (gitignored).
- Run: `node scripts/dynamics-schema-diff.js [tableName ...]`. No args = all annotated tables.

**Don't use for gap-finding:** `scripts/dynamics-schema-map.js`.
- Sample-based (25 records). Filters fields populated <20% of samples.
- Sparsely-populated new fields (e.g. `wmkf_ai_summary` rolled out across 2026, used on a small subset of records) get silently dropped.
- Still useful for "what's actually in active use" — different question, different tool.

**Why:** `wmkf_ai_summary` was missing from inline annotations as of 2026-05-05 even though it was added to Dataverse weeks earlier. The sample mapper had been re-run since the field was added but didn't surface it. The diff tool catches this class of miss.

**How to apply:** When the user reports the model "doesn't know about field X" or asks for a schema refresh, run the diff tool first to enumerate the actual gap, then curate descriptions by hand. The 1200+ raw "missing" count across all six annotated tables is misleading — most is Dataverse system boilerplate (`address1_*`, `yomi*`) and unused Akoya-platform fields (scholarship/dedication-notification). Real curation candidates are the custom-only `wmkf_*` and `akoya_*` fields the foundation actually uses.
