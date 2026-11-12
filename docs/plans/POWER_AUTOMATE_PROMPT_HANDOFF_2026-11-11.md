# Power Automate prompt delivery: implementation and Connor handoff

Owner: Codex in `codex/power-automate-integration-2026-11-11`.
Status: partial, offline foundation; no deployed machine endpoint or flow.
Last verified: 2026-11-11 (Pacific).

## Outcome

Justin clarified the deliverable on November 11: give Connor prompts stored in
Dataverse, structured so his Power Automate flows can call them and populate the
expected Dataverse output fields. Connection/application details are unknown to
Justin and are not a reason to expand infrastructure. Justin subsequently clarified
that working plumbing takes priority over optimizing prompt wording or length.
Existing prompt content stays unchanged; no Methodology length choice was made.

The accepted execution boundary remains one shared backend Executor, as recorded
in [the discovery handoff](PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md): Power Automate
selects when to request approved tasks and handles business follow-up; the backend
loads the Dataverse prompt/profile, resolves the approved inputs, validates outputs,
and performs approved conditional writeback. No second provider implementation in
Power Automate. Prompt storage alone is not a callable integration or field mapping.

The deliverable for each task is its exact prompt key and published revision,
required input contract, structured output schema, exact entity/column destination,
write policy, and an example submit/status exchange. The deployment handoff also
needs the actual API audience/app permission and an independently proven Power
Automate connection. No credentials belong in the prompt row or flow examples.

## Current boundary and first implementation slice

[VERIFIED via source and local tests] New `machine-auth.js` verifies single-tenant
Entra v2 application JWTs using the existing jose library. It pins the API audience,
issuer/tenant, RS256 signature, caller application, service-principal object ID,
`idtyp=app`, and application role; rejects any `scp` claim; requires bounded numeric
`iat`/`nbf`/`exp` with a two-hour maximum lifetime. The server config is reread after
verification, and the returned assertion rechecks configuration and expiration
before later protected operations. A tenant change replaces the cached key resolver.
No token claim chooses a JWKS URL. There is no environment binding or route yet.

Identity is `app:entra-v2:<tenant>:<client>:<service-principal>`. This is distinct
from the existing human trial identities and is additionally bounded by exact
request and proof scope at reads. This is not a claim that a trusted arbitrary
store caller cannot construct that string; the store is an internal authorized seam.

[VERIFIED via isolated PostgreSQL] `machine-admission-proof.js` accepts one exact
configured fixture Request, task, scope and idempotency key. It authenticates before
SQL, pins source event to null and operation to `generate-draft`, and uses the
existing migration 097 ledger. Concurrent identical submissions return one receipt;
configuration retention does not erase replay identity. Reads bind environment,
principal, Request, scope and key, and reject changed/executed tasks. The only public
projection is `{jobId, version, state: 'queued', modelExecutionEnabled: false}`.
There are no source, response, result, audit, initialization or publication rows.
One fixture configuration row is persisted. No model or source is invoked.

This is an offline facade, **not an HTTP route or PA connector proof**. Its tests
require an explicit loopback database named `pa_proof` and create/drop only a unique
schema. Do not wire it to the shared application database: a generic worker could
execute a synthetic task if explicitly given its ID. Nothing claims a runtime
worker exclusion that has not been built. The facade returns 202-equivalent
acceptance and 200-equivalent status, never completed generation. A policy change
during a database operation can leave a committed receipt while denying the
response; exact reauthorized replay recovers it without duplicate admission.

| Invariant | Enforcing surface | Verification |
| --- | --- | --- |
| Verified application identity is not request-provided identity | `machine-auth.js`; closed proof body | Real RSA tokens; wrong/delegated identity cases |
| Policy changes and expiry deny subsequent protected operations | Auth assertion and grant reread before/after awaits | Deferred key verification and SQL mutation tests |
| Duplicate delivery preserves one immutable job | Store unique identity/key and canonical command hash | Concurrent same/conflicting payloads against real PostgreSQL |
| Proof cannot disclose another scope's receipt | Exact owner/Request/scope/key checks after `readJob` | Foreign principal, Request and scope tests |
| Receipt exposes no private configuration | Explicit four-field projection | Private canary fields present in source view |
| Admission is not execution or writeback | No worker/provider/source wiring; queued-only projection | Zero attempt/initialization/publication rows; configuration only |

Auth errors are content-free and uniform within class: malformed/invalid tokens,
unknown keys and claim failures return 401; correctly signed tokens with the wrong
caller/object/role return 403; missing/disabled/changed config and known JWKS
transport/format failures return 503. Unknown verification errors fail closed as
503, so an unrecognized dependency outage is not mislabeled as invalid credentials.
Raw storage diagnostics are replaced by a safe 503. No provider or cron-secret fallback exists.

## Prerequisites for a real Power Automate connection

[PLANNED] Reuse an approved existing API/caller registration if appropriate; do not
create one speculatively. Verify API access-token version 2, optional `idtyp` claim,
single tenant, app-only application permission/admin consent, exact caller and
service-principal object IDs. Custom token signing keys are outside this initial
contract. The actual connection/action must obtain app-only tokens; the presence
of an HTTP-with-Entra connector is not proof. Microsoft's
[claims-validation guidance](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
requires `idtyp=app` when authorizing an application through `azp`.

The later HTTP slice must register exact routes and guards with the proxy/security
matrix, bound request body and admission capacity, return `private, no-store` plus
authenticated status location/polling interval, and prove real connector issuance.
It must not promote this isolated proof facade to a production queue. General
submit/status handling must map all durable task/writeback states, including
unknown outcomes and partial success, rather than using the queued-only proof DTO.

## Prompt-to-field handoff inventory

The workbook requirements in the dated discovery handoff are inputs for review,
not approval of every audience, keyword list or overwrite rule. Current registered
proposal capabilities deliberately have `destinationField: null`.

| Desired output | Existing key or implementation | Required handoff work |
| --- | --- | --- |
| Short title/objective | `grantee-title.generate`; existing title service | D37 explicitly approves `akoya_request.wmkf_wmkfprojectdescription`; preserve the objective wording and existing callers. Verify the current published row and new-flow refresh policy before enabling writeback. |
| Executive summary | `proposal.executive-summary`; 200-word draft capability | Approve exact destination and audience; do not silently reuse legacy `wmkf_ai_summary` or document-section fields. |
| Methodology | `proposal.methodology`; draft capability | Reconcile workbook overview length with the longer trial draft before assigning a destination. |
| Personnel | Workbook P4, existing analog discovery | Approve task instructions, output shape and exact destination. |
| Intake rationale | Workbook P5 | Define versioned storage/write contract, not an unconditional overwrite. |
| Field/method keywords | Workbook P7 shared task | Obtain approved controlled vocabularies; D26 placeholder lists are not production values. |
| Intake flags | Workbook P6, provisional rubric | Approve rubric, evidence and versioned destination. |
| Open questions | Cross-task output in workbook P | Decide accumulation/deduplication and references; not automatically another model call. |
| Staff notes/rationale | Human-editable workbook Q | Preserve human edits and intentional clearing; not automatically another model call. |
| Expertise | `expertise.recommendations` | Other session owns fourth trial. Recommendations only; assignments still require coordination with Connor. |

All exact mappings need source/metadata and current consumer verification. Similar
field labels do not establish equivalent semantics. No new Dataverse columns,
prompt publication or live output writes are authorized by this offline receipt.

## First concrete handoff row: Short Title

[VERIFIED via tracked prompt definition and D37 owner decision; live row not
re-probed in this slice] This is a contract to connect, not a deployed endpoint:

| Contract item | Value |
| --- | --- |
| Dataverse prompt identity | `wmkf_ai_promptname = grantee-title.generate`; historical November 10 Admin readback was v2, requiring fresh readback before pinning a rollout |
| Source record | Authorized `akoya_request`, selected by Request GUID |
| `source_title` input | `akoya_title`, required untrusted applicant text, maximum 600 characters |
| `source_abstract` input | `wmkf_abstract`, required untrusted applicant text, maximum 20,000 characters |
| Output | `edited_title`, raw one-line string; “To [verb]…” objective; existing service validation still applies |
| Prompt output target | `none`; caller/backend delivery owns writeback |
| Approved destination | `akoya_request.wmkf_wmkfprojectdescription` |
| Existing writer semantics | Invited-research cron writes when blank; this is not the new intake trigger |
| Intake delivery decision still needed | First initialization versus explicit replacement; workbook “Overwrite” does not override the existing protection of staff changes |
| Automation state | Not registered as a shared job capability; no PA endpoint or flow proof |

Sources: [prompt definition](../../shared/config/prompts/grantee-title.js),
[title service](../../lib/services/grantee-title-service.js),
[J27 decision D37](J27_ALIGNMENT_LOG_2026-10-24.md).

For later tasks, these existing fields are **not interchangeable**:

- `wmkf_ai_summary` is the legacy Phase I summary, not an approved new Executive
  Summary destination.
- `wmkf_ai_methodologies` and `wmkf_ai_keywords` are tracked 4,000-character Memo
  JSON-array fields, potential P7 storage pending list and mapping approval;
  neither stores the Methodology prose overview.
- `wmkf_ai_teaminfo` is cached team JSON; `wmkf_apprequestperson` is the structured
  team roster. Neither automatically satisfies Personnel prose.
- `wmkf_ai_riskflags` describes compliance risks, not the workbook's provisional
  six-flag scientific triage rubric.
- Pre-Site executive-summary, methodology, personnel and rationale fields belong
  to versioned `wmkf_requestdocument` artifacts, not intake Request columns.
- The separate Request narrative workstream has `wmkf_layabstract` and
  `wmkf_initialassessment` with one-time initialization, ETag checks, and staff
  edit/clear preservation. Reuse its agreed contract rather than extending it
  silently to unrelated outputs.

These distinctions are source/metadata evidence, not fresh live-schema proof.
See [AI extension definitions](../../lib/dataverse/schema/wave2-existing/akoya_request-ai-extensions.json)
and [Request narrative handoff](REQUEST_NARRATIVES_HANDOFF_2026-11-09.md).

## Status and conditional delivery plumbing

[BRANCH-BUILT, offline verification] `machine-status.js` projects an already
scoped, authorized ledger view to a content-free machine DTO. It checks the actual
migration/store combinations of task, attempt, audit and publication state. Unknown
values or inconsistent tuples return a fixed `job_state_inconsistent` 503 rather
than a false success. The current one-attempt lifecycle is explicit; a future
retry implementation must extend this reader alongside its writer.

The precedence is uncertainty/attention, active work, then settled outcomes.
Initial queued work becomes running after snapshot or target capture. A known
failed or protected-content task is failed; it yields partial when a sibling was
successfully delivered. Success requires validated generation and delivered audit,
plus applied writeback for initialization. Applied delivery remains successful
after temporary content expires. Draft generation remains a historical success
after expiry, but this machine DTO exposes no result endpoint or recovery action:
`resultAvailable` is false and `recoveryActions` is empty. Pending audit or
unstarted publication whose content expires requires attention. In-flight writes
remain running until the worker observes their outcome or expired lease.

`version` tracks durable ledger mutations. `observedAt` records projection time;
retention can change state at the same version. A future poller must not discard a
same-version status observation. Any remaining generation, audit or publication
work suggests another poll (five seconds), even when the aggregate needs attention;
settled responses use null. A needs-attention response is not automatically terminal. These are service DTOs, not
HTTP responses; no new route exists yet.

[BRANCH-BUILT, offline verification] `request-field-delivery.js` implements the
worker's capture/write interfaces for the existing approved Short Title column
only. It has no default transport or runtime caller. Capture authorizes before and
after the read, requires an explicit selected field and concrete ETag, preserves
null versus empty-string hashes, and treats whitespace as existing staff content.
Write accepts only the approved physical field, a nonblank string within the
2,000-character limit, and the exact original ETag frozen on the job. It freezes
canonical request/operation identity and payload before asynchronous authorization.
It calls the injected PATCH adapter once, with the original `If-Match` and
`noFallback:true`; 412 is conflict, every other transport exception is unknown.
Neither path refreshes the ETag or retries. An unrelated Request field edit can
cause the same conservative 412 because the version is row-wide.

The adapter is **not initialization deduplication**. The existing ledger's
reservation, publication and retained receipts must own first-event eligibility
and replay protection. Blankness alone never authorizes refilling a staff-cleared
field. Runtime binding must use the normal grant-request DAL adapter, current
machine permission and target interlock; this helper adds no bypass or human
impersonation. Existing task capabilities still prohibit real Request publication,
so a real Short Title job is not enabled by adding this adapter.

Tests exercise the real Dynamics write-core serialization with its physical HTTP
seam replaced, and the real PostgreSQL `captureTarget` contract. The latter uses
an explicit synthetic field-label translation in test code only, because current
ledger initialization remains synthetic-only. It proves hash/blankness capture
and protected-content status, not production field admission or live Dataverse.

## Next implementation sequence

1. Wire authenticated machine submission/status and a bounded worker composition,
   preserving existing prompt text. Add the actual permitted task/source/delivery
   contract without relaxing staff or expertise trial guards. No additional prompt
   wording decision is required to build these boundaries.
2. Start real field-delivery wiring with the approved Short Title destination;
   keep other mappings disabled until their exact columns and write policies are
   agreed. The existing Short Title prompt is a legacy override-input task, not a
   profiled shared job. Preserve its current callers while adding durable-job
   execution support; do not publish incompatible metadata into that existing row.
3. Prove the chosen Power Automate connection and bounded submit/replay/status
   path, then run an explicitly authorized model/writeback trial. Test first fill,
   duplicate delivery, staff edits/clearing, partial failure and unknown outcomes.
4. Hand Connor the tested calling/field contract, then optimize or expand the
   individual prompts separately. General document selection remains open; no
   fixture or trial source policy silently becomes the all-prompt default.

## Verification and review receipts

### Status/delivery slice

Opus 5.5 reviewed both plan and build through subscription OAuth with tools
disabled. Named changes addressed: active-work polling under needs-attention,
real write-core 412/500 outcome checks, and real-ledger lifecycle projection.
The existing worker already catches writer exceptions after dispatch and persists
unknown; a real PostgreSQL/worker test now proves this. Changing dispatch order
was rejected because the existing durable-intent boundary is correct. Imports
were moved to the top of the test file; scoped lint and type checks passed.

The real PostgreSQL tests cover queued, snapshot, target capture, dispatch intent,
response, validation, audit pending/dispatch/delivery, publication ready/dispatch,
applied/conflict/unknown/expired, and content cleanup. Separate cases cover partial
publication with protected staff content, source/response-stage expiry, validation
failure and unknown provider outcome. They use fabricated model/audit values and
no application model or Dataverse calls. No staff-scientific-quality claim follows
from these engineering tests.

Review packets: plan SHA-256
`8a79e2215d8b9a3465bdfe1dfd90dcbeb91b5df3eacaa85e44c952947ac742eb`; build SHA-256
`c5d99f56e47e9aa42cb98d73a20d08029f8039946bfc1fbd6b0b7e424d1bbfae`.
Local supplementary receipts: `/private/tmp/wmkf-pa-plumbing-plan.json` and
`/private/tmp/wmkf-pa-plumbing-build.json`. Root closes the named findings using
the targeted regression tests; another review iteration is not needed for these
bounded changes. Final combined verification passed 218 tests: 62 authentication,
84 status, 50 delivery and 22 real-PostgreSQL cases. Scoped lint/types, DAL/context
gates with sequential self-tests, and documentation gates passed. The isolated
`wmkf-pa-delivery-20261111` PostgreSQL container was removed after its unique test
schemas were confirmed absent. Real route, grant, scheduler, source and Dataverse
wiring remain required before a deployment verdict.

### Earlier authentication/admission slice

Plan reviewed by Claude Opus 5.5 through subscription OAuth, tools disabled.
Verdict NAMED CHANGES: explicit lifetime checks, tenant-key isolation, safe error
classes, UUID normalization, identity namespace analysis, fixed event value and
conflicting-concurrency proof. Those requirements are incorporated above.
Build review by the same Opus 5.5 OAuth mechanism returned NAMED CHANGES:
classify unrecognized verifier outages as safe 503, sanitize raw storage errors,
and prove the committed receipt exists before reauthorization in the recovery
test. All three were implemented and regression-tested. Root self-review closed
these bounded findings; no further iteration was warranted. This is not a
release-readiness verdict for the unbuilt HTTP/Power Automate path.

Final verification: 62 real-signature authentication cases and 8 real-PostgreSQL
admission/status cases passed (70 total). Scoped ESLint, type checking, API route
and Atlas gates with sequential self-tests, docs catalog, and doc-currency gate
with its self-test passed. PostgreSQL tests dropped their own randomized schema.
The isolated `wmkf-pa-proof-20261111` container was removed after verification.

Review packet fingerprints (no credentials, proposal content or real user rows):
- Plan SHA-256: `0a360ff650168231c8e5217fc79f4cb73ad5962900db66440719e92d1684ee18`.
- Build SHA-256: `5b6e318362dd8bb1a170afb73fb90a286b23ef09607b4a42c980c4a1d107a2e8`.
- Local receipts: `/private/tmp/wmkf-pa-phase1-plan-review.json` and
  `/private/tmp/wmkf-pa-phase1-build-review.json`. These volatile files are
  supplementary; the review findings and their resolution are retained here.

Reproduce offline proof (an isolated local PostgreSQL database must already exist):

```sh
PA_PROOF_PG_TEST_URL=postgresql://postgres@127.0.0.1:55441/pa_proof PA_PROOF_PG_TEST_REQUIRE=1 npm test -- --runInBand tests/unit/prompt-jobs-machine-auth.test.js tests/integration/prompt-jobs-machine-proof.pg.test.js
```

The inherited V4 implementation commit `d6919c949` is integrated as `810ae6b11`;
the proof suite was rerun against it. No main push/deployment or live Dataverse,
SharePoint, application PostgreSQL writes or application model calls occurred in this slice.
Startup checks passed except the pre-existing `check:j27-register` stale J27-066
excerpt in `docs/BACKEND_AUTOMATION_PLAN.md`. This remains a known documentation
failure, not a green whole-repository result.

Durable-fact scope: new offline components only. Existing architecture/interface
references to a future **deployed** PA endpoint remain accurate; the discovery
handoff and SESSION_PROMPT describe dated prior sessions. Shared V4 docs remain
owned by the other active session. No whole-repository reconciliation claimed.
