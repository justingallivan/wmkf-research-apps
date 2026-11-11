---
title: Shared-prompt Power Automate child flow guide
domain: prompt-executor
kind: plan
status: superseded
summary: Superseded 2026-11-10. Historical proposal for a Power Automate-native child flow.
canonical: false
owner: product-engineering
related:
  - docs/EXECUTOR_CONTRACT.md
  - docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md
  - docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md
---

# Superseded Power Automate child-flow proposal

**Superseded by the owner on 2026-11-10.** Power Automate will use the
authenticated submit and status endpoints of the planned [shared Executor
backend](SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).

## Historical design record (2026-11-04)

The recipe below records the unimplemented proposal from that discussion.
Its scope, build sequence, and acceptance examples apply to the superseded
design. See [Executor Contract](../EXECUTOR_CONTRACT.md) for the shipped
single-prompt service.

## Responsibility split

Parent flows gather proposal inputs, decide sequencing and branching, and save
validated business results to approved request fields. The reusable child runs
one shared prompt, records its exact prompt/version lineage and returns its
result. Keep prompt text in the shared Dataverse Prompt Table, editable in Admin,
rather than copying text into individual flows.

## Proposed first supported subset

- One prompt per invocation, identified by stable prompt name.
- Text variables whose declarations use override sources; parent supplies values.
- One raw output with target kind none; parent performs any business-field write.
- One explicitly reviewed provider and concrete model supported by the child.
- No tools, streaming, multi-turn interaction, SharePoint variable resolution,
  generic Dataverse variable resolution or generic output-target persistence.

Reject unsupported configuration before making a paid provider call. Do not
silently ignore advanced options or replace them with child-flow defaults.
Prompts requiring the full Executor contract need a later implementation slice.

## Build sequence

1. Create a solution-aware child flow using the supported Power Automate child
   flow pattern. Define inputs for promptName, requestId where applicable,
   overrideVariables as JSON text, and an invocation/correlation identity.
   Choose and document the exact transport envelope before connecting parents.
2. Query entity set wmkf_ai_prompts for the exact wmkf_ai_promptname with
   wmkf_ai_iscurrent=true. Fetch up to two rows: zero means missing; two means
   invalid duplicate-current state. Never select the highest version as a
   substitute. Escape/validate the name before constructing an OData filter.
3. Freeze the selected row for this invocation. Retain prompt GUID, name,
   wmkf_promptversion, text, variables, output schema and model configuration.
   Do not reload the mutable current pointer halfway through a run.
4. Parse declarations; validate required variables, supported sources, output
   shape, target none, provider/model, token budget and parameter support.
   Fail before spend on malformed or unsupported rows.
5. Compose the system/user content using the declared substitution contract.
   Preserve the untrusted-input separation and payload bounds required by the
   Executor; never interpolate proposal text as trusted instructions. Do not
   claim byte-equivalence until fixtures prove the composition matches.
6. Make one provider request through a securely configured connection. Keep
   credentials out of prompt rows, returned data and recorded run content.
   Do not blindly retry an uncertain timeout as if the first call never ran.
7. For the proposed Anthropic raw-text subset, require a normal end_turn with
   usable text. Treat max_tokens, tool requests, refusals and empty output as
   failures or explicit unsupported outcomes, not successful business results.
8. Attempt the wmkf_ai_run audit with exact prompt lookup/version, request
   linkage where available, PowerAutomate Auto run source, status, model,
   usage and retention-governed output. Follow current Dataverse metadata and
   Executor field mapping; do not invent option-set numbers from labels.
   Make an audit-write failure visible; it must not cause an automatic second
   paid call. A missing audit ID is not evidence that the provider never ran.
9. Return a stable envelope as JSON text: outcome, output/error code, run ID,
   prompt ID/name/version, concrete model and usage where available. Parent
   parses it and validates any structured business result before writing it.
10. Build Try/Catch/final-response scopes so every supported outcome returns a
    deliberate response. Keep failure details bounded and avoid copying secret
    or sensitive input into error messages.

## Acceptance examples before wider reuse

Use synthetic inputs to exercise missing prompt, duplicate current rows,
malformed declarations, missing variables, unsupported source/target/model,
successful text, truncated/empty output, uncertain transport failure and failed
audit persistence. Prove one invocation records the exact prompt version used,
even if a newer version is published during that invocation. Verify parents do
not save a business result after a failed or unsupported child outcome.

Validate solution connection ownership, permissions and response-time limits in
Connor's environment before adopting the child across intake flows. No provider
run, environment write or other metered execution is authorized by this document.

## References used in the discussion

- `docs/EXECUTOR_CONTRACT.md` — current inputs, outputs, audit and payload rules.
- [Microsoft: Create child flows](https://learn.microsoft.com/en-us/power-automate/create-child-flows)
- [Microsoft: Dataverse List rows](https://learn.microsoft.com/en-us/power-automate/dataverse/list-rows)
- [Microsoft: Error handling](https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling)
- [Anthropic: Handle stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

External references were consulted for the earlier chat guidance; they were not
re-certified at session close. This guide does not expand the app's provider or
credential contracts.
