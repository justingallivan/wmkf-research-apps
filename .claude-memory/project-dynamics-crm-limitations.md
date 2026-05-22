---
name: project-dynamics-crm-limitations
description: Known Dynamics/Dataverse OData API limitations that differ from standard OData behavior
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

- **`$skip` is NOT supported** — Dynamics CRM error `0x80060888: "Skip Clause is not supported in CRM"`. Do NOT add `$skip` to OData queries. Pagination must use keyset approach (filter on last value) or increase result limits.
- **`$count` endpoint** fails with complex filters (Edm.Int32 error) — use `$count=true` query parameter instead.
- **`_formatted` fields** cannot appear in `$select` — auto-returned via `Prefer: odata.include-annotations="*"` header.
