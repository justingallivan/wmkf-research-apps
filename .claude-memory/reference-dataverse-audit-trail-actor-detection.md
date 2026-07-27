---
name: reference-dataverse-audit-trail-actor-detection
description: "How S270 used Dataverse audit rows to investigate whether a field appeared human- or automation-populated; actor/timing patterns are corroboration, not proof that no non-writing flow exists."
metadata:
  node_type: memory
  type: reference
  status: active
  scope: global
  last_verified: S270 via live audit queries (J26/D25/J25/D24 on akoya_request)
---

## Recall Rule

Use this only when investigating who changed a Dataverse field. Re-derive the
field's current `ColumnNumber`, query `audits` read-only with the required
`objecttypecode` condition, and treat actor/timing patterns as corroboration rather
than proof that no non-writing automation exists.

To investigate who changed a Dataverse field without Power Automate access, the
S270 probe read the **`audits`** entity for actor, time, and changed attributes.

**Query contract (gotchas, S270):**
- The `audits` retrieve REQUIRES exactly one top-level condition on `objecttypecode`,
  e.g. `?$filter=objecttypecode eq 'akoya_request' and _objectid_value eq <guid>`.
  Without it you get `0x80040256 ReadAuditSummary`.
- `attributemask` is a comma-separated list of **column numbers**, not names. Map the
  field once via `EntityDefinitions(LogicalName='<entity>')/Attributes(LogicalName='<field>')?$select=ColumnNumber`
  (e.g. `wmkf_wmkfprojectdescription` = **461**), then test membership in the mask.
- `_userid_value@OData.Community.Display.V1.FormattedValue` supplied the actor
  display name in the S270 responses.

**Verdict heuristic:** automation writes the whole set as ONE identity in a tight
burst (all rows within ~seconds, one service account). Human curation shows MULTIPLE
named users, seconds-within-a-sitting then days/months across the set, multi-edit
revisions. S270 found edits by six named staff across weeks, which supported a
human-curation inference for that field. A write audit cannot rule out a flow that
reacts without writing back, so repeat the probe and preserve that limitation in
any current recommendation.

Read-only: only the OAuth token POST; every Dataverse call is a GET. Probe pattern:
`scripts/probe-akoya-*.js` headers (load `.env.local`, client-credentials token).
Related: [[feedback-verify-external-platform-claims]]; Dataverse domain → the
dataverse-dynamics agent-wiki topic.
