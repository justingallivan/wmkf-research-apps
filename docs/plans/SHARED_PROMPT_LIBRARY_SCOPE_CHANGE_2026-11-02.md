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

## New shape (for Codex to plan)

[PLANNED — not designed or built]

- **Publish in Admin's server.** Use ordinary Dataverse writes through the DAL
  (`withDalContext`), made conditional on the row's ETag (`If-Match`). A
  concurrent change then fails instead of being overwritten. Admin
  auth/app-access remains the only publish permission.
- **Show drafts written directly in Dataverse.** Admin must list and publish
  drafts Connor creates outside Admin.
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
