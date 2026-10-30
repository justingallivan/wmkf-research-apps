---
title: Shared Prompt Library Implementation Plan
domain: ai-platform
kind: plan
status: proposed
summary: Shared prompt library with local JS contracts and compiled SDK lifecycle/persistence/guard evaluators; production rule composition, registered publication and clients remain pending.
canonical: false
cataloged: 2026-10-29
last_verified: 2026-10-30
owner: product-engineering
related:
  - docs/atlas/dataverse-wmkf-ai-run-and-prompt.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
---

# Shared prompt library

## Outcome and boundary

**[OWNER DIRECTION]** Justin and successors can create, organize, and edit prompts
in Admin without working directly in Dataverse. Connor can continue authoring
with coding tools against Dataverse and use Admin for small changes. Both see
the same library, including prompts with no application-code registration.

**[PLANNED]** Dataverse owns prompt content, descriptive metadata, workflow labels,
ordering, assignments and shared publication enforcement. Dataverse owns common
validation/privileges; Admin adds session permissions, validation feedback and
rendering.
Creating or classifying a prompt requires no deployment. Creating a prompt does
not create a Power Automate flow, grant execution permission, or wire an app caller.
No Power Automate execution bridge is included in this work. Existing application
consumers, model/provider policy, and execution budgets remain separate contracts.

**[OWNER DIRECTION, 2026-10-29]** Future prompts belong on the existing prompt
table; Connor will populate the proposed group field. Both authoring routes
preserve versions and explicitly activate a version. Connor must be able to
publish from his coding tools without opening Admin. This supersedes the
Admin-only first-release publication proposal.

**[OWNER CONFIRMED, per Justin]** Connor agrees that the existing app prompt
format stored in Dataverse can be adopted by his future Power Automate flows.
Use that common definition format for both authoring routes in the first release.
Locating the historical Power Automate flow is NOT a prerequisite for building,
rehearsing or releasing the library and its two publication clients. Actual
execution by a future flow remains that flow's integration acceptance task.

This document governs the implementation; no schema has been deployed. The offline definition/wire/fingerprint foundation is implemented in
`lib/prompt-publication/` with portable fixtures and unit tests. It is not wired to
live routes or the existing budget/prompt publishers. Complete structural validation exists; consumer-specific
restrictions now cover 39 audited names, all locally passing with reviewed models;
`phase-i.checkin` remains held for a common execution definition. Initial
Assessment version capture and Pre-Site native schema are reconciled locally. Shared
pinned budget checks, the unused atomic budget adapter and an unwired transaction
reference core exist. Compiled .NET SDK lifecycle/persistence, wire contracts, authorization/write-guard
evaluators and a source-hashed sandbox rehearsal packet now exist. Production
format/budget/catalog rules, registered entry, full parity and tenant proof remain
pending. See [publisher milestone](SHARED_PROMPT_PUBLISHER_MILESTONE_2026-10-30.md)
and [SDK checkpoint](SHARED_PROMPT_SDK_MILESTONE_2026-10-30.md). An offline Pre-Site transition planner and separately
backportable runtime pause guard prepare the coordinated release; see
[transaction milestone](SHARED_PROMPT_TRANSACTION_MILESTONE_2026-10-30.md). Remaining holds and
.NET/tenant/cutover proof are tracked in
[consumer compatibility](SHARED_PROMPT_CONSUMER_COMPATIBILITY_2026-10-30.md). See that
directory's README and
[local implementation record](SHARED_PROMPT_LOCAL_FOUNDATION_2026-10-29.md) for
invariants and remaining local milestones. The retained
schema probe was read-only. This revision checks Microsoft platform documentation
and repository source and includes a subsequent owner-authorized read-only
example probe; it performs no tenant provisioning, live writes or model execution. The linked historical AI-run form was read separately; it did not
establish the originating flow definition or prompt format.

## Verified baseline

**[VERIFIED via `scripts/probe-shared-prompt-library-schema.js`, Production,
2026-10-29T23:22:42Z]** Retained complete paging evidence:
[`evidence/shared-prompt-library-schema-2026-10-29.json`](evidence/shared-prompt-library-schema-2026-10-29.json).
The evidence records exact request paths, table metadata, keys, column limits,
choice values, and prompt name/version/current/status only; no prompt text,
variable values, credentials, or model output.

| Surface | Verified result | Consequence |
|---|---|---|
| `wmkf_ai_prompt` / `wmkf_ai_prompts` | 18 custom metadata attributes, including 2 read-only virtual label attributes | 16 writable custom fields, not 18 new authoring controls |
| Content | System, body, variables JSON, output-schema JSON: Memo, each max 1,000,000 characters | Existing Admin body validation is stricter: 65,536 characters; do not silently relax it |
| Identity/model | Technical key `wmkf_ai_promptname`: String 850; model: String 100 | New Admin keys should use a conservative normalized `<domain>.<purpose>` grammar; preserve existing keys |
| Lifecycle | `wmkf_promptversion`: Integer; `wmkf_ai_iscurrent`: Boolean; published timestamp: DateTime | Preserve existing same-name/version-row model |
| Status | Draft `682090000`, Published `682090001`, Retired `682090002` | Current flag and status are distinct, and must be validated together |
| Other fields | `wmkf_ai_notes`: Memo 1,000,000; last-test/preflight dates; temperature; max tokens; rollback-from Integer | Do not repurpose Notes or assume rollback-from is a lookup; no test/preflight dates may be stamped without actual checks |
| Descriptive metadata | No title, description, workflow group/subgroup, Used by, or usage-category column on this table | Dedicated additive columns are needed for the proposed row-level authoring contract |
| Concurrency | Optimistic concurrency enabled; no alternate keys | ETags are available; duplicate-name/version and first-publish safety are not schema-enforced today |
| Inventory | 59 rows, 40 distinct names, 39 current; `phase-i.checkin` has no current row and its sole row has null status; no duplicate-current names in this snapshot | The existing no-current/null-status name needs explicit recovery; zero duplicates today is not a concurrency guarantee |
| `wmkf_appsystemsetting` | Key String 255, value Memo 100,000; active unique key on `wmkf_settingkey`; concurrency enabled | Suitable existing home for small shared workflow-group configuration |
| Proposed setting key | `prompt-library.groups` absent | It must be seeded deliberately, not assumed available |

The custom-entity name scan found no WMKF prompt-group/catalog table under a
prompt/catalog/group name. This does not prove that no differently named custom
store exists; the recommendation needs only the verified settings table above.
Metadata create/update flags are schema capabilities, not proof of a user's
security role or app-principal write permissions. This read-only task did not
probe writes, sandbox schema parity, Dataverse auditing configuration, or Connor's
current flow definitions/identities.

**[VERIFIED via current source]**

- `shared/config/adminPromptCatalog.js` owns descriptions, usage labels, workflow
  order and assignments today; the budget editor repeats three group labels.
- `lib/dataverse/adapters/ai-prompt.js` has separate Executor, Admin, and seed
  projections. Admin inventory requests 200 current/noncurrent rows per query,
  but `lib/services/dynamics/read-ops.js` clamps each request to 100 and returns
  only that page; history and seed lists request 50. Full paging must replace caps
  before claiming complete future discovery/version allocation.
- `lib/services/admin/prompts-list-service.js` discovers names without a static
  allowlist, prefers a current row, and shows a latest noncurrent row otherwise.
  It does not distinguish a retired-only name from a true draft, or surface an
  unpublished draft beside a current version. Duplicate current rows overwrite
  one another in its Map rather than becoming inventory warnings.
- `GET /api/admin/prompts` is superuser-only; there is no create verb.
  `PUT /api/admin/prompts/[name]` requires an existing current row and delegates
  to `lib/services/admin/prompts-publish-service.js`.
- Publication validates templates, variables, output contract, reviewed Claude
  model and output budget, writes pending/final Postgres `prompt_publish_audit`
  records, fingerprints content for idempotency, and uses an ETag to retire the
  prior current flag. Create-new-current then retire-prior is non-atomic and can
  expose two current rows after failure. Do not describe it as transactional.
  However, `lib/services/dynamics/changeset.js` already provides atomic Dataverse
  changesets with per-operation If-Match guards, trusted context and actor
  support. That is an existing app-side capability, not the target shared
  publisher: the proposed plug-in uses in-context SDK operations instead. An old
  SQL comment denying batch transactions is not current platform evidence.
- The current publisher carries temperature forward but cannot edit it; the
  existing form does not expose variable-declaration editing. New creation needs
  explicit valid values for both, not invented inheritance from a nonexistent row.
- `lib/services/prompt-seed.js` is create-only by default and preserves versions
  on force recovery, but it is not the Admin audited publication service.
  Calling a seed helper alone is not compliance with the target shared publisher.
- Executor lookup selects by name/current flag, not status. Tool/reviewer
  resolvers also depend on current-row semantics. A current Draft can therefore
  be executable today; the new writer must never create that combination.

## Proposed storage contract

### Native prompt columns — additive, not provisioned

Add optional native columns to `wmkf_ai_prompt`; proposed logical names below
must be checked against the deployed schema after Connor provisions them.
Optional schema requirements preserve existing callers during rollout; Admin
requires complete metadata for new publications after cutover.

| Proposed logical name | Type / application limit | Meaning |
|---|---|---|
| `wmkf_ai_displaytitle` | String / 200 | Human-readable title; technical key remains unchanged |
| `wmkf_ai_description` | Memo / 4,000 | What the prompt does |
| `wmkf_ai_groupkey` | String / 80 | Stable workflow key, e.g. `preflight` |
| `wmkf_ai_sectionkey` | String / 80, optional | Optional subsection within that group |
| `wmkf_ai_usedby` | Memo / 4,000 | Human declaration of applications/flows and useful flow link/name |
| `wmkf_ai_usagecategory` | String / 40 | Curated display classification; never execution permission |

Keep technical identity in `wmkf_ai_promptname`. Do not rename keys as a side
effect of title edits. No new runtime inputs/outputs are encoded in these fields.

Use bounded text for curated category values rather than a new deployment-bound
Choice catalog. Preserve existing application/reference/diagnostic/unconnected
classifications in migration, and add neutral `declared` / `unclassified` for
backend-created prompts. These are editorial declarations, not automatic proof
of a flow caller, recent execution, or production activation. Display that
qualification. Model/provider eligibility and runtime allowlists stay in code.

**Metadata editing:** Admin provides a separate audited catalog-details save
using the current row ID + expected ETag; it may change only these six metadata
columns, not content, current flag, status, model, or version. This allows
classification of an unfamiliar backend prompt even if its content/model cannot
be published under the supported definition-format rules. A new draft starts with the latest current catalog
metadata. Publication uses
the explicitly reconciled staged metadata, never a silent merge of newer labels. Old
published content is immutable;
current-row catalog metadata is explicitly mutable and is not a promise of
historical descriptions. Store catalog-change before/after values, actor,
request ID and target row in the Dataverse operational receipt store. Record the
draft's current-row metadata baseline ETag (explicit null for a new name) in its
staged definition.
A changed baseline blocks publication until the editor explicitly refreshes and
reapplies its catalog choices to a new staged snapshot. Backend drafts with no
recorded baseline require that reconciliation when opened for publication.
Require publish's expected ETag as well as expected version, so an intervening
catalog edit is not lost.
Seed scripts must preserve metadata rather than restore catalog-code defaults.
The Dataverse write guards enforce this metadata-only allowlist for direct tools
as well as Admin; catalog-change audit belongs in Dataverse so neither route
depends on a Vercel-only audit write.

### Draft baseline — additional authoring column

**[PLANNED]** Add a dedicated optional Memo column, proposed
`wmkf_ai_draftbaseline`, bounded by the app to 16,000 characters. It stores
schema-versioned draft-only JSON: baseline current GUID/ETag (explicit null for
first publication), baseline catalog values for the six editable fields, and
expected head revision. Both clients round-trip it in draft projections; the
publication operation checks it against current state and never treats it as
actor authority. Save it with the draft under ETag, update only after explicit
refresh/reapply, and clear it on successful publication in the same transaction.
Backend drafts missing it remain saveable but need explicit reconciliation
before publish. It is not Notes, prompt variables, or a client-only/localStorage
value. This is a seventh prompt column beyond the six descriptive fields;
provisioning, projection fan-out and limits are part of the sandbox schema gate.

### Workflow catalog — existing settings table

Store `prompt-library.groups` in `wmkf_appsystemsetting`, under its active key,
with a schema-versioned JSON value:

```json
{
  "schemaVersion": 1,
  "groups": [
    { "key": "preflight", "label": "Pre-flight", "order": 10, "sections": [] },
    { "key": "reviews", "label": "Reviews and evaluations", "order": 30,
      "sections": [{ "key": "human", "label": "Human peer reviews", "order": 10 }] }
  ]
}
```

This is a shape example, not the full seed. Seed all current groups and review
subsections from the reviewed catalog, preserving their existing keys/order.
Native group/section text columns let Connor's LLM-assisted scripts author
metadata directly; his scripts fetch this catalog first. A Dynamics-native
lookup picker would require a separate group table and is not part of this
simpler proposal. Admin supplies the dropdowns and a compact Manage groups form
for adding/renaming/reordering groups and sections without deployment.

Use existing conditional-create/ETag settings patterns, trusted Updated By
attribution, strict unique keys/parent membership, and payload size under the
100,000-character live limit. Referenced groups/sections cannot be removed;
renaming a label preserves its key. No historical/reference prompts are deleted.
The settings configuration is independent from execution budgets. Budget
sections resolve their labels/order from the same catalog and their membership
from each budgeted prompt's resolved metadata; budget schema and controls stay
code-owned. Missing assignments remain visible in a budget fallback section.

### Missing, invalid, and unavailable metadata

- Complete valid metadata: show in its configured group, including unknown
  technical names. Never infer classification from a name prefix.
- Missing/unknown group or invalid parent-section pair: keep the prompt visible
  under **Needs organization**, preserve submitted values for repair, and show
  a warning. Missing title displays the technical key. Retired and draft badges
  derive from lifecycle data, not from catalog classification.
- Malformed/missing group configuration: show a region warning and all prompts
  in the fallback group, rather than an empty library. Block catalog saves and
  new publication requiring valid assignments until configuration is repaired.
  Existing runtime execution is unaffected.
- Dataverse failure: report an unavailable region with Retry; never present
  hardcoded labels as successfully persisted data. Preserve dirty UI drafts.
- Duplicate-current / duplicate-version rows: expose every conflicting row ID in
  restricted diagnostic/recovery details, block normal publication for that name,
  and never silently select one. Executor continues to fail closed as today.

## Admin flows and shared write protocol

### Create and edit

Add **Create prompt**, with title, technical key, group/subgroup, description,
Used by, instructions, input-variable declarations, output format, reviewed
model, temperature policy, and output-token limit. Structured input controls
should cover caller-supplied variables; advanced JSON preserves existing
Executor declarations without inventing a new DSL.

The first release offers raw-text or JSON returned output with `target.kind:
none` and caller-supplied inputs for new general-purpose prompts. Existing
prompts with Dynamics/SharePoint sources or field-write contracts retain their
full definitions in the advanced editor; authoring a new field-write mapping
requires separately scoped work. Connor can import existing compatible advanced
definitions, but automatic flow wiring and a new generic execution API are not
implied. Unsupported providers/contracts remain visible with an explanation;
metadata organization remains available without silently rewriting content.

**Save draft** persists an explicit noncurrent Draft in the same table, identified
by its GUID and ETag. Drafts have no published version number: use null for
`wmkf_promptversion`, supported by Microsoft's documented ApplicationRequired
API semantics, subject to verifying tenant custom rules and numeric constraints
in sandbox. If null is not allowed, stop and agree an additive
draft-storage adjustment; do not silently reserve published numbers or use an
undocumented sentinel. Draft updates keep the same GUID. Incomplete content can
be saved after structural/key/size validation; publication validates the complete
definition. New numeric/model defaults require schema-range verification.

A reload shows active content and pending drafts separately. Dirty edits survive
failed saves and stale loads; navigation warns about unsaved edits. Historical
Published/Retired rows are never reused as drafts. The legacy null-status
`phase-i.checkin` row needs explicit lifecycle inspection/recovery, not automatic
conversion. A rollback copies historical content into a new draft and publishes
a new higher version after review.

### Shared Dataverse publication operation

**[PLANNED; owner-approved direction]** Implement a synchronous Dataverse Custom
API Action backed by a .NET plug-in. Admin's server and Connor's authenticated
coding-tool command call the SAME operation. Direct Dataverse draft authoring
remains supported. Manually setting current/status/version or modifying published
content is not a supported publication route; synchronous Dataverse write guards
must reject those bypasses, including legacy seed/upsert writers after cutover.
No Admin cookie, profile-ID argument, or Vercel-only lock is required by Connor.

The bounded platform assessment and sources are in
[publication feasibility](SHARED_PROMPT_PUBLICATION_FEASIBILITY_2026-10-29.md).
**The Custom API/SDK primitives are documented; exact transaction context,
tenant deployment, permissions and race/fault behavior remain untested.** This adds a Dataverse solution/plug-in deployment to
the feature and is not merely six extra columns.

#### Coordination and durable state

Use two small additive Dataverse tables (logical names finalized during schema
review): one **publication head** per technical key, and append-only
**publication receipts** (also used for catalog-change audit). Prompt content stays exclusively in `wmkf_ai_prompt`;
workflow definitions stay in the existing settings table. Both new operational
tables are **OrganizationOwned**, chosen before creation, with explicit Org Read
for approved publishers and guard-restricted mutations. This does not grant all
staff access or allow another actor to reuse a receipt UUID.

- Head: a required unique bounded identity (proposed SHA-256 hex of the
  lowercase ASCII canonical technical key, with canonical and original keys
  retained and compared to reject a hash collision), active prompt lookup, last published version and revision. Do not
  make a unique key directly on the existing 850-character name: Dataverse key
  size is limited. New keys must already be lowercase ASCII under the conservative grammar;
  guards reject case-equivalent aliases at direct draft creation and publication.
  Existing key spelling stays unchanged, but all reader-equivalent names must
  share one canonical head. Audit legacy case/whitespace/Unicode/collation
  equivalences before seeding heads; unsupported keys block that name's cutover
  for explicit mapping, never silently get a second head or a rename. Microsoft
  documents case-insensitive Dataverse string filtering; raw exact-byte hashing
  would therefore be unsafe. Prove canonical identity equals actual reader
  equivalence in sandbox, including case-variant first-publication races.
- Initialize one head from each unambiguous legacy name under a controlled
  writer freeze; its high-water version covers ALL historical published/retired
  versions and any legacy reserved numbers. Repair ambiguous lifecycle/version
  states before enabling publication. New-name head creation is create-only
  under an Active unique key; concurrent initialization rejects one transaction,
  which retries the same request after rereading. No read-then-create guarantee.
- Every publication must conditionally update the head using the caller's
  expected head revision and the SDK row version (`IfRowVersionMatches`). This
  fences first publication (expected active null) as well as later publication.
  After winning the conditional head write, reread and validate the draft,
  active rows and complete version inventory inside the same transaction;
  recheck all caller expectations. No unconditional head update or max+1 alone.
- Receipt: required unique request UUID, operation/fingerprint contract version,
  exact prompt key, actor from execution context, draft ID, expected head/current
  and draft versions/ETags, effective-snapshot hash, prior/new IDs, assigned
  published version, actual timestamp, definition-format version and
  pinned policy-artifact version/hash. It stores
  hashes/identifiers, not another content library. Metadata-only operations use
  the same append-only store with a distinct operation kind, before/after values
  for the six allowed catalog fields, and execution-context correlation ID; a
  direct PATCH need not spoof a publish UUID. Receipt creation and lifecycle
  writes commit in the SAME Dataverse transaction. Restrict receipt/head writes
  to the trusted operation. Retain receipts/history without automatic expiry in
  this release; page reads, monitor capacity and use content-free receipts.

#### Operation protocol

1. Authenticate/authorize the caller in Dataverse. Admin additionally retains its
   superuser/session guard, trusted DAL context, target/write interlock and
   server-derived actor mapping. Connor uses delegated Entra OAuth under his
   authorized Dataverse identity through a supported command/Web API call; no
   new unattended application identity is included. Record initiating/effective
   identities; never trust a payload actor. Prove Admin impersonation and reject
   silent fallback to app attribution for privileged publication.
2. Require request UUID, draft GUID/ETag, expected head revision, expected active
   GUID/version/ETag (explicit null for first publication), metadata baseline,
   explicit supported definition-format version and exact staged snapshot
   fingerprint. Replay checks precede fresh-write
   preconditions: same authorized actor/name/operation/hash returns the original
   receipt even if current has advanced; changed reuse is rejected. A client
   refresh of current state is returned separately from that historical receipt.
3. Require `IsInTransaction`; fail before mutation otherwise. Use only
   `IOrganizationService` in the plug-in, never same-org HTTP, nested batch
   transaction requests, Vercel/Postgres calls, or model calls. For registered
   token-governed prompts, first acquire the budget coordination CAS and read
   current budgets; then acquire the per-name head CAS. Other prompts take only
   the head CAS. Validate expected state and the complete draft using the exact
   deployment-pinned policy-artifact version/hash.
   A stale catalog baseline requires explicit refresh/reapply; neither route
   silently replaces newer labels. Metadata-only direct saves use ETags, a strict
   column allowlist and transactional catalog audit; a concurrent catalog edit
   must make the publication's draft/current conditional update fail.
4. Assign `head.highWaterVersion + 1` only at publication (first = 1 where no
   history exists). Promote that exact Draft row with a conditional row-version
   update, set Published/current and actual publication time, and conditionally
   clear the previous current flag. Advance head lookup/high-water/revision and
   create the unique receipt in the same transaction. Prior content stays
   immutable; prior Published status remains Published with current false.
   An SDK concurrency/validation/unique-key failure aborts the WHOLE operation;
   do not catch and continue a faulted transaction.
5. Return the committed receipt and refreshed active state. A transport timeout
   is unknown, not failure: lookup/retry the same UUID, never invent a new one.
   If concurrent identical requests race on receipt uniqueness, the losing
   transaction aborts; an outer retry reads the winning receipt. A head/receipt
   conflict on a reused UUID must trigger another receipt lookup BEFORE showing
   an edit conflict: the winner may have committed after the first lookup. An
   unavailable/unknown receipt read is not proof of failure; retain the UUID and
   draft without resending as a new publication. No durable
   partial lifecycle is a valid new-operation outcome. Existing legacy partial
   states require explicit recovery; never guess a winner or delete a row.

The head fences all publication participants; synchronous Create/Update/Delete
and applicable bulk-message guards on prompt/head/receipt tables must close raw
write bypasses. Published content, name, version and lifecycle fields are
protected; audited catalog-only edits remain allowed. Validate draft
name/version/status/current constraints on direct creates too. Guard permissions
and parent execution context must prove an authorized publication message, not a
client-supplied bypass flag or message-name assertion alone. Environment admins
who disable/bypass plug-ins are outside the supported concurrency guarantee;
monitor and document that operational boundary. Before writer enablement,
inventory actual roles/identities (including Connor and the app principal) with
`prvBypassCustomBusinessLogic` or `prvBypassCustomPlugins`; no holdings are assumed.
Require nonempty head identity/receipt UUID in code and Active unique indexes;
ApplicationRequired alone does not enforce either. Test individual/bulk/upsert
paths without duplicating merged pipeline handlers.

#### Shared publication rules and execution-format validation

**[PLANNED]** Keep two separate validation responsibilities, both enforced by the
Dataverse publication operation before its transaction commits:

| Layer | Rules | Scope |
|---|---|---|
| Shared publication | Trusted actor/privilege/target; stable key; Draft and Published lifecycle; expected head/current/draft state; catalog baseline; immutable history; version allocation; atomic activation/receipt; payload-bound retry | Every publication, whether initiated by Admin or Connor's tools |
| Definition format | Validate the full stored definition under the explicitly supported format version: system/body templates, declared variables, output definitions and applicable model/token/A7 requirements | The selected supported definition format, independent of which tool authored it or which app/flow will execute it |

The first release supports the EXISTING APP PROMPT FORMAT through one versioned
format validator, including its established supported variants. Connor's future
PA prompts use that format too. Do not build a general profile framework or a
legacy free-text/Power-Automate-only validator for this release. A supported
format version is fixed by server policy and included in the request fingerprint
and receipt; unknown versions fail closed for publication. Editorial group,
Used by and category never select a weaker validator or grant execution rights.
Neither client can bypass the format validator by calling only the lifecycle
operation. Metadata-only saves remain independently allowed.

Preserve existing application validation and caller-specific constraints. Do not
require every output to use native structured generation: existing raw-text,
JSON and supported advanced definitions retain their established semantics.
Model eligibility, token ceilings and applicable template/A7 checks are format
checks; app-specific budget registry membership is not a condition for a new
PA-owned prompt to join the library. Apply registered budget checks where the
existing budget contract applies, without accepting client budget overrides.
An accepted stored definition is not a promise that every runtime implements
every source/target/input feature. Runtime still enforces its own supported
operations, data boundaries and output writes. PA triggers, document assembly,
model invocation and result handling stay in the future flow.

The normative [format v1 contract](SHARED_PROMPT_FORMAT_V1_2026-10-29.md)
defines the previously ambiguous cap/null-model/temperature/enum/regex behavior.
The first local slice turns it into executable schema and shared golden vectors,
including name-specific parser contracts and preserved application variants.
Before enabling new writers, run the extracted validator read-only over the
complete current cohort under separately authorized access; incompatible rows
remain intact for explicit remediation, never silently rewritten.

Policy is an immutable artifact packaged with both JS and the .NET operation,
with explicit tier mapping, default model and version/hash. No mutable policy
activation settings or policy-only global fence in v1. Replacing it disables
both publication routes server-side and drains all in-flight operations before
deployment/re-enable. Successful old receipt replay stays valid; new clients
must match the installed artifact. Never substitute a one-time read of a mutable
policy row for commit-time freshness.

Retain a budget-scoped coordination CAS only for registered token-governed prompt
keys; timeout-only and new generic/PA prompts do not acquire it. The existing
JS budget writer captures its ORIGINAL coordination revision before reading all
models/history and validating, then creates the budget revision plus conditional
control advance in one strict-actor/no-fallback changeset. Token-governed model
publication uses the same guard before its head CAS. This preserves the planned
stored budget/model consistency guarantee; the runtime cap alone does not.
Implement this after the first local schema/mock slice but BEFORE enabling new
writers. Details and counterexamples are in the
[validated Fable review](SHARED_PROMPT_REVIEW_VALIDATION_2026-10-29.md).

No Vercel, Postgres, provider-list or model call occurs inside the publication
transaction. Runtime guards remain necessary at later invocation.

**Legacy example boundary:** the read-only probe found Connor-attributed
`phase-i.checkin` with native-budget-PDF intent, undeclared placeholders and
human-readable output instructions rather than machine JSON Schema. Keep it
visible and preserve its content/lifecycle; do not automatically convert or
activate it. Supporting its old format unchanged or migrating its actual flow
is deferred work. Its historical flow/model/input wiring remains UNKNOWN, but
that uncertainty does not block the common-format library. No new native-PDF
Executor capability or PA execution bridge is implied by format agreement.

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

#### Existing audit and reader compatibility

The new Dataverse receipt is publication truth for BOTH routes. Existing
Postgres `prompt_publish_audit` pending/final receipts remain readable/replayable
under their original fingerprint versions; never resend an old receipt as a
new mutation. Admin may keep a correlated operational mirror, but a failed
Postgres mirror cannot roll back a committed Dataverse publication or make
Connor depend on Vercel/Postgres. Receipt readback recovers lost responses.

Keep `wmkf_ai_iscurrent` as the compatibility marker for existing readers;
update it atomically with head. The head is the publication concurrency
resource, not an independent competing active authority. Admin readers compare
head to sole-current rows and surface mismatches. Apps and future adapted
Power Automate callers resolve exact key + sole current Published row, reject
zero/duplicates/invalid lifecycle, and record exact prompt GUID/version. Today
Executor selects current without status: update that guard at cutover and audit
ALL direct readers, projections, cached resolvers and fallback semantics.
Read-only callers must not create heads. Existing resolver caches may briefly
serve an older immutable version; document their TTL/invalidation and do not
promise instantaneous cross-client activation. Existing flows are not silently
rewired or claimed verified by this plan.

## Implementation slices and release gates

1. **Local foundation — start now.** Implement versioned request/definition/
   receipt schemas from the format v1 contract, fingerprint golden vectors, pure
   shared validator/artifact extraction, organization-owned solution manifests,
   read-path/status/paging corrections under tests and both clients against
   mocked transport. Author the reusable plug-in operation source and fake-
   organization-service tests. No .NET toolchain, tenant access or historical
   PA flow is required to begin JS/contracts/mocks. Compile .NET when Connor's
   supported tooling is available; do not write a separate throwaway spike.
2. **Authorized sandbox deployment/proof.** Connor owns solution maintenance and
   tooling/import arrangements. Import that SAME operation source, prove exact
   Custom API IsInTransaction/rollback, null-version draft behavior, both actual
   identities/privileges, head/receipt uniqueness/CAS, parent/bulk guards, strict
   impersonation and lost-response recovery. A failed proof blocks deploying or
   enabling the affected writer architecture, not independent local coding.
3. **Schema/enforcement and compatibility gate.** Provision the six descriptive
   columns plus draft baseline, OrganizationOwned heads/receipts with Active
   unique keys, required-key guards and managed solution. Preserve old receipts;
   audit existing states/seeds/raw writers and bypass privileges. Run authorized
   content-free current-row validation before cutover, resolve incompatibilities
   explicitly and keep new writers disabled until all relevant gates pass.
4. **Catalog/read/UI slice.** Complete inventory/history paging and projection/
   structural-error fan-out, explicit drafts/history/conflicts and Needs
   organization. Conditionally seed groups/backfill blank metadata with exact
   IDs/ETags and resumable readback; refuse conflicting nonblank values. Add
   search, metadata editor and group manager here, not as foundation blockers.
   Budget presentation uses shared metadata without changing its authority/UI
   placement or registered membership. This remains part of the full feature.
5. **Two real clients and budget consistency.** Wire Admin and Connor's delegated-
   OAuth validate/save/publish/receipt command to the same guarded Action, pinned
   format artifact, retained dirty drafts and original receipts. Implement the
   scoped budget CAS and strict original-snapshot budget changeset before any
   new governed writer is enabled; test budget-up/model-down in both orders.
   No silent Admin-only substitution; dry-run invokes no model.
6. **Full rehearsal and deliberate promotion.** Use a new common-format prompt,
   never auto-activate the legacy row. Prove both-client discovery/publication/
   active read, first/later/case races, auth and bypass denial, metadata/artifact
   conflicts, budget coordination, rollback and response-loss recovery. Only
   then explicitly authorize Production additive provisioning/backfill and
   controlled writer freeze, head initialization, reader/guard rollout and both
   clients' enablement. Verify authenticated UI/attribution. No live writes are
   authorized by this planning revision or by local implementation readiness.

Retain current code catalog solely as the migration input and temporary,
explicitly identified compatibility fallback before cutover. Remove it as the
runtime authority only after every live UI consumer (including budgets) reads
Dataverse and verified migration is complete. Rollback disables new writes and
keeps the new columns/data; code rollback must not resume stale metadata cloning,
legacy upsert seeds or the old uncoordinated publisher; keep writers disabled
until both routes again share the enforced publication operation. No destructive schema rollback or prompt deletion.

### Required tests and durable reconciliation

- Source→persistence→consumer: two-way discovery, full paging, unknown names,
  draft/current/retired distinctions, missing/corrupt group catalog, preserved
  dirty drafts and out-of-order loads; group rename/order without a deployment.
- Schema/metadata: missing columns during rollout, exact per-field limits,
  unknown group/section/category handling, allowed metadata-only mutations,
  migrations preserving body/model/variables/output/status/version/current flags.
- Validation layers: each client must satisfy both shared publication rules and
  the common app-format validator; group/category/caller labels cannot bypass
  checks. Unknown format versions remain unpublishable, while legacy discovery
  and metadata organization work without locating a flow.
- Publish: two simultaneous first publications, active-version races across both
  clients, repeated/different UUID payloads, same-UUID concurrency, null draft
  versions, metadata-baseline conflicts, head/flag mismatch, policy changes,
  draft/current row-version failures, guard/bulk bypass attempts, receipt failure
  and transaction rollback, lost response then later unrelated publication,
  legacy audit replay and old corrupt states. A new publication returns success
  only with a committed matching Dataverse receipt; drafts never execute.
- Trust: superuser Admin guard, delegated backend identity, actual/effective
  actor, role-denied API call, no app-attribution fallback, no client-controlled
  bypass/actor/target, protected head/receipt/lifecycle writes, unknown definition
  or validation policy rejected, no provider call or execution-budget override.
- Run targeted unit/service/adapter tests, types, lint, canonical build, relevant
  gates and their self-tests sequentially. Register new route methods in
  `docs/API_ROUTE_SECURITY_MATRIX.md`; update `docs/SERVICE_AND_UTILITY_CATALOG.md`,
  relevant Atlas pages (prompt/settings, new Dataverse head/receipt/catalog audit
  and unchanged legacy Postgres publication audit),
  migration manifest, docs catalog and any canonical counts. Reconcile the
  Executor contract and prompt-governance memories when implementation changes
  their facts. Do not mark target behavior shipped in those surfaces now.

## Review disposition / implementation gates

**[OWNER DIRECTION, 2026-10-29]** Both Admin and Connor's coding tools publish
through a shared Dataverse operation; Admin is not mandatory for Connor. Drafts
use GUIDs, and published numbers are assigned at activation. This replaces the
former reserved-draft/Postgres-lock/Admin-first proposal.

**[VERIFIED via Microsoft documentation and repository inspection]** The platform
supports the required Custom API, synchronous transactional service calls,
row-version checks, unique keys and OAuth clients. **[UNKNOWN]** Tenant deployment
privileges/tooling, actual role/impersonation behavior,
null-version draft shape and fault/concurrency behavior require the named sandbox
spike. The .NET project now compiles locally; a deployable Dataverse publication solution
and production rule composition are not supplied.
See the feasibility report and linked technical preflight for evidence,
falsification tests, approved ownership/access and review status.

**[OWNER DECIDED]** Connor maintains the Dataverse operation/solution. Initial
human publication access is Connor and existing Admin superusers; actual mapped
identities and Dataverse roles still need authorized verification. This is not
a role grant or evidence Connor has deployed the operation.

Local foundation implementation can begin now against the normative format v1
and validated review disposition. Executable schema/artifact/golden fixtures are
its first deliverables. Tooling/import access and exact platform behavior gate
compilation/deployment/proof as applicable; they do not block local source work. Connor's format agreement
is owner-confirmed; locating/adapting a historical flow is not a build or library
release gate. Future-flow execution verification is a separate integration task. These are technical/release gates,
not a requirement for Connor to accept Admin publication. No message to Connor,
schema change, Production write or model test is authorized by this PR.

## Review record and bounded reconciliation

The earlier 2026-10-29 review corrected the FORMER app-only proposal's stale
metadata, reserved-version and pending/final audit design. That review is
historical evidence, not approval of this replacement Dataverse architecture.
The retained schema evidence remains dated and unchanged.

Contract-reconcile scope: Admin/button and coding command → authenticated
Dataverse Action → synchronous validation/head CAS/draft+prior updates/receipt
→ both clients and current-row consumers. New operations are one atomic unit;
unknown network outcomes resolve by receipt. Async client generation fences,
policy parity and full raw-field reader/writer fan-out gate writer enablement.
Shared helper audit: one server operation, two clients, preserved auth differences.
Durable-surface audit: new solution/tables/guards/roles require Atlas, security,
catalog and rollout reconciliation during build; this PR contains local SDK evaluators and proposed persistence, but provisions
none of the tenant solution/tables/guards/roles.

Sweep Mode A: changed authoring/publication direction. Searched current plans,
SESSION_PROMPT, Atlas/wiki/memory, runtime/scripts/tests for the named shared-library
proposal and publication restrictions. The two proposal documents carried the
superseded target and are rewritten together; existing runtime/Atlas/governance
statements remain descriptions of today's implementation, not this proposal.
The current main handoff is owned alongside Claude's work; it is not overwritten
from this older planning branch. PR description and this report carry the new
resume boundary. Final gate/review evidence is recorded in the feasibility report.

**[PLANNED budget-policy parity]** The budget publisher must replace its current
dynamic tier/model resolution with the SAME pinned tier/default/capability
artifact used by prompt publication. Coordination alone cannot protect a pair
validated against different model ceilings. Policy deployment disables and drains
governed budget writes as well as both prompt publication routes, then revalidates
all governed active budget/model pairs against the new artifact before re-enabling
writers. Reject incompatible pairs for explicit remediation. Shared golden cases
cover differing dynamic versus pinned tier ceilings and policy upgrades.
