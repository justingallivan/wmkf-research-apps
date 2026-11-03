---
title: Admin prompt groups — plan
kind: plan
domain: ai-platform
status: proposed
summary: Move the Admin prompt group list from code into a Dataverse setting so superusers can add, rename and reorder groups in Admin. No sections for new groups and no deletion.
canonical: false
cataloged: 2026-11-02
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md
  - docs/plans/ADMIN_ADD_PROMPT_PLAN_2026-11-02.md
---

# Admin prompt groups

[PLANNED — not built. Awaiting Justin's review.]

## Why

The prompt groups are hard-coded in `ADMIN_PROMPT_GROUPS`
(`shared/config/adminPromptCatalog.js:304-318`) [VERIFIED]. Adding one needs a
code change and a deploy. The Admin forms, the catalog-details server check
(`normalizeCatalog`, `lib/services/admin/prompts-catalog-service.js:54-60`) and
the page's placement logic (`resolveAdminPromptDescription`) all read that
constant [VERIFIED], so a group that isn't in it can't be used.

**[OWNER REQUEST 2026-11-02]** Let superusers add groups from Admin.

## Owner decisions (2026-11-02)

- **Store the list in Dataverse settings** (option A), not free-text groups.
- **No sections** for new groups.
- **No deletion.**
- **Order follows the proposal flow, then other apps.** You choose a new
  group's position when you add it, and you can move groups up or down later.

## Storage

One row in the existing settings table `wmkf_appsystemsettings`, key
`promptLibrary.groups`, through `lib/services/settings-service.js`
(`getSettingStrict` / `setSettingIfUnchanged`, which already exist [VERIFIED];
no route calls `setSettingIfUnchanged` yet, so its conflict behavior is checked
in the build). Value:

```json
{ "version": 1, "groups": [ { "id": "preflight", "label": "Pre-flight" } ] }
```

- **The array order is the display order.**
- **No setting yet → the current code list.** The first save writes the full
  list, so nothing moves on deploy.
- **Pinned groups are not stored.** "Uncataloged prompts" and "Legacy app
  prompts — stored reference" stay last, are not editable and can't be moved.
  Prompts with no usable group still land in "Uncataloged".
- **Sections stay in code.** The one existing group with sections
  ("Reviews and evaluations") keeps them by id. New groups have none.
- **IDs never change.** A prompt stores the group id, so renaming a label is
  safe. A new group's id is made from its label once (for example
  "Grant reporting" → `grant-reporting`) and kept even if the label changes.

## Admin

A **Manage groups** panel on the Prompts page:

- **Add group:** a label plus "Place after: [group]".
- **Rename:** edit a label in place.
- **Reorder:** ↑/↓ buttons.
- **Save** sends the whole list. If someone else saved first, it shows "Groups
  changed since you opened them" and asks you to reload.

The new group then appears in the Group dropdown in **Add prompt** and
**Edit details**, and as a section of the prompt list once a prompt uses it.

## Server

- **Read:** `GET /api/admin/prompts` also returns `groups` (the effective list,
  pinned groups included) and its revision. The page passes it to the forms and
  to `resolveAdminPromptDescription`, which takes the list as an argument
  instead of importing the constant.
- **Write:** `PUT /api/admin/prompt-groups` (superuser). It is a separate path,
  not `/api/admin/prompts/groups`, because that path would capture a prompt
  named `groups`, which the name rule allows. Body:
  `{ groups, expectedRevision, requestId }`. It refuses:
  - a missing existing id (no deletion);
  - a changed id;
  - a blank, duplicate or over-80-character label;
  - a pinned group in the list;
  - a stale revision (409 `groups_conflict`).
- **Validation on prompt writes** (`normalizeCatalog`, used by Edit details and
  Add prompt) reads the effective list from the setting instead of the
  constant.
- **Audit:** the settings row records who saved it last and when. No separate
  audit table, because this is display metadata only and changes no prompt.
  [OPEN — see below]

## Out of scope

- Sections for new groups, deleting groups, and moving prompts between groups
  in bulk. **Edit details** still moves one prompt at a time.

## Durable surfaces for the build PR

- `docs/API_ROUTE_SECURITY_MATRIX.md` (new route), with `check:api-routes`.
- The Atlas page for `wmkf_appsystemsettings` (new key) and the prompt Atlas
  page, with `check:atlas`.
- The scope-change doc and the agent wiki prompt-executor page.
- Tests: list validation (no deletion, immutable ids, pinned groups, stale
  revision), fallback to the code list, the new group usable by Edit details
  and Add prompt, and the UI (add, rename, reorder, conflict).

## Open questions for Justin

1. **Audit.** Is "last saved by / when" on the settings row enough, or do you
   want a history of every group change?
2. **Pinned groups.** Is it fine that "Uncataloged" and "Legacy" stay fixed at
   the bottom and can't be renamed?
