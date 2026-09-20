# Connor handoff — Test Request Factory platform gates

Status: **PLATFORM-OWNER EVIDENCE REQUESTED; PRODUCTION ENABLEMENT BLOCKED.** Connor was emailed by the owner; response is pending. This handoff records the bounded questions that must be answered before the separate `codex/test-request-design` branch can move beyond offline implementation. It authorizes no schema apply, request creation, file creation, email, deployment, or push.

## Current scope and evidence

The factory is an admin-only synthetic fixture tool, separate from the shipped GraphService release. The implementation branch is `codex/test-request-design` at `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps`; the active design and Stage 0 contract are:

- `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`
- `docs/plans/TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md`

The accepted local slice is an inert policy/compiler and isolation work only. It has no runtime caller, route, UI, ledger, schema rollout, or live creation path. Stage 0 metadata and automation receipts are source/metadata evidence, not proof of tenant readiness.

Verified Stage 0 facts include:

- Both registered tenants lack the proposed `wmkf_istestrequest` and `wmkf_testcreationrunid` attributes.
- Production and sandbox differ in createable/application-required fields; sandbox also lacks the reminder and triage controls needed by the proposed policy.
- The verified applicant binding is `akoya_applicantid@odata.bind` to `accounts`; intake's `akoya_Account@odata.bind` precedent must not be copied.
- Request-number auto-number configuration and document-management capability are visible in metadata, but effective create privileges, plugin defaults, number allocation, and successful end-to-end creation remain unverified.
- No app-owned SharePoint document-location create seam was found in the inspected adapter. A resolved request bucket is required; the responsible provisioner is still unknown.
- Production and sandbox visible automation/vendor registrations differ. Names and trigger flags do not establish behavior, and absence of a visible narrative/package flow does not prove absence.

Evidence paths in the branch include `evidence/test-request-factory/` and the Stage 0 contract receipt. The source census and platform census were bounded and did not query business records or execute flows.

## Evidence Connor should provide

Please return authoritative owner/config evidence, or explicitly mark an item unknown. Do not run a production create to discover behavior.

1. **Create/update suppression**
   - For activated request Create workflows and enabled vendor Create/Update hooks, identify the owner, trigger/message, environment, and relevant branches.
   - State how a marker and creation-run ID present in the initial INSERT, and every later pointer/status PATCH, are handled.
   - Confirm that marked requests do not trigger narrative/package overwrite, status recomputation with external effects, email/calendar, payment/honorarium, provider generation, or other operational automation.
   - Include an approved disconfirming test or owner-backed configuration evidence. Do not disable mandatory vendor hooks wholesale.

2. **Narrative/package and status consumers**
   - Identify the actual Power Automate/AkoyaGO definitions that write `AI Materials/ProposalNarrative_<number>.pdf`, `Reviewer Materials/Proposal_<number>.pdf`, or react to request status.
   - Provide environment, trigger, marker exclusion, and subsequent PATCH behavior. If a documented flow is retired, provide authoritative retirement evidence.
   - Repository source and visible-definition absence are insufficient to close this gate.

3. **SharePoint location provisioner**
   - Identify the component that creates or provisions the Dynamics-tracked request document location, its trigger, expected library/parents, maximum wait, retry/recovery behavior, and uniqueness contract.
   - Confirm how a new request reaches exactly one resolved parent chain usable by `requireResolvedParents: true`.
   - Clarify whether provisioning is Dataverse document management, AkoyaGO, Power Automate, UI-driven, or an approved app adapter. `IsDocumentManagementEnabled: true` alone is not proof.
   - Explain whether suppressing request automation also suppresses folder provisioning; if so, identify the approved test-safe provisioning path rather than bypassing suppression.
   - Do not create a location, accept duplicates, or relax the resolved-parent requirement during this handoff.

4. **Create/number/default contract**
   - Confirm effective create privileges and the smallest valid create body for each target environment.
   - Confirm server number allocation and readback, createable required defaults, marker/run/reminder field behavior, and applicant lookup binding.
   - Reconcile production/sandbox differences before claiming one recipe works in both.

5. **Isolated rehearsal boundary**
   - Name the approved isolated target, test organization/personas, content boundary, retention owner, and bounded file/count limits.
   - Provide a readback plan proving fresh request GUID/number, marker/run values, independent folder/location, no source mutation, no real contacts/tokens, no unwanted automation, and exact owned-resource cleanup.
   - This evidence must precede any schema rollout or controlled fixture creation.

   - Confirm approved test PI/liaison identities and recipient behavior. A test persona or prior invitation does not authorize a new send; the preparation path must be no-send unless a separately approved recipient rehearsal is selected.

## Enablement boundary

Until the suppression owner evidence and location-provisioner contract are verified, production cloning remains disabled. The marker and run ID must be present in the initial request INSERT; a later patch cannot retroactively suppress create-triggered automation. Offline policy and tests may continue on the separate branch, but no clone control, schema apply, request create, folder/file create, invitation, or email is enabled. Unknown marker state must fail closed; folder naming or a Dataverse-only target does not establish SharePoint isolation. Metadata visibility, prior test fixtures, or an approved recipient identity do not imply permission to enable production cloning.

Connor's response should be attached to this handoff and reconciled into the Stage 0 contract before any implementation stage is accepted. The user has emailed Connor; response status is pending at the time of this handoff.
