---
name: dataverse-export-floor-scoping
description: "Track B AI on-ramp is the user's headline vision; the filter \"floor\" is the bulk-selective SUBSET of the export-column contract, not 1:1 with it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8050fbb7-13c6-444b-b802-c9bc7a61a3ce
  status: active
  scope: dataverse
  last_verified: 2026-07-27 citation audit against the dated 2026-05-18 probe evidence; current populations require a fresh probe
---

## Recall Rule

Read this when scoping the deferred natural-language on-ramp or adding
person/contact filter axes to Dataverse Bulk Export.

Do:
- Preserve the built deterministic `QuerySpec` → preview → confirmed run seam; a
  future NL layer may propose a spec but must render it for human confirmation.
- Build person-role grounding per program, not entity-wide.
- Force an explicit request-contact vs organization-contact vs CEO choice.
- Label `wmkf_donorname` as "Directed by (discretionary sponsor)" — internal directed-giving, NOT an external philanthropic donor.

Do not:
- Treat the trusted export-column contract as identical to the filter-axis set.
- Ship one generic "PI" field across programs.
- Equate contact GUID with human identity; duplicate contact rows can represent
  the same person.

## Current and Historical Boundaries

[VERIFIED 2026-07-27 via
`docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md:41-61,198,256-259`]
The deterministic compiler, preview/run confirmation seam, and expert builder
are built; the natural-language on-ramp remains deferred. The current user guide
therefore describes a structured builder, not a chatbot
(`docs/guides/DATAVERSE_BULK_EXPORT.md`).

The semantic findings below are **dated 2026-05-18 probe snapshots**, not claims
about today's population percentages:

- `docs/atlas/evidence/akoya-person-role-by-program-2026-05-18.txt`:
  Research uses `wmkf_projectleader` plus the request-person junction; SoCal
  primarily uses request contact / `wmkf_ceo`; Discretionary does not share the
  same grantee-lead model.
- `docs/atlas/evidence/akoya-socal-contacts-2026-05-18.txt`:
  request primary contact, account primary contact, and `wmkf_ceo` are distinct
  concepts and sometimes diverged in the sampled records.
- `docs/atlas/evidence/akoya-socal-contact-divergence-2026-05-18.txt`:
  GUID divergence can overstate person divergence because duplicate contact rows
  may represent one human.

Before implementing a future AI grounding dictionary or reporting fresh
percentages, rerun the corresponding scripts:
`scripts/probe-akoya-person-role-by-program.js`,
`scripts/probe-akoya-socal-contacts.js`, and
`scripts/probe-akoya-socal-contact-divergence.js`.

Related: [[akoya-temporal-axis-encodings]]
