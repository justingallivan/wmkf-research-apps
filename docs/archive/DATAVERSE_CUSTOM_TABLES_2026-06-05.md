# Dataverse custom-table reference (snapshot 2026-06-05)

> **Point-in-time snapshot, NOT gate-maintained.** Generated S222 from a live `EntityDefinitions` probe (`DynamicsService.getEntityDefinitions()`, `IsPrivate eq false`) against prod Dataverse. Counts/fields drift as the schema evolves; re-probe before relying on it for destructive work. Built as reference for the "where do Connor's AI prompts live" question.

**Custom tables (prefix `wmkf_` or `akoya_`): 143** — 23 `wmkf_` (foundation-custom, incl. this app suite) + 120 `akoya_` (Foundant/Akoya grant-management product schema).

## AI / prompt-relevant tables
- **`wmkf_ai_prompt`** ("AI Prompt", set `wmkf_ai_prompts`) — the ONLY AI-prompt store; read by the Executor (`executePrompt`), the reviewer-finder resolver, and the `/admin` Prompt Templates editor.
- **`wmkf_ai_run`** ("AI Run", set `wmkf_ai_runs`) — AI invocation audit ledger; also holds one dormant legacy scratch-row prompt read by `prompt-resolver.js`.
- The Microsoft system prompt entities (`msdyn_*prompt`, `mcpprompt`, `agentprompt`) are Copilot/Agent/MCP infrastructure, not ours (excluded — not `wmkf_`/`akoya_`).
- "Template" tables below (`akoya_lettertemplate*`, `akoya_fundstatementlettertemplate*`) are **mail-merge letter templates**, NOT LLM prompts.

> **Conclusion:** any prompt stored as Dataverse *data* lives in `wmkf_ai_prompt`. Prompts not found there (e.g. Connor's PA-side ones) are embedded in Power Automate flow definitions, not Dataverse rows. Pending Connor's confirmation.

## `wmkf_*` tables (23)
| Logical name | Entity set | Display name | Description |
|---|---|---|---|
| `wmkf_ai_prompt` | `wmkf_ai_prompts` | AI Prompt |  |
| `wmkf_ai_run` | `wmkf_ai_runs` | AI Run |  |
| `wmkf_appgrantcycle` | `wmkf_appgrantcycles` | App Grant Cycle | Grant review cycles backing the Reviewer Finder. One row per fiscal-year board meeting cycle. Alt-keyed on fiscal year code so it joins to akoya_request.akoya_fiscalyear. |
| `wmkf_appproposalsearch` | `wmkf_appproposalsearchs` | App Proposal Search | Per-user record of a Reviewer Finder analysis run. Owner-scoped (UserOwned) but readable org-wide so staff can see each other's searches. |
| `wmkf_apprequestperson` | `wmkf_apprequestpersons` | App Request Person | Junction tracking PI / co-PI participation across akoya_request history. One row per (request, contact, role). Replaces the legacy 6-OR query against akoya_request._wmkf_projectleader_value + _wmkf_copi1..5_value. Backfilled once from existing slot fields; ongoing sync is owned by Connor's net-new PA flows on akoya_request create/update. Read-side strategy is UNION with akoya_request._wmkf_projectleader_value (NOT junction-first/fallback) — see docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md §5. |
| `wmkf_appreviewersuggestion` | `wmkf_appreviewersuggestions` | App Reviewer Suggestion | One row per (potential-reviewer, request) candidate. Tracks the full outreach lifecycle: invitation, response, materials, reminders, review receipt, thank-you. The canonical person identity lives on wmkf_potentialreviewers (which is 1:1 with contact once promoted). UserOwned (the staff member who suggested the candidate) but org-readable. |
| `wmkf_appsystemsetting` | `wmkf_appsystemsettings` | App System Setting | Admin-editable key/value configuration for the Research Review App Suite (model overrides, etc.). |
| `wmkf_appuserappaccess` | `wmkf_appuserappaccesses` | App User App Access | Per-user grants for apps in the Research Review App Suite. Matches appRegistry.js keys. |
| `wmkf_appuserpreference` | `wmkf_appuserpreferences` | App User Preference | Per-user preferences for the Research Review App Suite. Holds encrypted secrets; requires User-level Read access on the security role (post-schema step). |
| `wmkf_bbstatus` | `wmkf_bbstatuses` | BB Status | Blackbaud status |
| `wmkf_donors` | `wmkf_donorses` | Donors |  |
| `wmkf_glaccount` | `wmkf_glaccounts` | GL Account |  |
| `wmkf_grantprogram` | `wmkf_grantprograms` | Grant Program |  |
| `wmkf_policy` | `wmkf_policies` | Policy | A policy slot (e.g., 'reviewer-coi', 'reviewer-ai-use'). Parent of wmkf_policyversion children. The slot is the stable conceptual identifier; versions are the actual texts that come and go over time. wmkf_ActiveVersion lookup (added in step 03) points at whichever child is currently in force for the slot. Staff edit policy bodies by creating a new version row and flipping wmkf_ActiveVersion (atomic activation). General-purpose: applicant T&C, staff handbook, and other future surfaces use the same pattern. |
| `wmkf_policyversion` | `wmkf_policyversions` | Policy Version | A versioned policy body. Child of wmkf_policy (parent slot) via wmkf_Policy lookup. Each row captures one specific version of a policy's title + body text. Multiple versions per parent over time; only one is active at any moment (the parent's wmkf_ActiveVersion lookup points at it). Used for reviewer-facing acknowledgment surfaces (COI, AI-use) and future surfaces (applicant T&C, etc.). IMMUTABILITY: once any wmkf_appreviewersuggestion row references a version via its policy-version lookup, that version's title and body must not be edited. Text changes create a new version row, never edit-in-place. Default Restrict cascade on the suggestion lookup prevents hard-delete of referenced rows; staff role configuration should restrict delete privilege to admins. |
| `wmkf_portalmembership` | `wmkf_portalmemberships` | Portal Membership | Applicant-portal institution-claim membership: a contact's claimed association with an account (institution), with self-service request + staff approval state. Alt key (contact, account) — one row per (person, institution) pair regardless of approval state; re-applying after rejection updates the existing row. Pending vs. revoked vs. rejected are distinct (wmkf_approvalstatus carries the distinction; statecode alone cannot). Admin approve/reject surface is a SEPARATE downstream slice (docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md) — only the entity is slice 0. |
| `wmkf_potentialreviewers` | `wmkf_potentialreviewerses` | Potential Reviewers |  |
| `wmkf_programlevel2` | `wmkf_programlevel2s` | Program Level 2 |  |
| `wmkf_programlevel3` | `wmkf_programlevel3s` | Program Service Area |  |
| `wmkf_proposalbudgetline` | `wmkf_proposalbudgetlines` | Proposal Budget Line | Intake-portal slice 0. Per-year, per-category budget rows drained from the applicant intake portal, child of akoya_request (parental, cascade delete). TWO DISTINCT DELETE AXES — do not conflate (Connor S162 ruling, see docs/INTAKE_PORTAL_ITEM_6_DISCUSSION.md § 0 'Update 2026-05-18 (S163)'): (1) the parental cascade.Delete:Cascade below governs WHOLE-akoya_request deletion / orphan cleanup — stays as specced; (2) the drain's post-submit-edit reconciliation must DEACTIVATE obsolete rows (statecode->Inactive), NEVER hard-delete them DURING DRAIN/POST-SUBMIT RECONCILIATION — the Item-6 recompute fires on that child Update and sums ACTIVE children only. (Whole-akoya_request deletion via axis (1)'s parental cascade DOES hard-delete children — that is an administrative/retention path, out of scope for the recompute flow since the parent is gone; it is not a counterexample to the deactivate rule, which scopes to drain reconciliation only.) PARENT-HARD-DELETE POLICY (Codex review S163): whole-akoya_request hard delete is PERMITTED ONLY as a deliberate human administrative / data-retention operation; it MUST NOT be invoked by any automated drain, reconciliation, or recompute path. No automated code path in this codebase may hard-delete an akoya_request or rely on the child cascade for cleanup. Deactivation needs NO schema here: Dataverse custom entities carry statecode/statuscode by default. Cost-share rows live here too via wmkf_category 100000007-100000009 — WMKF-spend aggregate queries must filter wmkf_category NOT IN (100000007,100000008,100000009). Entity name LOCKED as wmkf_proposalbudgetline (Justin decision S163, 2026-05-18 — the wmkf_budgetline alternative is dropped; was flagged for Connor naming review, now closed). Authoritative spec: docs/BUDGET_FORM_SPEC.md v3 + docs/INTAKE_PORTAL_SCHEMA_CHANGES.md 2026-05-14 entry. |
| `wmkf_sitevisit` | `wmkf_sitevisits` | Site Visit |  |
| `wmkf_supporttype` | `wmkf_supporttypes` | Support Type |  |
| `wmkf_type` | `wmkf_types` | Type |  |

## `akoya_*` tables (120)
| Logical name | Entity set | Display name | Description |
|---|---|---|---|
| `akoya_account` | `akoya_accounts` | Account | Chart of general ledger accounts for recording revenues and expenses. |
| `akoya_accountingsettings` | `akoya_accountingsettingses` | Accounting Settings |  |
| `akoya_accountsubcategory` | `akoya_accountsubcategories` | Account Subcategory |  |
| `akoya_akoya_donor_akoya_interest` | `akoya_akoya_donor_akoya_interestset` | akoya_akoya_donor_akoya_interest |  |
| `akoya_akoya_fund_akoya_interest` | `akoya_akoya_fund_akoya_interestset` | akoya_akoya_fund_akoya_interest |  |
| `akoya_akoya_request_akoya_interest` | `akoya_akoya_request_akoya_interestset` | akoya_akoya_request_akoya_interest |  |
| `akoya_akoya_scholarship_akoya_request` | `akoya_akoya_scholarship_akoya_requestset` | akoya_akoya_scholarship_akoya_request |  |
| `akoya_akoyaapply` | `akoya_akoyaapplies` | GOapply Opportunity |  |
| `akoya_akoyaapplycontact` | `akoya_akoyaapplycontacts` | GOapply User |  |
| `akoya_akoyaapplyresponse` | `akoya_akoyaapplyresponses` | GOapply Response (Deprecated) |  |
| `akoya_assets` | `akoya_assetses` | Assets | Donor Assets |
| `akoya_bpf_37cbc1cffe8e4c91be3e81ab38b1db8b` | `akoya_bpf_37cbc1cffe8e4c91be3e81ab38b1db8bs` | Gift Payment Process | Base entity for process Gift Payment Process |
| `akoya_bpf_7341ea3f0b6848ae96398dda40f7dd6a` | `akoya_bpf_7341ea3f0b6848ae96398dda40f7dd6as` | Grant Payment Process without Accounting | Base entity for process Grant Payment Process without Accounting |
| `akoya_bpf_ff8cc7b28bfb437ebc7033bc8c56eae7` | `akoya_bpf_ff8cc7b28bfb437ebc7033bc8c56eae7s` | Grant Payment Process | Base entity for process Grant Payment Process |
| `akoya_committee` | `akoya_committees` | Committee |  |
| `akoya_committeemember` | `akoya_committeemembers` | Committee Member |  |
| `akoya_concept` | `akoya_concepts` | Concept |  |
| `akoya_configflag` | `akoya_configflags` | Config Flag |  |
| `akoya_criteria` | `akoya_criterias` | Criteria |  |
| `akoya_criterialist` | `akoya_criterialists` | Criteria List |  |
| `akoya_criteriasublist` | `akoya_criteriasublists` | Criteria Sublist |  |
| `akoya_custommarketinglistitem` | `akoya_custommarketinglistitems` | Custom Marketing List Item |  |
| `akoya_department` | `akoya_departments` | Department |  |
| `akoya_donor` | `akoya_donors` | Donors & Prospects |  |
| `akoya_donoropportunities` | `akoya_donoropportunitieses` | Donor Opportunity | Donor engagements for cultivation and stewardship |
| `akoya_dtaccounts` | `akoya_dtaccountses` | DT Accounts |  |
| `akoya_entitymapping` | `akoya_entitymappings` | Entity Mapping (Deprecated) |  |
| `akoya_entitymappingrecord` | `akoya_entitymappingrecords` | Entity Mapping Record (Deprecated) |  |
| `akoya_event` | `akoya_events` | Event |  |
| `akoya_eventattendee` | `akoya_eventattendees` | Event Attendee |  |
| `akoya_eventfee` | `akoya_eventfees` | Event Fee |  |
| `akoya_field` | `akoya_fields` | Field (Deprecated) |  |
| `akoya_fieldmapping` | `akoya_fieldmappings` | Field Mapping (Deprecated) |  |
| `akoya_fiscalyear` | `akoya_fiscalyears` | Fiscal Year |  |
| `akoya_foundationmatchinggift` | `akoya_foundationmatchinggifts` | Foundation Matching Gift | gifts made by the Foundation by way of Interfund Grants to match gifts from outside the Foundation |
| `akoya_function` | `akoya_functions` | Function |  |
| `akoya_fund` | `akoya_funds` | Fund |  |
| `akoya_fundfeeformula` | `akoya_fundfeeformulas` | Fund Fee Formula |  |
| `akoya_fundfees` | `akoya_fundfeeses` | Fund Fees | The Fund Fee Formulas assigned to Funds |
| `akoya_fundfeetier` | `akoya_fundfeetiers` | Fund Fee Tier | Tier used in the calculation of fund fees |
| `akoya_fundgroup` | `akoya_fundgroups` | Fund Group | a group of funds for reporting or financial purposes |
| `akoya_fundingopportunities` | `akoya_fundingopportunitieses` | Funding Opportunities | Funding Opportunities connecting Requests to Funds |
| `akoya_fundstatementformat` | `akoya_fundstatementformats` | Fund Statement Format |  |
| `akoya_fundstatementlettertemplate` | `akoya_fundstatementlettertemplates` | Fund Statement Letter Template - DEPRECATED | This table is currently not being used by the process, but we're leaving it here in case we change plans in the future and do need to use it. |
| `akoya_fundstatementlettertemplatesession` | `akoya_fundstatementlettertemplatesessions` | Fund Statement Letter Template Session |  |
| `akoya_gift` | `akoya_gifts` | Gift |  |
| `akoya_giftfee` | `akoya_giftfees` | Gift Fee |  |
| `akoya_giftfeebusinessprocessflow` | `akoya_giftfeebusinessprocessflows` | Gift Fee Business Process Flow | Base entity for process Gift Fee Business Process Flow |
| `akoya_giftpayment` | `akoya_giftpayments` | Gift Payment |  |
| `akoya_goapplyformbuildertoolboxmappingoverrides` | `akoya_goapplyformbuildertoolboxmappingoverrideses` | GOapply Form Builder Toolbox Mapping Overrides |  |
| `akoya_goapplylogs` | `akoya_goapplylogses` | GOapply Logs |  |
| `akoya_goapplymessage` | `akoya_goapplymessages` | GOapply Message | GOapply messages allows you to communicate with GOapply applicants directly through the portal. |
| `akoya_goapplysettings` | `akoya_goapplysettingses` | GOapply Settings |  |
| `akoya_goapplystatustracking` | `akoya_goapplystatustrackings` | GOapply Status Tracking |  |
| `akoya_goapplystatustrackingattachments` | `akoya_goapplystatustrackingattachmentses` | GOapply Status Tracking Attachments |  |
| `akoya_goapplystatustrackingexternalresponse` | `akoya_goapplystatustrackingexternalresponses` | GOapply Third Party Response |  |
| `akoya_gochangerequeststaging` | `akoya_gochangerequeststagings` | Change Requests |  |
| `akoya_godonatedonation` | `akoya_godonatedonations` | GOdonate Donation |  |
| `akoya_godonatelog` | `akoya_godonatelogs` | GOdonate Log |  |
| `akoya_godonatesettings` | `akoya_godonatesettingses` | GOdonate Settings |  |
| `akoya_godonatetransaction` | `akoya_godonatetransactions` | GOdonate Transaction |  |
| `akoya_gofundcharts` | `akoya_gofundchartses` | GOfund Charts |  |
| `akoya_gofunddraftrecommendations` | `akoya_gofunddraftrecommendationses` | GOfund Draft Recommendation |  |
| `akoya_gofundlog` | `akoya_gofundlogs` | GOfund Log |  |
| `akoya_gofundsettings` | `akoya_gofundsettingses` | GOfund Settings |  |
| `akoya_goimportuserstaging` | `akoya_goimportuserstagings` | Add GOapply Users | The purpose of this table is to create a GOapply user account on behalf of an external party. |
| `akoya_goverify` | `akoya_goverifies` | GOverify |  |
| `akoya_impactinvestment` | `akoya_impactinvestments` | Impact Investment | Any type of investments intended and structured to generate both a financial return and a measurable social return. |
| `akoya_impactoutcomes` | `akoya_impactoutcomeses` | Impact Outcomes |  |
| `akoya_impactpartners` | `akoya_impactpartnerses` | Impact Partners |  |
| `akoya_impactpayment` | `akoya_impactpayments` | Impact Payment | the disbursement or repayment records for impact investments |
| `akoya_importedactivity` | `akoya_importedactivities` | Imported Activity | Activity imported from another system, typically during implementation/data migration |
| `akoya_intacctmapping` | `akoya_intacctmappings` | Intacct Mapping |  |
| `akoya_intacctmappingtype` | `akoya_intacctmappingtypes` | Mapping Entity Relationship |  |
| `akoya_integrationsettings` | `akoya_integrationsettingses` | Integration Settings |  |
| `akoya_interest` | `akoya_interests` | Interest |  |
| `akoya_interest_account` | `akoya_interest_accountset` | akoya_interest_account |  |
| `akoya_interfundcreation` | `akoya_interfundcreations` | Interfund Creation | Base entity for process Interfund Creation |
| `akoya_interfundgrants` | `akoya_interfundgrantses` | Interfund Grants | The entity used to create and process interfund gift and grants. |
| `akoya_interfundpaymentprocess` | `akoya_interfundpaymentprocesses` | Interfund Payment  Process | Base entity for process Interfund Payment  Process |
| `akoya_lettertemplatefile` | `akoya_lettertemplatefiles` | Letter Template File |  |
| `akoya_lettertemplates` | `akoya_lettertemplateses` | Letter Templates | set up for letters for bulk and individual letters in akoyaGO |
| `akoya_lettertemplatesession` | `akoya_lettertemplatesessions` | Letter Template Session |  |
| `akoya_mailinglist` | `akoya_mailinglists` | Mailing List |  |
| `akoya_mailinglistmember` | `akoya_mailinglistmembers` | Mailing List Member |  |
| `akoya_mailinglistmember_akoya_mailingli` | `akoya_mailinglistmember_akoya_mailingliset` | akoya_mailinglistmember_akoya_mailingli |  |
| `akoya_marketingentity` | `akoya_marketingentities` | Custom Marketing List |  |
| `akoya_outcome` | `akoya_outcomes` | Outcome |  |
| `akoya_outcomemeasure` | `akoya_outcomemeasures` | Outcome Measure |  |
| `akoya_page` | `akoya_pages` | Page (Deprecated) |  |
| `akoya_paymentadjustmentreversal` | `akoya_paymentadjustmentreversals` | Payment Adjustment/Reversal |  |
| `akoya_paymentmethod` | `akoya_paymentmethods` | Payment Method |  |
| `akoya_phase` | `akoya_phases` | Phase |  |
| `akoya_program` | `akoya_programs` | Program | Grant Program Category for which grants can be requested. |
| `akoya_programbudget` | `akoya_programbudgets` | Program Budget |  |
| `akoya_projectarea` | `akoya_projectareas` | Project Area | The list of possible areas served by the project for which grant funds are being requested. |
| `akoya_proposal` | `akoya_proposals` | Proposal |  |
| `akoya_recurringgift` | `akoya_recurringgifts` | Recurring Gift | Donor-initiated recurring GOdonate transactions |
| `akoya_referral` | `akoya_referrals` | Referral | An entity that ties together Donors and Gifts based on referral. |
| `akoya_region` | `akoya_regions` | 990 Region | a listing of all regions and associated countries  according to the IRS 990 reporting |
| `akoya_request` | `akoya_requests` | Request | A request for a grant, including information about the applicant, project, process, payments, and requirements. |
| `akoya_requestedscholarship` | `akoya_requestedscholarships` | Requested Scholarship |  |
| `akoya_requestedscholarshipattachments` | `akoya_requestedscholarshipattachmentses` | Requested Scholarship Attachments |  |
| `akoya_requestedscholarshipthirdpartyresponse` | `akoya_requestedscholarshipthirdpartyresponses` | Requested Scholarship Third Party Response |  |
| `akoya_requestpayment` | `akoya_requestpayments` | Payment or Requirement | Payments and requirements applicable for this award. |
| `akoya_reverseagiftpayment` | `akoya_reverseagiftpayments` | Reverse a Gift Payment | Base entity for process Reverse a Gift Payment |
| `akoya_reverseagrantpayment` | `akoya_reverseagrantpayments` | Reverse a Grant Payment | Base entity for process Reverse a Grant Payment |
| `akoya_reverseinterfund` | `akoya_reverseinterfunds` | Reverse Interfund | Base entity for process Reverse Interfund |
| `akoya_reviewer` | `akoya_reviewers` | Reviewer |  |
| `akoya_reviewerrequestscore` | `akoya_reviewerrequestscores` | Reviewer Request Score |  |
| `akoya_reviewgroup` | `akoya_reviewgroups` | Review Group |  |
| `akoya_reviewgroupapplications` | `akoya_reviewgroupapplicationses` | Review Group Applications |  |
| `akoya_reviewresponses` | `akoya_reviewresponseses` | Review Responses |  |
| `akoya_scheduleddistribution` | `akoya_scheduleddistributions` | Scheduled Distribution |  |
| `akoya_scholarship` | `akoya_scholarships` | Scholarship | Named scholarships available from the foundation. |
| `akoya_scholarshipautomatchlog` | `akoya_scholarshipautomatchlogs` | Scholarship Automatch Log |  |
| `akoya_scholarshipsubmissionsession` | `akoya_scholarshipsubmissionsessions` | Scholarship Submission Session |  |
| `akoya_servicearea` | `akoya_serviceareas` | Service Area | A description of the service area served by this constituent. |
| `akoya_spendableallotmentformula` | `akoya_spendableallotmentformulas` | Spendable Allotment Formula |  |
| `akoya_spendableallotmenttier` | `akoya_spendableallotmenttiers` | Spendable Allotment Tier |  |
