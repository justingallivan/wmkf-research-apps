---
title: Shared Prompt Consumer and Budget Integration Milestone
domain: ai-platform
kind: implementation-record
status: historical
summary: Historical revision3 consumer and budget milestone; superseded for consumer compatibility by the October30 record.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_WIRE_V1_2026-10-29.md
---

# PR553 consumer and budget milestone

**Historical checkpoint at commit `0b6971c37`, policy revision3.** Current consumer
status is in [the October30 milestone](SHARED_PROMPT_CONSUMER_COMPATIBILITY_2026-10-30.md).
The holds and counts below describe that earlier checkpoint.

**[PARTIAL implementation at that checkpoint, NOT deployed]** Ten consumer definitions are audited
and captured from tracked source; eight can pass local publication validation.
Two audited names and thirty other known names remain held. No live row was read
or changed. The new budget adapter is not imported by a route or existing budget
publisher; legacy runtime paths remain unchanged. Deployment/enablement still
requires consumer compatibility, guards, roles, actual transaction rehearsal and
coordinated cutover of both publication routes and budget writer.

## Invariants

| Invariant | Enforcement | Verification |
|---|---|---|
| Preserve load-bearing consumer contracts | Exact per-name variable/output values from tracked source; named exceptions cannot be chosen by metadata | Actual imported exports compared against artifact; mutation negatives |
| No invented defaults or silent migration | Null model remains blocked; unresolved names stay held | Missing/unknown model and hold tests |
| Same pinned model ceilings for both writer directions | Shared policy registry and resolver; no live discovery in preparation | Model-up/budget-down and budget-up/model-down cases |
| Original control revision binds validation | Capture control BEFORE budget/model reads, freeze copies, no refresh | Mutating transport and both modeled CAS orders |
| Budget revision and CAS land together | One control-first changeset with create-only revision and original If-Match | Adapter descriptor tests; tenant rollback still unproved for this operation |
| No fallback actor write | Prepared server plan only; noFallback true through DAL/transport; missing header refuses | 403/disabled-impersonation and legacy-default tests |
| No false proof from unknown outcome | Errors propagate without refreshing ETag or retrying creates | Unknown-outcome adapter test; same-UUID recovery required at integration |

## Named consumer requirements

`consumer-contract.js` reads policy requirements, not caller-selected profiles.
The offline extractor runs only a fixed allowlist of tracked pure config modules
in isolated VM contexts with no service/environment/network imports. This is a
trusted-source build mechanism, not a security sandbox for malicious code.
Source/caller digests pin the review basis; actual imported exports are separately
tested so a broken extractor cannot validate itself alone.

Every audited name retains its complete seeded variable/output contracts in
value, including input names/sources/placement/A7 classification and caps,
retention, targets, guards and local/native schemas. Body/system prose remains
editable except the actual Pre-Site reader's exact-body and required-system
assertions. Review Panel and Cycle Dossier row token ceilings remain 16,000.
Property-order-independent consumers allow memo reformatting; Pre-Site retains
JSON.stringify property order because its current reader requires it.
Whole-root JSON consumers keep synthetic pass-through output labels; generic
new definitions do not acquire that exception. A modified consumer memo always
fails even if its generic structure would otherwise pass. Reviewed empty array
defaults are accepted (no child values bypass validation); nonempty aggregate
defaults remain rejected.

| Audited name(s) | Local publication disposition |
|---|---|
| Cycle Dossier entry/research plan | Exact frozen inputs/output, all pass-through, row tokens ≤16,000 |
| Review Panel seat/chair | Exact frozen contract; seat runtime question schema remains caller-owned; row tokens ≤16,000 |
| Review Synthesis | Exact native/local schema, request write target/always-overwrite and hash retention preserved |
| Presentation summary, staff discussion summary/sentiment | Exact bounded transcript schemas and none retention/pass-through preserved |
| Initial Assessment | HOLD: producer rejects a result whose version differs from INITIAL_ASSESSMENT_CONTRACT.promptVersion; simply publishing v2 would fail after a paid call. Requires coordinated consumer/lineage update |
| Pre-Site proposal core | HOLD: tracked native schema contains maxLength constraints rejected by the reviewed v1 native subset, while reader requires exact seed parity. Do not strip/rewrite automatically; reconcile source/provider compatibility and reader cutover first |

The Pre-Site hold does NOT assert that today's live row or provider call fails;
no current content or provider execution was probed. Known-name holds are not
editorial classifications or permissions. Remaining legacy names still need their
own caller audit. New generic common-format prompts remain publishable locally.
Audited Executor consumers may preserve explicit null temperature (the current
Executor supplies its own temperature default), but first-name creation still
requires an explicit value. No null model default is inferred from ambient env.

## Budget integration

The control row stores LAST-WRITER policy provenance, not active policy. Its
revision/ETag and provenance types are checked, but an older valid policy stamp
does not force reseeding or reset concurrency. Fresh requests still check the
current packaged artifact; new budget plans/commits stamp that current identity.
Policy replacement still requires disabling/draining all writers and both writer
implementations using the same accepted artifact. The deployed Dataverse guards
must reject writes validated against an unsupported artifact before enablement;
that tenant-side enforcement is not proved by local CAS tests.

The policy captures the existing closed Executor budget registry, code fallback,
all bounds and membership. All eight token-governed keys require shared budget
state; timeout-only and generic/PA names do not. Both validation directions use
the SAME pinned tier/model mapping. The shared Review Panel seat budget is also
bounded by the minimum reviewed OpenAI candidate ceiling, preserving its second
provider slot without introducing OpenAI prompt publication.

`validateFreshPublication` takes a separate SERVER budget snapshot, never a new
wire-request field. For token-governed names it requires valid control + strict
budget state, checks the current budget against the staged model, and returns
an internal budgetFence. The future Dataverse operation must consume that CAS
before its per-name head. A valid pure check without that write is not a stored
consistency guarantee. Old receipt replay still precedes these fresh checks.

`prepareBudgetPublication` validates exact caller input and server-derived actor,
then captures original control revision/ETag BEFORE reading budget history and
sole-current Published model rows. It freezes copies across every await. Missing,
corrupt/future-schema, unknown/null model, stale expected version or missing actor
state fails closed. Malformed budget rows still reserve their revision; registry
schema/default-fill/timeout bounds and existing five-field budget envelope remain
unchanged. It never loads live model lists or accepts provider/default overrides.

The preparation result is frozen and recognized only in the preparing process.
`prompt-budget.js` refuses forged/deserialized plans and requires a trusted DAL
context. It submits one changeset: control PATCH with original ETag FIRST, then
immutable budget-revision POST. Both set the server actor lookup and pass the
strict effective actor to transport. It neither refreshes ETags nor retries the
write on conflict/unknown outcome. Caller integration must resolve the existing
request UUID in durable budget history before fresh preparation and after an
unknown/conflict outcome; this helper does not replace that existing replay path.

The localized noFallback option now reaches batch _writeFetch. When selected with
an actor, a disabled/omitted impersonation header refuses before batch submission;
a 403 does not retry as service principal. Default behavior of existing changeset
callers remains unchanged. Explicit server rejection rolls back; timeout or an
unconfirmed response is UNKNOWN, not evidence that nothing committed.

## Contract-reconcile Mode B / bounded Sweep Mode A

Entry points: local validators, preparation and named budget DAL adapter.
Persistence target: existing wmkf_appsystemsettings; none written. Consumers:
unit tests, explicit build/check scripts and future route/SDK integration.

- Whole flow: tracked seed/caller → pinned policy → local definition checks;
  server budget/control/current-model reads → frozen plan → strict changeset.
- Partial success: one atomic changeset; no partial application status. Tenant
  proof pending; ambiguous transport outcome requires request-ID resolution.
- Async: original control, state, input and actor are copied/frozen; no post-await
  ETag refresh. Runtime rows are checked current/Published/sole before validation. All adapter
  reads and writes use DynamicsService's same target; the legacy settings client
  is not used for history reads in this adapter.
- Helper semantics: actual per-name root-output and ordering differences retained;
  source-specific exceptions never become generic permission or execution bypass.
- Durable surface: no new table/column/route/status. Existing settings set is
  registered from retained metadata; no provisioning. New source headers/tests
  and this record describe the unused adapter; actual rollout still gated.
- Docs: schema/wire/README/main-plan state is updated; historical first milestone
  and probe evidence remain explicitly dated. No live/default writer claim.
- Symbol fan-out: new consumer errors/budgetFence/plan fields are consumed only
  by local tests/new adapter; existing routes/UI do not consume them yet.

## Explicit cutover prerequisites

- All eight governed current rows must have explicit reviewed models. The empty
  null-default registry intentionally blocks inheriting an ambient env default.
- Replace the old budget writer, its request-ID replay/history lookup and runtime
  readers together so every path resolves the SAME Dataverse target. The legacy
  settings client prefers DYNAMICS_SANDBOX_URL, unlike the new adapter. Do not
  copy data between targets or enable mixed paths as an accidental migration.
- Deploy and prove Dataverse raw-write guards and current-artifact validation for
  both writer directions, disable/drain old writer instances on artifact changes,
  preserve control revisions and historical receipts. No mutable policy service
  or reset/reseed of the control counter is introduced.
- Seed control deliberately; prove original ETag rollback/actor/alternate-key
  behavior, replay and unknown-outcome recovery in the sandbox before enabling.

Recommendation evidence for treating control identity as provenance: the row
represents the previous successful writer, not the currently installed validator.
A regression uses older valid provenance and revision17/ETag44, prepares against
current pinned models and emits revision18/current artifact without reseeding.
An old submitted prompt-policy identity still rejects; modeled CAS orders still
reject stale commits. Disconfirming boundary: old writer code must not remain
accepted after a policy replacement. Disable/drain and current-artifact Dataverse
guard proof are REQUIRED and currently PLANNED; no claim that a CAS alone fixes
validation against different policies. The CAS itself is retained unchanged.

## Independent review disposition

Claude Fable (`claude-fable-5-1`) reviewed through verified `claude.ai` OAuth /
WMKF Team subscription, session `60a82210-60b7-4036-bccc-378e512b8ccb`. No API-key
authentication, model/provider execution for the app, or metered review product.

The review found no blocking local-code defect, but required removal of control
policy-hash activation coupling before seeding. This was implemented as provenance
type checks while retaining fresh current-policy validation, original-revision
CAS and explicit same-artifact deployment/guard gates. The targeted recheck
accepted the correction and verified five suites / 295 tests, with no claim of
tenant proof. Its minor request for missing malformed-history/duplicate-key tests
was addressed with both exact mocked rejection cases.

Self-review fixed cross-target history reads and verifies that the legacy settings
client is not called by the new adapter. No architecture/format expansion or
optional refinement was pursued after the concrete findings were addressed.

Final local verification: 13 suites / 465 tests passed, including consumer, budget,
DAL/context, changeset, strict/default actor behavior and previous publication
contracts. Types, lint, script syntax, policy/golden drift, independent Python
hashes and whitespace checks passed. Relevant runtime/document/security gates
and paired self-tests passed sequentially (29 commands). Policy revision 3 hash:
`7aad6cb304185b2a9eb64b573b82770224d000b085f43e2b43695eebff2d21db`.
No live seeding, write, merge or production deployment was performed.
