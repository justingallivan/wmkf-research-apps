---
name: reference-dataverse-audit-trail-actor-detection
description: "How to prove a Dataverse field is human- vs automation/flow-populated using the audits entity — who set it, when, the gap pattern. Used S270 to close the title-cron PA-flow open item."
metadata:
  node_type: memory
  type: reference
  status: active
  scope: global
  last_verified: S270 via live audit queries (J26/D25/J25/D24 on akoya_request)
---

To answer "does a write to field X fire a Power Automate flow / is X human- or
machine-populated?" without Power Automate access, read the **`audits`** entity —
it records who/when/what per change.

**Query contract (gotchas, S270):**
- The `audits` retrieve REQUIRES exactly one top-level condition on `objecttypecode`,
  e.g. `?$filter=objecttypecode eq 'akoya_request' and _objectid_value eq <guid>`.
  Without it you get `0x80040256 ReadAuditSummary`.
- `attributemask` is a comma-separated list of **column numbers**, not names. Map the
  field once via `EntityDefinitions(LogicalName='<entity>')/Attributes(LogicalName='<field>')?$select=ColumnNumber`
  (e.g. `wmkf_wmkfprojectdescription` = **461**), then test membership in the mask.
- `_userid_value@OData.Community.Display.V1.FormattedValue` = the actor's display name —
  the smoking gun. A named staff member = human; a service principal / app user = automation.

**Verdict heuristic:** automation writes the whole set as ONE identity in a tight
burst (all rows within ~seconds, one service account). Human curation shows MULTIPLE
named users, seconds-within-a-sitting then days/months across the set, multi-edit
revisions. S270: the field was edited by 6 named staff across weeks → human-curated,
no flow → cron write-when-empty is safe. (Caveat: a write-audit can't fully rule out
a trigger-flow that reacts WITHOUT writing back — but absence of a service-account
audit right after each human edit is strong corroboration.)

Read-only: only the OAuth token POST; every Dataverse call is a GET. Probe pattern:
`scripts/probe-akoya-*.js` headers (load `.env.local`, client-credentials token).
Related: [[feedback-verify-external-platform-claims]]; Dataverse domain → the
dataverse-dynamics agent-wiki topic.
