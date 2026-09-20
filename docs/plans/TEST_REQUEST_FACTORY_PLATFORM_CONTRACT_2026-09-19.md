# Test Request Factory — Stage 0 platform contract

Status: **PARTIAL: source census, tenant schema metadata and visible automation registrations verified; suppression behavior and provisioning unresolved.** No request creation, schema apply, deployment or business-record query was performed. The offline census is reproducible with `node scripts/probe-test-request-factory-preflight.js --json`; it does not verify tenant state.

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

### Concrete platform-owner handoff

Use the receipt IDs/names to obtain the following evidence, without sending messages or changing platform configuration as part of this task:

1. For activated request Create workflows and enabled vendor Create/Update hooks: identify the owner, required internal branches and outbound effects; specify how the initial marker and every later pointer/status PATCH are handled. Do not disable mandatory vendor hooks wholesale.
2. Identify/export the actual narrative/package and status-recompute flow definitions (or authoritative retirement evidence), including their environment, triggers and marker exclusion. App-user-visible metadata alone is incomplete.
3. Identify the location provisioner and trigger, expected library/parents, whether UI navigation is required, maximum wait and duplicate-location recovery. Document-management enabled is insufficient.
4. Provide effective creation/field privileges and the smallest approved isolated rehearsal proving server numbering, preservation of marker/run/reminder fields, location readback and absence of unwanted sends/payments/provider work.

The [schema proposal](TEST_REQUEST_FACTORY_SCHEMA_PROPOSAL_2026-09-19.md) specifies additive fields, rollout order, resolver truth table, reader/transport inventory and tests. No schema is applied by this proposal.

## Remaining gates

1. Provision reviewed marker schema and missing environment-specific controls only under a separately reviewed deployment step. No live schema apply occurred here.
2. Name the SharePoint location provisioner, trigger, bounded recovery and uniqueness contract. Basic cannot become ready without verified location resolution; IA/materials remain blocked.
3. Verify platform/plugin number allocation, effective creation privileges and required defaults with an approved isolated rehearsal after suppression is established.
4. Verify marker list/filter/search support and every ordinary read/worker/transport consumer. Unknown marker state must fail closed without redefining eligibility.
5. Obtain current platform-owner evidence for create/update flows, including narrative/package overwrites and status-driven automation. Repository docs alone cannot close this gate.
6. Establish approved test organization/personas, content boundary, retention and file limits. No identity is silently inferred from source.

## Offline verification scope

The preflight checks required source anchors and negative fixtures for lost evidence, unexpected location creation and incorrect field roles. Read-only behavior is established by source review, not by the script's static safety declarations. Tests do not prove remote suppression or runtime readiness.

Stage 0 remains partial pending the external evidence above. Offline policy development may continue under the accepted design; no create route is enabled by this receipt.
