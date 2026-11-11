---
name: Prompt Storage + Executor Contract
description: Shipped single-prompt Executor and the owner-selected direction for Power Automate to call the shared backend.
type: project
originSessionId: d898b20a-8b1d-4a13-ad0e-878f4f62e71d
status: active
scope: prompt
last_verified: 2026-11-10 via owner decision and current Executor source
---

## Recall Rule

Read this when: building or modifying the Executor, shared prompts, chaining,
or app/Power Automate prompt execution.

- Read `docs/EXECUTOR_CONTRACT.md` for the shipped `executePrompt()` contract.
- Store shared prompt definitions in Dataverse `wmkf_ai_prompt`. Use
  `<domain>.<purpose>` names and the tracked variable and output schemas.
- Use `generationMode:"native-json-schema"` only as an explicit prompt-level
  opt-in with a reviewed model that supports it.
- For the planned Power Automate integration, use the authenticated job submit
  and status contract in the [shared Executor job design](../docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).

## Current boundary

[VERIFIED via `lib/services/execute-prompt.js` and its callers] The single-prompt
Executor and versioned prompt publication are shipped. The Executor resolves
one current prompt or a server-owned frozen snapshot. It supports declared
`dynamics`, `sharepoint`, and `override` sources and `akoya_request` or `none`
output targets. It owns the invocation audit in `wmkf_ai_run` and the caller
owns task sequencing and semantic retries.

[PLANNED, owner decision 2026-11-10] Power Automate owns triggers and business
follow-up and calls the shared backend. The backend will own input resolution,
prompt execution, validation, and approved writeback. The first pilot is
Executive Summary and Methodology, with a synthetic trial before the real
Request-field mappings are finalized. Execution profiles and job endpoints
are planned.

## Historical design and evidence

Session 109 (2026-04-24) called the earlier approach Path B. It separated the
prompt definition from workflow orchestration and proposed parallel generic
Executors in Power Automate and Vercel. Phase 1 would have added the Power
Automate `ExecutePrompt` child flow and a cross-runtime echo oracle. Phase 2
considered `prior_output` and shared `context_block` inputs for caching and
chaining. The separate runtime proposal was superseded on 2026-11-10.
See the [historical storage design](../docs/PROMPT_STORAGE_DESIGN.md).

### Ground truth: wmkf_ai_prompt schema (probed live 2026-04-24)
18 custom fields (after Phase 0 Connor additions, confirmed live 2026-04-24). Already built before Session 109: `promptoutputschema` (workflow chaining unblocked), `rollbackfrom`, `preflightpasseddatetime`, `lasttestdatetime`, `iscurrent`, `promptstatus` picklist (Draft/Published/Retired). **Connor added 2026-04-24 ✅:** `wmkf_ai_systemprompt` Memo (system/user split for caching; note no underscore between "system" and "prompt") + Lookup `wmkf_ai_prompt` on `wmkf_ai_run` (fixes provenance gap — `promptversion` Integer alone is ambiguous).

### Dated production evidence

- `phase-i.summary` was the first shipped Dataverse prompt on the Vercel
  Executor. The reference caller is `pages/api/phase-i-dynamics/summarize-v2.js`.
- The 2026-07-27 production probe found no prompt Executor or chaining flow in
  the 114 visible, parseable cloud-flow definitions.
- Of 353 run rows on that date, the 303 PowerAutomate-labeled historical rows
  had no current-prompt lookup and ended on 2026-05-06. Vercel-labeled runs
  continued through 2026-07-26. The Vercel title-generation cron also uses
  `PowerAutomate Auto`, so the run-source label alone does not prove caller identity.
