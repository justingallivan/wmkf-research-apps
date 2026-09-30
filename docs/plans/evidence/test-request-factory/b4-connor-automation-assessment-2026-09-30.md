# B4 Connor automation assessment — 2026-09-30

**Current disposition: items 4–6 owner-classified for the marked test Request slot operation; items 1–3 await one scope clarification. Release/slot gate remain BLOCKED.**

[OWNER-REPORTED via the human owner in this chat, received/recorded 2026-09-30T21:46:00Z] Reviewer: Connor. This timestamp records receipt of his answers, not an independently known time of his review. No GOsupport article, vendor response or implementation inspection was supplied. These are reported operational classifications, distinct from the [19:36 metadata probe](b4-automation-evidence-2026-09-30.md). No new Production read/write, flow invocation, ledger operation, migration or environment edit ran.

| Item | Connor's answer as relayed | Current classification for this operation |
|---|---|---|
| 1. AkoyaGo.CalculatedFieldsAsync | Potential Reviewers is a custom table; vendor automations will not reference or affect it. | CLARIFICATION PENDING: the operation updates a lookup on akoya_request, not the reviewer person table. Does the answer cover that Request update and its downstream effects? |
| 2. AkoyaGo.RequestPreOperation | Same custom-table assessment. | Same single scope clarification pending. |
| 3. AkoyaGo.RequestPostOperation | Same custom-table assessment. | Same single scope clarification pending. |
| 4. GOapply Add Request to Review Group (Deprecated) | Manually run through an interface button; deprecated. | CLEARED for direct automatic triggering by the reviewer-slot update, based on Connor's invocation-path classification plus the observed manual/no-subscription trigger. No button/flow execution authorized. |
| 5. Bill.com - Push Payments | Purely manually run flow. | CLEARED for direct automatic triggering by this update, based on Connor's manual-only classification plus the observed manual/no-subscription trigger. No payment/external execution authorized. |
| 6. GOapply AutoFill Next Phase (Deprecated) | Autofills a field on the Request, harmless for test records; deprecated. | OWNER-ASSESSED ACCEPTABLE for marked test records. Preserve the source distinction below; plug-in/indirect-chain scope remains pending with items 1–3. |

[VERIFIED via captured metadata] Names containing Deprecated do not establish deactivation; these flows were active at the probe. Their classifications rely on manual invocation or Connor's test-record effect assessment, not their names. The captured AutoFill definition reads akoya_requests and writes akoya_CurrentPhase@odata.bind on akoya_goapplystatustrackings. Connor described this functionally as a Request autofill; the actual persisted target in the collected definition remains status tracking. His harmless-for-test-records assessment is recorded without changing that metadata fact.

[VERIFIED via source at 725931e49] lib/services/test-requests/cast-slot-binding-runner.js sends PATCH /akoya_requests(requestId), binding the dynamically read navigation property for wmkf_potentialreviewer1 to an existing wmkf_potentialreviewerses person. It changes the Request row. The enabled any-column Request/global Update registrations can therefore be reached even if vendor code never references the custom reviewer table. The absent custom-table reference alone does not establish what those implementations do on a Request update.

One follow-up was presented to the owner: did Connor confirm the Request lookup-only update has no problematic downstream effects, or only that the vendor plug-ins do not operate on the custom Potential Reviewer table? No vendor-only evidence requirement is imposed: an operational classification covering the actual write can resolve the question. Owner silence is not a response.

The raw section 13 receipt retains six dispositionRequired entries and complete=false; it does not ingest later human dispositions. Consult this companion and the current owner worksheet for the three flow classifications. Items 1–3 and overall indirect-chain review remain pending. Local literal-on readiness, ledger restore/schema/address-digest evidence and deliberate Tier 2 promotion remain separate prerequisites. PR #369 stays draft; no slot PATCH is authorized here.

Bounded contract reconciliation: human report and committed write target → companion evidence → owner worksheet/release checklist/handoff. Mode A durable sweep preserves the original probe snapshots and labels their six-open status as historical, then updates current status pointers. This is documentation only; no runtime/schema change or Production milestone shipped, so no DEVELOPMENT_LOG entry is required.

[VERIFIED via local sequential command output] All 20 relevant documentation/Atlas/secret/invariant gate and self-test commands passed, each gate followed by its self-test. Staged whitespace check passed; redacted Gitleaks staged scan found zero leaks. No runtime tests were rerun for this report-only change.
