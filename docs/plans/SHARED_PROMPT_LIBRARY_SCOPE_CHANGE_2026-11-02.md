---
title: Shared Prompt Library Scope Change — Admin Publishing, No Dataverse Plug-in
kind: plan
domain: ai-platform
status: active
summary: Owner decision 2026-11-02 — drop the Dataverse plug-in, write guards and Windows/registration track; Connor drafts in Dataverse and publishes from Admin. Supersedes the PR553 Custom API publication design.
canonical: false
cataloged: 2026-11-02
owner: product-engineering
related:
  - docs/plans/PR553_MONDAY_RESUME_2026-11-02.md
---

# Shared prompt library: scope change

## Decision

[OWNER DECISION, Justin with Connor, 2026-11-02]

1. **No write protection inside Dataverse.** Access to the prompt tables is
   already tightly limited: only Connor holds most permissions. Regular
   users have neither the motive nor the means to edit prompts. Accidental
   or unauthorized edits are not a risk this feature needs to address.
2. **No Dataverse plug-in.** Option B was chosen: there is no Custom API and no
   .NET publisher, and nothing is registered in Dataverse.
3. **Connor publishes from Admin.** He keeps writing drafts directly in
   Dataverse with his own tools. Making a version live is done in Admin, by
   Connor or Justin. Connor cannot run the repo's Node scripts, so a
   command-line publisher was ruled out.

This supersedes the following on branch `codex/shared-prompt-library-plan`
(PR #553):

- The 2026-10-29 direction that "Connor must be able to publish from his
  coding tools without opening Admin".
- The "Shared Dataverse publication operation" design (Custom API Action
  plus synchronous write guards) in `SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md`.
- The Windows-check, signing, registration, guard-activation and enablement
  sequence (operator checklist, activation, exact-registration and Monday
  resume records).

[VERIFIED via owner instruction] The Windows09 offline check was not run and
is no longer needed.

## Original outcome, unchanged

From the branch plan's "Outcome and boundary" section:

- Justin and successors create, organize and edit prompts in Admin
  without working in Dataverse.
- Connor keeps authoring against Dataverse with his own tools.
- Both of them see the same library.
- Versions are preserved, and a version goes live only through an explicit
  publish step.

## What already exists on main

[VERIFIED via source on `main` at `4e52d2018`] Much of Option B already exists:

- **Versioned publish of an existing prompt.** Admin publishes a new version of
  an existing prompt through `pages/api/admin/prompts/[name].js` and
  `lib/services/admin/prompts-publish-service.js:1-20`. A publish creates
  version v+1, switches the previous version off with `If-Match`, checks that
  exactly one current version remains, and records an audit entry. It is
  idempotent on replay.
- **Inventory includes prompts no app uses.** The Admin list
  (`lib/services/admin/prompts-list-service.js:8-12`) shows every prompt name.
  A name that has only non-current rows appears as a draft.
- **Superuser-only.** Both routes require a superuser
  (`pages/api/admin/prompts/index.js:21`, `[name].js:29`).
- **How apps select a prompt.** App readers pick a row by `wmkf_ai_promptname`
  plus `wmkf_ai_iscurrent` (`lib/dataverse/adapters/ai-prompt.js:5,72-73`). A
  new prompt under a name no app uses cannot be picked up by an app. Connor
  must not reuse an existing app prompt name.

**Gaps.**

- **First publish of a brand-new prompt.** Publishing a name that has no
  current row returns `404 no_current_row` ("seed it before versioned
  publish"; `prompts-publish-service.js:123`).
- **Organizing fields.** The six catalog columns now exist (see
  [Catalog columns](#catalog-columns)), but Admin neither shows them nor copies
  them to a new version yet.
- **Connor's superuser access:** [OWNER REPORTED 2026-11-02] Connor has it.

**Owner-reported context, 2026-11-02.** Connor has no draft prompts in
Dataverse yet. His current prompts are free text that Power Automate reads.
He plans to add them to this same table, and he can sign in to Admin.
Pointing his Power Automate flows at the table stays outside this work.

## Catalog columns

**[OWNER DECISION 2026-11-02]** Add all six catalog columns from the original
plan, in Production and the sandbox.

[VERIFIED via the `apply-dataverse-schema.js` run and a metadata readback,
2026-11-02] All six exist on `wmkf_ai_prompt` in both environments. All are
optional, and the types and lengths match
`lib/dataverse/schema/wave36-prompt-catalog/`:

| Column | Type | Length |
|---|---|---|
| `wmkf_ai_displaytitle` | String | 200 |
| `wmkf_ai_description` | Memo | 4,000 |
| `wmkf_ai_groupkey` | String | 80 |
| `wmkf_ai_sectionkey` | String | 80 |
| `wmkf_ai_usedby` | Memo | 4,000 |
| `wmkf_ai_usagecategory` | String | 40 |

- **Production:** created by the run, under Justin's same-day approval
  (`DATAVERSE_PROD_WRITE_ACK`). The script binds new columns to solution
  `wmkfResearchReviewAppSuite` (`scripts/apply-dataverse-schema.js:25-26`).
  Solution membership was not read back separately.
- **Sandbox:** the columns already existed before the run, which reported them
  as present. [ASSUMED] They came from earlier PR553 test-schema work.
- **Not changed:** no rows were written and no code reads these columns yet.
  The draft-baseline column was not added, because Admin's existing `If-Match`
  publish already catches concurrent edits.

## Backfill plan for existing prompts

[PLANNED — needs separate approvals at steps 3 and 5]

1. **Copy the columns forward in Admin first.** Today a publish builds the new
   version from an explicit field list
   (`lib/services/admin/prompts-publish-service.js:263-277`), so it would drop
   the catalog values.
   - Make publish copy all six from the prior current row.
   - Add them to the Admin row projection and the inventory list, so they are
     visible.
   - Until this ships, backfilled values would vanish on the next publish.
2. **Draft the values from code; no Dataverse read is needed.** For each
   prompt name defined under `shared/config/prompts/` or in a seed script,
   propose all six values:
   - Title and description, from the definition and its caller.
   - Group and section, by app area.
   - Used by: the calling app or service.
   - Usage category: `application` for app-wired prompts, `unclassified`
     otherwise.

   Justin and Connor edit this table before anything is written.
3. **Take a read-only Production inventory.** Collect every prompt name's
   current row: ID, ETag, version, and whether any catalog value is already set.
   - Flag names found in Dataverse but missing from the code table, such as
     prompts Connor added; those need values from Connor.
   - Flag any name with zero or several current rows.
   - This is a Production read and needs Justin's approval.
4. **Check that rewriting a row is safe for readers.** Before writing, confirm
   on `main` that no reader refuses a prompt row because it was modified. The
   known checks compare variables, output schema and body only. Look for
   `modifiedon`, `versionnumber` or ETag dependence.
5. **Write each row once, conditionally.** Write the six catalog columns only
   to each name's current row, or to its latest row when no current row exists.
   - Each write is a DAL update with `If-Match` on the inventoried ETag. A row
     that changed since the inventory fails and is reported, not retried
     blindly.
   - Do it outside any publish activity.
   - Production writes need a same-day `DATAVERSE_PROD_WRITE_ACK`.
   - The sandbox goes first, as a rehearsal.
6. **Keep a record.** Commit a before/after receipt per row under
   `docs/plans/evidence/`: name, row ID, old and new values, and outcome. The
   receipt is needed because this script does not write the Postgres
   `prompt_publish_audit` that the publish route does.
7. **Then Connor adds his prompts,** filling in the catalog fields as he goes.
   He must not reuse an existing app prompt name.

Historical versions are not backfilled. Catalog metadata describes the prompt
as it is now; it is not a historical record.

## New shape (for Codex to plan)

[PLANNED — not designed or built]

- **Extend Admin's existing publish flow; don't build a new one.** Add a first
  publish for a new prompt name, plus whatever organizing fields Justin
  approves. Keep the existing `If-Match`, single-current, audit and idempotency
  behaviour.
- **Show drafts written directly in Dataverse.** The inventory already lists
  them. The gap is publishing one when the name has no current row.
- **Expect states Admin did not create.** With no guards, Admin must detect and
  clearly report rows it did not produce, rather than guess: zero or several
  current versions for one key, versions out of sequence, edited published
  content.
- **Reuse the JavaScript validation.** The format, template and limit checks
  already written on the branch (`lib/prompt-publication/`) are the candidate
  rules for the publish step. Re-review them for the new caller.
- **Reconsider the extra tables.** The head (current-version) and receipt
  tables existed mainly to make the plug-in's transaction and retry safe. Decide
  whether status and version columns on the existing prompt rows are enough
  before provisioning anything new.

## Dropped

[VERIFIED via branch file list at local head `9d838c4c8`] These are no longer
needed and should not be merged:

- `dataverse/prompt-publication/` (C# Transport, Checks, Package and
  PackagingTool, plus the registration and rehearsal material).
- The PR553 signing, packaging, registration, guard-preparation and activation
  scripts under `scripts/` and `scripts/lib/pr553-*`.
- The quiet-window writer freeze.

The review findings that applied only to guards no longer apply: the
merged-pipeline bulk denial, trusted-write matching, the settings-table-wide
guard and the frozen budget/group writers.

**Local-only material.** The private signing key, the Windows handoff bundles
and `output/connor-windows09-offline-checks/` are untracked and local. Keep
them until Justin decides to dispose of them. They must never enter Git.

## Carried forward — still open

[VERIFIED via read-only review of local head `9d838c4c8`, 2026-11-02] These
apply whichever publication mechanism is used:

1. **Blocker: Pre-Site output schema.**
   `shared/config/prompts/pre-site-visit-proposal-core.js` drops `maxLength`
   from the output schema. The reader in
   `lib/services/pre-site-visit/artifact-model.js` requires the live row's
   schema to match the constant exactly. Merging without updating the live row
   in the same release would fail every Pre-Site generation. Hold the schema
   change until the row cutover.
2. **Risk: Initial Assessment reads the live row before claiming.** Any drift
   between the live variables or output schema and the code constant now
   returns 409. The prompt version comes from the live row. Check this against
   the live row before release.
3. **Risk: test-request IA seeding.** It now requires exactly one matching
   current `initial-assessment.generate` row in the sandbox.
4. **Risk: the pause flag parses strictly.** Only unset, empty or exactly
   lowercase `off` means open; `false` or `OFF` pauses Pre-Site generation.
5. **Merge base.** The branch base is 222 commits behind `main`. Two test files
   conflict, and several runtime files changed on `main` since the base (the
   terminology PRs #596–#601) need a semantic re-check.
6. **Legacy test rows.** The two Published v1 rows in the test org have no
   current-version record. The new design must handle them, but it no longer
   needs to do so before guards go on.

## Ownership and next step

- Codex owns PR #553 and the replanned design. Claude made no changes to that
  branch and made no Dataverse calls.
- Next: Codex proposes the reduced plan and which branch commits to keep. Get
  Justin's review before building.
