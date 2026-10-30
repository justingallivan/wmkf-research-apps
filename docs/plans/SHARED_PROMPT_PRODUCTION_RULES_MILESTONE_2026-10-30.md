---
title: Shared Prompt Production Rules and Plug-in Wiring Milestone
domain: ai-platform
kind: implementation-record
status: historical
summary: Historical production-rules checkpoint before the signed-package milestone; retains its original local evidence and remaining-work boundary.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_PUBLISHER_MILESTONE_2026-10-30.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
  - docs/plans/PRE_SITE_PROMPT_READER_TRANSITION_2026-10-30.md
---

# Production rules and registration source

Historical checkpoint at ad8e48e06. Current packaging state and remaining
registration work are recorded in
[the package milestone](SHARED_PROMPT_PACKAGE_MILESTONE_2026-10-30.md).

[VERIFIED via local source/build/tests; NOT DEPLOYED] Production implementation of
`IPublicationRules` now exists, together with stateless `IPlugin` publisher and
guard entry classes and a prepared registration manifest. The main entry uses
the real rules, never the test stub. The packaged bindings are disabled with null
tenant/extension/privilege values and empty identity lists. Neither registration
nor a live publisher is claimed; no solution import, schema/role write, API call
or model execution occurred.

[OWNER DECIDED] Keep the planned synchronous MainOperation and package reviewed
environment/identity bindings with the assembly. Microsoft does not support
constructor configuration for a Custom API main-operation plug-in; the documented
PostOperation workaround would change this design. See
[Microsoft's Custom API documentation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api).

| Invariant | Production enforcement | Local evidence |
|---|---|---|
| No policy supplied by a caller | Embedded byte-pinned policy revision 5 and artifact identity; cloned read-only inputs | Policy-byte load/hash and installed-policy checks |
| Complete definition acceptance rules | DefinitionRules ports templates/A7, source/variable/output/local/native grammars, pinned model/temperature and named consumers | 535 JS-oracle cases, including all 39 audited consumer shapes and negative mutations |
| Required original budget before head | SDK control read/CAS/readback precedes budget history/head; exact captured state is passed into fresh validation | Real production governed SDK flow, absent/future history and conflicting model negatives |
| No filtered inventory masquerades as complete | Table-derived Global Read checked for effective AND initiating principal on prompt/head/receipt/settings | Privilege/context fake SDK checks; real tenant intersection still unproved |
| Missing schema/index cannot admit a first publication | Fresh-only published metadata gate checks columns/ranges, concurrency, ownership, lookup target and exact Active unique keys | Missing key/column, wrong owner/lookup/concurrency fail before writes |
| Catalog membership/removal cannot race via raw writes | Exact shared catalog-row CAS; direct group/control/history mutation denied by settings guard | Missing/duplicate/removed catalog and fault cases; SDK guard composition |
| Actor and release are not request input | Packaged binding checks org/message/stage/extension/approved human and initiating principal before SDK operations | Disabled template, wrong org/extension/initiator/async and extra-input negatives |
| Historical replay stays historical | Authorization before receipt; fresh enabled/policy/schema/rules follow replay | Old-policy receipt and disabled-new-writer replay tests |
| No test rule in registered source | No-argument IPlugin adapters compose production rules/store/auth/guards | Bound production composition plus real adapter rejection of incomplete packaged bindings |

## Definition and budget parity boundary

`DefinitionRules` enforces the existing JS acceptance grammar without rewriting
memo text. A7 ASCII case folding and the explicit ECMAScript whitespace set avoid
assuming .NET regex defaults match JavaScript. Pre-Site ordered memos compare
JavaScript property order (including integer-index keys); other audited memos use
structural canonical equality. Unknown schema/target/source/model complements
reject. Arbitrary regex/default aggregates remain unsupported, as in JS.
Whitespace checks use the explicit ECMAScript set for first-name catalog
completeness and legacy budget UUID validation too. BOM-only metadata rejects;
a NEL-prefixed invalid budget UUID cannot hide an older incompatible revision.
The helper validates presence/shape only and never rewrites stored strings.
Diagnostics use fixed first-error codes; identical JS multi-error ordering/path
lists are not claimed. The checked-in oracle generator verifies 535 accept/reject cases covering 80
JS rejection codes. Negatives must throw a known fixed rule/parser code; crashes
cannot masquerade as expected rejection. It does not prove provider behavior or
actual Framework floating-point parity. Packaged marker escapes are allowlisted
so future uppercase regex classes cannot silently invert during ASCII folding.
The current three byte-pinned patterns are supported; a future marker pattern
using whitespace inside an unescaped bracket class needs an explicit translation
review before the policy byte pin is changed. Generic future-regex parity is not
claimed.

Budget exemptions derive only from the packaged registry. Governed writes take
`prompt-library.budget-coordination` under its original ETag/revision, advance
without resetting historical policy provenance, verify the write and read the
complete history from the same target. Registered defaults fill older missing
names. Reserved malformed revisions remain warnings/high-water evidence;
unsupported future schema, duplicate/ambiguous strict JSON, unsafe numeric data
and timestamps outside the real UTC ISO-millisecond publication form fail the entire
strict operation (including .NET-parseable time-only text that JS rejects). These conservative
unknown-state failures must not become an older-revision fallback. This is an
intentional divergence from runtime reads: for example, a future-schema revision
may leave runtime execution on an older valid revision, while strict publication
blocks the write. It is not a claim of identical runtime-fallback behavior. No app/provider
call occurs during publication. The existing JS budget writer is not switched.

`prompt-library.groups` remains the existing settings record. New/changed staged
assignments must be actual group/section members; unchanged baseline assignments
are preserved. The same catalog row is conditionally fenced before promotion, with exact value
and advanced-RowVersion readback; a no-op that leaves the version unchanged aborts.
Catalog v1 requires unique bounded lowercase keys, nonblank labels, safe integer
order, and unique section keys per group. Raw group creation/removal/editing is
blocked once the guard is installed. An audited group editor/removal operation
must join the same fence and inspect all references; it is not supplied here.
Published metadata edits and raw prompt deletes remain blocked until their
separate audited operation exists.

## Packaged bindings and registration

`dataverse/prompt-publication/registration/bindings.json` is a disabled template,
not actual tenant authority. It packages binding version, enabled flag, expected
organization/owning extension, approved human publishers, separately approved
initiating principals (including Admin's app when needed), and the exact execute
privilege. App roles, SDK impersonation intersection and these lists must be
coordinated explicitly. Updating identity/target/policy bindings requires a
reviewed package replacement and writer disable/drain, not an editable settings
row or client flag. Disabled-but-complete bindings permit authorized historical
receipt replay while rejecting new publications. The null template fails before
SDK calls.

The prepared manifest specifies `wmkf_PublishPrompt`, global synchronous Action,
MainOperation stage 30, calling-user identity, no extra custom processing steps,
required String `RequestJson` and String `ResultJson`. The exact receipt Create
privilege gates execution and is checked against published table metadata. The
stateless main adapter strictly accepts one request parameter and emits output
only after the provisional receipt is written. The platform must commit before
that response is observed. No exception is swallowed to continue a transaction.

Bootstrap is two-phase: register the disabled publisher/API (defer guards),
observe the actual main-operation OwningExtension/context, fill reviewed bindings,
rebuild/update the signed package and reverify that identity before guard install.
Do not assume the GUID or its entity type from a plug-in type ID. Exact tenant
behavior remains UNKNOWN until the approved probe. Seed groups and budget control
before guards; no automatic seeding or registration is implemented.

The stateless guard adapter uses synchronous PreOperation stage 20, calling user,
all attributes (no filtered-update escape), the `publication` preimage alias and
complete prompt lifecycle/native-head/settings key/value projections listed in
the manifest. It handles entity/reference targets; bulk/upsert/state/assign paths
are explicit denials. Probe which messages the tenant actually supports and
prove merged pipelines without executing a guard twice. Actual OwnExtension,
null-bearing images, original Target.RowVersion/Create ID and serializable-permit propagation
remain blocking rehearsal evidence.

**Do not activate these guards against the existing writers.** Settings guards
also deny the old uncoordinated JS budget/history and catalog writers. Existing
prompt/seed/budget/group writers must be frozen, migrated or disabled before
registration/enablement; the reviewed shared budget and group authoring routes
are still pending. Unrelated Create/Update/Delete settings remain permitted. For settings, the
manifest requires proving alternate/bulk paths reach individual guards and
explicitly excludes blanket alternate-message denial steps that would block
unrelated setting writers. A bypass blocks enablement until a scoped handler
exists. Other protected tables retain explicit alternate-message denials. Connor owns solution and
registration maintenance. No live bindings or bypass privileges are invented.

## Remaining release work

- Build/sign the supported dependent-assembly package and deployable managed
  solution from the reviewed source; this manifest is not a solution installer.
- Resolve actual organization/extension/user/app/privilege IDs, provision the
  additive schema/Active keys/lookup delete restrictions, verify full images and
  all actual role/bypass grants. The source gate does not attest registration.
- Run Windows Framework and tenant transaction/rollback/uniqueness/precision/
  propagation tests. Compile success is not Framework execution or live proof.
- Complete both publication clients, same-target budget replay/writer cutover,
  audited metadata/group operations and reader/UI integration. Preserve the
  staged Pre-Site pause/drain/new-reader/new-prompt transition; main auto-deploys.
- Authorize a concrete sandbox deployment/rehearsal only after those applicable
  preparation gates; no production merge or deployment is authorized here.

## Contract and durable reconciliation

Contract-reconcile Mode B: IPlugin context/bindings → strict request → real
actor/privilege authorization → historical receipt → fresh enabled/policy/schema
→ budget original CAS/state → head/history/draft → full format/budget/catalog CAS
→ lifecycle/head/receipt → provisional output/platform commit. Async/client-state
and partial batch audits are N/A; one publication is the success unit. Fake SDK
faults prove stop-on-fault and no receipt, not actual rollback. Existing runtime
routes, database migrations, statuses and deployed Atlas ownership are unchanged.

Bounded Sweep Mode A: production rules and entry source now exist. Authoritative
source/tests update current plan/wire/READMEs; earlier SDK/publisher records are
explicitly historical. The main checkout's handoff/unrelated changes remain
untouched. No external-state claim is refreshed by local evidence.

## Final local verification and Fable disposition

[VERIFIED via final isolated SDK runner] Transport and Checks compile for net48
and net8 with zero warnings/errors. The net8 harness passes 1,478 checks,
including 535 JS-oracle definition cases covering 80 observed rejection codes,
production generic/governed flows and actual plug-in/guard composition. The
packaged disabled/null template rejects before SDK calls. All 387 publication
Jest tests, policy/golden drift, independent Python fingerprints, ESLint, shell
syntax, whitespace and 29 sequential relevant repository gate/self-test commands
passed. Prepared packet matches the final source/resources/locks/oracles. Actual
Windows Framework execution and tenant behavior were not tested.

[VERIFIED via Claude Fable review] OAuth session
`bcf73630-899c-4df1-8595-98c43862e811`, actual model only
`claude-fable-5-1`, reviewed the milestone and two targeted correction checks.
No helper model, API key, metered product or permission denial was used/reported.
The final check reran all 1,478 checks and accepted the whitespace patch with no
new divergence. The prior targeted review accepted the full bounded milestone
and verified packet/oracle drift checks. It did not independently build net48;
that compilation is established by the isolated SDK runner above.

Concrete corrections: broadened acceptance vectors; crashes no longer count as
expected negatives; marker escape/flag guard; catalog CAS readback must advance;
unknown registration table has an explicit denial; two-phase binding bootstrap
is documented; settings guard no longer assumes preimage RowVersion; production
budget policy loads only after replay. Extra cases cover wrong-next control,
protected Delete, malformed newer history, unchanged legacy assignment and
manifest/entry/image coherence. Final self-review fixed ECMAScript whitespace
at catalog completeness and budget GUID sinks; the counterexample proves an
invalid newer NEL-GUID row cannot hide an older incompatible budget/model pair.

Retained nonblocking future-policy note: new marker regex syntax with whitespace
inside bracket classes needs a deliberate port and new vectors before changing
the current policy byte pin. Today's three patterns are supported and unchanged.
Strict publication failures intentionally differ from permissive runtime fallback
as described above; no broader runtime-reader parity is claimed.

Sweep result for the bounded implementation fact: source → SDK writes → receipt
and tests are traced; current plan/wire/READMEs now describe production rules and
IPlugin source, and the earlier publisher/SDK records are explicitly historical.
Repeated stale-fact searches found no remaining live stale claim in those
surfaces. Atlas/runtime/memory deployment facts remain unchanged; actual tenant
state, role/registration behavior and release gates remain UNKNOWN or PLANNED.
No merge, deployment, environment edit, tenant provisioning or Dataverse write
was performed. Signing/import/client/writer cutover and rehearsal remain work,
not approvals inferred from this local review.
