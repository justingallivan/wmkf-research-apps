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

**[OWNER DIRECTION, 2026-10-29; publication operation not implemented]** Future prompts share the existing
Dataverse prompt table, and Connor supplies the proposed group field. Admin and
Connor's coding tools both preserve versions and explicitly activate a version.
**Connor does not have to open Admin to publish.** The detailed technical contract
below remains proposed for the live operation. The
[local wire v1 specification](SHARED_PROMPT_WIRE_V1_2026-10-29.md) now has
executable structural schemas and hashes; it does not authorize or perform writes. Justin confirms Connor's agreement
to use the existing app prompt format in future PA flows; this does not imply
a deployed operation or permission for schema/data writes or model execution.

See the [implementation plan](SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md) and
[feasibility assessment](SHARED_PROMPT_PUBLICATION_FEASIBILITY_2026-10-29.md).

**[OWNER DECIDED]** Connor maintains the Dataverse operation/solution. Initial
human publishers are Connor and existing Admin superusers. Actual Dataverse
roles/mappings require verification and deliberate provisioning; app-role
changes and Dataverse-role changes must be coordinated explicitly.

The normative [format v1 contract](SHARED_PROMPT_FORMAT_V1_2026-10-29.md) and
[validated review](SHARED_PROMPT_REVIEW_VALIDATION_2026-10-29.md) define the local
foundation and deployment gates. See the [technical preflight](SHARED_PROMPT_PUBLICATION_PREFLIGHT_2026-10-29.md)
for source findings, client envelope, pinned policy, scoped budget coordination
and rehearsal cases.

**[OWNER CONFIRMED, per Justin]** Both routes use the existing app prompt
format stored in Dataverse; Connor will adopt it in future Power Automate flows.
Locating the historical flow is not a prerequisite to building, rehearsing or
releasing the shared library. Flow execution is separate integration work.

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
   for first publication), reconciled metadata baseline, explicit supported
   definition-format version and snapshot fingerprint.
   A draft opened without a recorded catalog baseline must explicitly refresh
   and reconcile before publication. Persist draft baseline in the proposed dedicated `wmkf_ai_draftbaseline` JSON
   column (current GUID/ETag, catalog snapshot and head revision); it is cleared
   atomically at publication. A changed definition gets a new UUID.
2. Server derives initiating/effective actor from execution context and verifies
   privilege and target environment. Caller
   labels/actor IDs cannot authorize writes. Admin must prove actor mapping and
   fail closed rather than silently attribute privileged writes to the app.
3. Check prior receipt BEFORE checking current freshness. Same authorized
   actor/key/operation/fingerprint returns the original receipt even if another
   version is now active. Changed reuse is a conflict. Fresh active state is
   returned separately, never confused with the historical publication result.
4. For a fresh publication, verify the exact installed policy-artifact version/hash.
   In one Dataverse transaction, acquire the budget coordination CAS first when
   the key has a registered token budget; then conditionally advance the unique
   per-key head,
   reread and validate shared state AND the supported definition format, assign
   the next version, conditionally promote the
   exact draft, clear the previous current flag, advance the head and create the
   unique append-only receipt. SDK row-version checks protect head, draft and
   prior row. Failure anywhere aborts everything. First publication uses the same
   head fence, not an unprotected absence check.
5. A receipt contains request/fingerprint versions, policy revision, actor,
   key/draft/prior/new IDs, snapshot hash, expected-state evidence, assigned
   version, definition-format version, pinned artifact hash and actual publication time. Receipt creation commits with the
   publication, not in a later Vercel/Postgres write.
6. A timeout means unknown. Query/retry the same UUID; never blindly publish with
   a fresh UUID. A concurrent duplicate receipt aborts the losing transaction;
   an outer retry retrieves the winner. A retried UUID that encounters head/
   receipt conflict MUST reread its receipt before surfacing an edit conflict:
   the initial lookup may have preceded the winner's commit. Unknown/unavailable
   reads remain unknown; retain UUID/draft without inventing a new publication.
   Existing corrupt lifecycle states block
   publication and require explicit recovery; never choose/delete a winner.

The head is a concurrency resource, not a second independent active authority.
Its active lookup and the existing current flags must agree in every commit.
Head and receipt tables are OrganizationOwned with explicit Org Read for approved
publishers and guarded mutations. Actor-bound retry still applies. Guard required
nonempty keys/UUIDs; do not enable writers before unique indexes are Active.
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
baseline, complete staged content/catalog hash, and submitted wire-contract,
definition-format and pinned policy-artifact version/hash. Store both hashes in the receipt. Reusing a UUID with ANY changed
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
exception outside the guarantee. Inventory actual holders of both Dataverse
bypass privileges before writer enablement, including maintainer/app identities;
do not infer their grants. Verify merged individual/bulk guard coverage without
executing the same guard twice. Existing legacy seed/upsert/force publishers
must be inventoried and migrated or disabled under coordinated cutover; never
silently leave a second publisher active. Existing historical Postgres receipts
remain replayable, but new shared publication truth lives in Dataverse.

## Two validation layers, one publication operation

**Shared publication rules** apply to every prompt and both authoring routes:
authorization/attribution, identity, lifecycle, expected state/catalog baseline,
immutable history, increasing published versions, atomic active-version change,
audit receipt and request-bound retries.

**Execution-format validation** checks the complete stored definition under the
server-supported format version: templates/placeholders, variable declarations,
output definitions and applicable model, token, A7 and caller-contract rules.
The first release uses the EXISTING APP PROMPT FORMAT, including its established
supported variants, for Admin and Connor's tools. This is not an extra external-
flow format or a generalized profile system. Group, category and Used by are
editorial; they cannot select weaker validation or authorize execution.

Both layers run in the same Dataverse publication operation before commit.
Separating their responsibilities does not create a lifecycle-only bypass.
The supported format version is bound into the immutable request fingerprint
and receipt; unknown versions cannot publish. Metadata-only organization does
not need content publication. Existing raw-text/JSON/native-structured variants
retain their actual requirements; not every prompt needs native JSON Schema.
Registered application budgets remain checked for their governed prompt keys;
a new PA prompt need not join the app's code-owned budget registry to publish.

Package one immutable reviewed format-policy artifact with both JS and the .NET
operation; exact version/hash and frozen tier/default-model mapping are checked
and recorded. No mutable policy-activation settings/control row in v1. Policy
replacement disables BOTH publication routes server-side and drains in-flight
operations before deployment/re-enable. Old successful receipts replay under
their original fingerprint; new mismatched clients cannot publish.

Retain a budget-only coordination CAS for registered token-governed prompt keys
and the existing JS budget publisher. Bind its commit to the ORIGINAL control
revision captured before validating the exact model/history snapshot. New PA/
generic names and timeout-only keys do not take this guard. Runtime caps remain
necessary but do not establish stored budget/model consistency. Implement/test
this after foundation mocks and before enabling new governed writers. The
validated review records the counterexamples; no platform correctness is claimed
until sandbox proof. Publication makes no model call.

## Execution and legacy compatibility

Publication accepts a stored definition; it does not execute it, create a flow,
or prove any caller implements every declared input/source/target feature.
Applications retain runtime capability, security and output-write guards. Future
PA flows own triggers, input gathering, native-document assembly where applicable,
model invocation and result handling while adopting the common stored format.
A new PA Executor, native-PDF support in the app Executor or new provider support
is not included or implied.

The read-only `phase-i.checkin` example uses human-readable output instructions
and native-PDF intent rather than the complete app definition. Preserve it as
legacy content; no automatic rewriting, Draft conversion or activation. A custom
legacy-format publisher or migration of that historical flow is deferred and
NOT a library build/rehearsal/release prerequisite. Its actual caller remains
unverified; this does not block new common-format prompt authoring/publication.

New general-purpose authoring initially supports caller-supplied inputs and
returned text/JSON (`target.kind: none`); preserve existing supported advanced
Dataverse/SharePoint/field-output definitions. New direct-write mapping controls
are separate scope. Apps and adapted flows resolve exact key + sole current
Published row and record exact GUID/version per execution; never select a Draft
or latest-modified row. Preserve intentional application fallbacks and disclose
cache behavior. Do not claim existing PA flows were rewired or tested.

A breaking input/output change needs caller coordination, preferably a new key.
A future flow needs its own end-to-end execution acceptance before being called
working, but the library and both publication clients can be built/rehearsed
using a new common-format fixture with no PA flow or model execution.

## Local implementation and deployment gates

- Start local schema/artifact/golden vectors, pure validation, reader tests,
  client mocks and reusable plug-in source now. Use the normative format v1.
- Connor owns solution maintenance; tooling gates .NET compilation/import;
  authorized sandbox deployment and actual mapped roles gate tenant proof.
- Prove transactional context, uniqueness, head/draft/current conditional writes,
  replay, lost-response recovery, raw/bulk write denial and trusted attribution.
- Verify nullable draft versions and legacy state/head initialization.
- Prove JS/.NET parity before enabling writers; run the authorized complete
  current-row validator audit before cutover. Preserve application checks and
  the scoped budget consistency guard; there is no live mutable policy service.
- Use a new common-format test prompt for both-client publication rehearsal;
  historical-flow discovery/migration and future PA execution are separate work.
- Explicitly authorize Production provisioning/cutover separately.

**[PLANNED budget-policy parity]** The budget publisher must replace its current
dynamic tier/model resolution with the SAME pinned tier/default/capability
artifact used by prompt publication. Coordination alone cannot protect a pair
validated against different model ceilings. Policy deployment disables and drains
governed budget writes as well as both prompt publication routes, then revalidates
all governed active budget/model pairs against the new artifact before re-enabling
writers. Reject incompatible pairs for explicit remediation. Shared golden cases
cover differing dynamic versus pinned tier ceilings and policy upgrades.
