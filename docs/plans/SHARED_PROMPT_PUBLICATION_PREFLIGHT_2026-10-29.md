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
confirmed deployment availability. No message was sent to him by this agent. Justin subsequently confirmed Connor
agrees to adopt the existing app prompt format in future PA flows. Locating the
historical flow is not a library build/rehearsal/release prerequisite.

**[VERIFIED via source/test commands]** The initial offline pass used the PR branch at
`1bda7149c`, current repository code and the retained Production metadata snapshot
observed `2026-10-29T23:22:42.446Z`. That initial pass made no live tenant request/write, provisioning,
provider request or model execution. A subsequent explicitly authorized read-only
probe is recorded in the live-example section below. No runtime code changed.
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
  Head/receipt tables are OrganizationOwned, with explicit organization-level
  read for approved publishers and no user/team assignment dependency. Mutations
  remain guard-restricted and replay remains actor-bound. Nonempty identity/UUID
  guards and Active unique indexes are mandatory before enablement.
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
  outside the ordinary author guarantee. Inventory actual holders of
  `prvBypassCustomBusinessLogic` and `prvBypassCustomPlugins`, including Connor
  and the app principal; do not assume their roles from their responsibilities.
  Microsoft documents merged individual/bulk pipelines, but verify actual
  registrations without duplicate guard execution in sandbox.

## Proposed client protocol (both routes)

The logical Action name and SDK types are finalized with Connor, not guessed as
already deployed. Transport uses POST, with bounded inputs and a versioned
canonical JSON request inside the typed Action parameters if necessary.

| Input | Rule |
|---|---|
| `contractVersion`, `definitionFormatVersion`, `requestId` | Known wire schema + supported common app-format version + UUID; one immutable request, persisted by client until outcome known |
| `promptKey`, `draftId`, `draftEtag` | Canonical key and exact saved draft; no inline partial content PATCH on publication |
| `expectedHeadRevision` | Required expected state, including explicit initialization revision |
| `expectedCurrent` | Explicit null for first publication, otherwise exact ID/version/ETag |
| `metadataBaseline`, `snapshotHash` | Match durable staged baseline and complete saved definition/catalog |
| `policyRevision`, `policyArtifactHash` | Exact version/hash of reviewed artifact packaged with the operation; no caller-owned rules or mutable activation service |

No actor ID, arbitrary target URL, fields-to-PATCH, provider credentials, force
bypass or execution-budget override is accepted. Request fingerprint covers the
complete envelope plus trusted actor and canonicalization version. UTF-8 encoding,
JSON key order, null/omitted distinction, line endings, Unicode handling and
number serialization need shared golden vectors before JS/.NET release.

Response distinguishes immutable `receipt` (which publication this UUID did)
from refreshed `current` state (what is active now). A stale/conflict response
preserves drafts. A retried UUID with head/receipt conflict MUST recheck the
receipt after conflict, because a winner can commit after the initial lookup.
Unknown/unavailable lookup stays unknown, not a fresh-edit conflict or new UUID.
Concurrent winner/unknown timeout use read-receipt + unchanged
UUID retry, never automatic merge or another publication. Typed failures include
unauthorized/unsupported contract, draft changed, active/head changed, metadata
changed, policy changed, corrupt lifecycle and request-ID reuse; these are
proposed protocol codes, not current route behavior. Map SDK faults explicitly;
do not assume a plug-in exception becomes an HTTP 409 automatically.

## Two validation responsibilities

**[OWNER CONFIRMED, per Justin]** Future PA prompts adopt the same stored format
as app prompts. The first release needs no separate legacy PA format/profile or
generalized validator framework. Existing app-format variants keep their actual
requirements. Locating the old flow is not a build, rehearsal or library-release
gate; integration of a future PA execution path remains separately accepted.

- **Shared publication:** actor/privilege/target, key/lifecycle/expected state,
  metadata baseline, immutable version history, atomic activation and receipts,
  retries. Identical for Admin and coding tools, independent of executor.
- **Definition format:** full stored-template, variable/output, applicable A7,
  model/token and caller-contract checks. The first supported version is the
  existing app format. Apply governed budget checks to registered app prompts,
  without making registration a condition for a new PA prompt to publish.

Both responsibilities remain mandatory inside the same authoritative Action;
no lifecycle-only commit or editorial category/group bypass. Explicit format
version joins the request fingerprint and receipt. Unsupported legacy text
stays visible; format acceptance does not prove runtime feature support.

## Pinned policy and scoped budget coordination

The normative [format v1](SHARED_PROMPT_FORMAT_V1_2026-10-29.md) resolves the
previous cap/null-model/temperature/ASCII/enum ambiguities and requires exact
per-name constraints in the artifact. The
[validated Fable review](SHARED_PROMPT_REVIEW_VALIDATION_2026-10-29.md) records
source evidence, counterexamples and what was accepted/refuted.

**[VERIFIED existing source]** JS publication uses template/reviewer parse checks,
reviewed capability+pricing registries, dynamic tier resolution, output-schema
checks and durable Executor budgets. Current budget publication validates models
before creating a new uniquely keyed settings revision; no cross-writer
coordination currently exists. Runtime caps server-owned overrides, throws for
oversized row budgets and enforces strict retry floors; it does not make a
racing persisted budget/model pair consistent.

**[PLANNED simplification]** Generate ONE reviewed immutable artifact and package
it with JS and .NET: format version/hash, per-name template/parser constraints,
explicit tier→concrete/default mapping and reviewed capabilities/ceilings. No
provider call inside the operation. No mutable policy activation, policy-revision
settings rows or global policy-write fence in v1. Fresh requests must match the
installed artifact; policy replacement requires server-side disabling of both
publication routes and draining in-flight work before deploy/re-enable. Replay
of completed old receipts does not revalidate against today's artifact.

**[PLANNED retained protection]** One settings coordination row remains for
REGISTERED TOKEN-GOVERNED budgets, not all prompts. Those model publications
conditionally acquire it before reading budgets, then acquire their per-name
head. Timeout-only and unregistered generic/PA names take only their head.
Budget membership is the reviewed artifact registry, never an editorial label
or client flag. Do not let direct writes bypass the budget/row guards.

The JS budget writer captures ORIGINAL coordination revision/ETag before reading
all governed active models/history and validating. It commits the immutable
revision plus ORIGINAL-revision CAS in one strict-actor/no-fallback changeset.
Never reread a fresh ETag after validation to make a stale result commit. A stale
second commit aborts in either budget-up/model-down order. Preserve budget UI,
JSON schema, request IDs, history and runtime caps. Strict transport needs the
localized noFallback extension already identified; do not globally change
unrelated write-helper semantics.

Implement this budget adaptation after the first local contract/validator/mock
slice, but before enabling new governed publishers. No need to finish it before
writing foundation source. Actual transaction/lock/rollback behavior remains a
sandbox gate. The reproducible offline script tests the actual runtime guard and
modeled alternatives, not Dataverse isolation. A one-time equality read of a
mutable policy row is not accepted as proof of commit-time freshness.

The first foundation deliverables are executable v1 schema/artifact and golden
vectors, pure validator extraction, reader/paging/structural-error tests, both
clients' mocked transport and reusable plug-in source. Local .NET tooling is
needed for compilation, not for JS/schema/mocks. Use that same operation for the
sandbox spike rather than another throwaway implementation. Keep all live
writes disabled pending full proof and authorized rollout.

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
| OrganizationOwned head/receipt, pinned policy and scoped budget fence specified | Simultaneous first/later/case-variant publication; stale draft/metadata/policy |
| Normative format v1 and artifact/parity acceptance defined; executable artifacts are first local deliverables | JS/.NET parity; all-or-none rollback after each write boundary |
| Caller/seed/fallback migration requirements identified | Lost response + later publish + replay; direct/bulk/head/receipt bypass denial |
| Common format agreed; tooling still UNKNOWN; historical flow not a prerequisite | New common-format backend draft → discover → backend publish → app read; inverse Admin route; no PA execution |

The historical example below is not a build dependency. Local implementation
can start now using the format v1 contract and validated review disposition.
Executable artifact/schema/vectors and solution manifests are first-slice work;
tooling, roles, transaction proof and full cohort validation gate compile/import/
writer enablement as applicable, not independent local coding. No further product choice about
using Admin is outstanding. Do not treat this preflight as permission to install
tools, provision schema, grant access or write Production.

## Review and bounded reconciliation record

Contract-reconcile Mode A and Sweep Mode A cover this changed proposal and its
source prerequisites. Owner/access statements and draft/policy recommendations
were reconciled in the plan, contract and feasibility report in the same pass.
Existing runtime/Atlas/memory descriptions are still descriptions of the old
implementation, not evidence this design is deployed. Concurrent main handoff
files remain outside this branch's edit ownership.

The earlier independent preflight review identified stale budget/model
prevalidation; original-snapshot CAS remains required. The later Fable review
and source/offline validation are now reconciled in the dedicated validated-
review document. Its policy simplification uses a deployment-pinned artifact;
it does not replace commit-time freshness with an unfenced mutable-policy read.

Earlier 15 documentation checks/self-tests passed within their recorded scope;
this revision reruns relevant gates. No old review receipt is approval of
unimplemented behavior. Current verdict: READY for local foundation; roles,
actual solution/transaction behavior and .NET parity gate writer enablement.

## Subsequent owner-authorized read-only example discovery

**[VERIFIED via `scripts/probe-shared-prompt-authoring-example.cjs`, Production,
2026-10-30T02:14–02:20Z (October 29 PT)]** Sanitized retained evidence:
[evidence/shared-prompt-authoring-example-2026-10-29.json](evidence/shared-prompt-authoring-example-2026-10-29.json).
The owner explicitly authorized a database probe to find an example, possibly
inside Power Automate. Dataverse calls were GET only; OAuth token exchange was
the only POST. No flow/model execution, mutation, role change or schema action.
Raw flow definitions, provider headers/connection values, applicant output and
prompt bodies are not retained in this evidence.

**Found authored example:** `phase-i.checkin`, row
`ee2927ec-9741-f111-88b5-000d3a306b0f`. Its creator/modifier match the owner of
the user-linked AI run (the earlier browser form identified that owner as Connor
Noda). This is attributable authored content, not proof of which flow consumes
it or which exact prompt produced the linked run.

| Stored part | Observed format / implication |
|---|---|
| System prompt | 7,937 characters; role/input/task/output/rules sections for clerical checks, budget checks, keyword tags, technical summary and advisory priorities fit |
| User template | 158 characters; `{{proposal_text}}` and `{{budget_pdf}}` |
| System placeholder | `{{output_schema}}` interpolated into output instructions |
| Input intent | Extracted proposal text plus native budget PDF visual inspection; not just two plain-text input variables |
| Output field | 2,216 characters of human-readable JSON-shaped example, including alternatives such as number-or-null; not parseable JSON or a machine JSON Schema. This is a different authored format, not automatic evidence of corruption |
| Variable declarations | Absent |
| Lifecycle/model | Stored v1, noncurrent, null status and null model; max tokens 4096, temperature 0.3. No automatic Draft conversion/publication |

The linked run `402fdf35-9b45-f111-88b5-000d3a306d45` was created
2026-05-01T20:20:39Z, labeled PowerAutomate Auto with model
`claude-sonnet-4-5`, but its prompt GUID and prompt version are null. The record
form's display name is not the creation date. Similar task/output structure is
not sufficient to link that run to this prompt row.

**Flow access boundary:** 123 category-5 workflow definitions visible to the
application identity were paged completely; all 123 had parseable clientdata.
The broad discovery terms matched 21 generic records, but none of the raw
visible definitions matched `wmkf_ai_`, `anthropic`, `claude` or
`clerical_checks`. No originating prompt-execution flow was identified. This
does not rule out personal/non-solution flows, another environment, inaccessible
child flows, dynamic configuration or a different connector. Do not describe it
as a complete Power Automate inventory or proof that no flow exists.

**Current plan implication, after Connor's format agreement reported by Justin:**
the example demonstrates a legacy authoring shape, not a requirement to build an
external-flow publisher. Preserve its content/lifecycle and do not activate,
rewrite or migrate it automatically. New Admin and backend prompts use the
agreed existing app format; shared publication rules and format checks are
separate mandatory responsibilities in the same Action. Finding this example's
Power Automate flow is NOT required to build, rehearse or release the library.
Native-PDF assembly, model selection, output handling and active lookup for an
actual future flow require that integration's own acceptance; no PA execution
support or legacy compatibility is claimed by library publication alone.

Probe validation: Node syntax check and ESLint passed; sanitized output reviewed.
The summary probe was rerun to confirm the visible-definition boundary.
Independent read-only review found that raw-flow term matching needed to precede
JSON-wrapper inspection; this was corrected, rerun and rechecked. The probe
now emits its own raw-term matches and recognized-definition count, covering
unrecognized/unparseable wrappers without retaining their text. All 123 visible
definitions were recognized in the final run, with zero specific raw-term matches.
No full prompt/flow dump was committed. All 15 relevant documentation/secret checks and paired self-tests passed
sequentially for the retained evidence and reconciled plan changes; syntax,
ESLint and diff whitespace checks passed. No new runtime implementation was
introduced or tested by this read-only discovery.


## Current decision reconciliation: common format, independent flow integration

**[OWNER CONFIRMED, per Justin]** Connor agrees to adopt the existing app prompt
format in future PA flows. Shared publication rules and definition-format checks
are separate responsibilities, both mandatory before publication commits. This
supersedes the earlier proposal to require an external-flow profile or locate
the legacy flow before implementation. The historical probe evidence is unchanged.

Bounded Sweep Mode A searched all four shared-library proposal documents,
related docs/wiki/memory and session pointers. The current plan/contract/gates
are rewritten together; no legacy-format profile or historical-flow discovery
is a library build/rehearsal/release requirement. Existing current-runtime
contracts remain unchanged. Future PA execution still needs its own integration
acceptance; a common stored format does not implement an executor or native PDF.
Independent read-only review (`/root/review_pr553`) found no actionable issue
in this bounded update. Definition format version is explicit in both clients'
request, fingerprint and receipt; editorial metadata cannot select weaker rules.
All 15 documentation gates and available paired self-tests passed sequentially,
plus whitespace checks, for this docs-only revision. No new live probe or runtime
test was run; retained evidence and current runtime behavior are unchanged.

**[PLANNED budget-policy parity]** The budget publisher must replace its current
dynamic tier/model resolution with the SAME pinned tier/default/capability
artifact used by prompt publication. Coordination alone cannot protect a pair
validated against different model ceilings. Policy deployment disables and drains
governed budget writes as well as both prompt publication routes, then revalidates
all governed active budget/model pairs against the new artifact before re-enabling
writers. Reject incompatible pairs for explicit remediation. Shared golden cases
cover differing dynamic versus pinned tier ceilings and policy upgrades.
