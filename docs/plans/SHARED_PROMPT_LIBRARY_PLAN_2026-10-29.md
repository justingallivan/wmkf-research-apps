---
title: Shared Prompt Library Implementation Plan
domain: ai-platform
kind: plan
status: proposed
summary: Read-only live Dataverse schema verification and implementation plan for shared prompt discovery, catalog metadata, Admin creation, and governed backend publication.
canonical: false
cataloged: 2026-10-29
last_verified: 2026-10-29
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
ordering, and assignments. The app owns validation, permissions, and rendering.
Creating or classifying a prompt requires no deployment. Creating a prompt does
not create a Power Automate flow, grant execution permission, or wire an app caller.
No Power Automate execution bridge is included in this work. Existing application
consumers, model/provider policy, and execution budgets remain separate contracts.

This document is a plan, not an implementation or schema deployment. The only
external actions for this task were read-only metadata/inventory requests and
their OAuth token exchange. No prompt body or model execution was inspected.

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
| Concurrency | Optimistic concurrency enabled; no alternate keys | ETags are available; duplicate-name/version and first-publish safety need application enforcement |
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
  support. Reuse that existing seam for the target lifecycle flip; an old SQL
  migration comment claiming Dataverse has no batch transactions is not current
  evidence of platform capability.
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
be published by the Vercel publisher. A new draft starts with the latest current catalog
metadata. Publication uses
the explicitly reconciled staged metadata, never a silent merge of newer labels. Old
published content is immutable;
current-row catalog metadata is explicitly mutable and is not a promise of
historical descriptions. Store catalog-change before/after values, actor,
request ID and target row in the operational audit. Record the draft's current-row
metadata baseline ETag in its operation intent.
A changed baseline blocks publication until the editor explicitly refreshes and
reapplies its catalog choices to a new staged snapshot. Backend drafts with no
recorded baseline require that reconciliation when opened for publication.
Require publish's expected ETag as well as expected version, so an intervening
catalog edit is not lost.
Seed scripts must preserve metadata rather than restore catalog-code defaults.

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

**Save draft** persists an explicit noncurrent Draft in the same table. Incomplete
content can be saved after structural/key/size validation; full model/template/
output validation is required for Publish. Use valid required numeric/model
values or explicit defaults when saving drafts (verify numeric schema ranges in
implementation preflight). Draft writes use ETags and return a durable row ID.
A page reload shows a current version and its pending drafts separately; never
substitute a draft for the executable version. Draft updates do not repeatedly
allocate version numbers. A reserved draft may publish only if its version is
greater than the current version; an older draft must be explicitly rebased to
a newly reserved version. Publication never moves the current version backward. Dirty
client edits survive failed saves; navigation
warns about unsaved changes. Do not repurpose noncurrent Published/Retired rows
as editable drafts, including the existing `phase-i.checkin` without inspecting
its actual lifecycle state first.

### Publication invariants and concurrency

Use one shared governed publication service for Admin and backend tooling;
extend the existing service rather than maintaining two validation protocols.
Public APIs stay superuser/session authenticated. Backend authoring may create
noncurrent drafts directly under its Dataverse role, but **publication goes
through the shared publisher**. In the first release Connor can import a draft
and publish in Admin. A CLI must use the authenticated supported import/publish
entry, not fabricate a NextAuth cookie, pass a profile ID, or create a second
raw-Dataverse publisher. Unattended service-principal publication requires a
separately reviewed authenticated entry point; no new machine credential is
included here. Ordinary backend row creation remains discoverable, but bypass
publication is outside the guaranteed contract.

- Serialize governed draft creation/version reservation, metadata edits, and
  publication per target-host + normalized prompt name using a server-side
  Postgres lock with a dedicated connection, bounded wait and cleanup in finally.
  Allocate positive version `max(all rows)+1` under that lock. Initial draft v1;
  later drafts reserve higher versions. Gaps are allowed. Enumerate all rows,
  not current-version+1 or a truncated 50-row history. Direct backend drafts must
  use a unique positive version; collisions are surfaced and repaired explicitly.
- Use the existing append-only audit store for intent/outcome, with operation,
  draft ID, version, expected current ID/ETag, metadata baseline ETag, full
  effective-snapshot fingerprint, catalog changes, and trusted actor. Keep its two append-only phases, pending/final. The pending intent records
  every planned row ID, expected ETag and before/after lifecycle/fingerprint
  before the first mutation; recovery derives progress by exact Dataverse
  readback, not by inventing intermediate phase rows. Draft creates reserve a
  server-generated GUID before writing intent and create that exact ID (verify
  primary-ID create capability in sandbox). A new schema migration will extend
  operation/status coverage and intent constraints; assign its number from current main during build.
  Audit failure before a write blocks that operation. No new Postgres content
  library is introduced: this remains an operational audit/coordination store.
- Publish an already staged Draft row with full validation. Persist the pending
  audit first; recheck draft/current ETags, expected version, and exact snapshot
  under the lock; require draft version greater than current and unchanged
  metadata baseline. Promote the same reserved row, stamp Published/current/time,
  and clear the prior current flag in ONE existing `executeChangeset` call with
  per-row If-Match preconditions. Add a prompt-adapter operation so the service
  does not construct ungoverned transport calls. With no prior current, promote
  the first draft conditionally under the same per-name lock. Never change the
  published content in place. A repeat request with the same fingerprint returns
  its receipt; a changed payload with that request ID is rejected.
- These Dataverse updates plus Postgres audit are **not cross-store atomic**.
  Record the complete durable operation intent/IDs before its first change.
  Before another publish, reconcile a pending operation by rereading exact rows,
  lifecycle states and fingerprints to infer which planned writes took effect. A
  partial/unknown result is never rendered as clean success. The target
  Dataverse changeset prevents a committed half-flip between draft promotion
  and prior retirement; a transport timeout can still leave its commit outcome
  unknown, and final Postgres audit can fail after commit. Sandbox tests must
  prove embedded 412 rollback and lost-response recovery. Pre-existing torn
  states or bypass writes can still produce duplicate/zero-current states; stop
  execution through existing typed failures, preserve the draft and show recovery
  actions. Do not auto-delete,
  guess a winner, or silently roll back another writer's publication.
- Existing two-current torn-state recovery must be updated for staged-draft
  publication and tested alongside old audit receipts. Bump/version fingerprint
  contracts explicitly; old receipts remain replayable under their original
  fingerprint version, and no old publication is resent as a fresh mutation.
- The lock coordinates participating writers only. Arbitrary direct published
  Dataverse writes cannot be made safe by a Vercel lock. If Connor needs those
  writes to remain a normal publication route, this proposal must change before
  build to a Dataverse-enforced coordination design. Do not claim a guarantee
  across writers that do not participate.

The publication contract for Connor is a separate shareable document linked
below. It is proposed coordination guidance, not evidence he has accepted it.

## Implementation slices and release gates

1. **Additive schema + contracts.** Connor provisions the six optional columns
   in sandbox; verify types/lengths/create-update privileges, numeric required
   field ranges, ETags, and actor attribution. Add DTO validation, explicit
   catalog-edit allowlist, pending-intent/locking audit migration and tests.
   Review the full shared publication contract before any publishing rollout.
2. **Read path + catalog migration.** Page inventory/history completely. Add
   metadata to every Admin/history/draft/publisher/seed projection as needed;
   keep Executor projection unchanged. Build settings read/edit endpoints with
   server auth/DAL context and conflict handling. Prepare dry-run import from
   current `adminPromptCatalog.js`, exact row IDs/ETags, no body or lifecycle
   edits; backfill blank metadata only, refuse conflicting nonblank values.
   Catalog-details changes and backfill are audited/resumable per row. No-op
   reruns prove exact readback, not a second overwrite. Seed group configuration
   conditionally, never replace an already edited catalog.
3. **Admin shared library.** Render settings-driven workflow labels and row
   metadata, Needs organization, lifecycle/conflict warnings, metadata editor,
   group manager and search. Verify app/backend-created rows appear without
   source edits; do not require an entry in the former code catalog. Resolve
   budget labels/grouping from that same data and preserve its lower collapsed
   placement, draft state and existing publication contract.
4. **Creation/drafts/publication.** Add create/save-draft/publish-first support,
   advanced input declarations, complete-payload validation and the serialized,
   audited shared service above, reusing the existing atomic Dataverse changeset
   for promotion/prior retirement. Wire later content revisions to staged drafts;
   preserve current prompts during all editing and failure cases. Provide an
   import/export shape and dry-run validation for Connor. Do not offer a model
   Test action in this slice; it would consume credits and needs separate scope.
5. **Rehearsal and deliberate promotion.** In sandbox, round-trip backend draft
   → Admin discovery → metadata organization → publish → backend current read;
   Admin creation → backend discovery; concurrent writers; crash/retry; auth
   denial; unsupported definitions; settings outages. Only after that, provision
   Production additive schema, authorize migration, verify full backfill/readback,
   deploy compatible readers then enable writers, and inspect authenticated UI.
   Production schema/data writes are not authorized by this planning request.

Retain current code catalog solely as the migration input and temporary,
explicitly identified compatibility fallback before cutover. Remove it as the
runtime authority only after every live UI consumer (including budgets) reads
Dataverse and verified migration is complete. Rollback disables new writes and
keeps the new columns/data; code rollback must not resume stale metadata cloning
or legacy upsert seeds. No destructive schema rollback or prompt deletion.

### Required tests and durable reconciliation

- Source→persistence→consumer: two-way discovery, full paging, unknown names,
  draft/current/retired distinctions, missing/corrupt group catalog, preserved
  dirty drafts and out-of-order loads; group rename/order without a deployment.
- Schema/metadata: missing columns during rollout, exact per-field limits,
  unknown group/section/category handling, allowed metadata-only mutations,
  migrations preserving body/model/variables/output/status/version/current flags.
- Publish: duplicate technical keys and reserved versions, first-publish races,
  out-of-order reserved drafts (v3 before v2), stale metadata baselines,
  concurrent metadata/content edits, idempotency with changed payload, connection
  loss/lock cleanup, atomic rollback on either conditional lifecycle update, lost changeset
  responses, failure before/after changeset commit/audit finalization,
  repeat recovery, and unsupported model/output/injection-boundary contracts.
  Current/retired content cannot be edited as a draft. New drafts never execute.
- Trust: superuser UI and API guards, server-derived actor, no arbitrary field
  PATCH, no provider keys or execution-budget overrides accepted from clients,
  no automatic LLM execution, no unreviewed Power Automate auth expansion.
- Run targeted unit/service/adapter tests, types, lint, canonical build, relevant
  gates and their self-tests sequentially. Register new route methods in
  `docs/API_ROUTE_SECURITY_MATRIX.md`; update `docs/SERVICE_AND_UTILITY_CATALOG.md`,
  both relevant Atlas pages (Dataverse prompt/settings and Postgres audit),
  migration manifest, docs catalog and any canonical counts. Reconcile the
  Executor contract and prompt-governance memories when implementation changes
  their facts. Do not mark target behavior shipped in those surfaces now.

## Review disposition / decision needed before build

**[PLANNED]** Recommended implementation order is shared catalog/read visibility
first, then creation/publication; deliver one completed shared-library feature,
not an indefinite catalog-only milestone. No generalized workflow engine or
Power Automate execution adapter is required to achieve this objective.

The remaining product/coordination decision is whether Connor accepts the shared
publisher for publication (direct Dataverse drafts remain allowed). The live
schema verification is complete for the scoped prompt/settings fields; write
permissions, new-field provisioning, and sandbox fault rehearsal are explicit
implementation gates rather than facts claimed by this plan.


## Plan review record

**[VERIFIED via independent read-only contract review,
`/root/review_shared_library_plan`, 2026-10-29]** Live-schema claims matched the
retained evidence. Three findings were corrected and rechecked: prevent
out-of-order draft publication from moving the current version backward; reject
stale catalog-metadata baselines and require explicit reconciliation; and keep
pending/final audit phases with a complete pending intent rather than promising
unrepresentable intermediate event rows. No remaining blocker from those
findings. A subsequent source check found the existing atomic changeset seam;
the plan now reuses it for the lifecycle flip while retaining pending/final
audit intent and cross-store recovery. Inventory paging also accounts for the
transport's effective 100-row clamp, not just the adapter's requested 200. This review verifies the proposal, not implemented behavior.

Contract-reconcile scope: entry points are Admin and backend authoring; durable
state is Dataverse prompt/settings plus existing operational Postgres audit;
consumers are prompt inventory/history, budget presentation, and existing
runtime resolvers. Partial-success, concurrency, stale-state, full projection
fan-out and rollback requirements are specified above. Runtime changes,
Dataverse schema/write rehearsal and provider execution are not performed by
this plan. Bounded documentation sweep: existing catalog/publisher statements
remain current until implementation; no historical documents or governance
memories are relabeled as shipped.
