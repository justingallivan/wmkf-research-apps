---
name: Dataverse entity-creation authority delegated to Justin/Claude (2026-05-06)
description: Connor approved standing authorization to create new Dataverse entities + fields directly via creator privileges, with summary-after model rather than design-review-before
type: project
originSessionId: 064dffdf-ba31-44c3-81f2-73bf4d3b908f
---
**Status as of 2026-05-06**: Standing authorization. Granted by Connor in the intake portal sync 2026-05-06.

**Why**: Connor said "we still have creator privileges. Connor has given the go ahead to create new entities for this project. We can do it and just give him a summary of what's been created." Removes a coordination bottleneck for portal pilot work where many small schema changes were going to gate on Connor design review.

**How to apply**:
- For pilot-related schema work (new entities, new fields, new choice values, new lookups), proceed without waiting on Connor. Apply the change, log it.
- **Still summarize after the fact.** Maintain a running audit document (`docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` — to be created) listing every entity / field / choice change for the pilot, so Connor has one place to review post-hoc.
- Default to **conservative naming + scoping** — prefix `wmkf_*`, single source of truth, no orphans. The summary-after model trades coordination latency for trust; don't burn the trust by creating sloppy schema.
- Authorization is for **pilot-scope** changes. Out-of-scope (e.g., redesigning core `akoya_request`, restructuring existing relationships, changes affecting AkoyaGo) still warrants explicit Connor sign-off.
- Authorization does **not** extend to dropping or repurposing existing entities/fields. Adding is fine; mutating production schema isn't.

**What this unblocks for pilot**:
- `wmkf_portal_membership` entity (Decision 1)
- New child entities for structured tables: `wmkf_budgetline`, `wmkf_personnel`, `wmkf_priorsupport`, `wmkf_milestone` (Decision 6)
- New `account` lookups: `wmkf_authorized_official_contactid`, `wmkf_liaison_contactid`
- New `account` fields for institutional documents: `wmkf_governingboardfile`, `wmkf_govtunit`, `wmkf_groupexempt`, `wmkf_declarationofstatusfile`
- New `wmkf_reviewerstate` choice on `wmkf_potentialreviewer`
- Lifecycle stage values on `akoya_request` (`Awaiting T&C`, `T&C Signed`, `Awaiting Scheduling Call`, `Call Scheduled`)
- Reviewer migration entities (S136 lock): `wmkf_appgrantcycle` (new); new fields on `wmkf_potentialreviewer` for reviewer-portal capture (TBD); no new researcher pool or publications entity (drain instead)

All without per-change Connor coordination — but each change goes into the schema-changes catalog.
