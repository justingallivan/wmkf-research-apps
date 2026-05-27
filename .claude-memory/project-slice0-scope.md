---
name: Slice-0 schema scope is 4 items, not 3 (carryover under-counted)
description: Authoritative intake-portal slice-0 Dataverse schema scope; corrects the SESSION_PROMPT carryover item C which dropped wmkf_portal_membership
type: project
originSessionId: S155
---
Intake-portal "slice 0" was a **single Dataverse schema-deploy event** that multiple work-streams converged on — NOT the budget-only slice. **DEPLOYED to prod Dataverse S178, 2026-05-22.** The SESSION_PROMPT carryover item C enumerated only 3 items and dropped the membership entity; Codex caught it, verified S155.

**Authoritative source:** `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 section (the slice-0 catalog) + `docs/BUDGET_FORM_SPEC.md` v3 + `docs/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md`. The design doc `docs/INTAKE_PORTAL_DESIGN.md` is older (v2, 2026-05-12) — defer to the catalog where they differ.

**Slice-0 schema scope = 4 targets:**
1. NEW `wmkf_proposalbudgetline` entity (child of `akoya_request`; 10-value `wmkf_category` enum 100000000–100000009 — `Tuition` was added at 100000005 pre-deploy in S178, cost-share block renumbered up by 1; deployed values authoritative).
2. EXTEND `wmkf_apprequestperson` — 3 nullable fields (`wmkf_effortpct`, `wmkf_biosketchurl`, `wmkf_lineorder`) + `wmkf_role` enum 2→5 (add 100000002 Senior Personnel / 100000003 Key Personnel / 100000004 Other).
3. `akoya_request.wmkf_totalothersources` (Money) — only net-new field on akoya_request.
4. NEW `wmkf_portalmembership` entity (deployed logical name has NO underscore — the `wmkf_portal_membership` form was dropped pre-deploy; live schema at `lib/dataverse/schema/wave4/wmkf_portalmembership.json`, shape sketch at `docs/INTAKE_PORTAL_DESIGN.md:98-117`, alt key `(_wmkf_contact_value,_wmkf_account_value)`) + `wmkf_priordecisionstatus` Choice (100000000 Rejected/100000001 Revoked/100000002 Approved, nullable). The membership *admin UI* is a SEPARATE downstream slice (its own build plan); only the *entity* shipped in slice-0.

**Flagged, NOT auto-absorbed:** `contact.wmkf_portal_oid` + `akoya_request.wmkf_phaseiisubmittedat`/`wmkf_phaseiisubmittedby` appear in `docs/INTAKE_PORTAL_DESIGN.md:621` next-steps but are absent from the authoritative 2026-05-14 catalog. Doc-vs-catalog gap — needs Connor/owner reconciliation; do NOT pull into slice-0 on the design doc's authority alone.

**Why:** carryover lists go stale and propagate; the 3-item count came forward ~5 sessions. **How to apply:** trust the 2026-05-14 catalog, not carryover enumerations; re-derive slice-0 scope from `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` each time. Tooling/probe specifics in [[project-slice0-role-probe]]. Wave dir = `wave4`/`wave4-existing` (the `lib/dataverse/schema/intake/` doc reference is stale).
