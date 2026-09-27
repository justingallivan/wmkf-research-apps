---
title: Integrity screening Dataverse visibility flag investigation
status: proposed
date: 2026-09-26
owner: Codex
---

# Dataverse visibility flag — investigation

Scope: the owner requests a flag on the Dataverse request for people who do
not use the Workbench. Detailed runs and PD decisions remain in Postgres.
This is an investigation, not an implemented or deployed flag. The existing
[Workbench brief](INTEGRITY_WORKBENCH_TAB_BUILD_BRIEF_2026-09-26.md) remains
the implementation handoff; its board-readiness gate remains deferred.

**Owner decision:** Yes means **complete screen + PD approval**. The proposed
display label is **Integrity review complete**, logical name
`wmkf_integrityreviewcomplete`. This is a current-state indicator, not a
permanent marker that a screen once occurred. Implementation remains pending.

## Evidence

- [VERIFIED via `node scripts/probe-request-integrity-metadata.cjs --target=prod`]
  Production `akoya_request` metadata permits customization, has table auditing
  enabled, and supports optimistic concurrency. All 613 attributes were examined
  for `integrity|retraction|pubpeer|screen|background.check` in logical/schema
  names, labels and descriptions: no matches. The proposed logical names
  `wmkf_integrityscreencompleted` and `wmkf_integrityreviewcomplete` are absent.
  This keyword search does not exclude a differently named equivalent column.
- [VERIFIED via the same probe with `--target=sandbox`] Sandbox metadata was
  not checked: `DYNAMICS_SANDBOX_URL` is not configured in this checkout's
  loaded environment. No Dataverse data or schema writes were performed.
- [VERIFIED via source] `lib/dataverse/schema-apply.js` supports Boolean columns,
  default false, labels and descriptions. It is creation-only. The manifest
  `lib/dataverse/schema/solution.json` uses `wmkfResearchReviewAppSuite` and the
  `wmkf` publisher prefix. Use an isolated extension wave, not a rerun of an old
  broad wave. The Boolean serializer does not explicitly configure column audit
  or security settings; inspect/configure those separately.
- [VERIFIED via source] `lib/dataverse/adapters/grant-request.js:updateById`
  delegates to the shared write service, including caller identity and ETag
  options. `lib/services/workbench/triage-service.js` demonstrates an existing
  authorized request-field update. Integrity review routes already establish
  `withDalContext`; their service currently saves only Postgres runs/decisions.
  Metadata readability does not prove runtime actor write privileges.

## Proposed mechanics

1. Default No means current completion and approval have not been established;
   it does not prove no screening ever occurred. A saved run alone cannot set
   Yes. Findings do not automatically preclude PD approval; missing required
   sources do.
2. The **Integrity review complete** flag must follow the
   latest fully covered screen, matching current roster, and latest PD approval.
   Hold, replacement runs and roster changes can invalidate it. The current
   Workbench derives that state on reads; copying it only at approval time
   would leave stale Yes values for Dynamics-only users. The selected meaning
   needs an explicit invalidation/reconciliation mechanism, including edits
   made outside our apps. A request-row ETag does not cover contact/junction edits.
3. Provision one Boolean in an isolated schema wave after a type/default/name
   preflight in sandbox and production. Add it to the relevant Dynamics request
   form and view, publish, and test as a normal staff user. A column alone does
   not place a visible control on existing forms. Prefer display-only controls;
   use column security if preventing edits outside that form is required.
4. Save the qualifying evidence in Postgres first, then await a narrow Dataverse
   PATCH through the existing adapter and trusted context. Keep the PG record
   even if Dataverse fails. Show “saved; Dataverse update pending” separately;
   retry the flag update without rerunning paid screening or duplicating a PD
   decision. Persist pending synchronization durably and provide a bounded retry
   path. For this mutable approval state, retries must recompute and serialize current state
   rather than replay old values.
5. Verify permissions under the chosen runtime identity. Attribute PD decisions
   to their authenticated actors in Postgres; do not imply a background sync
   was performed interactively by that PD. Audit the Dataverse column if desired:
   environment, table and column auditing must be enabled. Only table-level
   audit enablement was verified here. The flag audit is not the detailed log.

## Remaining checks before release

Neither live form placement nor runtime write permissions were tested.
Confirm sandbox configuration, exact
form/view, column security and organization auditing. Test partial success and
retry without another screen and stale-state handling for the mutable approval
flag. Resolve how changes outside our apps invalidate Yes, and the acceptable
delay; periodic reconciliation alone can leave a stale-Yes interval. Existing
Postgres migrations 056–057 remain unapplied under the
original release boundary. Do not infer historical completion from legacy
standalone name-only screens during any backfill.

Platform references: [Microsoft auditing requirements](https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing),
[column security](https://learn.microsoft.com/en-us/power-platform/admin/enable-disable-security-field),
[form column properties](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/common-field-properties-legacy).
