---
name: Prompt Storage + Executor Contract (Phase 0 in flight for May 1 2026)
description: Phased Vercel-first → PA-later plan; shared Dynamics core via wmkf_ai_prompt; Executor contract at docs/EXECUTOR_CONTRACT.md; Path B chosen (declarative wrappers, generic executors in both callers)
type: project
originSessionId: d898b20a-8b1d-4a13-ad0e-878f4f62e71d
---
Session 109 (2026-04-24) reconciled six design docs + Wave 1 reality + Connor's built-out Dynamics schema into a single staged plan. **Authoritative refs:**
- `docs/EXECUTOR_CONTRACT.md` — shared spec both PA + Vercel build against
- `docs/PROMPT_STORAGE_DESIGN.md` — original design; field names now need renaming (see Ground truth below)
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
- `wmkf_ai_prompts` has 11 rows live (audit 2026-05-14); `wmkf_ai_runs` has 329 rows.
- No PA flows yet, no context blocks yet, no cross-prompt cache alignment yet — those are Phase 1/2.

**Phase 1 — post-cycle:** Connor builds PA `ExecutePrompt` child flow + first parent flow. Same prompt rows. `prior_output` source kind. Echo-prompt test oracle verifies byte-identical output from both callers.

**Phase 2:** context blocks + parallel-consumer chains. `shared.full_application` block referenced by `phase-i.summary` + `phase-i.compliance`. `placement: system` attribute. Cross-prompt cache alignment.

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
