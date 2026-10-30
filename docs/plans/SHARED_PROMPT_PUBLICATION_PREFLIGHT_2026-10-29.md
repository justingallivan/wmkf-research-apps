---
title: Shared Prompt Publication Technical Preflight
domain: ai-platform
kind: audit
status: active
summary: Source and retained-evidence checks for shared prompt publication, approved ownership/access, proposed client and policy contracts, and bounded sandbox acceptance.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_FEASIBILITY_2026-10-29.md
---

# Publication technical preflight

## Scope and decisions

**[OWNER DECIDED]** Connor maintains the Dataverse operation and solution.
Initial human publication access is Connor and existing Admin superusers.
Admin and Connor's coding tools use the same publication operation; Connor
need not open Admin. This establishes scope, not provisioned roles or Connor's
confirmed deployment availability. No message was sent to him.

**[VERIFIED via source/test commands]** This pass used the PR branch at
`1bda7149c`, current repository code and the retained Production metadata snapshot
observed `2026-10-29T23:22:42.446Z`. No live tenant request/write, provisioning,
provider request or model execution was performed. No runtime code changed.
Microsoft documentation was consulted for platform semantics. CodeGraph was
used first; uncovered exact source regions were then read directly.

## Draft storage: a bounded conclusion

The retained snapshot marks `wmkf_promptversion`, current flag, status, model,
temperature and max tokens ApplicationRequired. It does not retain numeric
MinValue/MaxValue for the numeric columns. All stored versions were positive;
that does not prove null can be written. All 39 current rows were Published.
All 40 distinct names were lowercase ASCII, with no case-equivalent collisions.
These are dated snapshot findings, not a fresh tenant inventory.

[Microsoft column definitions](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/entity-attribute-metadata)
explicitly distinguishes ApplicationRequired from SystemRequired: the former is
enforced by model-driven apps, not by the Dataverse data service itself.

**[PLANNED recommendation]** Keep drafts in the existing table with null version,
explicit Draft status/current false, a GUID and ETag. Keep the existing metadata
requiredness initially; Admin and the coding command are custom clients. Do not
add a draft table, use version zero or reserve a published number solely because
of the ApplicationRequired label. Guard publication to require/assign a positive
integer, and guard direct draft writes to require null. If people later want to
save unnumbered drafts through a stock Dynamics form, give that form a reviewed
Draft-specific requiredness rule; stock-form compatibility is not assumed.

**[UNKNOWN until rehearsal]** Tenant plug-ins/business rules, numeric ranges,
nullable create/PATCH/readback and actual draft non-execution. Inspect them and
exercise a sentinel draft in sandbox. If blocked, diagnose the specific rule
before proposing a storage/schema change. No requirement-level change is
currently recommended on the basis of retained metadata alone.

## Source findings and cutover matrix

| Surface | Verified source behavior | Required implementation/cutover action |
|---|---|---|
| `pages/api/admin/prompts/[name].js` | Superuser gate; passes `profileId` to publisher, no Dataverse actor argument | Resolve enabled session-linked systemuser server-side; require real authenticated role even when dev auth bypass is set; require UUID/expected-state envelope; reject input actor/target |
| `lib/utils/auth.js` `requireSuperuser` | Fresh Postgres role read; returns profile ID only; dev auth-off path permits null | Preserve normal gate; publication must additionally reject null/unresolved actor and auth-off privileged mutations; do not assume gate alone supplies session identity |
| `lib/services/dynamics/write-core.js` `_withCallerId` / `_writeFetch` | Impersonation header is flag-dependent; default 403 path removes it and retries as app; `noFallback:true` stops retry | Dedicated Custom API invocation verifies enabled impersonation/header and uses no-fallback transport; no silent app attribution or global change to unrelated writes |
| `pages/api/workbench/final-writeup/acknowledgement.js` and acknowledgement service | Existing pattern obtains `session.user.dynamicsSystemuserId`; validates enabled user; uses noFallback writes | Reuse the pattern, not its reviewer-specific permission rules; prove actual/effective actor in API receipt |
| `lib/dataverse/core/interlock.js`, `lib/services/dynamics/http.js`, `lib/dataverse/client.js` | Actual URL/method interlocked; POST is a write; no dry-run network; known target policy enforced | Fixed Action name and server-owned target; runtime adapter keeps DAL/interlock; coding client uses guarded client. Dataverse operation cannot infer Vercel deployment from a caller flag; role plus approved target configuration enforce direct-tool access |
| `lib/dataverse/adapters/ai-prompt.js` | Current read rejects zero/duplicates but omits status from projection; Admin/seed/history use separate projections, capped 50/200 requests with effective 100 cap | Add Published/positive-version checks AFTER counting all current rows; never filter away invalid current rows and accidentally conceal duplicates. Page all inventory/history; include metadata/baseline in appropriate projections only |
| `lib/services/prompt-store.js` `fetchPromptVersion` | History lookup uses capped `listVersions`, then exact ID/version filter | Use exact immutable row-ID read with name/version validation or fully paged history; drafts/retired-invalid rows cannot impersonate a published historical version |
| `lib/services/admin/prompts-list-service.js` | Current map can overwrite duplicate rows; noncurrent-only latest row displayed as draft; drafts beside current hidden | Preserve every conflict row; explicit Draft/Published/Retired/invalid classification; show staged drafts independently; do not choose active by latest modified/version |
| `lib/services/tool-prompt-resolver.js` | Strict transient fallback classifier; structural code set currently contains only missing/duplicate; missing message specifically says publish in Admin | Extend structural errors for invalid lifecycle/head mismatch; make instruction neutral to both routes; preserve legitimate outage fallback |
| `lib/services/reviewer-prompt-resolver.js` | Missing/duplicate fail loud; other fetch errors continue to override/code fallback; invalid body also falls back with provenance | New lifecycle/head/policy integrity errors must join structural set so they cannot silently become code/override results. Preserve intentional per-user override semantics and body validation policy |
| `lib/services/post-presentation-materials/discussion-sentiment-service.js` | Maps the existing missing/duplicate prompt codes | Add new structural codes to its user-facing mapping and test candidates/service paths |
| `lib/services/execute-prompt.js`, review-panel/cycle-dossier generation, Pre-Site dependencies, budget validation, reviewer override route | Read through shared prompt-store; downstream consumers impose further exact template/schema/identity checks | Carry Published checks through shared adapter; preserve caller-specific stricter contract assertions and exact run GUID/version provenance |
| `lib/services/prompt-resolver.js` | Separate legacy scratch AI-run reader; maintenance scripts, 5-minute data/1-minute fallback cache | Do not confuse it with current prompt-table readers or silently migrate it; leave historical tool scope explicit |
| prompt-store/tool/reviewer/Executor paths inspected | No stored prompt-row TTL cache in these implementations; model resolver has a 24-hour model-list cache | Re-read active prompt for each new resolution; ongoing executions keep their resolved immutable snapshot. Model-cache freshness is a separate publication-policy issue; Power Automate caches remain UNKNOWN |

This is a source cutover inventory, not a claim that all callers have already
been changed or every external reader has been discovered. Source searches used
raw `wmkf_ai_prompts`, `wmkf_ai_iscurrent`, `wmkf_promptversion`,
`wmkf_ai_promptstatus`, `aiPrompt`, `fetchCurrentPrompt`, `fetchPromptVersion` and
`seedPromptRow`, not just a mapping-helper name. Record-bind-only occurrences
are consumers of immutable prompt IDs, not alternate active resolvers.

### Existing writers: retain, adapt, never delete by inference

**[VERIFIED via source]** Admin publisher creates current first and clears prior
later; its SQL audit is not a shared Dataverse transaction. `prompt-seed.js`
creates a current row and conditionally clears old rows with post-verification.
All scripts delegating to `seedPromptRow` inherit that independent publisher.

Six raw scripts also contain direct create/update publication paths:

- `scripts/seed-phase-i-summary-prompt.js`
- `scripts/seed-phase-ii-prompts.js`
- `scripts/seed-reviewer-finder-prompts.js`
- `scripts/seed-peer-review-summarizer-prompts.js`
- `scripts/seed-field-primer-prompt.js`
- `scripts/seed-echo-parity-prompt.js`

Adapt needed bootstrap/recovery behavior to draft/import + the Action, or make
execution refuse under cutover enforcement. Keep dry-run/export and history.
No scripts were removed, disabled or executed. Before enabling writers, rerun
this inventory against latest main and check other repositories/Connor's tools.

## Proposed authentication and authorization contract

- **Admin:** current authenticated superuser + enabled session-linked Dataverse
  systemuser. Obtain session through the trusted server auth path; never take
  it from request input. Refuse missing actor, disabled user, auth-off publication,
  disabled impersonation or missing impersonation header before network mutation.
  Existing app impersonation capability is reused only after actual role checks.
- **Connor:** delegated Entra/MSAL sign-in as his Dataverse user, approved public
  client registration/scope, explicit known environment; no provider API key,
  Admin cookie, copied browser token or new unattended app identity.
- **Dataverse:** narrow Prompt Publisher role for the approved humans; use a
  generated privilege from a new operational table (e.g. receipt Create) as the
  Action execute privilege, rather than broad prompt-table Write shared with
  ordinary draft authors. Caller-context SDK needs the required head/receipt
  and prompt read/create/write/lookup privileges; synchronous guards reject raw
  privileged writes even when CRUD privilege exists. No general Delete grant.
  Final role names/privilege names derive from deployed schema, never invented.
- The app principal needs the compatible privilege intersection for impersonated
  calls but is not an additional human publisher; reject direct unimpersonated
  app publication. Record initiating/effective principals and correlation ID.
- Owner-approved initial membership is Connor + the CURRENT Admin superuser set.
  Enumerate actual mapped identities during authorized tenant preflight; do not
  put personal IDs in this plan. App roles live in Postgres, Dataverse roles do
  not automatically follow them: coordinate grants/revocations in both stores.
  Admin revocation is immediately enforced on Admin calls; direct API access
  remains until the Dataverse grant is revoked. Do not claim automatic sync.
  An automated role-sync service is not included; release runbook owns the
  paired change and checks it before handoff. Privileged platform bypass remains
  outside the ordinary author guarantee.

## Proposed client protocol (both routes)

The logical Action name and SDK types are finalized with Connor, not guessed as
already deployed. Transport uses POST, with bounded inputs and a versioned
canonical JSON request inside the typed Action parameters if necessary.

| Input | Rule |
|---|---|
| `contractVersion`, `requestId` | Known schema + UUID; one immutable request, persisted by client until outcome known |
| `promptKey`, `draftId`, `draftEtag` | Canonical key and exact saved draft; no inline partial content PATCH on publication |
| `expectedHeadRevision` | Required expected state, including explicit initialization revision |
| `expectedCurrent` | Explicit null for first publication, otherwise exact ID/version/ETag |
| `metadataBaseline`, `snapshotHash` | Match durable staged baseline and complete saved definition/catalog |
| `policyRevision` | Explicit current accepted immutable policy revision; never caller-owned rules |

No actor ID, arbitrary target URL, fields-to-PATCH, provider credentials, force
bypass or execution-budget override is accepted. Request fingerprint covers the
complete envelope plus trusted actor and canonicalization version. UTF-8 encoding,
JSON key order, null/omitted distinction, line endings, Unicode handling and
number serialization need shared golden vectors before JS/.NET release.

Response distinguishes immutable `receipt` (which publication this UUID did)
from refreshed `current` state (what is active now). A stale/conflict response
preserves drafts. Concurrent winner/unknown timeout use read-receipt + unchanged
UUID retry, never automatic merge or another publication. Typed failures include
unauthorized/unsupported contract, draft changed, active/head changed, metadata
changed, policy changed, corrupt lifecycle and request-ID reuse; these are
proposed protocol codes, not current route behavior. Map SDK faults explicitly;
do not assume a plug-in exception becomes an HTTP 409 automatically.

## Shared validation policy: technical recommendation

**[VERIFIED source dependency]** Current JS publication uses prompt template/
reviewer parse checks, reviewed capability+pricing registries, tier resolution,
output-schema checks and durable Executor budgets. Model resolution may consult
an external model list; it cannot simply run inside the Dataverse transaction.
Current budget publication creates a new uniquely keyed immutable settings
revision after checking models (`publishExecutorBudgetConfig`). That does not
itself synchronize with a new Custom API publication transaction.

**[PLANNED, not implemented]** Generate a versioned declarative validation-policy
artifact from reviewed source: supported contract profiles, template/parse
requirements, A7 prohibitions, per-field limits, concrete reviewed model
capabilities and an explicit tier→concrete mapping. Ship identical artifact/hash
and golden fixtures for JS feedback and .NET authoritative checks. Store immutable
policy revisions in existing settings; a conditional control row identifies the
accepted revision and latest budget revision. Size must fit the verified settings
limit; split bounded immutable chunks or fail publication if over limit, never
truncate. No secret/provider credential or prompt body belongs in policy.

Every fresh prompt publication and policy activation conditionally updates the
SAME control row inside its transaction before reading current policy/budgets;
then it acquires the per-key head. Use that lock order consistently. Every
successful prompt publication advances control even if the model is unchanged.
Guard lifecycle and policy/control/budget activation against direct bypass.

For the existing JS budget writer, use **snapshot-bound conditional commit**:
read control revision/policy FIRST, then read all governed active prompt models
and full budget history and run `assertModelCeilings`. Bind the validation result
to that exact control revision and exact prompt ID/version/model/ETag snapshot.
Commit the new immutable budget revision plus conditional control advance in ONE
Dataverse changeset with the original control ETag. If any prompt publication or
policy/budget activation occurred since the initial read, CAS fails and the
whole changeset rolls back. Re-read/revalidate under a NEW request only after
explicit conflict handling; do not acquire a fresh control ETag after validation.
Unchanged request retries first check their immutable budget receipt/history.
Every input-changing writer must participate in this fence before it is trusted.

This is the alternative to moving budget validation into another Custom API;
it keeps the existing JS budget validator but explicitly fences the snapshot it
validated. The batch adapter must require actual actor/header and no-fallback
transport (the current `executeChangeset` signature does not yet expose a
noFallback option), trusted DAL and target interlock. No unrelated helper's
fallback behavior is changed globally. Preserve current budget JSON schema,
registered membership, UI, request IDs and runtime semantics.

Rehearse both orderings of **budget raise versus prompt model-ceiling reduction**:
only the first expected-control commit wins; the other must conflict without a
new budget/prompt row. Also test unrelated prompt publishes (conservative global
conflicts are acceptable at this low write volume), direct bypass and policy
changes. Atomic budget creation/control advance WITHOUT binding the prevalidation
snapshot is insufficient.

This design reuses settings, not another prompt library. It is a recommended
technical design with explicit adjacent writer work, not a claim of implemented
parity. Model-list changes do not silently alter the accepted publication policy;
activate a reviewed new policy explicitly. Runtime tier/model/budget guards remain
necessary because invocation-time configuration can change after publication.

Before build, materialize schema and parity vectors for this policy and prove
extractability of current JS checks. Required vectors include undeclared/missing
variables in either template, reviewer labels, A7 markers, empty/oversize strings,
unknown output/source/target kinds, native structured-output compatibility,
unknown/retired model and token ceilings, budget changes, category/group values,
and unsupported profile. Do not invent an external-flow profile from the AI-run
output. Connor's representative definition is still needed; unknown profiles
remain visible/editable drafts and cannot publish accidentally.

## Baseline verification and remaining acceptance

**[VERIFIED via offline Jest run]** 12 existing suites, 307 tests passed:
prompt store/adapter/validators, service+route publisher, seeds, tool/reviewer
resolvers, model review, Executor budgets, write core and target interlock.
External dependencies/fetch are mocked. These tests characterize the current JS
implementation and provide starting fixtures; they do not verify the new Action,
.NET parity, tenant privileges, draft nullability or concurrency behavior.

No new runtime tests were written because this pass changes plans only.
No .NET/pac executable was found on this session's PATH during the earlier check;
Connor owns confirming a supported build/deploy machine and solution packaging.

| Before sandbox writes | During separately authorized rehearsal |
|---|---|
| Connor ownership/access scope decided; source cutover inventory recorded | Verify actual publisher roles, unauthorized identity denial and no app fallback |
| Draft-null behavior supported by platform documentation | Save/read/update null-version draft under tenant rules; prove non-execution |
| Head/receipt/policy fence and two-client envelope specified | Simultaneous first/later/case-variant publication; stale draft/metadata/policy |
| Validation dependencies and parity corpus requirements enumerated | JS/.NET parity; all-or-none rollback after each write boundary |
| Caller/seed/fallback migration requirements identified | Lost response + later publish + replay; direct/bulk/head/receipt bypass denial |
| Connor example and tooling availability still UNKNOWN | Representative backend draft → discover → backend publish → app read; inverse Admin route |

Remaining owner input: a representative Connor prompt definition/location, when
available. Remaining engineering prerequisites: concrete policy schema/vectors,
solution/role manifest and build/deploy tooling. No further product choice about
using Admin is outstanding. Do not treat this preflight as permission to install
tools, provision schema, grant access or write Production.

## Review and bounded reconciliation record

Contract-reconcile Mode A and Sweep Mode A cover this changed proposal and its
source prerequisites. Owner/access statements and draft/policy recommendations
were reconciled in the plan, contract and feasibility report in the same pass.
Existing runtime/Atlas/memory descriptions are still descriptions of the old
implementation, not evidence this design is deployed. Concurrent main handoff
files remain outside this branch's edit ownership.

Independent read-only review (`/root/review_pr553`) verified the inspected source
findings and snapshot counts. Its one finding required binding budget activation
to the exact prevalidated model/control snapshot. The snapshot-bound conditional
commit above corrected it; bounded recheck found no residual blocker from that
finding. This is not proof of Dataverse transaction behavior.

Documentation currency, fact consistency, canonical pointers, symbol refs,
build-claim freshness, docs catalog, secret-scan and scaffolding checks plus all
available paired self-tests passed sequentially (15 commands). Diff whitespace
check passed. Searches found no remaining live claim in this proposal set that
solution ownership is undecided or that Admin-only publishing is required.
Verdict: pre-rehearsal SOURCE CHECKS COMPLETE for this bounded pass; deployed
roles/tooling/custom rules, .NET parity and tenant fault behavior remain UNKNOWN.
