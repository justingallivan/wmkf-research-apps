---
title: Admin "Add prompt" form — plan
kind: plan
domain: ai-platform
status: active
summary: Create a new shared-library prompt from a form in Admin and publish it immediately as v1, with placeholders declared automatically. No Dataverse editing and no draft state.
canonical: false
cataloged: 2026-11-02
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md
---

# Admin "Add prompt" form

[OWNER APPROVED 2026-11-02: name format yes; Edit & publish also declares new
placeholders, yes; superuser-only, yes. BUILT ON BRANCH
`claude/admin-add-prompt`; NOT DEPLOYED.]

## Why

The shared prompt library assumed prompts start as drafts written directly in
Dataverse ([scope change](SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md),
Decision 3). Trying to publish the `phase-i.checkin` draft on 2026-11-02 showed
that this doesn't work well in practice:

- The draft's output-schema field held an example of the response shape, not
  the settings the Executor expects, so the publish was rejected.
- Its `{{…}}` placeholders were never declared in the variables field, and the
  only way to fix that is to hand-edit JSON in Dataverse.

**[OWNER REQUEST 2026-11-02]** Add a form in Admin that creates a new prompt
without anyone going into Dataverse.

## Decisions

1. **[OWNER DECISION 2026-11-02] Publish immediately as v1, with no draft
   step.** Apps find a prompt only by its exact name, and nothing looks for a
   new name until someone connects it in code. A new v1 therefore can't change
   a running app. Later edits go through the existing **Edit & publish**, which
   creates versions with history and an audit trail.
2. **Brand-new names only.** The form refuses a name that has any row,
   including a draft. Existing prompts keep using **Edit & publish**, and
   Dataverse drafts keep using first publish (PR #610).

## What the form does

An **Add prompt** button at the top of Admin → Prompts opens a form with:

| Field | Required | Notes |
| --- | --- | --- |
| Name | yes | Technical key, for example `grants.budget-check`. Lowercase letters, digits, dots and hyphens; must start and end with a letter or digit. Cannot be changed later. |
| Title | yes | Catalog title shown on the card. |
| Description, Used by | no | Catalog text. |
| Group / section | no | Same allowlist as **Edit details**. |
| Usage | no | Defaults to "No application caller" (`unconnected`). |
| System prompt | no | The rules and instructions. |
| Prompt body | yes | The per-run text. `{{name}}` marks a value supplied at run time. |
| Model | no | Same picker as **Edit & publish**; blank uses the Executor fallback. |
| Max output tokens | no | Same check against the model's limit. |
| Output schema | no | Settings that tell the Executor how to read the reply. Leave blank unless an app developer supplies one. |

**Inline help** says in plain words that the format you want back (for
example, an example JSON response) belongs in the prompt text, and that the
Output schema box is for app settings, not a response example. This is the
mistake the `phase-i.checkin` draft made.

**Detected placeholders** are listed live under the prompt fields, for example
"This prompt expects: `proposal_text`, `budget_pdf`".

## Placeholders become declared variables automatically

On create, the server finds every `{{name}}` in the system prompt and body
(the same pattern the validators use, `lib/utils/prompt-validators.js:159`) and
writes:

```json
{"variables":[{"name":"proposal_text","source":{"kind":"override"},"required":true}]}
```

**Why `source: override`.** [VERIFIED via `lib/services/execute-prompt.js:386-422`]
The Executor resolves each variable by its `source.kind` and throws
`unsupported source.kind` when a variable has none. `override` means "the
caller passes this value"; `required: true` makes a missing value fail loudly
instead of sending an empty string. When an app is connected later, its
developer replaces the source (for example SharePoint or a Dataverse field)
through a normal versioned publish or seed.

## Server flow

New verb `POST /api/admin/prompts` on the existing superuser-only list route
(`pages/api/admin/prompts/index.js`), calling a new `createPrompt` in
`lib/services/admin/prompts-publish-service.js`. It reuses that service's
validation, fingerprint and audit helpers:

1. Validate the name format, the catalog fields (the `normalizeCatalog` rules
   from `prompts-catalog-service.js`) and the body length.
2. Refuse with `409 name_exists` if `listVersions(name)` returns any row.
3. Build the payload with the derived variables and run the same
   `validatePublishPayload` checks as publish: template/variable match,
   output-schema shape, reviewed model, token ceiling.
4. Idempotency: a request id bound to the payload fingerprint, as publish does.
   A repeated click replays the earlier result instead of creating a second
   row.
5. Write the pending audit row; if that write fails, refuse the create, as
   publish does.
6. Create v1: current, Published, publish time stamped, catalog columns set.
7. Verify exactly one current row, then write the final audit row
   (`outcome_json.kind = 'create'`).

**Accepted gap (same as first publish).** Two people creating the same name at
the same moment both pass step 2. This surfaces afterwards as `partial` with
`invariant_violation_current_count_2`. Creating prompts is superuser-only, so
this is accepted.

## Durable surfaces to update in the build PR

- `docs/API_ROUTE_SECURITY_MATRIX.md` for the new POST verb (`check:api-routes`).
- The route header and service header.
- `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` (write paths and audit
  statuses), with `check:atlas`.
- The `prompt_publish_audit` status check: no migration needed. Create writes
  only `pending`, `completed`, `partial` or `failed`, which migration 093
  already allows; `name_exists` and `invalid_name` are HTTP responses, never
  audit rows. [VERIFIED via `lib/db/migrations/093_prompt_publish_audit_catalog_status.sql:10-14`]
- The scope-change doc and the agent wiki prompt-executor page.
- Tests: service (create, name exists, bad name, derived variables, replay,
  audit abort, concurrent create) and UI (form validation, placeholder list,
  success reload).

## Out of scope

- Drafts, deleting or renaming prompts, and connecting a prompt to an app.
- Editing variable sources in Admin.

## Open questions for Justin

1. **Name format.** [OWNER APPROVED] `team.task` style. The column's maximum
   length is still unread [ASSUMED]; the build caps names at 64 characters,
   well above the longest existing name (37).
2. **Placeholders added in later edits.** [OWNER APPROVED: yes] **Edit & publish** keeps the earlier
   version's variables. If someone adds a new `{{…}}` placeholder later,
   publish refuses it, which is today's behavior. Should **Edit & publish**
   also declare new placeholders automatically, without changing existing
   ones? For prompts an app already uses, a new required variable would fail
   that app's runs until the app supplies it.
3. **Who can add prompts.** [OWNER APPROVED: superuser-only] The plan keeps it superuser-only, like the rest of
   Admin → Prompts. Connor already has superuser access.
