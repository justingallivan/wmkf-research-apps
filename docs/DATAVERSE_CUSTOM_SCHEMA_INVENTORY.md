# WMKF Apps — Custom Dataverse Schema Inventory

**For:** Connor (Dataverse admin)
**From:** WMKF Apps team
**Date:** 2026-06-24

This is an inventory of the custom Dataverse / Dynamics schema the WMKF app suite has
created or now writes to in production: custom tables, custom fields/columns, and the
option-set (choice) values we stamp. Everything below carries the `wmkf_` publisher
prefix (ours) unless noted as a vendor (`akoya_`) or standard Dynamics table we only
extend or read.

**Source of truth:** logical names and entity sets are verified against our schema-as-code
files (`lib/dataverse/schema/`) and our live-state Atlas (probed 2026-05 to 2026-06-21).
Read-vs-write classifications are traced from application call sites. Items we are *not*
certain about are listed in Section 5 — please confirm those.

---

## 1. Custom Tables / Entities We Created (`wmkf_*`)

| Entity (logical name) | Entity set | Purpose |
|---|---|---|
| `wmkf_appreviewersuggestion` | `wmkf_appreviewersuggestions` | Per-(reviewer, request) suggestion + outreach lifecycle (invite → accept/decline → review upload → complete). Reviewer workflow core. |
| `wmkf_potentialreviewers` | `wmkf_potentialreviewerses` | Global per-person reviewer identity record (email-deduped). |
| `wmkf_appgrantcycle` | `wmkf_appgrantcycles` | Grant cycle definitions (meeting dates, deadlines, template URLs). Dataverse-primary since 2026-05-12. |
| `wmkf_apprequestperson` | `wmkf_apprequestpersons` | PI / Co-PI participation junction between `akoya_request` and `contact`. |
| `wmkf_ai_run` | `wmkf_ai_runs` | Append-only audit ledger — one row per AI invocation. |
| `wmkf_ai_prompt` | `wmkf_ai_prompts` | Staff-editable prompt library. |
| `wmkf_policy` | `wmkf_policies` | Policy slot parent (stable slot codes, e.g. `reviewer-coi`, `reviewer-ai-use`). |
| `wmkf_policyversion` | `wmkf_policyversions` | Versioned policy text children (one active version per slot). |
| `wmkf_granteedeliverable` | `wmkf_granteedeliverables` | One lifecycle row per awarded request: deliverable status, image, invite/reminder dates. |
| `wmkf_portalmembership` | `wmkf_portalmemberships` | Applicant portal: contact ↔ account (institution) join with approval workflow. (Entity live; app read/write not yet built.) |
| `wmkf_proposalbudgetline` | `wmkf_proposalbudgetlines` | Per-year, per-category budget rows for an intake proposal (child of `akoya_request`). |
| `wmkf_appsystemsetting` | `wmkf_appsystemsettings` | Admin key/value app configuration. |
| `wmkf_appuserappaccess` | `wmkf_appuserappaccesses` | Per-user app access grants. |
| `wmkf_appuserpreference` | `wmkf_appuserpreferences` | Per-user preferences (some encrypted). |
| `wmkf_appproposalsearch` | `wmkf_appproposalsearchs` | Proposal search session storage — empty, no active writer. |

**Dropped (can be cleaned up if still present):**
`wmkf_appresearcher`, `wmkf_apppublication`, `wmkf_apppublicationauthor` — removed 2026-06-02;
bibliometric fields were folded onto `wmkf_potentialreviewers`.

---

## 2. Custom Fields We Created

### 2a. On `akoya_request` (AkoyaGO vendor table — our `wmkf_*` extensions)

**AI writeback (Phase I / workbench):** `wmkf_ai_summary`, `wmkf_ai_dataextract`,
`wmkf_ai_complianceissues`, `wmkf_ai_compliancesummary`, `wmkf_ai_fitassessment`,
`wmkf_ai_fitrationale`, `wmkf_ai_fieldprimer`, `wmkf_ai_keywords`, `wmkf_ai_methodologies`,
`wmkf_ai_riskflags`, `wmkf_ai_teaminfo`, `wmkf_ai_budgetsummary`, `wmkf_ai_timeline`.

**Grant Report set (22 fields):** `wmkf_ai_reportpostdoccount`, `wmkf_ai_reportgradstudentcount`,
`wmkf_ai_reportundergradcount`, `wmkf_ai_reportpubstotal`, `wmkf_ai_reportpubspeerreviewed`,
`wmkf_ai_reportpubsnonpeerreviewed`, `wmkf_ai_reportpatentsawarded`, `wmkf_ai_reportpatentssubmitted`,
`wmkf_ai_reportadditionalfunding`, `wmkf_ai_reportprojectimpacts`, `wmkf_ai_reportawardsandhonors`,
`wmkf_ai_reportimplications`, `wmkf_ai_reportoutcomesummary`, `wmkf_ai_reportstaffnotes`,
`wmkf_ai_reportgoalsassessment`, `wmkf_ai_reportpub1citation`, `wmkf_ai_reportpub1abstract`,
`wmkf_ai_reportpub1source`, `wmkf_ai_reportpub2citation`, `wmkf_ai_reportpub2abstract`,
`wmkf_ai_reportpub2source`, `wmkf_ai_reportoverallrating`.

**Triage / workbench:** `wmkf_triagestatus`.

**Reviewer-engagement campaign config:** `wmkf_respondoffsetdays`, `wmkf_reviewduedate`,
`wmkf_respondreminderenabled`, `wmkf_respondreminderleaddays`, `wmkf_reviewduereminderenabled`,
`wmkf_reviewduereminderleaddays`, `wmkf_desiredcount`, `wmkf_quotanotifiedat`.

**Grantee abstract / title:** `wmkf_abstractformatted`, `wmkf_abstractapproved`,
`wmkf_wmkfprojectdescription`.

**BILL.com / honorarium linkage:** `wmkf_paymentnetworkidpni`, `wmkf_exisitngbillcomaccount`.

### 2b. On `wmkf_potentialreviewers` (entirely ours)

Identity & contact: `wmkf_name`, `wmkf_firstname`, `wmkf_lastname`, `wmkf_emailaddress` (dedupe key),
`wmkf_organizationname`, `wmkf_areaofexpertise`, `wmkf_whyreviewerwaschosen`, `wmkf_source`,
`wmkf_contact` (→ `contact`), `wmkf_primaryaffiliation`, `wmkf_department`, `wmkf_emailsource`.
Scholarly identifiers/metrics: `wmkf_orcid`, `wmkf_orcidurl`, `wmkf_googlescholarid`,
`wmkf_googlescholarurl`, `wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`, `wmkf_website`,
`wmkf_facultypageurl`, `wmkf_keywords`.
Freshness: `wmkf_lastchecked`, `wmkf_metricsupdatedat`, `wmkf_contactenrichedat`,
`wmkf_contactenrichmentsource`.
Identity resolver: `wmkf_identitystatus`, `wmkf_identityconfidenceband`,
`wmkf_identityresolverversion`, `wmkf_identityresolvedat`, `wmkf_identityevidencesummary`,
`wmkf_identityverifiedanchorsjson`.

### 2c. On `wmkf_appreviewersuggestion` (entirely ours)

Linkage: `wmkf_suggestionlabel`, `wmkf_potentialreviewer`, `wmkf_request`, `wmkf_grantcyclecode`,
`wmkf_programarea`, `wmkf_relevancescore`, `wmkf_matchreason`, `wmkf_sources`, `wmkf_notes`.
Lifecycle: `wmkf_selected`, `wmkf_invited`, `wmkf_accepted`, `wmkf_declined`.
Timestamps: `wmkf_emailsentat`, `wmkf_emailopenedat`, `wmkf_responsereceivedat`,
`wmkf_materialssentat`, `wmkf_remindersentat`, `wmkf_remindercount`, `wmkf_reviewreceivedat`,
`wmkf_thankyousentat`, `wmkf_completedat`, `wmkf_respondremindersentat`.
Status: `wmkf_responsetype`, `wmkf_reviewstatus`, `wmkf_applicantdisposition`.
External token: `wmkf_externaltokenhash`, `wmkf_externaltokenissued`, `wmkf_externaltokenexpires`,
`wmkf_externaltokenrevoked`, `wmkf_proposalfirstaccessed`, `wmkf_proposalurl`, `wmkf_proposalpassword`.
Review file: `wmkf_reviewbloburl` (legacy), `wmkf_reviewsharepointfolder`, `wmkf_reviewfilename`,
`wmkf_reviewuploadedbystaff`.
Structured ratings: `wmkf_revieweraffiliation`, `wmkf_reviewerimpact`, `wmkf_reviewerrisk`,
`wmkf_revieweroverallrating`.
Reviewer self-corrections: `wmkf_reviewerfirstname`, `wmkf_reviewerlastname`, `wmkf_reviewernickname`,
`wmkf_reviewertitle`, `wmkf_revieweremail`, `wmkf_reviewerorcid`.
Decline capture: `wmkf_declinereasonpicklist`, `wmkf_declinereason`, `wmkf_declinereferral`.
Stage-2a stamps: `wmkf_honorariumoptout`, `wmkf_withdrawnsufficientat`, `wmkf_coiackedat`,
`wmkf_aiuseackedat`, `wmkf_coipolicyversion` (→ `wmkf_policyversion`),
`wmkf_aiusepolicyversion` (→ `wmkf_policyversion`), `wmkf_honorariumrequest` (→ `akoya_request`).

### 2d. On `wmkf_ai_run` (entirely ours)

`wmkf_ai_runnum`, `wmkf_ai_request` (→ `akoya_request`), `wmkf_ai_tasktype`, `wmkf_ai_status`,
`wmkf_ai_model`, `wmkf_ai_promptversion`, `wmkf_ai_rawoutput`, `wmkf_ai_notes`, `wmkf_ai_runsource`,
`wmkf_ai_promptoverridden`, `wmkf_ai_promptoverride`, `wmkf_ai_Prompt` (→ `wmkf_ai_prompt`).

### 2e. Other tables (entirely ours) — see section 1 for purpose

- `wmkf_appgrantcycle`: `wmkf_displayname`, `wmkf_fiscalyearcode`, `wmkf_shortcode`, `wmkf_programname`,
  `wmkf_customfields`, `wmkf_meetingdate`, `wmkf_summarypages`, `wmkf_reviewreturndeadline`,
  `wmkf_reviewtemplateurl`, `wmkf_reviewtemplatefilename`, `wmkf_additionalattachments`, `wmkf_isactive`.
- `wmkf_granteedeliverable`: `wmkf_name`, `wmkf_Request`, `wmkf_deliverablestatus`, `wmkf_imagefileref`,
  `wmkf_imagecaption`, `wmkf_inviteddate`, `wmkf_remindeddate`.
- `wmkf_policy`: `wmkf_code`, `wmkf_displayname`, `wmkf_description`, `wmkf_activeversion`.
- `wmkf_policyversion`: `wmkf_versionlabel`, `wmkf_policy`, `wmkf_policytitle`, `wmkf_policybody`,
  `wmkf_effectivedate`.
- `wmkf_portalmembership`: `wmkf_name`, `wmkf_Contact`, `wmkf_Account`, `wmkf_RequestedBy`,
  `wmkf_ApprovedBy`, `wmkf_role`, `wmkf_isprimary`, `wmkf_approvalstatus`, `wmkf_priordecisionstatus`,
  `wmkf_requestedat`, `wmkf_approvedat`, `wmkf_rejectionreason`.
- `wmkf_proposalbudgetline`: `wmkf_name`, `wmkf_Request`, `wmkf_year`, `wmkf_category`, `wmkf_description`,
  `wmkf_amount`, `wmkf_lineorder`, `wmkf_rolecode`, `wmkf_headcount`, `wmkf_effortpct`.
- `wmkf_apprequestperson`: `wmkf_assignmentkey`, `wmkf_Request`, `wmkf_Contact`, `wmkf_role`,
  `wmkf_authorposition`, `wmkf_effortpct`, `wmkf_biosketchurl`, `wmkf_lineorder`.
- `wmkf_appsystemsetting`: `wmkf_settingkey`, `wmkf_settingvalue`, `wmkf_UpdatedBy`.
- `wmkf_appuserappaccess`: `wmkf_appkey`, `wmkf_User`, `wmkf_GrantedBy`.
- `wmkf_appuserpreference`: `wmkf_preferencekey`, `wmkf_preferencevalue`, `wmkf_isencrypted`.

### 2f. Custom fields on standard Dynamics tables

- `contact`: `wmkf_orcid`, `wmkf_portaloid` (Entra External ID OID, alt-key), `wmkf_billcomid`.
- `systemuser`: `wmkf_app_AvatarColor`, `wmkf_app_NeedsLinking`.

---

## 3. Option-Set / Choice Values We Stamp

| Table | Field | Values |
|---|---|---|
| `akoya_request` | `wmkf_triagestatus` | Advancing=100000000, Set aside=100000001, null=untriaged |
| `akoya_request` | `wmkf_ai_reportoverallrating` | Successful / Mixed / Unsuccessful |
| `akoya_request` | `wmkf_exisitngbillcomaccount` | Yes / No / Recently Confirmed (integers env-specific) |
| `wmkf_appreviewersuggestion` | `wmkf_responsetype` | accepted=100000000, declined=100000001, no_response=100000002, withdrawn_sufficient=100000003 |
| `wmkf_appreviewersuggestion` | `wmkf_reviewstatus` | accepted=100000000 … complete=100000004 |
| `wmkf_appreviewersuggestion` | `wmkf_applicantdisposition` | Recommended=100000000, Excluded=100000001 |
| `wmkf_appreviewersuggestion` | `wmkf_declinereasonpicklist` | too-busy=100000000, COI=100000001, outside-expertise=100000002, bad-timing=100000003, other=100000004 |
| `wmkf_granteedeliverable` | `wmkf_deliverablestatus` | Drafted=100000000 … Closed No Response=100000007 |
| `wmkf_portalmembership` | `wmkf_approvalstatus` | Rejected=100000000, Revoked=100000001, Approved=100000002, Requested=100000003 |
| `wmkf_portalmembership` | `wmkf_role` | Submitter=100000000, Contributor=100000001 |
| `wmkf_proposalbudgetline` | `wmkf_category` | Personnel=100000000 … Other Cost Share=100000009 |
| `wmkf_apprequestperson` | `wmkf_role` | PI=100000000, Co-PI=100000001, Senior=100000002, Key=100000003, Other=100000004 |
| `wmkf_ai_run` | `wmkf_ai_tasktype` | Summary=682090000, Report=682090001, Check-in=682090002, PD Assignment=682090003 |
| `wmkf_ai_run` | `wmkf_ai_status` | Completed=682090000, Failed=682090001, Needs Review=682090002 |

---

## 4. Standard / Vendor Tables We Only Read or Extend (NOT created by us)

`akoya_request` (we extend with `wmkf_*` fields), `contact` (extend), `account` (read),
`systemuser` (extend), `akoya_program`, `wmkf_grantprogram`, `wmkf_type`,
`sharepointdocumentlocation`, `akoya_requestpayment`, `akoya_phase`, `akoya_concept`,
`wmkf_donors`, `wmkf_bbstatus`, `wmkf_goapplystatustracking`, `wmkf_programlevel2`, `wmkf_supporttype`.

Note: some `wmkf_`-prefixed lookup tables above (donors, bbstatus, program/type/level2, supporttype)
appear to be vendor- or migration-provided that our app only reads — please confirm ownership.

---

## 5. Items to Confirm / Clean Up

1. **`wmkf__ai_summary`** (double underscore on `akoya_request`) — accidental duplicate of
   `wmkf_ai_summary`. Not written by app. **Delete candidate.**
2. **`wmkf_ai_compliancecheck`** (numeric, `akoya_request`) — vestigial from an earlier draft;
   app is instructed NOT to write it. **Reconcile/delete candidate.**
3. **`wmkf_billcomid`** (on `contact`) and **`wmkf_paymentnetworkidpni`** — used by code but not in
   our schema-as-code files; please confirm these are provisioned and where they live.
4. **`wmkf_app_AvatarColor` / `wmkf_app_NeedsLinking`** (on `systemuser`) — provisioned in wave 1 but
   no active app readers found; confirm whether to retain.
5. **`wmkf_phaseistatus` / `wmkf_phaseiistatus` choice values** — we read/filter these (e.g. our cron
   hardcodes Invited=100000003) but did not create them; please confirm the value set is stable so our
   automations don't break if values are renumbered.
6. **`wmkf_exisitngbillcomaccount` option set** — `wmkf_` prefix suggests ours, but it predates our
   tracked schema; confirm who owns it and the integer values.

---

*Prepared from code + Atlas, not a fresh live-metadata probe. Logical names and entity sets are
verified against schema-as-code; read/write classification is traced from app call sites. Happy to
run a live Dataverse metadata probe for field-level certainty before this goes out.*
