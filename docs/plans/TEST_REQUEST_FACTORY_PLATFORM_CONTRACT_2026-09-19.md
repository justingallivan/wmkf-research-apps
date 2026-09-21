# Test Request Factory — Stage 0 platform contract

Status: **PARTIAL: source census, tenant schema metadata, visible automation registrations, sandbox schema apply, and one successful marked sandbox Request create are verified; deterministic meeting-date handling, async document provisioning, and production suppression remain unresolved.** Request 1000338 proved effective create permission and number/marker/reminder readback after a bounded GoVerify bypass. No production write or deployment was performed. The offline census is reproducible with `node scripts/probe-test-request-factory-preflight.js --json`; it does not verify tenant state.

## Source contract

[VERIFIED via the line-numbered anchors emitted by the census]

- `grant-request.js` has a thin `create(data)` adapter, not a clone-field validator.
- Intake preallocates a GUID, expects a request number from the server response and recovers a duplicate primary key by reading that GUID. This source precedent does not verify live number allocation or every required field.
- The inspected `sharepoint-document-location.js` adapter exposes discovery and has no `createRecord` seam. This bounded check does not establish whether a platform provisioner exists. Governed consumers require resolved parents and exactly one Dynamics-tracked request bucket.
- OData visibility, row eligibility, FetchXML aggregation, Dataverse Search and direct-ID access are distinct surfaces. Synthetic exclusion belongs at read/dispatch boundaries, separately from business eligibility. The census is a starting inventory, not proof that every consumer is covered.
- Routes must use `requireSuperuser` plus source authorization before trusted DAL context; no actor identity from input.
- Documented external dependencies include AkoyaGO OnCreate, PA narrative/package writers and status-driven intake recompute. Initial INSERT and every post-create PATCH require owner/config and disconfirming evidence. Their current live behavior is UNKNOWN.

## Field roles

| Role | Fields / policy |
|---|---|
| Preallocated identity | `akoya_requestid`: fresh server-owned GUID, never copied. |
| Server readback | `akoya_requestnum`: never copied or included in POST. |
| Replaced identity | Applicant uses a configured test account. Source contacts/PI/payee/memberships are omitted; later presets require dedicated test personas. |
| Potential copied content | Allowlisted title, purpose and requested amount only in the initial offline compiler; never paid/awarded totals. Types and metadata limits must validate. |
| Explicit recipe selection | Fiscal year, meeting date, program/type and status/triage require specific supported policy; source lifecycle is not inherited. The initial compiler does not implement lookup/lifecycle recipes. |
| Required test controls | Proposed marker/run fields and both reminder booleans explicitly false; missing metadata blocks creation. |

Intake's `akoya_Account@odata.bind` is a source precedent, **not** the verified applicant navigation property. Fresh relationship metadata below identifies `akoya_applicantid@odata.bind` targeting `accounts`. Do not propagate the intake assumption into this factory or change intake as part of this work.

## Read-only metadata receipt

[VERIFIED via metadata GET on 2026-09-20 00:14–00:15 UTC]

Both registered hosts returned HTTP 200 for request attribute metadata, with no continuation page, and for the applicant relationship query. No business records were fetched.

| Check | Production `wmkf.crm.dynamics.com` | Sandbox `orgd9e66399.crm.dynamics.com` |
|---|---|---|
| Proposed marker/run attributes | Both absent | Both absent |
| Reminder controls | Both Boolean, createable | Both absent |
| Triage attribute | Picklist, createable | Absent |
| ApplicationRequired attributes | Applicant, fiscal year | Applicant, request type, meeting date |
| Applicant relationship | `akoya_applicantid` → account | Same |

`SystemRequired` metadata also includes platform-owned fields and name projections. Requiredness alone does not define a valid POST: noncreateable projections must never be copied, and defaults for createable system fields require evidence. Metadata createability is not authorization, plug-in behavior, number allocation, flow suppression or successful end-to-end creation.

Sanitized probe receipts are checked in alongside this document under `evidence/test-request-factory/`; the probe scripts used the existing Dataverse client and only metadata GETs after application authentication. Development-agent sessions remain OAuth-only. No credential values or tokens are in the receipts.

## Visible automation and provisioning metadata

[VERIFIED via `scripts/probe-test-request-platform.js`, receipt `evidence/test-request-factory/platform-2026-09-20.json`, 2026-09-20 UTC]

Both targets returned complete paginated HTTP-200 collections for the application user's visible process definitions and registered request/location plug-in steps. Production exposed 1,244 process definitions (114 cloud flows), sandbox 1,075 (109 cloud flows); 134/97 definitions matched the bounded request/location/content-term census. All visible cloud definitions had a parseable definition. This is not a tenant-wide visibility guarantee.

- Both targets report `IsDocumentManagementEnabled: true` and request-number `AutoNumberFormat: {SEQNUM:7}` with maximum length 100. This verifies configured capability, not successful numbering, effective create privileges, plugin defaults or location creation.
- Production has eight activated classic request processes with the Create flag; sandbox has twelve. Named production examples: `WMKF_Set Payee Payment Contact from Request`, `WMKF_Update Payment Contact from Org`, `WMKF_Set Co-PI Field on Contact`, `WMKF_Create SoCal draft Phase II Ack`. Sandbox additionally exposes `WMKF_Research Application Received Email Flow` with Create enabled. Conditions/action bodies were not evaluated, so names and trigger flags do not prove an effect occurs for a fixture.
- Enabled vendor registrations differ: production includes `AkoyaGo.RequestSetGrantAndStatus`, `AkoyaGo.CalculatedFieldsAsync`, and `AkoyaGo.AsyncEntityCreated`; sandbox includes `AkoyaGo.RequestUpdate`. Sandbox results cannot certify production behavior.
- Production `AkoyaGo.SharePointDocumentLocationHealthEvaluator` is registered on document-location Create/Update. This does not identify the request-to-location provisioner. The matching GOfund move-documents cloud flow is draft in both targets, so it is not evidence of active provisioning.
- No visible definition matched the narrative/package or proposed marker terms. The documented PA writers remain unresolved, not disproved. A cloud flow referencing requests in its actions is not necessarily triggered by request creation; the receipt records parsed trigger entity/message where available.

The reproducible probe exports selected metadata and definition hashes, not raw flow definitions, action inputs, connection parameters, credentials or document content. It rejects malformed pages, cross-origin/collection continuations and unbounded pagination. No flow execution, business-record read, schema change or request create occurred.

## Platform-owner response and sandbox rehearsal — 2026-09-21

[VERIFIED as owner-provided guidance] Connor reports: no automation sends email without user input; payment creation follows Phase II `Recommended`; organization-contact updates exist; new Requests should automatically receive linked SharePoint folders; Bill.com/other Akoya flows are manual or Request-value-only for this purpose; and sandbox is the appropriate verification target. He directed fixtures to the `W. M. Keck Foundation` organization. The product owner further decided that destinations must always be fresh Requests because SharePoint artifacts and file-version history survive Dataverse state resets.

[VERIFIED via tracked schema runner and `scripts/rehearse-test-request-sandbox.mjs`] Sandbox now has the two marker/run fields and the separately applied two-field reminder-control parity wave. Post-apply metadata confirms all four are createable. The exact manifest under `docs/plans/evidence/test-request-factory/` omitted payment, status, contact, submission, triage, and document fields.

The first authorized POST was rejected transactionally with HTTP 400 / `0x80040265` wrapping a remote 500. Read-only recovery found no Request, location, payment, or regarding email and unchanged Foundation account/Contact versions. `scripts/probe-sandbox-request-create-failure.mjs` and its sanitized receipt `docs/plans/evidence/test-request-factory/sandbox-create-failure-diagnostic-2026-09-21.json` resolved the failed synchronous sessions to `GOverify- check Publication 78 on create of a request record` and `Copy Applicant to Payee when Grant is Entered`.

[VERIFIED via manifest, HTTP receipt, exact-GUID readback, workflow-definition/activation readback, and bounded async-operation probe] The owner then classified GoVerify as irrelevant to this exercise and authorized a temporary sandbox bypass plus one fresh create. The operator deactivated only the editable GoVerify definition around the POST and restored it immediately afterward. Dataverse returned HTTP 201 and created Request 1000338. The marker, run ID, Grant type, fiscal year and reminder-false values persisted; the Foundation was copied to payee; no payment, regarding email, Foundation account change or Foundation child-Contact change was observed. This proves effective create permission and server number allocation. The requested `2099-12-01` meeting date read back as `2024-12-13`, so deterministic cycle state remains unproved.

No SharePoint document location appeared. The bounded attempt-window probe found that sandbox asynchronous Request workflows were canceled because the organization is in `Disable Background Processing` mode. That configuration prevents a full document/folder rehearsal and is consistent with missing asynchronous side effects, but does not identify the location provisioner. Sanitized reconciliation evidence is `docs/plans/evidence/test-request-factory/sandbox-rehearsal-verification-goverify-bypass-2026-09-21.json`.

### Registered owner and browser follow-up

[VERIFIED via read-only owner metadata census, `evidence/test-request-factory/registered-owners-2026-09-20.json`]

Connor Noda is the registered owner of production `WMKF_Set Payee Payment Contact from Request` and `WMKF_Create SoCal draft Phase II Ack`. Other activated production request Create workflows are registered to Bromelkamp Admin or # BCO akoyaGO Integration. Registered ownership identifies the starting point for follow-up; it does not confirm who currently operates the workflow or how it handles synthetic requests.

[VERIFIED via signed-in Power Automate browser observation, 2026-09-20 UTC] Justin Gallivan's Cloud flows and Shared with me views showed no flows in the default environment and WM Keck Foundation akoyaGO environment (`36db5b1b-d5f3-ef3e-9b18-32473347ec0f`). Solutions and administrative inventories were not inspected. These empty views do not prove tenant flows absent. No flow was run, edited or shared; nobody was contacted.

### Concrete platform-owner handoff

Use the receipt IDs/names to obtain the following evidence, without sending messages or changing platform configuration as part of this task:

1. For activated request Create workflows and enabled vendor Create/Update hooks: identify the owner, required internal branches and outbound effects; specify how the initial marker and every later pointer/status PATCH are handled. Do not disable mandatory vendor hooks wholesale.
2. Identify/export the actual narrative/package and status-recompute flow definitions (or authoritative retirement evidence), including their environment, triggers and marker exclusion. App-user-visible metadata alone is incomplete.
3. Identify the location provisioner and trigger, expected library/parents, whether UI navigation is required, maximum wait and duplicate-location recovery. Document-management enabled is insufficient.
4. Provide effective creation/field privileges and the smallest approved isolated rehearsal proving server numbering, preservation of marker/run/reminder fields, location readback and absence of unwanted sends/payments/provider work.

The [schema proposal](TEST_REQUEST_FACTORY_SCHEMA_PROPOSAL_2026-09-19.md) specifies additive fields, rollout order, resolver truth table, reader/transport inventory and tests. No schema is applied by this proposal.

## Remaining gates

1. Keep the reviewed marker/reminder schema sandbox-only until production schema and reader/transport guards receive a separately reviewed deployment step. The four rehearsal fields are live only in sandbox.
2. Name the SharePoint location provisioner, trigger, bounded recovery and uniqueness contract. Basic cannot become ready without verified location resolution; IA/materials remain blocked.
3. Explain or configure the sandbox meeting-date rewrite and verify required recipe defaults; effective creation privileges and server number allocation are now proven in sandbox.
4. Verify marker list/filter/search support and every ordinary read/worker/transport consumer. Unknown marker state must fail closed without redefining eligibility.
5. Obtain current platform-owner evidence for create/update flows, including narrative/package overwrites and status-driven automation. Repository docs alone cannot close this gate.
6. Establish approved test organization/personas, content boundary, retention and file limits. No identity is silently inferred from source.

## Offline verification scope

The preflight checks required source anchors and negative fixtures for lost evidence, unexpected location creation and incorrect field roles. Read-only behavior is established by source review, not by the script's static safety declarations. Tests do not prove remote suppression or runtime readiness.

Stage 0 remains partial pending a background-enabled isolated document/folder rehearsal, identification of the location provisioner, deterministic meeting-date behavior, and the external production-suppression evidence above. Offline policy development may continue under the accepted design; no create route or retry is enabled by this receipt.
