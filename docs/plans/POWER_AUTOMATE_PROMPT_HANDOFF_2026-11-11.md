# Power Automate prompt delivery: implementation and Connor handoff

Owner: Codex in `codex/power-automate-integration-2026-11-11`.
Status: branch-built Short Title pilot; offline integration verified; no deployed machine endpoint or flow.
Last verified: 2026-11-12 (Arizona); source and offline tests only.

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
No token claim chooses a JWKS URL. The new default-off machine pilot binds this verifier to the three routes described below.

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

The branch-built HTTP pilot registers exact routes and guards, bounds the submit
body to 4 KiB and admission to one job per pilot, and returns `private, no-store`
with authenticated status location/polling interval. Real connector issuance is
still unproven. It uses the real ledger status projection; the isolated proof
facade remains test-only.

## Prompt-to-field handoff inventory

The workbook requirements in the dated discovery handoff are inputs for review,
not approval of every audience, keyword list or overwrite rule. Current registered
proposal capabilities deliberately have `destinationField: null`.

| Desired output | Existing key or implementation | Required handoff work |
| --- | --- | --- |
| Short title/objective | New `preflight.short-title`; legacy `grantee-title.generate` preserved | D37 approves `akoya_request.wmkf_wmkfprojectdescription`. Pilot initializes once with original ETag; publish/pin the separate new definition before activation. |
| Executive summary | `proposal.executive-summary`; 200-word draft capability | Approve exact destination and audience; do not silently reuse legacy `wmkf_ai_summary` or document-section fields. |
| Methodology | `proposal.methodology`; draft capability | Approve the destination and write policy; wording/length optimization is deferred. |
| Personnel | Workbook P4, existing analog discovery | Approve task instructions, output shape and exact destination. |
| Intake rationale | Workbook P5 | Define versioned storage/write contract, not an unconditional overwrite. |
| Field/method keywords | Workbook P7 shared task | Obtain approved controlled vocabularies; D26 placeholder lists are not production values. |
| Intake flags | Workbook P6, provisional rubric | Approve rubric, evidence and versioned destination. |
| Open questions | Cross-task output in workbook P | Decide accumulation/deduplication and references; not automatically another model call. |
| Staff notes/rationale | Human-editable workbook Q | Preserve human edits and intentional clearing; not automatically another model call. |
| Expertise | `expertise.recommendations` | Fourth native-schema trial completed; source/docs integrated from the now-archived other session. Recommendations only; assignment still requires Connor coordination. |

All exact mappings need source/metadata and current consumer verification. Similar
field labels do not establish equivalent semantics. No new Dataverse columns,
prompt publication or live output writes are authorized by this offline receipt.

## First concrete handoff row: Short Title

[VERIFIED via tracked prompt definition and D37 owner decision; live row not
re-probed in this slice] This is a contract to connect, not a deployed endpoint:

| Contract item | Value |
| --- | --- |
| Dataverse prompt identity | New `wmkf_ai_promptname = preflight.short-title`, unpublished; existing legacy row remains unchanged |
| Source record | Authorized `akoya_request`, selected by Request GUID |
| `source_title` input | `akoya_title`, required untrusted applicant text, maximum 600 characters |
| `source_abstract` input | `wmkf_abstract`, required untrusted applicant text, maximum 20,000 characters |
| Output | `edited_title`, raw one-line string; “To [verb]…” objective; existing service validation still applies |
| Prompt output target | `none`; caller/backend delivery owns writeback |
| Approved destination | `akoya_request.wmkf_wmkfprojectdescription` |
| Existing writer semantics | Invited-research cron writes when blank; this is not the new intake trigger |
| Intake delivery policy | Pilot permits initialization only, one retained job per pilot; no replacement/retry API |
| Automation state | Branch-built capability and routes; no deployed endpoint or live PA flow proof |

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
settled responses use null. A needs-attention response is not automatically terminal. The new submit/status routes return this DTO inside `{job}`.

[BRANCH-BUILT, offline verification] `request-field-delivery.js` implements the
worker's capture/write interfaces for the existing approved Short Title column
only. The machine worker binds its transport to the Request DAL. Capture authorizes before and
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
impersonation. The new title capability permits only its approved field under the pinned machine
pilot. Other proposal and expertise tasks still carry no real destination.

Tests exercise the real Dynamics write-core serialization with its physical HTTP
seam replaced, and the real PostgreSQL `captureTarget` contract. The latter uses
an explicit synthetic field-label translation in test code only, because that earlier test exercises the synthetic ledger contract. The separate
Short Title integration suite exercises the actual field mapping with fake
Dataverse transport; neither is live Dataverse evidence.

## Branch-built Short Title pilot and activation boundary

[VERIFIED via branch source] POST `/api/automation/prompt-jobs` accepts exactly
`requestId`, `sourceEventId`, `operation: "initialize"`, and
`taskKeys: ["preflight.short-title"]`, plus a UUID `Idempotency-Key` header.
GET `/api/automation/prompt-jobs/[jobId]` returns content-free scoped status.
New/active jobs return 202; settled replays return 200. Responses include a relative
Location, no-store, and Retry-After only while work remains. These routes use
app-only Entra authentication, independently of staff browser sessions.

The unscheduled POST `/api/cron/drain-machine-prompt-jobs` requires the exact cron
secret and advances one server-selected stage. Power Automate does not receive
that secret or choose a worker job ID. Before Connor can run a full test, the
approved deployment must arrange bounded worker ticks; accepting a job alone
will not advance it.

`PROMPT_JOB_MACHINE_PILOT` is a default-off, exact server policy. It pins the
sandbox deployment/target, tenant/audience/caller/service principal/role, pilot,
Request/source event, prompt ID/version/hash, profile hash, actual database
endpoint plus cluster/database fingerprint, and an expiry no more than seven days
away. DAL and target enforcement must both be on; the independent snapshot nonce
must be stable. See the credentials runbook for exact configuration. No new
schema, security role, registration or schedule is created by this code.

Admission first verifies the database and locks/replays/counts receipts, commits,
then reads the source and prompt outside a transaction. A second pinned transaction
rechecks replay/quota and admits the frozen configuration. Invalid source returns
422 without consuming the pilot slot; changed keys hit the one-job cap even after
content expiry. Configuration stores hashes/provenance, not source text. The
sealed snapshot retains the original title/abstract as untrusted records, without
a fabricated document. Invited Requests are excluded to avoid the legacy title
cron's current eligible cohort.

The worker rechecks policy, source and original Request version before dispatch,
including after durable dispatch intent. It uses the shared Executor, validates
and normalizes the title, records a content-free audit, then conditionally patches
only the approved field using the captured ETag. Existing nonblank/whitespace
content is protected. A later row edit yields conflict; ambiguous delivery remains
unknown, without automatic resend. Within the pinned ledger/deployment, the pilot receipt prevents refilling a later
staff-cleared field. Do not re-pilot the same Request under a different database
or deployment to bypass that receipt; cross-database initialization is not fenced. It cannot constrain unrelated writers: the legacy cron could
still fill a cleared field if Request eligibility later changes.

Source/response content expires after 24 hours; configuration/result/audit content
after seven days. Exact-scope cleanup can run with a valid disabled/expired policy,
but cannot run when the policy is absent or malformed. Receipts remain permanently
for replay/quota. Deployment environment changes require a redeploy; offline
policy-change tests do not prove instantaneous production revocation.

### Remaining before Connor's live test

1. Offline integration and the Opus 5.5 review are complete for the branch
   implementation; use the evidence below when preparing activation.
2. Verify the actual API/caller registration and Power Automate app-only token
   issuance with Connor. Reuse existing infrastructure where possible.
3. Prepare the concrete sandbox deployment/configuration and unpublished
   `preflight.short-title` definition for approval. Probe the runtime database
   role's access to `pg_control_system()` and confirm exact endpoint/identity.
4. Obtain approval for publication, deployment/configuration and a bounded paid
   model/audit/field-write trial, then prove first fill, duplicate delivery and
   original-ETag protection with the real connection.
5. Give Connor the verified URL/audience/permission, Request/event/key, exact
   submit/status example and expected field outcome. No message has been sent.
   Expand to other prompts after destination/write contracts are agreed; keep
   general proposal-document selection open until caching work settles.

### Draft setup brief for Connor (not sent)

We have built the first Power Automate prompt path for Short Title. Your flow will
submit a Request GUID, source-event GUID and stable idempotency key; the backend
will read the published Dataverse prompt, generate/validate the objective, and
initialize `wmkf_wmkfprojectdescription` only when blank and unchanged. Repeated
submissions return the same job. The flow then polls authenticated status; it does
not call Anthropic or write the output field itself.

Before the first sandbox test, we need to identify the existing Power Automate
connection/caller application, if any, and prove that it can obtain an app-only
Entra v2 token for this API. We will provide the approved endpoint, audience,
permission, pinned test Request/event and exact request example after that setup
is verified. The code is not deployed or enabled yet. This first test deliberately
uses title and abstract fields; the general proposal-document source remains open.

## Verification and review receipts

### Short Title machine integration (November 12)

[VERIFIED via source and offline tests] The final combined run passed **625 tests
in 30 suites**, with no skipped tests. It includes real RSA authentication,
route/proxy policy, source bounds, record-only task isolation, the actual Executor
with a fake provider, real PostgreSQL admission/worker/publication, conditional
write-core transport, human edits and clearing, unknown audit/write outcomes,
post-intent denial/unavailability, and disabled/expired exact-scope cleanup.
No live application provider, Dataverse or shared database was invoked. The
isolated `wmkf-pa-title-20261112` PostgreSQL container was removed after its test
schemas were confirmed absent. Type
checking and relevant API, DAL/context, route boundary, injection tagging, Atlas,
secret/scaffolding, documentation and fact gates passed, with their applicable
self-tests run sequentially. The existing three external-materials guard warnings
remain; the inherited J27-066 documentation failure is outside this change.

Opus 5.5 reviewed the plan and build via subscription OAuth, tools disabled. The
user approved the exact build packet, SHA-256
`43638d14e779757cccab41e44283c8afd80048c90be3bbed89e266a2cc9fa0b2`.
Receipt: `/private/tmp/wmkf-pa-title-build-review-20261112.json` (supplementary).
The verdict was NAMED CHANGES. Root adjudication and closure:

- C1 accepted: a failed post-intent check before returning to the Executor is
  known not to have called the provider. It now terminalizes as
  `failed_pre_dispatch`, releases its slot, retains quota and never retries.
  Three actual-Executor/SQL race tests prove denial and unavailable checks.
- C2 accepted: record-only profiles are reserved for the exact title definition.
  Publication, admission and composition reject proposal/synthetic use of that
  profile, including a correctly sealed negative-test snapshot.
- C3 refuted: `machine-admission-proof.js` already existed at the base commit,
  remains an offline regression fixture, and is neither newly added nor connected
  to runtime by this change. No destructive removal was needed.
- P1–P5 resolved by source and tests: the write core preserves the exact original
  If-Match and 412 status; cleanup predicates bind all four scope fields; admission
  validates the extended configuration and capability; record manifests survive
  sealing; `PowerAutomate Test` maps to accepted run-source value 682090004.
- N1/N2/N3/N5 addressed: generic admission rejects the reserved scope; Request and
  audit writes pin the actual origin after token acquisition; title metadata
  explicitly requires empty system text and temperature zero (token ceiling was
  already enforced); stale source comments were corrected.
- N4 intentionally retains conservative validation: noncanonical punctuation may
  be rejected as `failed_validation`. Broadening legacy title normalization is
  unnecessary for safe delivery and would change a separate caller's behavior.

Root also found that PostgreSQL connection query parameters could override a URL
host. The policy now rejects overrides, duplicate parameters and fragments; only
one optional `sslmode=require` or `sslmode=verify-full` is accepted. Focused tests
prove this and actual Dataverse origin changes across token acquisition. These
bounded fixes were closed by source review and regression tests; another review
iteration would not add useful evidence. This is an engineering verdict, not
live deployment or prompt-quality approval.

The scoped durable-fact pass updated the handoff, Executor contract, architecture,
Atlas, credentials runbook, service catalog, route matrix and generated route count
(333). Historical test receipts below remain dated history. Deployment, actual
Entra/Power Automate issuance, published prompt/profile rows, hosted database-role
identity permission and real source/write behavior remain unverified activation
prerequisites. No whole-repository or live-state reconciliation is claimed.

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
schemas were confirmed absent. This historical slice did not include routes or source wiring. The current
branch-built pilot above still requires live activation and connector proof.

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
handoff and SESSION_PROMPT describe dated prior sessions. Shared V4 source/docs were released and integrated; that session is now archived. No whole-repository reconciliation claimed.
