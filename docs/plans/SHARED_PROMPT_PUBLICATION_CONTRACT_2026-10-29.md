---
title: Shared Prompt Authoring and Publication Contract
domain: ai-platform
kind: contract
status: proposed
summary: Proposed common contract for Connor's backend authoring and Admin prompt creation, metadata, drafts, and publication.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/EXECUTOR_CONTRACT.md
---

# Shared prompt authoring and publication contract

**Proposed, not implemented or agreed with Connor.** This is the target contract
for the shared-library implementation, not instructions to write new columns
before they exist. See the [implementation plan](SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md)
for live schema evidence, proposed columns, rollout, and recovery requirements.
Nothing in this document authorizes a schema change, production write, message
to Connor, or model execution.

## Shared library and metadata

- Dataverse `wmkf_ai_prompt` is the prompt-content store. Stable technical key:
  `wmkf_ai_promptname`; use the existing `<domain>.<purpose>` style. A title
  change does not change the key used by a flow or application.
- Add the proposed native metadata fields: `wmkf_ai_displaytitle`,
  `wmkf_ai_description`, `wmkf_ai_groupkey`, optional `wmkf_ai_sectionkey`,
  `wmkf_ai_usedby`, `wmkf_ai_usagecategory`.
- Fetch workflow definitions from the `prompt-library.groups` setting in
  `wmkf_appsystemsetting`. Use its stable group/section keys, not label text or
  a locally maintained list. Labels/order may change without deployment.
- Use readable titles/explanations and identify the flow/app in Used by. A
  declaration is not proof of execution; a historical PowerAutomate run-source
  label alone is not proof of the current caller. Metadata grants no permissions.
- Any prompt name is discoverable in Admin without a source-code catalog entry.
  Missing/invalid metadata goes to Needs organization instead of disappearing.
  Unsupported content contracts remain visible; catalog organization must not
  rewrite them to fit the app's execution capabilities.

## Authoring from either route

**Admin:** Create prompt → Save draft → review definition → Publish.
Existing prompts support catalog-detail edits and separately published content
revisions. All writers preserve metadata and complete execution definitions.

**Connor's coding sessions:** Read the shared catalog, prepare/import a full
prompt definition, and save a noncurrent Draft. Raw Dataverse draft creation is
allowed under the appropriate Dataverse role, but must supply a unique positive
version and valid schema-required fields. Use the governed importer when
available so validation, version reservation and audit are shared. If another
writer claimed the same version/name, stop and resolve it; do not overwrite it.

The initial supported publication route is Admin's authenticated publisher.
Backend automation may call a shared publisher only through an explicitly
supported authenticated entry point with server-established actor and target
context. Service-principal unattended publishing is a separate auth extension;
there is no implicit permission to bypass superuser authentication or invent a
profile ID. Connor can continue LLM-assisted authoring; he need not hand-edit
Dataverse forms. Publishing from a coding session without opening Admin needs
that supported entry point before it is offered as a feature.

## Drafts versus published versions

| Row state | Current | Status | Allowed edits |
|---|---|---|---|
| Draft | false | `682090000` | Content/metadata may change with expected row ETag |
| Current published | true | `682090001` | Content frozen; audited metadata-only edits allowed |
| Historical published | false | `682090001` | Read-only content; do not reuse as a draft |
| Retired | false | `682090002` | Read-only normal authoring; explicit recovery required |

Other combinations are invalid and are surfaced for repair. A noncurrent row
is not automatically a Draft. The current Executor resolves the current flag,
so **never write `iscurrent=true` on a Draft**.

Version is `wmkf_promptversion` (no `_ai_` in the name). The shared publisher
reserves positive `max(all versions)+1` while holding its per-environment/name
lock; saved drafts retain their reserved version, and gaps are allowed. Direct
backend drafts must not collide. Existing same-name/history rows are never
reset to version 1 or replaced by an upsert. Both sides explicitly reconcile staged
metadata against the current-row
baseline before publication and carry the complete variable/output/model
settings forward. If a newer draft publishes first, an older reserved version
cannot become current: rebase it to a newly reserved version. A stale catalog
metadata baseline requires explicit refresh/reapply; publication never silently
chooses between draft labels and newer current labels.

## Publication protocol

1. Use one request UUID bound to the exact definition and operation. Retry it
   unchanged; a changed payload requires a new UUID. Supply the expected current
   version/row ETag and selected draft row ETag. A conflict preserves the draft.
2. The governed service derives actor from authenticated context, serializes by
   target host + technical key, validates the entire definition and reviewed
   model/output ceiling, and records complete pending audit intent before Dataverse mutation. This
   includes planned IDs, expected ETags, the metadata baseline and exact
   before/after lifecycle/fingerprint; progress is derived by readback, while
   the audit retains its existing append-only pending/final phases.
3. Publish the reconciled staged snapshot through the shared service, only
   when its reserved version exceeds the current version. Set Published/current
   and actual publication time; conditionally clear the prior current flag in
   the same Dataverse changeset using both row ETags.
   First publication has no prior row. Metadata-only saves do not publish content
   or falsely stamp model-test/preflight dates.
4. Read back exact definition/lifecycle/metadata and verify the sole-current
   invariant. Save the audit receipt. A timeout is not proof of failure or
   permission to blindly resend with a new request ID.
5. On partial state, retain planned row IDs and infer completed writes from the pending intent
   and readback; resume from exact
   fingerprint/ETag evidence. Never choose/delete a duplicate automatically.
   Show partial/conflict explicitly. Dataverse updates and Postgres audit do not
   form one cross-store atomic transaction. The Dataverse lifecycle changeset
   rolls back together on a conditional-write failure, but a lost response or
   failed final audit still requires exact readback/recovery. Existing corrupt
   states or bypass writers must be resolved before publication.

The service's lock coordinates participating writers only. Do not directly
publish or edit published prompt content through raw Dataverse writes. If that
must remain supported, agree on Dataverse-enforced coordination before building
this design. Existing seed `--force` behavior alone is not the target audited
publisher and must not be treated as an alternate normal edit path.

## Execution and compatibility

The stored definition is separate from its trigger. Power Automate owns its
trigger, input gathering, orchestration, and handling of returned output. The
application owns its callers. No trigger/flow/route is created by publication.

New general-purpose Admin prompts initially support caller-supplied inputs and
returned text/JSON with output target `none`. Preserve existing advanced
Dataverse/SharePoint/field-output definitions when editing existing prompts;
new direct-write mappings are separate scope. Supported source/target kinds,
injection boundaries, model capabilities and output schemas follow
`docs/EXECUTOR_CONTRACT.md`. The library is not evidence that a Power Automate
Executor has been deployed, and storing a model name does not authorize its use.

A breaking input/output change requires coordination with every declared caller
before publication. Prefer a new technical key for a breaking contract so
existing flows keep working; descriptions may explain the replacement, but no
retirement/deletion is implied. Rollback publishes a new version copied from
reviewed historical content; it never edits or renumbers historical content.
