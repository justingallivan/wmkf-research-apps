---
name: Prompt Storage + Executor Contract
description: Current Vercel Executor boundary plus the historical Path B / Power Automate target; the production PA prompt pipeline was absent in the 2026-07-27 metadata probe.
type: project
originSessionId: d898b20a-8b1d-4a13-ad0e-878f4f62e71d
status: active
scope: prompt
last_verified: 2026-07-27 via current Executor source and production Power Automate/AI-run read-only probe
---

## Recall Rule

Read this when: building or modifying anything prompt-related — the Executor, prompt rows, chains, or PA/Vercel prompt execution.

Do:
- Read `docs/EXECUTOR_CONTRACT.md` first; use `lib/services/execute-prompt.js` as the canonical Executor.
- Use the real table/field names: table `wmkf_ai_prompt` (NOT `wmkf_prompt_template`), fields `wmkf_ai_promptbody`/`wmkf_ai_promptvariables`/`wmkf_ai_promptoutputschema`/etc., system prompt `wmkf_ai_systemprompt`. <!-- prompt-storage:ignore reason=correct-name-guidance -->
- Keep Path B (declarative wrappers + generic executors); name prompts `<domain>.<purpose>`.

Do not:
- Re-litigate the Session-109 locked decisions (Path B, two chain shapes, declarative vars/outputs, cache-boundary marker).
- Treat the Executor as multi-turn / agent-loop / SSE-streaming / retry-engine / chain-orchestrator / Batch API — it is none of these.

Ground truth: `docs/EXECUTOR_CONTRACT.md`, `docs/PROMPT_STORAGE_DESIGN.md`,
`docs/WORKFLOW_CHAINING_DESIGN.md`, `lib/services/execute-prompt.js`, and the
Phase I summarize-v2 route/service. The prompt schema was probed live
2026-04-24; the most recent retained row-count snapshot is 2026-07-12.

## Current boundary

The Vercel prompt store, publication path, and single-prompt Executor are
shipped. The 2026-07-27 production probe scanned all 114 visible, parseable
cloud-flow definitions and found no reference to any `wmkf_ai_*` field/table,
the Executor routes, Claude/Anthropic, or the WMKF Vercel app. The PA prompt
Executor and chaining DAG are not deployed in visible production flow
metadata. Universal prompt visibility/editability, the generalized prompt
resolver, and the historical Phase 1/2 chain extensions below must not be
inferred as built.

Session 109 (2026-04-24) reconciled six design docs + Wave 1 reality + Connor's built-out Dynamics schema into a single staged plan. **Authoritative refs:**
- `docs/EXECUTOR_CONTRACT.md` — shared spec both PA + Vercel build against
- `docs/PROMPT_STORAGE_DESIGN.md` — reconciled current boundary plus historical
  design; its field names now match the shipped schema
- `docs/WORKFLOW_CHAINING_DESIGN.md` — chaining principle; `wmkf_ai_promptoutputschema` column already exists
- Plan file: `/Users/gallivan/.claude/plans/ok-claude-connor-is-precious-dove.md`

**Why:** Justin + Connor working session hashed out how declarative-wrapper prompts actually look in PowerAutomate. Key insight: separate **function** (prompt row in Dynamics) from **process** (Flow in PA or Vercel route). Both callers implement a generic `ExecutePrompt`/`executePrompt()` that reads the function definition and executes it. Chains are Flow-level; Executor runs one prompt per invocation.

**How to apply:** Before building anything prompt-related, read `docs/EXECUTOR_CONTRACT.md`. Don't re-litigate these decisions:

### Architectural decisions locked in (Session 109)
- **Path B — declarative wrappers + generic executors** (not Path A duplication, not Path C HTTP gateway)
- **Table name is `wmkf_ai_prompt`** (Connor built it) — *not* `wmkf_prompt_template` as PROMPT_STORAGE_DESIGN originally proposed. <!-- prompt-storage:ignore reason=rename-callout --> Field names on it: `wmkf_ai_promptname`, `wmkf_ai_promptbody`, `wmkf_ai_promptvariables`, `wmkf_ai_promptoutputschema`, `wmkf_ai_promptstatus`, `wmkf_ai_iscurrent`, `wmkf_promptversion`, `wmkf_ai_rollbackfrom`, etc. See EXECUTOR_CONTRACT.md for full field list.
- **Two chain shapes, both first-class:** sequential (output → input, via `prior_output` source kind, Phase 1) and parallel-consumer (shared input block, via `context_block` source kind, Phase 2)
- **Variables are declarative** with `source.kind` enum: `dynamics`, `sharepoint`, `override` (Phase 0); `prior_output` (Phase 1); `context_block` (Phase 2)
- **Outputs are declarative** with `target.kind` enum: `akoya_request`, `wmkf_ai_run`, `none`
- **Caching requires byte-identical prefixes across callers** — explicit `<<<CACHE_BOUNDARY>>>` marker; cacheable vars before, variable tail after
- **Naming convention:** `<domain>.<purpose>` e.g. `phase-i.summary`, `phase-i.compliance`, `shared.full_application`
- **Context blocks are tagged prompt rows** (new `Context` picklist value on `wmkf_ai_promptstatus`, Phase 2) — not a separate table

### Ground truth: wmkf_ai_prompt schema (probed live 2026-04-24)
18 custom fields (after Phase 0 Connor additions, confirmed live 2026-04-24). Already built before Session 109: `promptoutputschema` (workflow chaining unblocked), `rollbackfrom`, `preflightpasseddatetime`, `lasttestdatetime`, `iscurrent`, `promptstatus` picklist (Draft/Published/Retired). **Connor added 2026-04-24 ✅:** `wmkf_ai_systemprompt` Memo (system/user split for caching; note no underscore between "system" and "prompt") + Lookup `wmkf_ai_prompt` on `wmkf_ai_run` (fixes provenance gap — `promptversion` Integer alone is ambiguous).

### Phased delivery plan

**Phase 0 — SHIPPED (historical, kept for context):**
- Connor added `wmkf_ai_systemprompt` Memo + Lookup `wmkf_ai_prompt` on `wmkf_ai_run` (verified live).
- `phase-i.summary` prompt row authored; `lib/services/execute-prompt.js` is the canonical Executor implementation; `pages/api/phase-i-dynamics/summarize-v2.js` imports it.
- `wmkf_ai_runs` had 353 rows on 2026-07-27. The 303
  PowerAutomate-labeled historical rows had no current-prompt lookup and ended
  on 2026-05-06; Vercel-labeled runs continued through 2026-07-26. The
  `PowerAutomate Auto` option is also used by the current Vercel
  title-generation cron, so the label alone is not caller proof.
- The production flow-definition probe found no PA prompt Executor.
  Generalized context blocks and cross-prompt cache alignment remain unbuilt.

**Historical Phase 1 target:** Connor would build a PA `ExecutePrompt` child
flow plus first parent flow over the same prompt rows, add `prior_output`, and
use an echo-prompt oracle for parity. No such production flow was present in
the 2026-07-27 visible metadata.

**Historical Phase 2 target:** context blocks plus parallel-consumer chains,
including a `shared.full_application` block, `placement: system`, and
cross-prompt cache alignment. This is not current built-state guidance.

### Retired from prior plan
- Old name `wmkf_prompt_template` — Connor built table as `wmkf_ai_prompt` (renamed); PROMPT_STORAGE_DESIGN updated globally S167. <!-- prompt-storage:ignore reason=rename-history -->
- Old field names (`wmkf_body`, `wmkf_variables`, `wmkf_output_schema`) — actual names are `wmkf_ai_promptbody`, `wmkf_ai_promptvariables`, `wmkf_ai_promptoutputschema`
- `wmkf__ai_summary` on akoya_request — confirmed a typo by Connor, being deleted, ignore
- Hybrid-vs-full-PA-composition debate — decided Session 102: full PA composition (no Vercel dependency at runtime)

### Scope of Executor (what it is NOT)
- Not multi-turn / not agent-loops (Dynamics Explorer stays separate)
- Not streaming SSE (today's streaming routes stay outside the contract)
- Not a retry engine (caller decides retry)
- Not a chain orchestrator (the Flow orchestrates; Executor runs one prompt per invocation)
- Not Anthropic Batch API (that's `wmkf_batch_run`, retrospective analyses)
