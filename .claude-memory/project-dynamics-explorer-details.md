---
name: project-dynamics-explorer-details
description: Dataverse Search API capabilities on the CRM instance + performance optimizations applied to the Dynamics Explorer app
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

## Dataverse Search API

Enabled on the CRM instance (77K+ docs, 154MB index).

- **Endpoint:** `{DYNAMICS_URL}/api/search/v1.0/query`
- Searches all indexed text fields across tables simultaneously
- Returns `@search.entityname`, `@search.objectid`, `@search.score`, `@search.highlights`
- Highlights use `{crmhit}` / `{/crmhit}` tags
- Query auto-expansion: "fungi" → `(fungus* | fungi)^2 OR (fungi~1)`
- Entity filter format: `entities: [{ name: 'akoya_request' }]`
- **`wmkf_abstract`** field exists on `akoya_request` — full proposal abstract text, not in original schema but now added

## Performance Optimizations Applied

- Inline schemas for top 4 tables (saves 1 round-trip per query)
- Parallel tool execution
- Streaming final response via `text_delta` SSE events
- `React.memo` / `useMemo` on `MessageBubble`
