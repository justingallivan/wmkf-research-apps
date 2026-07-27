---
name: project-dynamics-crm-limitations
description: Known Dynamics/Dataverse OData API limitations that differ from standard OData behavior
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dynamics
  last_verified: 2026-07-27 via current DynamicsService/OData caller patterns; external platform semantics remain documentation-backed
---

## Recall Rule

Read this when: writing Dynamics/Dataverse OData queries that paginate, count, or select formatted values.

Do:
- Paginate via keyset (filter on last value) or larger page sizes — `$skip` is unsupported (`0x80060888`).
- Use the `$count=true` query parameter, not the `$count` endpoint (which fails on complex filters).
- Get `_formatted` values via the `Prefer: odata.include-annotations="*"` header, not in `$select`.

Do not:
- Add `$skip` to any Dynamics OData query.
- Put `_formatted` fields in `$select`.

Ground truth: durable Dynamics OData behavioral limitations (not live state). For counts past the 5,000 cap see the FetchXML-aggregate approach in [[project-dataverse-power-tools]] / [[project-dynamics-explorer-reuse-power-tools]].

[VERIFIED 2026-07-27 via current query construction in
`lib/services/dynamics-service.js` and the shared
`lib/dataverse/core/odata.js` helpers]: this is an API-semantics hazard, not a
snapshot of Dataverse rows or schema.

- **`$skip` is NOT supported** — Dynamics CRM error `0x80060888: "Skip Clause is not supported in CRM"`. Do NOT add `$skip` to OData queries. Pagination must use keyset approach (filter on last value) or increase result limits.
- **`$count` endpoint** fails with complex filters (Edm.Int32 error) — use `$count=true` query parameter instead.
- **`_formatted` fields** cannot appear in `$select` — auto-returned via `Prefer: odata.include-annotations="*"` header.
