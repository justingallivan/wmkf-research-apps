# B4 automation metadata evidence — 2026-09-30

**Collection DONE; six owner dispositions remain OPEN. Release and first slot PATCH remain BLOCKED.** Owner authorized these Production metadata reads in this chat. No Dataverse record write, flow invocation, migration, email, ledger operation or job drain ran; the only POST was Azure AD token acquisition.

## Provenance and visibility

[VERIFIED via interlocked GET-only client] Capture window: `2026-09-30T19:36:49.536Z` → `2026-09-30T19:37:29.318Z`. Target classification: Production. Source commit `ab812c2ac97e28169601bcede8dc0109b586c172`; committed section 13 probe and Dataverse client were clean. This evidence-only descendant preserves the reviewed runtime candidate `40ab24f3e` and the probe/client source, verified by an empty Git diff. The extra collector was ad hoc and **not committed at capture**; its exact [source snapshot](b4-automation-collector-source-2026-09-30.txt) has SHA-256 `196a6d1d8cc8d6aea7291045010820d820187115595aa2c5a08e703c50d5cc77`. These provenance claims are distinct.

The [fresh committed section 13 receipt](reviewer-slot-readiness-receipt-2026-09-30T19-36-50-888Z.json) and [supplemental metadata](b4-automation-metadata-2026-09-30.json) agree on 14 readable activated flows, 68 readable activated Request workflows/rules and the same six unresolved dispositions. Effective `prvReadWorkflow` returned `Global` for one enabled app user, HTTP 200. Section 13 has zero hard incomplete reasons and `complete=false`. Production `TEST_REQUEST_ISOLATION` and `SYNTHETIC_REVIEWER_ISOLATION` both read **on**. Local/Preview flags and marker availability were not re-probed by this collection; their dated evidence remains separate.

Production configuration came from the previously verified Vercel project using `vercel env pull`, an initially mode-0600 temporary file, chmod after pull, and finally-block deletion. No linked-project file or shared environment file changed. The final capture used 18 Dataverse GETs, including the committed section 13, effective privilege, supplemental flows/workflows and registrations. Reads occurred within the stated window, not an atomic snapshot; recheck immediately before any eventual slot operation.

## Three flows: facts collected and decisions still open

| Flow | Verified visible definition | Remaining owner evidence / decision |
|---|---|---|
| GOapply Add Request to Review Group (Deprecated) | Sole trigger `manual`, type `Request`, kind `ApiConnection`; exact parameter keys `dataset,table`, values `default.cds,akoya_requests`; input schema has `rows` and Request-ID references; no subscription parameters. Request action is `GetItem`. The only visible record create is `Apply_to_each_2/Add_to_Review_Group`: `CreateRecord` on `akoya_reviewgroupapplicationses`, with `akoya_ReviewGroup@odata.bind` and `akoya_statustrackingid@odata.bind`. No visible Request update or reviewer-slot reference. | Identify actual authorized callers/UI entry points and whether a custom plug-in can invoke this manual flow or downstream review-group automation. Record reviewer, UTC and disposition. OPEN. |
| Bill.com - Push Payments | Sole trigger `manual`, `Request` / `ApiConnection`; exact keys `dataset,table`, values `default.cds,akoya_requestpayments`; `rows` schema with payment-ID references; no subscription parameters. `Get_Request` is `GetItem` on `akoya_requests`. Visible writes are `UpdateOnlyRecord`/`UpdateRecord` on `akoya_requestpayments`: `akoya_folio`, `akoya_paymentdate`, `wmkf_billcompaymentid`. Two HTTP POST actions target external endpoints; no URLs/body values retained. No visible Request update or reviewer-slot reference. | Identify callers/UI entry points, external payment effects and any indirect invocation from plug-ins/other automation. Never invoke it to test this gate. Record reviewer, UTC and disposition. OPEN. |
| GOapply AutoFill Next Phase (Deprecated) | Sole trigger `When_a_row_is_added,_modified_or_deleted`, `OpenApiConnectionWebhook`, `SubscribeWebhookTrigger`, API `shared_commondataserviceforapps`; literal entity `akoya_goapplystatustracking`, message `1`, scope `4`. Reads Request with `GetItem`; `Condition/Update_a_row` uses `UpdateRecord` on `akoya_goapplystatustrackings` with `akoya_CurrentPhase@odata.bind`. No visible Request update or reviewer-slot reference. | Determine whether a Request slot update can indirectly create status tracking or otherwise reach this flow. Review the classic-workflow creation paths below and vendor behavior. Record reviewer, UTC and disposition. OPEN. |

[VERIFIED via Microsoft contract] Message `1` means **Create / Added**, not Request Update; the [Dataverse connector guide](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/dataverse) gives the event/message mapping and the [callback registration reference](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/callbackregistration?view=dataverse-latest) lists the same options. The [connector reference](https://learn.microsoft.com/en-us/connectors/commondataserviceforapps/) documents the observed subscription operation and record operations. This settles the numeric trigger semantics, not its possible indirect reachability.

[INFERENCE from visible definitions] The two manual flows accept row-oriented request payloads; their visible triggers have no Dataverse change subscription. Actual caller identity, invocation routes outside these definitions and run-only permissions were not read. `default.cds` is recorded as the observed literal; it is not a claim about every connection's runtime target. No owner disposition is inferred from this metadata.

## Vendor plug-ins

[VERIFIED via enabled registration GET] All six listed custom steps use managed `AkoyaGo.Plugins` assembly version `22.6.26233.1`, isolationMode `2`, sourceType `0`. The three directly unresolved registrations are:

| Step type | Entity filter returned | Update filtering attributes | Stage / mode / rank |
|---|---|---|---|
| AkoyaGo.CalculatedFieldsAsync | akoya_request | null (any column) | 40 / 1 / 99 |
| AkoyaGo.RequestPreOperation | absent | null (any entity/column) | 20 / 0 / 1 |
| AkoyaGo.RequestPostOperation | absent | null (any entity/column) | 40 / 0 / 1 |

The supplement also lists `AkoyaGo.AsyncRequestGoApplyRequirementsUpdate` (Request filter; `akoya_creategoapplyrequirementstrigger`), `AkoyaGo.RequestSetGrantAndStatus` (Request filter; `akoya_amendment,akoya_originalgrantamount,akoya_specialrequeststatus`) and `AkoyaGo.RequestPaymentFundAnonymity` (absent entity filter; `akoya_fund`). Keep the absent filter conservative even when a step's name mentions another table. [Microsoft's registration contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-plug-in) explains absent primary-entity scope, Update attribute filtering and synchronous/asynchronous stages. Registration metadata does not describe the compiled business logic.

**Vendor/owner question for each of the three unresolved types:** for an Update containing only a Potential Reviewer slot lookup, does this exact assembly/type modify any Request fields, create/update GOapply status tracking, payments or review-group records, send outreach, or invoke flows/custom actions? Identify field guards, downstream operations and evidence for the answer. Include the other three registrations and every listed Request workflow/step in indirect-chain review. Implementation/owner proof is still UNKNOWN; no assembly binary or configuration was fetched.

## All active flow actions and indirect-chain evidence

[VERIFIED via supplemental definitions] All 14 visible activated flows are included, with 215 nested action nodes (conditions, loops, else/default/case branches included), operation IDs, literal table targets, field names, run-after edges and schema references. Literal action values, full expressions and external endpoints are omitted. The following is an inventory for owner review, not execution proof or clearance:

| Activated flow | Nested nodes | Trigger type(s) | Visible record-action table targets |
|---|---:|---|---|
| Annual/Fiscal Year calculations | 7 | Recurrence | akoya_accountingsettingses |
| GOapply Update Form Definition (Deprecated) | 3 | Request | akoya_goapplystatustrackings, akoya_phases |
| GOapply Add to Review Group (Deprecated) | 6 | Request | akoya_goapplystatustrackings, akoya_reviewgroupapplicationses, akoya_reviewgroups |
| GOapply Add Request to Review Group (Deprecated) | 11 | Request | akoya_goapplystatustrackings, akoya_requests, akoya_reviewgroupapplicationses, akoya_reviewgroups |
| GOapply Invite Contact (Deprecated) | 16 | Request | accounts, akoya_akoyaapplies, akoya_goapplystatustrackings, akoya_phases |
| Bill.com - Push Payments | 23 | Request | accounts, akoya_programs, akoya_requestpayments, akoya_requests |
| Bill.com Sync Vendor | 36 | Request | accounts |
| GOapply - Bulk import users (Deprecated) | 52 | Request | akoya_configflags, akoya_goapplysettingses, akoya_goimportuserstagings, templates |
| GOapply Invite Constituent (Deprecated) | 13 | Request | akoya_akoyaapplies, akoya_goapplystatustrackings, akoya_phases, contacts |
| GOapply AutoFill Next Phase (Deprecated) | 17 | OpenApiConnectionWebhook | akoya_goapplystatustrackings, akoya_phases, akoya_requests |
| GOapply Duplicate Review Group (Deprecated) | 4 | Request | akoya_reviewgroups |
| GOapply Duplicate Review Group and Reviewers (Deprecated) | 8 | Request | akoya_akoyaapplycontacts, akoya_reviewers, akoya_reviewgroups |
| GOapply Add All Applications to Review Group (Deprecated) | 7 | Request | akoya_goapplystatustrackings, akoya_reviewgroupapplicationses, akoya_reviewgroups |
| Bill.com Pull Payments | 12 | Recurrence | akoya_requestpayments |

`Annual/Fiscal Year calculations` invokes unbound action `akoya_CalculatedFieldCalculation`; the bulk-import flow invokes `msdyn_SendEmailFromTemplate` in two branches and has a dynamic HTTP endpoint. External/custom action effects remain unclassified. No matching cross-workflow ID references were observed in the inspected definitions; that lexical result cannot rule out named/dynamic/external calls or plug-in invocation. No reviewer-slot schema references were observed in the 14 visible flow definitions; absence in this lexical scan does not prove absence of indirect effects.

The supplemental classic-workflow summaries preserve readable status, update filters, created tables, set field names, email/custom-activity indicators and schema references for all 68 Request workflows/rules. No custom activity type matched the committed probe's XAML extractor; that regex result does not prove all extension behavior absent. In particular, these definitions contain creation of `akoya_goapplystatustracking`:

| Request workflow | Recorded update attributes | Observed created status-tracking table |
|---|---|---|
| WMKF_Create SoCal Phase II Decision | wmkf_phaseistatus | akoya_goapplystatustracking |
| WMKF_Research Advance to Phase II | wmkf_phaseistatus | akoya_goapplystatustracking |
| WMKF_Create Follow-Up to Final Report | no update attributes recorded | akoya_goapplystatustracking |
| WMKF_Create Draft Discretionary App Email | wmkf_paymentcontactconfirmed | akoya_goapplystatustracking |
| Create GOapply Status Tracking (Deprecated) | no update attributes recorded | akoya_goapplystatustracking |
| WMKF_Create SoCal Phase I Status Tracking | wmkf_socalconceptstatus | akoya_goapplystatustracking |
| WMKF_Create Budget Reallocation | no update attributes recorded | akoya_goapplystatustracking |
| WMKF_Create No Cost Extension | no update attributes recorded | akoya_goapplystatustracking |

[INFERENCE, reachability UNKNOWN] A path worth reviewing is a plug-in-induced Request field change → a matching classic workflow → status-tracking creation → AutoFill's create trigger → status-tracking CurrentPhase update. Two concrete update-filtered examples are `WMKF_Research Advance to Phase II` and `WMKF_Create SoCal Phase II Decision`, both recording `wmkf_phaseistatus`. This evidence does not establish that a reviewer-slot update actually changes that field or satisfies the workflows' conditions. Definitions without update attributes need their own on-demand/create/invocation classification. Branch condition values and runtime execution history were not collected.

## Contract and durable evidence audit

`/contract-reconcile` bounded Mode A: owner-authorized metadata GET → unchanged committed probe plus supplemental collector → sanitized repository receipts → owner worksheet, B4 checklist and branch handoff. The entry, persistence and consumer are all traced here; application UI, runtime helpers and database migrations are unchanged. Successful reads are not successful disposition/slot clearance. Counts and UTC/source hashes address provenance, not future freshness. No cleanup task, background job or journal operation was introduced.

`/sweep` Mode A scope: this new automation-evidence fact, the B4 plan/current report/owner worksheet/handoff and earlier B4 review/fix report pointers. Earlier 01:01 and 18:31 captures remain dated history. Ledger location/restore, Local off/off, deployment-captured switch uncertainty and the release policy are unchanged. Scheduled-email surfaces, 059/V58 and Claude's checkout are excluded by owner instruction. No Production milestone shipped; no DEVELOPMENT_LOG entry required.

Sanitizer checks preserve nested branches and mixed-case navigation-property names while omitting fixture credentials, literal action data, GUIDs and URLs. [VERIFIED via sequential command output] All 20 relevant documentation/secret/invariant gate and self-test commands passed; [verification receipt](b4-automation-verification-2026-09-30.json). Staged whitespace and redacted Gitleaks scans passed with zero leaks. The bounded changed-fact search found no remaining live assertion that the new trigger parameters/actions are still uncollected; actual caller/vendor/indirect-effect claims remain explicitly UNKNOWN. The advisory pilot report was unavailable because local state could not be read; no observation row was fabricated. At capture source `ab812c2ac`, all 12 GitHub checks passed and PR #369 was draft/mergeable/clean; [dated CI snapshot](b4-ci-at-automation-source-2026-09-30.json). Recheck the new evidence head after push. No broader runtime test claim is made for this evidence-only task. The slot gate remains BLOCKED; the six disposition decisions require named owner review, evidence and UTC. Tomorrow's journal restore remains necessary for ledger-dependent checks.
