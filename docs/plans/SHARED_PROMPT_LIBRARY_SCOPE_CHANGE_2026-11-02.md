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

- **First publish of a brand-new prompt.** [PRODUCTION-LIVE
  2026-11-02: PR #610, merge `6648f2a18`; owner smoke pending] Owner decision
  2026-11-02 (option A): publishing a name that has no current row copies its
  latest draft row, with any edits made in Admin, into a new current row at
  max version + 1. The draft row is left unchanged, so later direct edits to it
  do not reach the live prompt. The new row is stamped Published and its
  pending/final audit names the draft as `prior_prompt_id`. Nothing is flipped,
  so two simultaneous first publishes are caught only afterwards, as `partial`
  with `invariant_violation_current_count_2` (accepted: superuser-only).
  `404 no_current_row` now means no rows exist for the name. Before this, such a
  publish returned `404 no_current_row` ("seed it before versioned publish").
- **Organizing fields.** [DONE 2026-11-02] Admin shows, carries forward and
  edits the six catalog columns; see [Catalog columns](#catalog-columns).
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

## Backfill of existing prompts — done 2026-11-02

[VERIFIED via per-row readback, 2026-11-02 22:05 UTC] All 40 Production
prompt names now carry the six catalog values. Each was written once under
Justin's same-day approval (`DATAVERSE_PROD_WRITE_ACK`). Steps as run:

1. **Admin copies the columns forward.** Merged in PR #606 (`adb674d73`) and
   deployed to Production before the write. A publish copies all six from the
   prior current row, and so does a `prompt-seed.js` `--force` recovery version.
   The Admin prompts page prefers stored values and falls back to the code
   catalog.
2. **Values came from the code catalog.** Admin's existing
   `ADMIN_PROMPT_CATALOG` in `shared/config/adminPromptCatalog.js` already held
   title, description, group, section, used-by and usage for all 40 names. Each
   maps one-to-one onto a column, so the Admin page shows the same text,
   now read from Dataverse. Justin waived a separate value review for that
   reason.
3. **Read-only Production inventory** (owner-approved):
   `docs/plans/evidence/prompt-catalog-inventory-prod-2026-11-02.json`.
   - 61 rows across 40 names.
   - Every name was in the code catalog, and every catalog entry was in
     Dataverse.
   - No duplicate-current rows, and no catalog values were already set.
   - The one exception: `phase-i.checkin` has a single non-current v1 row. That
     row was the target.
4. **Readers are safe.** [VERIFIED via grep on `main`] No prompt-row reader
   depends on a prompt row's `modifiedon`, `versionnumber` or ETag.
   - The hits in `final-writeup/transition-model.js`,
     `pre-site-visit/reopen-service.js`, `execute-prompt.js:489` and
     `test-requests/run-runner.js` concern request, request-document or
     suggestion rows.
   - Prompt IDs and versions are unchanged.
5. **Conditional write.** Each target row got one PATCH of the six columns,
   with `If-Match` on the inventoried ETag, then a readback.
   - The dry run showed no ETag drift, and all 40 were `written_verified`.
   - Justin waived the sandbox rehearsal, because the values are
     display-only and reversible.
6. **Receipt:** `docs/plans/evidence/prompt-catalog-backfill-prod-2026-11-02.json`
   records, per row, the name, row ID, ETags, before and after values,
   PATCH status and readback. It is needed because this write did not go
   through the Postgres `prompt_publish_audit`.
7. **Editing in Admin** [OWNER DECISION 2026-11-02; VERIFIED deployed in PR
   #608 `d108f21a1`, after migration 093 was applied]
   - Admin → AI → Prompts → **Edit details** saves the six fields in place,
     with no new version.
   - Group, section and usage are chosen from the existing lists.
   - Each edit is audited in `prompt_publish_audit`, which needs migration
     093 applied to Production Postgres before the code deploys.
   - Clearing a field makes the page fall back to the built-in code catalog
     text; it does not go blank.
8. **Next: Connor adds his prompts,** filling in the catalog fields as he
   goes. He must not reuse an existing app prompt name. Publishing a brand-new
   name still needs the first-publish gap closed (see below).

Not backfilled:

- Historical versions. Catalog metadata describes the prompt as it is now.
- The sandbox prompt rows.
- The code catalog itself. It remains the fallback until a decision is made to
  retire it.

## New shape (for Codex to plan)

[PLANNED — not designed or built]

- **Extend Admin's existing publish flow; don't build a new one.** Add a first
  publish for a new prompt name, plus whatever organizing fields Justin
  approves. Keep the existing `If-Match`, single-current, audit and idempotency
  behaviour.
- **Show drafts written directly in Dataverse.** The inventory already lists
  them. Publishing one when the name has no current row is live (PR #610);
  see Gaps above.
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
