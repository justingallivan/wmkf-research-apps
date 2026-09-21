# Connor handoff — Test Request Factory platform gates

Status: **CONNOR RESPONSE RECEIVED; SANDBOX CREATE BLOCKED BY TWO FAILING SYNCHRONOUS WORKFLOWS; PRODUCTION ENABLEMENT BLOCKED.** This handoff records Connor's 2026-09-21 answers, the owner's fixture-isolation decision, and the controlled sandbox result. It does not authorize production schema/data writes, email, payment, file copying, retry creation, or cleanup.

## Questions and Connor's answers

1. **Create/update side effects.** Connor reports that no automation sends email without user input. A payment is created when Phase II status changes to `Recommended`. Automations update contacts on the organization. His recommendation is to never use a live grantee organization for a test Request; use **W. M. Keck Foundation**.
2. **Create permission.** Connor answered that app-principal creation is theoretically possible.
3. **SharePoint location.** Connor expects a newly created Request to create and link its SharePoint folder automatically.
4. **Bill.com/Akoya flows and rehearsal.** Connor reports that Bill.com and the other Akoya flows are manually triggered or only modify Request values on the Request and are not consequential for this test. He recommended using the accessible sandbox to verify.

These answers are platform-owner guidance, not a substitute for readback. The tracked platform census shows environment drift: the sandbox `WMKF_Create Payment` registration watches `akoya_recommendedamount`, while the production registration watches `wmkf_phaseiistatus`. A safe create therefore omits both fields and verifies zero payment rows.

## Owner decision: create fresh Requests

The owner rejected reset-in-place as the default fixture strategy. Workflows produce SharePoint documents, and version-controlled files can remain discoverable and influence later behavior even after Dataverse state is reset. The factory must create a fresh Request GUID, request number, Dynamics document location, SharePoint folder, and document history for each fixture run. Existing Requests may be source inputs, but they are never recycled as the destination.

## Controlled sandbox rehearsal — 2026-09-21 UTC

Authorized scope was one sandbox-only rehearsal: add only the reviewed isolation/reminder fields, create one fresh Request under W. M. Keck Foundation, and verify numbering, location, files, payment/email, and organization/contact side effects. No production target, file copy, send, payment, retry, deletion, or reset was authorized.

### Verified schema and preflight

- Applied `wave29-test-request-isolation` to sandbox: `wmkf_istestrequest` and `wmkf_testcreationrunid`.
- Applied the separately isolated `wave29-test-request-reminder-controls` sandbox parity subset: `wmkf_respondreminderenabled` and `wmkf_reviewduereminderenabled` only.
- Post-apply metadata readback found all four fields createable with the reviewed types; applicant, Request Type, and meeting date are application-required.
- Resolved exactly one active `W. M. Keck Foundation` account and one child Contact. Sandbox request type `Grant` is option `100000000`.
- The sandbox default SharePoint site is the canonical `https://appriver3651007194.sharepoint.com/sites/akoyaGO` site.

### Exact attempted body and result

The create manifest is `docs/plans/evidence/test-request-factory/sandbox-rehearsal-manifest-2026-09-21.json`. It supplied only a preallocated Request GUID, Foundation applicant binding, TEST title, `December 2099`/`2099-12-01`, `Grant`, marker/run, and both reminder flags false. It omitted status, amounts, payee, contacts, programs, triage, submission acceptance, and document pointers.

Dataverse rejected the single POST with HTTP 400 / `0x80040265`, wrapping `The remote server returned an error: (500) Internal Server Error.` The receipt is `docs/plans/evidence/test-request-factory/sandbox-rehearsal-receipt-2026-09-21.json`. The operator did not retry.

Read-only recovery proved a complete rollback: the Request GUID does not exist; there are zero SharePoint locations, payments, and regarding emails; the Foundation account and its child Contact retain the exact pre-run versions.

The bounded failure-log probe (sanitized receipt `docs/plans/evidence/test-request-factory/sandbox-create-failure-diagnostic-2026-09-21.json`) identified two failed synchronous process sessions in the exact attempt window:

- `GOverify- check Publication 78 on create of a request record`
- `Copy Applicant to Payee when Grant is Entered`

Both failed during an internal Dataverse Update with the remote 500. This proves the sandbox create path currently cannot satisfy Connor's expected normal workflow behavior. It does not prove the marker or reminder fields caused the failure.

## Remaining platform-owner action

Before any second create is proposed, identify and repair/configure the sandbox dependency behind those two synchronous workflows, or document the ordinary user-path prerequisite that prevents their failure. Then authorize a new single-create manifest explicitly. Do not work around the failure by disabling mandatory workflows, omitting the required Foundation applicant, changing production, or retrying the consumed manifest.

Production remains blocked until marker-aware ordinary consumer guards, automation exclusions, and the location/folder contract are implemented and independently verified. The failed sandbox transaction did not test number allocation, marker/reminder persistence, folder uniqueness, or file-history isolation.
