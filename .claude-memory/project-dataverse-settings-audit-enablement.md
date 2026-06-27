---
name: project-dataverse-settings-audit-enablement
description: "Parked TODO — enable Dataverse table-level auditing on wmkf_appsystemsetting for native recovery of admin settings; needs Connor's input on scope + retention policy."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: global
  last_verified: 2026-06-27 via scripts/probe-appsystemsetting-audit.mjs (live prod probe)
  originSessionId: 8ce5311e-9446-4cb1-a64e-1c170772c7b1
---

**Parked (2026-06-27), owner input needed: Connor.** Enable Dataverse
table-level auditing on the admin settings table so accidentally-blanked admin
values (email defaults, honorarium amount, model overrides, secret-expiry) are
recoverable natively from the audit log instead of re-seeding/re-typing.

**Verified live state (probe `scripts/probe-appsystemsetting-audit.mjs`, GET-only):**
- Org master switch `organizations.isauditenabled = true`.
- Table `wmkf_appsystemsetting` `IsAuditEnabled.Value = false` (`CanBeChanged: true`).
- Column `wmkf_settingvalue` `IsAuditEnabled.Value = true` (dormant — gated by the
  table flag).
- So NO change history is captured today; `setSetting` PATCHes the value in place
  (`lib/services/dataverse-settings-service.js`). A blanked-and-saved value is
  unrecoverable except via re-seed / env PITR.

**The fix is one admin toggle** (Power Platform → table "Audit changes to its
data"); the column flag is already on, so future edits would be captured for the
WHOLE admin-settings surface, not just templates.

**Why it's Connor's territory / open questions for him:**
- Which tables/columns to audit (scope) and the org **audit-retention** policy
  (records age out; storage cost).
- Recovery is manual, not one-click: a human reads the record's audit history and
  re-enters the old value. The app service principal got 403 on
  `ReadAuditSummary`, so recovery is done by a human in the Power Platform UI, not
  the app.

Separate from this: the reviewer email-template **bootstrap seed** still ships
regardless (a fresh env has no rows; audit can't restore from nothing) — see the
reviewer-workbench-lifecycle wiki topic "Email templates" section for the S297
admin-default + per-PD-override migration.
Related: [[reference-dataverse-audit-trail-actor-detection]].
