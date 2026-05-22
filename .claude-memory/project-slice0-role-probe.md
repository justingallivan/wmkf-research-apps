---
name: Slice-0 wmkf_role pre-deploy probe — correct tool + 2026-05-15 CLEAR result
description: Which script actually verifies wmkf_apprequestperson.wmkf_role before intake schema slice 0 (NOT the carryover-named dynamics-schema-diff.js), why, and the point-in-time CLEAR result
type: project
originSessionId: S155
---
Intake-portal schema slice 0 extends `wmkf_apprequestperson.wmkf_role` from 2 → 5 option values (adds `100000002`/`100000003`/`100000004` = Senior Personnel / Key Personnel / Other). Blocking pre-deploy check: confirm no live row data already occupies those numeric slots — Dataverse retains orphaned numeric values on rows after an option is deleted, so a metadata-definition probe alone is insufficient.

**Use:** `node scripts/probe-apprequestperson-role-data.js` (written S155, 2026-05-15). Does both halves — option-set *definition* probe + live *row-data* distribution + a precise filtered count on `100000002`–`100000004`. Exit `0`=CLEAR, `3`=BLOCK, `1`=ERROR (read-only; two OData GETs). Definition-only half alone: `scripts/probe-picklist.js wmkf_apprequestperson.wmkf_role`.

**Do NOT use `scripts/dynamics-schema-diff.js`** for this. Carryover (SESSION_PROMPT item B + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:110`) named it for ~5 sessions, but it is a Dynamics-Explorer annotation-coverage diff: only diffs tables in `TABLE_ANNOTATIONS` (does NOT include `wmkf_apprequestperson` → errors "Unknown table"), and never inspects row data. See `project_dynamics_explorer_schema_diff.md` for what that tool is correctly for.

**Result 2026-05-15 (S155): CLEAR.** Definition = exactly 2 values (PI=`100000000`, Co-PI=`100000001`). Live distribution = 4,488 PI + 1,073 Co-PI = 5,561 rows; zero in `100000002`–`100000004`. Slice 0's enum extension is non-breaking on this axis.

**Why:** Codex S150 flagged this as the only unverifiable slice-0 claim; the carryover then propagated the wrong tool name across handoffs without anyone running it — a stale-belief class the S154 audit was about.

**How to apply:** The CLEAR result is point-in-time, not durable. **Re-run the probe at deploy time (target 2026-05-19)** — a non-zero exit blocks slice 0. Originating doc corrected S155 (item struck through, verified result inline). Related: `feedback_human_legibility_schema_principle.md` (why the enum expands instead of a new entity).
