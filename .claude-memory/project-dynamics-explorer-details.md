---
name: project-dynamics-explorer-details
description: Dataverse Search API capabilities on the CRM instance + performance optimizations applied to the Dynamics Explorer app
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: dynamics
  last_verified: 2026-07-27 via dynamics-service searchRecords and Dynamics Explorer route/prompt source; index metrics remain dated
---

## Recall Rule

Read this when: using or extending the Dataverse Search API in Dynamics Explorer, or reasoning about its performance optimizations.

Do:
- Hit `{DYNAMICS_URL}/api/search/v1.0/query` for cross-table indexed text search; filter with `entities: [{ name: 'akoya_request' }]`; read `@search.*` result fields and `{crmhit}` highlights.
- Keep the applied optimizations (inline schemas for top tables, parallel tool execution, SSE `text_delta` streaming, memoized message rendering).

Do not:
- Trust the index size / doc-count figures here as current — re-probe if load-bearing.

Ground truth: `pages/api/dynamics-explorer/chat.js` (agentic tool-use orchestration), `lib/services/dynamics-service.js` (`searchRecords` — the `search/v1.0/query` impl now lives here, not in `chat.js`), `shared/config/prompts/dynamics-explorer.js`; structural Search/schema facts should be re-probed, not trusted from this memory. See [[project-dynamics-explorer-reuse-power-tools]], [[project-dynamics-explorer-schema-diff]].

## Dataverse Search API

Historical observation: Search was enabled when originally probed, with 77K+
documents and a 154 MB index. Re-probe current enablement/metrics before they
are load-bearing; source only proves how the app calls the API.

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
