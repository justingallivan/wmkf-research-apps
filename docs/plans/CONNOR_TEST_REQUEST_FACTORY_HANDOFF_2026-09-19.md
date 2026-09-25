# Connor handoff — Test Request Factory platform gates

Status: **CONNOR RESPONSE RECEIVED; APP-OWNED SANDBOX FOLDER/LOCATION CREATE PROVEN; PRODUCTION ENABLEMENT REMAINS BLOCKED.** This handoff records Connor's 2026-09-21 answers, the owner's fixture-isolation decision, and subsequent bounded sandbox evidence. Request 1000339 and its exact folder/location were created by the app suite; identifying AkoyaGO's automatic provisioner is no longer a prerequisite for a sandbox fixture. This document is an evidence record, not an authorization boundary for later user instructions.

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
- No Dynamics SharePoint document location appeared **during that attempt-window readback**. Bounded async-operation readback showed that the sandbox was in **Disable Background Processing** mode and canceled every observed asynchronous Request workflow in the attempt window. This could not validate Connor's expected automatic document/folder behavior or identify the location provisioner. A later location and folder observation is recorded below.

## Later read-only location follow-up — 2026-09-23 UTC

[VERIFIED via exact Dataverse Request/location/creator/parent GETs, Graph folder list, and refreshed complete plugin-step census; sanitized receipt: `evidence/test-request-factory/location-followup-2026-09-23.json`] Sandbox Request 1000338 now has exactly one resolved `sharepointdocumentlocation` under `akoya_request`, and its physical SharePoint folder exists with zero root items. The location was created at `2026-09-22T18:51:10Z`, about 20 hours after the Request, with **Justin Gallivan** as `createdby`. Production reference Request 1002788 has one location created about 82 seconds after its Request by **# BCO akoyaGO Integration**. The sandbox meeting date remains `2024-12-13`, and its marker/run still match.

The refreshed metadata census found an enabled asynchronous `AkoyaGo.AsyncEntityCreated` registration on production Request Create and no matching sandbox registration; both step collections were complete HTTP 200. This is a concrete environment difference, not proof that the production step provisions folders. The late sandbox location under a staff user does not establish automatic provisioning or the action that created it. Enabling background processing alone is therefore not a proven sandbox-parity remedy.

## Read-only Admin preview integration — 2026-09-21/22

[VERIFIED via Git, Vercel CLI, signed-in browser and read-only service probes] The reviewed preview work is integrated and pushed on `codex/test-request-preview-integration`. The branch adds Administration **Test Requests → Preview** and `GET`/`POST /api/admin/test-requests/preview`. Both verbs are superuser-only, run under trusted DAL context, require the registered sandbox Dataverse host and registered shared akoyaGO SharePoint site, and expose no create/copy action. The server re-resolves the source Request, Foundation account, Grant option, metadata, SharePoint buckets and selected file identities; the browser cannot supply those trusted values. Returned plans are sanitized and forced non-executable.

The stable non-production URL `https://wmkfresearchapps-preview.vercel.app/admin?workspace=test-requests&view=preview` was verified against Preview deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. Branch-scoped Preview configuration contains `DYNAMICS_URL`, `SHAREPOINT_SITE_URL`, `DATAVERSE_DAL_ENFORCEMENT`, and `NEXTAUTH_URL`; their values were configured for the sandbox/registered shared-site rehearsal. The general Preview environment was not relied on. No production deployment or production Dataverse/SharePoint write occurred.

Signed-in smoke loaded sandbox Requests 1000338 and 996142 and displayed the sandbox/SharePoint targets. A POST for 996142 reached the pure compiler and returned a deliberately blocked preview. The blockers at that deployed smoke were:

- At that deployed smoke, `ownerid` and `owneridtype` were unresolved. A later sandbox readback of Request 1000338 verified that a POST omitting both fields received the authenticated application user as owner and creator. Production Request 1003259 is also created and owned by this app suite's application user. The owner decided future Test Requests should follow that app-suite pattern. The branch's pure compiler now omits these fields and accepts only these two documented system-required defaults; the deployed Preview has not been re-smoked after this source change. A future executor must omit staff impersonation and verify both identities after create.
- `filePolicy`: preview hashing has technical ceilings, but execution file-count, per-file-byte and total-byte limits have not been approved.

Neither Request exposed allowlisted proposal documents. A bounded read-only inventory of 150 sandbox Requests with linked folders found no source containing the canonical allowlisted proposal-document set. Therefore target/source resolution and the zero-document POST path are live-verified, but selected-file download/version/hash and filename transformation remain unverified against live sandbox data.

## Remaining platform-owner action

**2026-09-23 update [VERIFIED via `evidence/test-request-factory/app-owned-location-{manifest,receipt,rehearsal}-2026-09-23.json`]:** A second bounded rehearsal created marked Request **1000339**, then used Graph to create its exact folder and Dataverse to create one location bound to the verified `akoya_request` parent. The Request and location were created and owned by `# WMK: Research Review App Suite`; the empty folder and exact location read back. No payment, regarding email, or Foundation account/Contact change appeared in 60 seconds. The temporary GoVerify bypass was restored. The raw receipt's only failure is an obsolete null assertion for `akoya_submissionaccepted`; stored `false` matches live Boolean metadata's `DefaultValue=false`, and the source assertion is corrected. The meeting date still rewrites to `2024-12-13`.

[VERIFIED via `evidence/test-request-factory/meeting-date-rule-and-patch-2026-09-23.json`] The active sandbox `WMKF_Set Meeting Date` business rule contains server-side XAML assigning December/June 2024 dates from the fiscal-year text. A guarded one-field PATCH on Request 1000339 restored `2099-12-01`; the date persisted in later readback with one location and no payment/email rows. The rehearsal script now corrects and verifies the date after create when needed. No third Request was created to test the combined path, and production did not expose a rule with that exact name.

Production remains blocked until marker-aware ordinary consumer guards, automation exclusions, deterministic meeting-date behavior, and duplicate-location handling are implemented and verified. The app-owned folder/location path is proven in sandbox and does not require background-processing parity. The production-only `AkoyaGo.AsyncEntityCreated` step remains relevant to possible duplicate creation if production later uses this path. File-copy execution also needs a decided copy policy and source content that can be safely exercised. The runtime Admin preview still has no create route or ledger.
