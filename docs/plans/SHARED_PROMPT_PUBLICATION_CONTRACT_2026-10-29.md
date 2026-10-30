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

**[OWNER DIRECTION, 2026-10-29; not implemented]** Future prompts share the existing
Dataverse prompt table, and Connor supplies the proposed group field. Admin and
Connor's coding tools both preserve versions and explicitly activate a version.
**Connor does not have to open Admin to publish.** The detailed technical contract
below is proposed for implementation; it is not evidence of Connor's acceptance,
a deployed operation, or permission for schema/data writes or model execution.

See the [implementation plan](SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md) and
[feasibility assessment](SHARED_PROMPT_PUBLICATION_FEASIBILITY_2026-10-29.md).

**[OWNER DECIDED]** Connor maintains the Dataverse operation/solution. Initial
human publishers are Connor and existing Admin superusers. Actual Dataverse
roles/mappings require verification and deliberate provisioning; app-role
changes and Dataverse-role changes must be coordinated explicitly.

See the [technical preflight](SHARED_PROMPT_PUBLICATION_PREFLIGHT_2026-10-29.md)
for source findings, client envelope, validation-policy fence and rehearsal cases.

## One library, two authoring routes

Dataverse `wmkf_ai_prompt` stores prompt content. `wmkf_ai_promptname` is the
stable technical key used by callers; titles and group labels never rename it.
Admin discovers all names without source-code registration. Missing metadata is
visible under Needs organization. A shared library does not prove a flow exists
or make a definition compatible with the application's Executor.

Proposed metadata fields: `wmkf_ai_displaytitle`, `wmkf_ai_description`,
`wmkf_ai_groupkey`, optional `wmkf_ai_sectionkey`, `wmkf_ai_usedby`,
`wmkf_ai_usagecategory`. Group/section keys come from the `prompt-library.groups`
setting in `wmkf_appsystemsetting`; labels/order can change without deployment.
Used by is an editorial declaration, not permission or execution evidence.

| Action | Admin | Connor's coding tools |
|---|---|---|
| Discover/read | Shared Dataverse inventory | Same table/catalog |
| Create/edit | Save a noncurrent Draft | Direct Dataverse draft save or supported importer |
| Organize | Audited metadata-only save | Same allowed metadata columns with ETag |
| Publish | Button calls shared Dataverse Action | Authenticated command calls the same Action |
| Execute | Existing application caller | Existing Power Automate flow/caller |

Both clients preserve the complete definition, enforce stale-edit conflicts and
show durable row IDs/receipts in restricted diagnostics. Normal UI uses readable
names. Neither client rewrites unfamiliar definitions to fit its own runtime.

## Drafts and published versions

| Row state | Current | Status | Version | Allowed edits |
|---|---|---|---|---|
| Draft | false | `682090000` | Unassigned | Content/metadata with expected ETag |
| Current published | true | `682090001` | Positive integer | Audited metadata only |
| Historical published | false | `682090001` | Original positive integer | Content remains immutable |
| Retired | false | `682090002` | Original version | Explicit recovery only |

Version is `wmkf_promptversion` (no `_ai_` infix). Draft identity is its GUID,
not a reserved published number. The retained schema marks version
ApplicationRequired; Microsoft documents that
this alone does not reject null through API clients. Tenant custom-rule and
numeric-range behavior still needs rehearsal; if incompatible, stop and review an additive draft-storage adjustment. Do not
silently use a sentinel or revert to version reservation. Do not automatically
convert legacy noncurrent/null-status rows into drafts.

The Dataverse publisher assigns the next number when activating a draft, above
all existing historical/reserved numbers. Draft saves never increment it. A
published definition is never edited in place, renumbered or upserted over.
Rollback copies reviewed historical content into a new draft and publishes a
new higher version. Catalog-only edits do not publish content or stamp test dates.

## Shared publication operation

**[PLANNED]** A synchronous Dataverse Custom API Action with .NET plug-in logic
owns publication. Admin remains superuser/session authenticated and invokes it
server-side through the guarded Dataverse adapter. Connor's supported command
uses delegated Entra OAuth and his authorized Dataverse user; no Admin cookie
or fabricated profile ID. Both routes are included in the first publication
release. Unattended service-principal tooling is separate scope.

1. Save the draft and read active state. Submit request UUID, exact draft
   GUID/ETag, expected head revision and active GUID/version/ETag (explicit null
   for first publication), reconciled metadata baseline and snapshot fingerprint.
   A draft opened without a recorded catalog baseline must explicitly refresh
   and reconcile before publication. Persist draft baseline in the proposed dedicated `wmkf_ai_draftbaseline` JSON
   column (current GUID/ETag, catalog snapshot and head revision); it is cleared
   atomically at publication. A changed definition gets a new UUID.
2. Server derives initiating/effective actor from execution context and verifies
   privilege, target environment and supported validation-policy revision. Caller
   labels/actor IDs cannot authorize writes. Admin must prove actor mapping and
   fail closed rather than silently attribute privileged writes to the app.
3. Check prior receipt BEFORE checking current freshness. Same authorized
   actor/key/operation/fingerprint returns the original receipt even if another
   version is now active. Changed reuse is a conflict. Fresh active state is
   returned separately, never confused with the historical publication result.
4. In one Dataverse transaction, conditionally advance the unique per-key head,
   reread and validate state, assign the next version, conditionally promote the
   exact draft, clear the previous current flag, advance the head and create the
   unique append-only receipt. SDK row-version checks protect head, draft and
   prior row. Failure anywhere aborts everything. First publication uses the same
   head fence, not an unprotected absence check.
5. A receipt contains request/fingerprint versions, policy revision, actor,
   key/draft/prior/new IDs, snapshot hash, expected-state evidence, assigned
   version and actual publication time. Receipt creation commits with the
   publication, not in a later Vercel/Postgres write.
6. A timeout means unknown. Query/retry the same UUID; never blindly publish with
   a fresh UUID. A concurrent duplicate receipt aborts the losing transaction;
   an outer retry retrieves the winner. Existing corrupt lifecycle states block
   publication and require explicit recovery; never choose/delete a winner.

The head is a concurrency resource, not a second independent active authority.
Its active lookup and the existing current flags must agree in every commit.
Head identity uses the lowercase ASCII canonical key, not case-sensitive raw
bytes: Dataverse string filters are case insensitive. New case-equivalent aliases
are rejected by direct-write guards and publication. Preserve original legacy
spelling, audit reader-equivalent collisions before initialization, and block
unsupported keys for explicit mapping rather than creating another head.
Unique head creation and first-publish races are specified in the implementation
plan and must be proved in sandbox before rollout.

A content hash and request fingerprint are distinct. The versioned canonical
request fingerprint binds operation, canonical/original key, authenticated actor,
draft GUID/ETag, expected head revision and active GUID/version/ETag, metadata
baseline, complete staged content/catalog hash, and submitted contract/policy
revision. Store both hashes in the receipt. Reusing a UUID with ANY changed
request field is rejected, even for identical text in a different draft. An
unchanged successful replay returns its original receipt before checking newer
state or policy; authorization is still required. A fresh request must use the
currently accepted policy. Never rebuild the replay fingerprint from today's
active row, generated publication time or latest policy.

## Direct writing and enforcement

Connor may write directly to noncurrent Draft rows and populate the group field.
That does not require Admin. Both routes use the shared Action to activate a
version. Synchronous Dataverse guards reject raw lifecycle/version changes,
published-content edits/deletes and direct head/receipt writes outside the trusted
operation. Audit metadata-only edits transactionally. Cover relevant bulk paths,
not just individual Create/Update. No client-controlled bypass flag is allowed.

These protections must be deployed before claiming a common publication contract.
Privileged administrators disabling/bypassing plug-ins are an operational
exception outside the guarantee. Existing legacy seed/upsert/force publishers
must be inventoried and migrated or disabled under coordinated cutover; never
silently leave a second publisher active. Existing historical Postgres receipts
remain replayable, but new shared publication truth lives in Dataverse.

## Validation and execution

A generated versioned policy artifact is the recommended shared rule source.
Policy and Executor-budget activation must share a Dataverse conditional control
row with fresh publications; snapshot checks without that fence are insufficient.
Both JS/.NET use golden vectors; details and adjacent budget-writer scope are
in the technical preflight. This design is not yet implemented or parity-tested.


Publish validates the complete supported definition without making a model call.
Dataverse must enforce the shared lifecycle/definition rules for both clients;
Admin-only checks are insufficient. JS/.NET parity fixtures and the availability
of current reviewed model/budget policy at the operation are implementation
gates. Unknown definitions or policy revisions fail closed for publication while
remaining discoverable and editable as drafts. Catalog organization remains
available for unsupported definitions.

The read-only probe found Connor-attributed `phase-i.checkin`, with a native PDF
input intent and human-readable output instructions instead of machine JSON
Schema. Its actual Power Automate binding/model assembly is still unverified;
see the technical preflight. Define an explicit external-flow validation profile
before claiming this format can publish. Do not label it corrupt merely because
it differs from Executor JSON. Do not require adopting the
Vercel Executor merely to join the library. New general-purpose Admin authoring
initially supports caller-supplied inputs and returned text/JSON (`target.kind:
none`); preserve existing advanced definitions. New providers/direct field-write
mapping controls and a Power Automate Executor are separate scope.

Apps and adapted flows resolve exact technical key + exactly one current
Published row, not latest-modified or a Draft. Record exact prompt GUID/version
per execution. Missing/duplicate/invalid active state is an error; preserve
explicitly designed existing fallback semantics during reader migration.
Existing resolver caches can temporarily serve the prior immutable version;
audit TTL/invalidation and avoid promising immediate global activation.

Power Automate keeps its triggers, input gathering and output handling. Publishing
does not execute a prompt or create a flow. A breaking input/output change needs
caller coordination, preferably a new technical key. Existing flows are not
silently rewired. No flow definition or caller migration was tested by this plan.

## Pre-implementation gates

- Connor owns solution maintenance; verify his tooling, authorized sandbox deployment
  and actual mapped publisher roles.
- Prove transactional context, uniqueness, head/draft/current conditional writes,
  replay, lost-response recovery, raw/bulk write denial and trusted attribution.
- Verify nullable draft versions and legacy state/head initialization.
- Verify the discovered Connor example's actual flow/model/input assembly and
  specify its external-flow profile plus shared validation-policy transport.
- Explicitly authorize Production provisioning/cutover separately.
