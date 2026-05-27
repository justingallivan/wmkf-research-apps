---
name: Slice-0 wmkf_role probe + extension — VERIFIED 2026-05-22 (all 5 values present)
description: Which script verifies wmkf_apprequestperson.wmkf_role for intake schema slice 0, the post-deploy verified state (extender ran during S178; 0 to insert on S179 re-run), and the live data distribution
type: project
originSessionId: S155
---
Intake-portal schema slice 0 extends `wmkf_apprequestperson.wmkf_role` from 2 → 5 option values (adds `100000002`/`100000003`/`100000004` = Senior Personnel / Key Personnel / Other). Blocking pre-deploy check: confirm no live row data already occupies those numeric slots — Dataverse retains orphaned numeric values on rows after an option is deleted, so a metadata-definition probe alone is insufficient.

**Use:** `node scripts/probe-apprequestperson-role-data.js` (written S155, 2026-05-15). Does both halves — option-set *definition* probe + live *row-data* distribution + a precise filtered count on `100000002`–`100000004`. Exit `0`=CLEAR, `3`=BLOCK, `1`=ERROR (read-only; two OData GETs). Definition-only half alone: `scripts/probe-picklist.js wmkf_apprequestperson.wmkf_role`.

**Do NOT use `scripts/dynamics-schema-diff.js`** for this. Carryover (SESSION_PROMPT item B + `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:110`) named it for ~5 sessions, but it is a Dynamics-Explorer annotation-coverage diff: only diffs tables in `TABLE_ANNOTATIONS` (does NOT include `wmkf_apprequestperson` → errors "Unknown table"), and never inspects row data. See `project-dynamics-explorer-schema-diff.md` for what that tool is correctly for.

**Result 2026-05-15 (S155): CLEAR.** Definition = exactly 2 values (PI=`100000000`, Co-PI=`100000001`). Live distribution = 4,488 PI + 1,073 Co-PI = 5,561 rows; zero in `100000002`–`100000004`. Slice 0's enum extension is non-breaking on this axis.

**Why:** Codex S150 flagged this as the only unverifiable slice-0 claim; the carryover then propagated the wrong tool name across handoffs without anyone running it — a stale-belief class the S154 audit was about.

**How to apply:** Deploy-time blocker is CLOSED — post-deploy verification ran S179 (see below) and confirmed the extension is non-breaking. Re-run only before code that writes Senior/Key/Other roster rows if live state may have drifted (probe is read-only and cheap). Related: `feedback-human-legibility-schema-principle.md` (why the enum expands instead of a new entity).

**Post-deploy state (S179, 2026-05-22, drain plan v7 P5 verification):**
- Data re-probe: 5,561 rows total (4,488 PI / 1,073 Co-PI / 0 Senior/Key/Other) — CLEAR, unchanged from S155.
- Picklist extension: live OptionSet has all 5 values with correct labels (`PI`/`Co-PI`/`Senior Personnel`/`Key Personnel`/`Other`); `extend-apprequestperson-role-picklist.mjs` re-run reports `0 inserted this run; rest pre-existing`. The extender ran as part of S178's slice-0 deploy (not separately tracked at the time).
- Drain plan v7 P5 verification checklist item: ✓ checked. The picklist is ready for `wmkf_apprequestperson` roster rows written by the drain's `dynamics_patched` state without risking `validation_400`.
