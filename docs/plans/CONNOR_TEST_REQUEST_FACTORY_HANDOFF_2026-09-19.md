# Connor handoff — Test Request Factory platform gates

Status: **CONNOR RESPONSE RECEIVED; ONE MARKED SANDBOX REQUEST CREATED; FULL DOCUMENT-WORKFLOW REHEARSAL BLOCKED BY DISABLED SANDBOX BACKGROUND PROCESSING; PRODUCTION ENABLEMENT BLOCKED.** This handoff records Connor's 2026-09-21 answers, the owner's fixture-isolation decision, and both controlled sandbox attempts. It does not authorize production schema/data writes, email, payment, file copying, another Request create, or cleanup.

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
- The sandbox default SharePoint site is the canonical `https://appriver3651007194.sharepoint.com/sites/akoyaGO` site. That site is shared with ordinary akoyaGO document workflows; it is separately registered and must not be described as sandbox-isolated.

### Exact attempted body and result

The create manifest is `docs/plans/evidence/test-request-factory/sandbox-rehearsal-manifest-2026-09-21.json`. It supplied only a preallocated Request GUID, Foundation applicant binding, TEST title, `December 2099`/`2099-12-01`, `Grant`, marker/run, and both reminder flags false. It omitted status, amounts, payee, contacts, programs, triage, submission acceptance, and document pointers.

Dataverse rejected the single POST with HTTP 400 / `0x80040265`, wrapping `The remote server returned an error: (500) Internal Server Error.` The receipt is `docs/plans/evidence/test-request-factory/sandbox-rehearsal-receipt-2026-09-21.json`. The operator did not retry.

Read-only recovery proved a complete rollback: the Request GUID does not exist; there are zero SharePoint locations, payments, and regarding emails; the Foundation account and its child Contact retain the exact pre-run versions.

The bounded failure-log probe (sanitized receipt `docs/plans/evidence/test-request-factory/sandbox-create-failure-diagnostic-2026-09-21.json`) identified two failed synchronous process sessions in the exact attempt window:

- `GOverify- check Publication 78 on create of a request record`
- `Copy Applicant to Payee when Grant is Entered`

Both failed during an internal Dataverse Update with the remote 500. This proves the sandbox create path currently cannot satisfy Connor's expected normal workflow behavior. It does not prove the marker or reminder fields caused the failure.

## Authorized GoVerify bypass and successful create — 2026-09-21 UTC

The owner confirmed that GoVerify only supplies a non-blocking nonprofit-status warning in AkoyaGO and is irrelevant to the intended tests. They authorized a GoVerify bypass and one new sandbox Request create. The operator temporarily deactivated only the editable sandbox GoVerify workflow definition around the single POST, then restored it. Read-only follow-up verified the definition active with exactly one current active activation; Dataverse retained the deactivated activation as an inactive historical row.

The fresh manifest and raw receipt are `sandbox-rehearsal-manifest-goverify-bypass-2026-09-21.json` and `sandbox-rehearsal-create-receipt-goverify-bypass-2026-09-21.json`. Dataverse returned HTTP 201 and created Request **1000338** (`46ff3ea9-8933-4f5d-91a9-3ee8ac54dad5`) under W. M. Keck Foundation. The marker, run ID, fiscal year, Grant type, and both false reminder flags survived readback. The ordinary Copy Applicant to Payee behavior populated the Foundation as payee. There were zero payment rows, regarding emails, Foundation account changes, or Foundation child-Contact changes.

The operator's first post-restore assertion expected one total activation row and stopped before its observation phase when Dataverse returned one current active activation plus the historical inactive activation. No retry occurred. The reconciled read-only receipt is `sandbox-rehearsal-verification-goverify-bypass-2026-09-21.json`.

Two Stage 0 discrepancies remain:

- The requested meeting date `2099-12-01` read back as `2024-12-13`; the responsible synchronous default/workflow is not yet identified.
- No Dynamics SharePoint document location appeared. Bounded async-operation readback showed that the sandbox is in **Disable Background Processing** mode and canceled every observed asynchronous Request workflow in the attempt window. This prevents the sandbox from validating Connor's expected document/folder behavior, but does not by itself identify the location provisioner.

## Remaining platform-owner action

GoVerify is no longer the immediate create blocker for this exercise, and Copy Applicant to Payee is not independently broken. Before relying on this sandbox for document-generation tests, the platform owner must enable/restore the required sandbox background processing or provide another isolated environment where those async workflows run; identify the actual SharePoint location provisioner and its trigger; and explain or configure the meeting-date rewrite so a recipe can produce deterministic state. Do not treat background-disabled success as proof that normal create/update automations are safe.

Production remains blocked until marker-aware ordinary consumer guards, automation exclusions, and the location/folder contract are implemented and independently verified. The successful sandbox Request proves effective create permission, server number allocation, marker/run/reminder persistence, and absence of the checked synchronous payment/email/account/Contact effects. It does not prove folder uniqueness, SharePoint file-history isolation, deterministic meeting-date handling, or behavior with normal background processing enabled.
