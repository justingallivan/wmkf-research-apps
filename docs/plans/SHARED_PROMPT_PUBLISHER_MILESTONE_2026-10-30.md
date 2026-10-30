---
title: Shared Prompt SDK Publisher and Authorization Milestone
domain: ai-platform
kind: implementation-record
status: active
summary: Historical lifecycle/authorization checkpoint at 36a846dc5; production rules and IPlugin composition are recorded in the subsequent local-only milestone.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_SDK_MILESTONE_2026-10-30.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
---

# SDK publisher lifecycle and authorization

Historical checkpoint at `36a846dc5`. See [production rules milestone](SHARED_PROMPT_PRODUCTION_RULES_MILESTONE_2026-10-30.md)
for subsequent production rules/IPlugin source. No tenant registration is claimed.

[PARTIAL / LOCAL ONLY] The SDK source now includes the synchronous publication
state machine, real SDK head/receipt persistence and authorization/write-guard
evaluators. This is not the complete deployable publisher: there is no registered
IPlugin entry, and `IPublicationRules` has no production implementation. Its only
implementation is an explicitly test-only stub in Checks. Full .NET execution-
format, installed-policy, original-control budget and live catalog/removal rules
must be implemented and connected before a plug-in can be exposed. No lifecycle-
only route, nullable validator default or caller-selected exemption exists.

| Invariant | Implementation | Offline verification |
|---|---|---|
| Authorization precedes receipt read/replay | PublisherAuthorization checks server-configured human IDs, enabled interactive systemuser, execute privilege and global Read; store binds derived actor to SDK context | Denied identity/status/privilege/context cases; authorized replay after policy change, revoked actor denial |
| Stable historical wire identity | PublicationWire strictly parses exact request/receipt fields and actor-bound v1 fingerprints independently of installed policy | JS-oracle valid/invalid structural matrix plus existing fingerprint goldens |
| Complete history and original conditions | Publisher validates head/inventory/draft/catalog baseline; SDK updates use original ETags, never refreshed conditions | First/later publication; malformed/aliased/reserved/duplicate state; exact prior content preservation |
| Required rules precede promotion | Policy, budget-before-head, fresh format and live catalog are mandatory server dependencies | Explicit call ordering and fault injection; no permissive production rule implementation |
| No fault continuation inside transaction | No publisher/store catch, retry, fallback or nested batch | Injected policy/budget/head/promotion/receipt failures stop, with no success receipt |
| Raw writes cannot activate or rewrite published history | Guard allowlists draft attributes, rejects protected control/lifecycle/content writes and unknown/bulk/upsert messages | Raw create/update/published/control/alternate-message and altered-permit negatives |
| Trusted writes use an exact short-lived permit | Parent message/stage/extension/org/actor/correlation/transaction plus immediate child context and exact target/attributes/RowVersion | Every integrated SDK mutation passes guard; permit removed on exit/failure; altered/reused writes deny |

## Persistence proposal and ownership

[OWNER APPROVED AS PROPOSED NAMES] Justin approved `wmkf_promptpublicationhead`
and `wmkf_promptpublicationreceipt` for Connor's solution review before provisioning.
No schema or privilege name is asserted live. Justin selected native head
columns and a prompt lookup rather than the initial compact JSON state draft.
Both proposed tables are OrganizationOwned with optimistic concurrency.

| Table | Proposed columns | Required proof |
|---|---|---|
| Head | `wmkf_keyhash` String 64, `wmkf_promptkey`/`wmkf_originalkey` String 850, `wmkf_revision` String 19, `wmkf_highwaterversion` Int32, nullable `wmkf_currentprompt` lookup to the existing prompt table and `wmkf_currentversion` Int32 | Required identity/revision/high-water; unique key on keyhash must be Active; current lookup/version null together or valid together |
| Receipt | `wmkf_requestid` String 36, `wmkf_payload` Memo at least 65,536 UTF-16 units | Required nonempty UUID/payload; unique requestid key must be Active; immutable Create-only v1 envelope |

SDK RowVersion is reconstructed as exact OData weak ETag, never persisted as a
second writable version. Receipt payload is the content-free v1 receipt,
including original request/baseline/actor and publication result. Definition text
is not copied into either table. There is no automatic expiry. Queries page all
visible matches and reject duplicates/identity divergence; read errors never
mean absence. Required guards, actual schema/index/lookup-relationship behavior
and organization-level security remain registration/rehearsal gates.

`PublicationSdkStore` now projects all six catalog columns and complete Executor
content into its inventory/draft DTO. Null stored memo/metadata values remain
null. Invalid lifecycle and unsupported numeric/type values reject; no silent
legacy conversion. The older `PromptRows.ReadInventory` transport helper remains
narrow and is not the publisher's inventory DTO.

The required rules interface now passes the captured budget snapshot explicitly
from fence to fresh validation; it does not require a hidden mutable rules object.
The eventual production implementation must enforce registry membership and
original control identity, not replace the captured state with a newer read.

## Authorization and guard registration boundary

Approved human GUIDs and the expected execute privilege are trusted release
configuration, with no defaults or client fields. Read privileges are derived
from each actual published prompt/head/receipt table metadata record, and returned
privilege IDs must match. Execute privilege must match receipt Create metadata. Effective systemuser must be
interactive/enabled and not an application user. Initiating user may be the
Admin app principal; SDK impersonation intersection remains a separate tenant
proof. Authorization uses `RetrieveUserPrivilegeByPrivilegeName`, including team
privilege depth; the older flat privilege-list message cannot prove global Read.
No role grant or automated Admin-role synchronization is included.

The guard evaluator must be wired to synchronous PreOperation registration with
complete name/status/current/version preimages on prompts and all native head
columns on head updates. Trusted parent requires the exact
Custom API main-operation extension GUID and stage; actual OwningExtension,
ParentContext and SharedVariables propagation MUST be observed in rehearsal.
Guard checkers reconstruct trust from the child ParentContext/SharedVariables
using server-owned bindings; no shared authority object identity is required.
Unrelated/null parents fall through to the draft allowlist, never to a privileged
write. The scoped permit contains only serializable text and binds the entire SDK
mutation, not a client bypass flag or a depth-only assertion. No IPlugin adapter
or default registration is supplied while these proofs/rules are missing.

Bulk/upsert/state/assign messages currently deny; prove merged pipeline coverage
without double execution before enabling clients. Published metadata edits and
all raw deletes currently deny as well: the separate audited metadata operation
remains unimplemented. This is an explicit temporary fail-closed restriction,
not a completed metadata-editing experience. Privileged plug-in bypass and
administrators disabling enforcement remain operational exceptions requiring
inventory and release controls.

A publisher result is provisional until the platform finishes/commits its
transaction. The plugin must let every fault abort the transaction. Receipt
lookup after an aborted/unknown request occurs through the external client on
the SAME UUID; never catch and resume SDK writes inside the failed transaction.
No refreshed current state is inserted into the immutable historical receipt.

## Contract and reconciliation audit

Contract-reconcile Mode B: strict request → trusted authorization → receipt
replay → mandatory rules → SDK head fence → full inventory/draft → original CAS
promotion/prior clear/head finish/receipt → provisional platform response.
Client state/UI/route and background/async audits are N/A in this source milestone.
Unit of success is one publication; fakes prove stop-on-fault, not platform rollback.
No database migration, route, runtime enum, existing writer or deployed schema
changes. Proposed persistent columns and receipts require Connor's solution,
Atlas and security/role/keys proof before tenant enablement.

Sweep Mode A is bounded to the changed SDK implementation fact. SDK source and
integrated tests are authoritative; current plan/wire/README are updated while
prior milestone records stay explicitly historical. Main SESSION_PROMPT and
unrelated changes remain owned in the main checkout. No live-state claim changes.

## Verification and Claude review

[VERIFIED via local commands] Both Transport and Checks compile for net48 and
net8 with zero warnings/errors. The isolated locked SDK runner passes 498
canonical/wire/publisher/authorization/guard checks and verifies the preparation
packet. The JS publication suites pass 385 tests, including the new wire-oracle
drift check. Policy/golden drift and independent Python fingerprints, ESLint,
shell syntax, whitespace and all 29 sequential relevant repository gate/self-test
commands pass. No tenant connection, provider/model execution or live mutation
was performed by these tests. Framework runtime execution remains unproved.

[VERIFIED via Claude review] Fable reviewed session
`2187e057-0a93-4db1-907b-1ffcdd861502` through Keychain-backed subscription OAuth.
Fable was the requested primary model (`claude-fable-5-1`); CLI usage also reports
auxiliary `claude-haiku-5-5` usage in that session. No API keys or metered review
product were used. The final targeted recheck allowed only read/check tools,
reran all 498 checks and accepted the bounded local milestone with no new defect.
No review permission denial remained. Review was finalized after the native
head decision and code freeze, not against the earlier JSON-state draft.

Concrete findings addressed: unrelated/null parents now reach raw draft checks;
head preimage registration names every native column; authorization derives and
matches real table privilege IDs instead of accepting three unrelated names;
negative assertions pin exact codes; captured budget state crosses the rules
interface explicitly; null-version omission is accurately documented. Initiating
app versus effective human attribution remains intentional and must be proved
with exact calling-user registration/impersonation bindings before enablement.

[PLANNED] Complete production rules, signed/dependent-assembly packaging, secure
Custom API/guard registration, full preimages, nullable draft metadata, Active
indexes and OrganizationOwned tables, relationship delete restrictions, actual
Read/impersonation/bypass privileges, Windows Framework parity, timestamp/permit
propagation and transaction/rollback/concurrency rehearsal remain gates. The fake
SDK proves message/ordering/denial behavior only. Nothing is ready to deploy or
enable, and no schema provision, merge, deployment or Dataverse write occurred.

Bounded Sweep result: current plan/wire/READMEs describe this partial compiled
state; the previous SDK/transaction records are explicitly historical. The old
“No .NET project” current-plan statement was removed. The same stale-fact searches
and relevant documentation gates passed. No remaining live stale claim was found
in these in-scope surfaces; tenant/platform/production-rule facts remain UNKNOWN
or PLANNED as named above.
