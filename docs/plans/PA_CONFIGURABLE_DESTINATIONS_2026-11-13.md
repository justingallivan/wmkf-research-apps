# Configurable destinations for Power Automate jobs

Status: implementation in the isolated feature branch; no deployment or live policy,
prompt, Request or credential changes. Connor’s test remains on its existing immutable
Preview. Executive Summary document selection and first-event eligibility remain OPEN.

## Scope and owner decision

Justin authorized extending the existing prompt destination configuration to durable
Power Automate jobs, preserving duplicate and overwrite protection, with Opus 5.5
review of plan and build. This slice changes the admitted Short Title destination;
it does not enable additional prompt tasks or Summary generation.

The shared generic Executor already interprets `outputSchema.outputs[].target`.
The machine path previously used `target:none` plus a fixed Short Title field.
The extension accepts the same direct Request target syntax in that profiled task:

```json
{"parseMode":"raw","outputs":[{"name":"edited_title","maxChars":2000,"target":{"kind":"akoya_request","field":"wmkf_exampletitle"}}]}
```

This example is a shape, not an approved live field. Field names must be exact
lowercase WMKF logical names. No jsonPath, field arrays, extra target keys, lookups,
numeric columns, arbitrary entities or client-selected destinations are accepted.
The stored title task/body/model/profile/output limit remain their existing contract.

A new server pilot configuration adds one optional `destinationGrant`:

```json
{"field":"wmkf_exampletitle","type":"Memo","maxLength":2000}
```

It pins the approved physical field and compatible type/length. The prompt selects
that field; the server grant independently permits it. New destinations require
operator approval/configuration and verified prompt pins, but no code mapping change.
The existing Admin raw Output Schema editor publishes the prompt definition; it does
not grant machine permission. No new configuration table, field picker or queue.

## Invariants and enforcement

| Invariant | Source / verification |
| --- | --- |
| Legacy Connor configuration stays valid | Absent grant adds no default JSON key; unchanged default builder output and full-row prompt hashing; legacy integration tests |
| Grant and target must agree exactly | `machine-destination.js`: explicit target needs grant; grant with target:none rejects, no fallback |
| Prompt editing cannot redirect admitted jobs | Frozen configuration and full-row hash already cover output schema; machine admission hashes entire prompt; persisted field matches frozen target and exact grant |
| Status checks remain exact | `projectMachineJob` receives server-policy expected field, defaults to legacy field; foreign but valid field fails; terminal status needs no expired content |
| New target is compatible | Uncached pinned-Sandbox metadata check before reservation, at provider checks and pre-PATCH: optional/readable/updateable/unsecured, simple nonderived String/Memo, plain Text, live length >= grant length >= fixed 2000-character output cap |
| Existing text survives | `$select`, blankness hash and single-field payload all use resolved field. Only null/empty is blank; whitespace/text protected before provider |
| Replays do not generate or write again | Original same-key receipt returned before mutable prompt/source loading; different event/scope cannot bypass unique environment/Request/physical-field reservation |
| Clearing/failure/expiry does not reopen machine slot | All machine reservations retained, including known pre-dispatch/validation failures. Synthetic fixture slot-release semantics remain unchanged; no new recovery endpoint |
| One physical conditional operation | Original ETag, one payload, noFallback, 412 conflict/no refresh, unknown outcomes fenced |
| Generic bypass is bounded | Generic Executor and publication reject the configured machine field in that deployment; profiled task publication has closed validation and Executor returns results without direct persistence |
| Summary remains gated | Lay Abstract cannot be granted to Short Title; Summary/Methodology profiled targets remain none, draft admission unchanged |

The reservation identity stays the physical field. Choosing a different approved field
is a different initialization; it does not reuse or erase the original receipt. Existing
receipts are not backfilled, migrated or deleted. Already released historical slots
are not retroactively repaired. A fresh scope cannot circumvent retained reservations.

The current pilot still pins one prompt version/hash and permits one job per scope.
Use a separately approved new scope for a different destination; do not edit a live
scope to remap work. A changed/revoked policy stops outstanding work; it never migrates
its destination. Retain the original scope configuration to inspect/replay its jobs.
An edit to the Dataverse current prompt alone does not mutate any admitted snapshot.

## Boundaries

Entry: existing authenticated machine submit → exact server policy → prompt/source
load and destination metadata validation → transaction freezes config/task/slot.
Worker: frozen config and policy verification → original target baseline → shared
Executor (no direct write) → retained result and audit → frozen publication → original
ETag PATCH → content-free status. Success is one job/one field, not an audit alone.
Every asynchronous policy/metadata/source return is followed by currentness checks.

Metadata availability is not proof of application-user security-role privileges;
Dataverse still enforces actual read/write permissions. No role changes are included.
The generic-writer guard is deployment-scoped, not a tenant-wide exclusive ownership
claim: existing external flows, other deployments and dedicated staff editors can
still write. Before approving a destination, inspect those consumers and writers.
No existing generic production workflows are silently remapped. A malformed configured pilot policy fails closed for generic execution/publication in that deployment; operators must validate the policy before enabling it. Absent policy preserves the existing generic path.

No Postgres migration, new API route, schema provisioning or deployment is needed for
this source change. Existing permanent task/initialization/publication receipts and
hashes are reused. Browser/editor behavior is unchanged; downstream readers still read
their own named physical fields and need review when a destination is changed.

## Opus plan review adjudication

Opus 5.5 tool-free OAuth review recommended exact single grant, no legacy fallback
with a grant, exact status comparison, destination-aware blankness, generic bypass
protection, metadata checks before reservation, and legacy configuration compatibility.
Applied all those constraints. Two reviewer assumptions were verified against source:
`sha256(canonical(promptRow))` already covers the entire output schema, so no hash
migration is needed; exact policy-field comparison can reuse existing permanent task
and slot receipts without adding a redundant field/hash column. Expired configurations
cannot authorize a write, while exact terminal status remains readable under its grant.

Tests use synthetic provider/DAL data and a new loopback-only PostgreSQL container
on port 55441/database pa_proof, with isolated schemas. They do not touch the existing
roster-import container, Neon, Dataverse, Connor’s scope, provider APIs or Vercel.

## Opus build review adjudication

The build review's proposed blocker (generic guard blocking the durable worker) was
refuted by the early `executeProfiledPrompt` return and by running the actual worker
with `readMachinePilotPolicy` returning the configured grant. The generic branch
also rejects execution-marked prompts before model dispatch, so an ungranted profiled
prompt cannot bypass the durable path. The regression remains in the suite.

Applied the useful findings: metadata is checked before publication dispatch as well
as immediately before PATCH; Summary exclusion uses the existing shared field
constant; malformed-pilot coupling is explicit above. A metadata failure before
publication leaves no dispatched operation; a later race at pre-PATCH remains fenced
as unknown. Actual candidate metadata (including exact plain-Text format) must pass
before a live grant is approved. No candidate field is enabled by this change.

## Final verification and review

[VERIFIED via local commands] 531 tests passed across 19 suites, including real
PostgreSQL worker/store, shared Executor and staff-draft integration. Scoped ESLint,
TypeScript, webpack production build, API/security/DAL/Atlas/document/prompt-boundary
gates and their sequential self-tests passed. Turbopack was not retried because this
worktree's external node_modules symlink is unsupported; webpack is the verified build.
All providers and Dataverse responses were synthetic; no live configured-field trial.

Opus 5.5 follow-up: **no remaining blockers**, B1 withdrawn. Exact approved packet
SHA-256 `e40bc7458c28b0055f88600ee5ef85b7790e4869edf0fe0d8d826a7a0138f58e`.
Root verified the guard imports policy at invocation (no cache); the generic-bypass
unit test covers a real configured-field target. Tests additionally assert unavailable
metadata leaves generation queued and publication can resume after compatible metadata
returns, with no second generation and the original ETag. These checks deliberately
retain existing nonterminal unavailable-check semantics rather than adding a new state.
The pre-PATCH race remains fenced if uncertainty arises after dispatch intent.
A valid disabled/expired policy still protects its configured field from generic writes;
only absence removes that deployment-level generic guard. Retained database reservations
remain authoritative for machine initialization.

Owner: Codex. Branch: `codex/power-automate-integration-2026-11-11`.
Next action: separately approve an actual destination/policy and bounded live trial
if needed. No deployment, prompt publication, credentials or Connor test changed.
Summary document selection remains open. No migration or new persisted enum/status.
