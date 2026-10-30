---
title: PR553 Schema Preparation and First Publication Client Contracts
kind: implementation-record
domain: ai-platform
status: active
summary: Offline additive schema requests, disabled bound-package tooling, content-free bootstrap context and synthetic publication recovery/readback contracts; no tenant writes or live client wiring.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/PR553_FIRST_TEST_PUBLICATION_2026-10-30.md
  - docs/plans/SHARED_PROMPT_PACKAGE_MILESTONE_2026-10-30.md
---

# Local preparation toward the first publication

[VERIFIED via local source/tests; NOT DEPLOYED] The chosen Research Review App
Suite solution now has an offline additive schema planner. A separate packaging
mode can embed and independently inspect fully populated but disabled test
bindings. The synthetic first-publication client has request/recovery/readback
contracts plus an offline request-state command. It has no live HTTP/OAuth
adapter or draft-creation command yet. Those remain implementation work, not
something Connor is expected to write.

Windows access remains unavailable. Connor maintains the operation. Human
operator choice, secure signing-key handoff/backup and a quiet external-writer
window remain pending. No role grant, schema write, package/API/guard registration,
prompt mutation, model invocation, merge or deployment occurred.

| Invariant | Enforcement | Evidence |
|---|---|---|
| Chosen test target/solution only | Evidence target/org plus exact WMKF publisher/solution match | Wrong host/org/publisher/solution and failed inventory tests |
| Existing metadata is preserved | Create requests only; incompatible attributes and existing tables block | Conflict/compatible/existing-table tests |
| Active keys and lookup protections precede writer use | Exact key requests, Restrict lookup; fresh published readback remains required | Schema shape checks; no tenant proof claimed |
| Bound build cannot enable writes | Exact test organization and disabled shape, fixed resource bytes, full signature/source inspection | Bound shape negatives plus actual synthetic bound build |
| Bootstrap observes, never publishes | Exact unbound preparation traces SDK context then original denial before obtaining SDK services | Content-present exclusion, context match and zero-call/zero-mutation checks |
| Unknown outcome retains original request | Frozen state; auth before receipt; one POST then lookup, recovery mode never POSTs | Lost response, read outage, repeated receipt and unknown POST tests |
| Receipt success is distinct from active readback | Actor/payload binding then full one-row snapshot/head check | UUID collision, duplicate/current/head/content/paging/target negatives |

## Additive schema request preparation

`registration/schema-v1.json` defines seven prompt fields, native head fields,
receipt fields, two unique keys and the active-prompt lookup. The primary display
columns reuse the existing required values the SDK writes: prompt key for heads
and request UUID for receipts. They are nullable at the platform metadata level;
server guards enforce valid nonempty identities and preserve null-version drafts.
No extra human-readable title column or write-map change is introduced.

`prepare-prompt-publication-schema.cjs` consumes the retained read-only schema and
registration reports, confirms the exact chosen unmanaged solution and publisher,
and emits 18 proposed POST requests with `MSCRM.SolutionUniqueName`. It has no
environment loading, authentication, HTTP or execution mode. Incomplete inventories
throw; a conflicting attribute or an existing new table is an explicit blocker,
not a request to patch it or proof its metadata is compatible. Reports must carry the versioned complete-metadata marker and the expected
unfiltered prompt-attribute and exact two-table query scopes. An old or narrowed
report is not execution permission. New table requests include only the primary
column; subsequent columns and keys carry ordered dependencies. Revalidate live published metadata before every approved
provisioning phase; record partial creation by exact artifact IDs and prepare a
new remainder plan instead of blindly rerunning the old requests.

Table and relationship request shapes follow Microsoft's
[table creation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api)
and [lookup relationship](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-relationships-using-web-api)
contracts. Keys must report Active, table concurrency must be true and lookup
deletion must be Restrict before writer use. Request preparation does not prove
the tenant accepts these payloads or numeric/range/role requirements.

## Practical bootstrap order and context evidence

The API execute privilege is the receipt table's actual Create privilege. Therefore
provision/review additive schema and Active keys without guards BEFORE registering
the disabled API. Resolve that exact privilege from published metadata; never
invent its name. Then register the disabled publisher/API, still without guards.
The older package checkpoint's API-before-schema order was incomplete and is
historical; the manifest and generated registration plan now express the corrected
order. Role/seed preparation and old-writer freeze precede later guards.

The exact disabled/null preparation bindings can emit `PR553_BOOTSTRAP_CONTEXT`
through platform `ITracingService` before the original `release_bindings_incomplete`
denial. The payload contains SDK organization, effective/initiating IDs, stage,
mode, transaction flag, actual OwningExtension ID/logical name, message and
correlation ID. It never reads/logs RequestJson, prompt content or credentials,
and does not obtain a Dataverse service. Complete bindings, whether enabled or
disabled for replay, do not activate this observation path.

This is not a new success response or authority grant. Actual trace availability,
exception tracing configuration and tenant context must be verified during the
approved test session. Capture only the marker payload and corroborate its
organization/correlation/extension; no full unrelated trace export. No logging
configuration was changed here.

## Bound-disabled package path

The existing builder accepts optional `--bindings ABSOLUTE_FILE`. It validates
before build and copies that input into a new output directory so the compiler
and inspector use the same bytes. Transport selects the supplied embedded resource
without overwriting tracked `registration/bindings.json`. Default builds still
embed the disabled/null template. The same signing key/package/assembly identity
and signed source-packet binding remain in force.

`validate-bound-disabled`, `inspect-bound-disabled` and `verify-bound-disabled`
require exact fields, binding version 1, `enabled=false`, the fixed test org,
canonical nonzero GUIDs, nonempty publishers, bounded distinct lists and a valid
privilege-name shape. The inspector matches those bytes against the signed DLL.
This is structural/artifact verification, NOT proof the IDs, execute privilege,
operator approval or impersonation rights are real. Only separately reviewed
observations may supply actual values. Enabled bindings remain unsupported by
this builder; no activation file is synthesized.

Local synthetic binding tests use deliberately fake actor/extension/privilege
values. Their packages are test fixtures, not handoff/registration artifacts.
The retained key is unchanged and still awaits secure transfer/backup to Connor.
NuGet archive hashes identify exact bytes; signed assembly/source/key hashes
remain the reproducible anchors, not an asserted Git commit.

## First-publication client and offline command

`first-publication-client.js` is limited to `pr553.rehearsal.publication` in the
approved test organization. Preparation requires a complete empty-head inventory
containing exactly the real Draft/null-version/noncurrent row, original ETag,
matching empty metadata baseline and a locally valid complete snapshot. It uses
the installed pinned policy for a NEW request. The offline command
`prepare-prompt-first-publication.cjs` writes the immutable request/expected-actor
state to a new private local file; it performs no authentication or tenant access.
IDs and ETags must come from actual reads, not the checked-in proposal.

A future trusted transport must independently pin the test host, authorize,
perform complete reads and call only the shared Action. Actor fields never enter
the publication request. `attempt` verifies the transport actor tuple, looks up
the immutable receipt BEFORE considering a POST, and preserves the original
request/UUID through any uncertainty. A failed initial receipt read prevents a
POST. One attempted POST, including a timeout, is followed only by same-UUID
lookup; a trusted adapter can explicitly classify a known fixed server denial,
which is reported as rejected only after lookup finds no receipt. Raw exception
text is never returned, and unknown/unclassified errors stay unknown. Every
result records whether a POST was attempted; recovery-only mode cannot POST. Historical receipt replay does not run
new policy/definition checks. No new UUID or automatic write retry is generated.

A matching receipt yields receipt-confirmed state even when active readback is
unavailable or divergent. Full first-publication readback additionally requires
complete exact-key inventory, one current Published row, exact snapshot hash and
matching native head GUID/version/revision. This narrow first-test check does
not invalidate a historical receipt when a later publication becomes active;
it reports readback unverified and retains the committed receipt. General Admin
history/UI and later-version readback behavior remain separate work.

## Corrected Windows handoff

The previous bundle's flat fixture directory omitted the registration manifest
that ProductionChecks reads via a repository-relative path. It would not complete
all checks on Windows. The corrected generator preserves
`tests/fixtures/prompt-publication/` and includes the exact registration manifest
under `dataverse/prompt-publication/registration/`. It runs the portable net8
harness against that copied layout before producing its handoff manifest.
The bundle generator can also take explicit `--bindings` for a bound-disabled
artifact and verifies the copied package/receipt/bindings together. This validates
package layout, not Windows/Framework semantics. Earlier ZIPs are
superseded; give Connor the final replacement recorded here after verification.

## Contract and durable boundary

Contract-reconcile Mode B traces evidence → proposed metadata requests and
observed draft/actor → durable request → authenticated port → immutable receipt
→ complete readback. One publication is the unit of success. Async operations
retain frozen request state; there is no UI generation to update and no batch
writer. Failed/partial metadata application is future operator state, not a
claimed transactional schema deployment. No Postgres migration, live route,
provider contract or deployed Atlas ownership changed.

Bounded Sweep Mode A covers bootstrap order, bound-disabled inspection and current
handoff/client state. The earlier package record is historical. Current SDK
README and first-test runbook point here and retain Windows/tenant/auth gates.
Final review/test/artifact evidence follows after Fable correction review.
