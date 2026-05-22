---
name: Dynamics Explorer tool-result serializer — shipped
description: Codex AI_DATA_FLOW_MATRIX P1 #2 (Dynamics Explorer agentic-loop record-detail boundary). Deferred 2026-05-04, then shipped later in Session 130 after Codex implemented the model-context minimization tranche.
type: project
originSessionId: 86703e2a-1188-4182-8ea8-fcc124398944
---
Shipped in Session 130 (commit pending in same session as activation work). Implemented as `lib/utils/dynamics-explorer-serializer.js` and wired into `pages/api/dynamics-explorer/chat.js` at three points: tool results before they're appended as Claude `tool_result` messages, Dataverse Search highlights field-by-field, and export AI-processing record paths.

**Framing — important for future readers:** This is **model-context minimization, not a Dataverse permission layer.** The 16 staff users have full CRM access by design; the serializer's job is to keep generated content (`wmkf_ai_summary`, `wmkf_ai_rawoutput`, `wmkf_ai_promptoverride`), large narrative memos (`description`, `notetext`, `body`, `documentbody`), and credential-shaped fields out of the agent loop where they would inflate cost and risk loopback. The original "sensitive field" framing in Codex's matrix was preventive against a threat model staff-side RBAC already covers — the real value is reducing token spend and Claude-citing-AI-output-as-truth.

**Mechanism:**
- Recursive sanitizer strips `@`-prefixed and odata-named keys, redacts fields matching the sensitive-field patterns to a placeholder, and caps long scalar strings at 1500 chars by default. Adds `_aiContextBoundary` metadata to the result envelope when redaction or truncation fires.
- Passthrough tools (`describe_table`, `count_records`, `list_documents`, `search_documents`) skip sanitization — schema descriptions and Graph search snippets are already curated.
- Search highlights go through `serializeDynamicsExplorerFieldValueForModel(field, value)` per-field so a hit on `notetext` or `description` becomes a redaction placeholder before reaching Claude.
- Tests: `tests/unit/dynamics-explorer-serializer.test.js` (5 cases) + `tests/integration/dynamics-explorer-tool-serialization.test.js` (full chat-loop integration).

**Watch items still open (now post-ship, lower priority):**
- `wmkf_ai_summary` is **not** in the denylist — relies on the 1500-char cap for truncation. Adopting full redaction would block legitimate "summarize the AI summary for proposal X" queries. Revisit only if usage shows summaries getting hauled into generic queries unprompted (right answer would be per-table default-select pruning, not blanket redaction).
- `search_documents` returns a single joined string of N file lines + snippets and is in PASSTHROUGH_TOOLS. A 100-result query is ~20KB to Claude. Add a fan-out cap if cost becomes visible.
- `_etag` survives the serializer (it's renamed by `processAnnotations` before sanitization runs). Harmless, but a stray bytes-of-context cost.

**How to apply:** When adding new Dynamics Explorer tools or expanding what records enter the agent loop, default to non-passthrough so the sanitizer fires; only add to PASSTHROUGH_TOOLS for tools whose output is small + already curated (schema, counts, search summaries). When you see Claude treating an AI-generated field as authoritative on a fresh query, that's the loopback symptom — investigate whether the field needs to move to the denylist or whether the system prompt needs tightening.
