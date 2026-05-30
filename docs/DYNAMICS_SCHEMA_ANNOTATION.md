# Dynamics Explorer — Schema Annotation Reference

> **Scope (clarified 2026-05-08).** This doc records the field annotations baked into the **Dynamics Explorer** chat tool's `TABLE_ANNOTATIONS` — what the Explorer's LLM "knows" about each table. It is not a full schema dump.
>
> **Authoritative live schema** for any table or entity-set lives in `docs/APPLICATION_STATE_ATLAS.md` and the per-entity pages under `docs/atlas/dataverse-*.md`. The Atlas is CI-gated; this doc is not. If they conflict, trust the Atlas.
>
> **Intentionally excluded from this doc / TABLE_ANNOTATIONS:**
> - `wmkf_ai_run` (operational AI audit log, not business data — should not surface in natural-language queries)
> - `wmkf_ai_prompt` (staff-edited prompt store; surface via prompt-resolver, not chat search)
> - The `wmkf_ai_*` flat fields on `akoya_request` (Field Sets A/C/D + Set B reporting + 6 workflow-chaining) — these are AI-output fields, documented in `docs/atlas/dataverse-akoya-request.md`. They are not annotated here because Explorer users typically want CRM fields, not AI summaries.
>
> If TABLE_ANNOTATIONS-driven Explorer behavior needs a refresh, regenerate via `scripts/dynamics-schema-diff.js` (NOT the older `dynamics-schema-map.js`, which samples 25 records and silently drops sparsely-populated fields — that's how `wmkf_ai_summary` was missed until 2026-05-05).

## Overview

This document records the field-level understanding of the akoyaGO Dynamics 365 CRM schema. It was created as a planning doc (Session 54) and fully resolved through comprehensive database introspection (Session 84). All annotations are now implemented in `shared/config/prompts/dynamics-explorer.js` via `TABLE_ANNOTATIONS`.

## Architecture

- **System prompt** (~800-1000 tokens) — lean vocabulary, default filters, and key GUIDs
- **TABLE_ANNOTATIONS** — per-table field metadata returned on-demand via the `describe_table` tool
- **Search-first** — Dataverse Search discovers records; OData queries retrieve details

## Database Scale

- **89 entities** with data out of 1,683 total Dataverse entities
- **15 tables** annotated in TABLE_ANNOTATIONS (covering all commonly queried data)

---

## Annotated Tables

### 1. akoya_request — Universal Record Table (25,000+)

Not just grants — this table holds **all record types**: grant applications (16K), concepts (3K), office visits (2.8K), site visits (1.5K), phone calls (914), and individual grants (86). The `wmkf_request_type` option set distinguishes them.

**Default filter rule:** Always add `wmkf_request_type eq 100000001` unless the user asks for concepts, visits, or all records.

| Field | Meaning |
|-------|---------|
| `akoya_requestid` | Primary key (GUID) |
| `akoya_requestnum` | Unique request number (e.g. "1001585") |
| `akoya_title` | Proposal/project title |
| `wmkf_request_type` | Record type option set: 100000001=Request, 100000000=Concept, plus Office Visit, Site Visit, Phone Call, Individual |
| `akoya_requesttype` | Vendor field, nearly always "Grant" — ignore |
| `_wmkf_type_value` | Lookup → wmkf_type — request type classification (Program, Discretionary, etc.) |
| `wmkf_typeforrollup` | Text copy of _wmkf_type_value — redundant, ignore |

**Statuses:**

| Field | Meaning |
|-------|---------|
| `akoya_requeststatus` | Meta/pipeline status: Concept Pending → Phase I Pending → Proposal Invited → Phase II Pending → Approved/Denied/Active/Closed |
| `wmkf_phaseistatus` | Phase I outcome: Invited, Not Invited, " Ineligible" (note leading space!), Incomplete, Pending Committee Review, Recommended Invite, Request Withdrawn, Rescinded Grant |
| `wmkf_phaseiistatus` | Phase II outcome: Approved, Phase II Declined, Phase II Pending Committee Review, Phase II Withdrawn, Phase II Deferred (rare) |
| `wmkf_researchconceptstatus` | Research concept call: Completed, Scheduled, Denied, Ineligible, Pending, Incomplete |
| `wmkf_socalconceptstatus` | SoCal concept call: Completed, Phone Call, Unlikely to be Competitive, Competitive Apply, Scheduled Call, Ineligible, Fit but Wait, Pending |
| `wmkf_contingencystatus` | Contingent payment status (int option set): Not Met, Met, Paid. Only ~20 requests use this. |

**Money fields:**

| Field | Meaning |
|-------|---------|
| `akoya_request` | "The ask" — amount requested from Keck |
| `akoya_expenses` | Total project cost (including cost share) |
| `akoya_grant` | Award/grant amount (what Keck gave) |
| `akoya_paid` | Total amount paid/disbursed to date |
| `akoya_balance` | Remaining balance on grant |
| `akoya_originalgrantamount` | Original approved amount |
| `akoya_recommendedamount` | Staff-recommended amount |
| `wmkf_invitedamount` | Invited amount for Phase II |

**Dates:**

| Field | Meaning |
|-------|---------|
| `akoya_submitdate` | Phase II submission date |
| `akoya_loireceived` | Phase I proposal (Letter of Inquiry) received |
| `wmkf_meetingdate` | Board meeting date for decision |
| `akoya_decisiondate` | Board decision date |
| `akoya_begindate` | Grant start date |
| `akoya_enddate` | Grant end date |
| `wmkf_conceptcalldate` | Scheduled concept discussion call |

**People & organization lookups:**

| Field | Meaning |
|-------|---------|
| `_akoya_applicantid_value` | → account: applicant institution (grantee) |
| `_akoya_primarycontactid_value` | → contact: liaison / primary contact at institution |
| `_wmkf_projectleader_value` | → contact: PI / principal investigator |
| `_wmkf_researchleader_value` | → contact: VPR / VP for research |
| `_wmkf_ceo_value` | → contact: CEO / president / chancellor |
| `_wmkf_authorizedofficial_value` | → contact: authorized official / signing authority |
| `_wmkf_paymentcontact_value` | → contact: payment contact |
| `_wmkf_copi1_value..5` | → contact: co-PIs (5 slots) |
| `_akoya_payee_value` | → account: payee org (if different from applicant due to tax status) |
| `wmkf_usingpayee` | Boolean — true if grant uses an alternate payee org |
| `_wmkf_donorname_value` | → wmkf_donors: donor fund source |

**Keck staff lookups:**

| Field | Meaning |
|-------|---------|
| `_wmkf_programdirector_value` | → systemuser: Keck program director |
| `_wmkf_programdirector2_value` | → systemuser: secondary program director |
| `_wmkf_programcoordinator_value` | → systemuser: Keck coordinator |

**Classification:**

| Field | Meaning |
|-------|---------|
| `_wmkf_grantprogram_value` | → wmkf_grantprogram: broad program (Research, SoCal, UE, etc.) |
| `_akoya_programid_value` | → akoya_program: specific internal program (S&E, MR, HC, etc.) |
| `_wmkf_type_value` | → wmkf_type: request type classification |
| `akoya_fiscalyear` | Grant cycle label like "June 2025" (NOT calendar year) |

**Other fields:**

| Field | Meaning |
|-------|---------|
| `wmkf_vendorverified` | Applicant payment info verified via GOverify |
| `wmkf_phaseiicheckincomplete` | Phase II check-in is complete (boolean) |
| `wmkf_numberofyearsoffunding` | Years of funding |
| `wmkf_numberofconcepts` | Concept count |
| `wmkf_numberofpayments` | Payment count |
| `wmkf_mrconcept1title..4title` | Medical Research concept titles (4 slots) |
| `wmkf_seconcept1title..4title` | Science & Engineering concept titles (4 slots) |
| `_wmkf_potentialreviewer1_value..5` | Assigned reviewers (5 slots) |
| `wmkf_excludedreviewers` | Excluded reviewer names and reasons |
| `wmkf_abstract` | Full proposal abstract text |
| `wmkf_researchconceptemailsent` | Has concept email been sent (boolean) |

---

### 2. akoya_requestpayment — Payments & Requirements (22,500+)

Single table holding **two unrelated record types**:
- **Payments** (9,271) — financial disbursements, split by `akoya_type eq false`
- **Requirements** (13,252) — reporting obligations, split by `akoya_type eq true`

| Field | Meaning |
|-------|---------|
| `akoya_type` | Boolean: true=Requirement, false=Payment. **Critical for filtering.** |
| `akoya_paymentnum` | Unique payment/report number |

**Payment-specific fields:**

| Field | Meaning |
|-------|---------|
| `akoya_amount` | Payment amount |
| `akoya_netamount` | Net payment amount |
| `akoya_paymentdate` | Actual payment date |
| `akoya_postingdate` | Posting/accounting date |
| `akoya_estimatedgrantpaydate` | Estimated future payment date |
| `akoya_folio` | Payment status. Stored values (probe `scripts/probe-akoya-folio-casing.js`, 2026-05-30): `PAID` (issued), `Void`, `Scheduled` (known date), `Ready To Send`, `Contingent` (awaiting condition), `Ready To Pay`, `Refund`. Issued value is uppercase `PAID` (no mixed-case "Paid"); Dataverse string `eq` is case-insensitive, so `akoya_folio eq 'PAID'` is exact and casing-proof — prefer `eq` over `contains()`. |
| `akoya_alternatepayee` | True if payment goes to alternate payee org |
| `wmkf_billcompaymentid` | Bill.com payment reference ID |
| `akoya_postingoption` | Posting option |

**Requirement-specific fields:**

| Field | Meaning |
|-------|---------|
| `akoya_requirementdue` | Report due date |
| `wmkf_reporttype` | Int option set (staff-facing): 682090000=Interim, 682090001=Final, 682090002=Follow-up to Final, 682090003=Contingency Update, 682090004=No Cost Extension, 682090005=Budget Reallocation, 682090006=Returned Postcard (legacy: signed award letter), 682090007=Deferral Update |
| `akoya_requirementtype` | Back-end only. Auto-set by business rule from wmkf_reporttype. Used by portal for mapping. Not user-queryable. |
| `wmkf_published` | Internal workflow flag (requirement published to portal) |
| `wmkf_requirementcheckedin` | Internal workflow flag (requirement checked in) |

**Shared fields:**

| Field | Meaning |
|-------|---------|
| `_akoya_requestlookup_value` | → akoya_request: parent request |
| `_akoya_requestapplicant_value` | → account: applicant org |
| `_akoya_requestcontact_value` | → contact: contact person |
| `_akoya_payee_value` | → account: payee org |

---

### 3. account — Organizations (4,500+)

| Field | Meaning |
|-------|---------|
| `name` | Organization name (may be legal or common) |
| `akoya_aka` | Common/short name (95% populated) |
| `wmkf_legalname` | Official legal/incorporated name (83%) |
| `wmkf_dc_aka` | Abbreviations/alternate names (21%) |
| `wmkf_formerlyknownas` | Historical names after rebranding (sparse) |
| `akoya_constituentnum` | Unique organization ID |

**Tax & compliance (populated by GOverify system):**

| Field | Meaning | Population |
|-------|---------|------------|
| `akoya_taxid` | EIN / Tax ID (e.g. "36-4760242") | 69% |
| `akoya_taxstatus` | Verification status (e.g. "Verified Nonprofit") | 57% |
| `wmkf_bmf509` | IRS 509(a) status (e.g. "509(a)(1)") | — |
| `wmkf_bmfsubsectiondescription` | IRS subsection (e.g. "501(c)(3) Charitable Organization") | — |
| `wmkf_bmffoundationcode` | IRS foundation status code | — |
| `akoya_pub78city/state/street1/zip` | IRS Publication 78 registered address | ~57% |
| `akoya_guidestarorganizationname` | Name as registered on GuideStar | ~57% |
| `akoya_guidestarcode` | GuideStar code (e.g. "PC" = public charity) | ~57% |
| `akoya_guidestardescription` | GuideStar full description | ~57% |

**Other fields:**

| Field | Meaning |
|-------|---------|
| `akoya_totalgrants` | Total grant amount |
| `akoya_countofawards` / `akoya_countofrequests` | Award/request counts |
| `wmkf_eastwest` | Geographic region: east/west US |
| `akoya_institutiontype` | Institution type |
| `wmkf_financialstatementsneeded` | Needs financial statements (boolean) |
| `_primarycontactid_value` | → contact: primary contact (68%) |
| `_wmkf_organizationleader_value` | → contact: org leader/CEO (28%) |

**Note on GOverify:** The `akoya_goverify` table exists (3,400+ records) but all relevant tax/compliance fields are also stored directly on the account table. The akoya_goverify table is not needed for queries.

---

### 4. contact — People (5,000+)

| Field | Meaning | Population |
|-------|---------|------------|
| `fullname` / `firstname` / `lastname` | Name fields | — |
| `salutation` | Title prefix (Dr., Prof.) | 56% |
| `emailaddress1` | Primary email | — |
| `jobtitle` | Job title | — |
| `telephone1` | Phone number | — |
| `akoya_contactnum` | Unique contact number | — |
| `wmkf_orcid` | ORCID researcher identifier | 24% |
| `address1_line1/city/stateorprovince/country` | Address | — |
| `adx_organizationname` | Org name from portal registration | 44% |

---

### 5. email — Email Activities (5,000+)

| Field | Meaning |
|-------|---------|
| `subject` | Email subject |
| `description` | Email body (HTML) |
| `sender` / `torecipients` | Sender and recipients |
| `directioncode` | true=outgoing, false=incoming |
| `attachmentcount` | Number of attachments |
| `_regardingobjectid_value` | → linked request or record |

**Important:** The `senton` field is NULL for incoming emails. Always filter by `createdon`.

---

### 6. Program Hierarchy

Three-level hierarchy for classifying grants:

```
wmkf_type (8 broad classifications)
  ↕ many-to-many in practice
wmkf_grantprogram (11 grant programs)
  ↓ parent-child
akoya_program (24 internal programs)
```

**wmkf_type** (8 values): Program, Discretionary, Site Visit, Office Visit, Special Projects, Special Grants, Miscellaneous, Individual.

**wmkf_grantprogram** (11 values): Research (RES), Southern California (SOCAL), Undergraduate Education (UE), Discretionary (DISC), Law (LAW), Young Scholars (YS), Strategic Fund (STRAT), Honorarium (HON), Emeritus (EMER), Memorial (MEM), Other (MISC).

**akoya_program** (24 values): S&E, MR (under Research); HC, CC, EC, EP, AC (under SoCal); LA (under Law); UG (under UE); CGP, DDGP, DMGP, EMGP, SDGP, SSDGP (under Discretionary); and others. Some newer programs (DR=Disaster Relief, BR=Bridge Funding, RR=Research Reviewer) lack parent links.

---

### 7. Lookup/Reference Tables

| Table | Count | Description |
|-------|-------|-------------|
| `wmkf_bbstatus` | 88 | Status codes with request type mapping |
| `wmkf_donors` | 116 | Donor codes and names |
| `wmkf_supporttype` | 41 | Support type classifications |
| `wmkf_programlevel2` | 29 | Program sub-categories |
| `akoya_phase` | 62 | GoApply application phases |

---

### 8. Defunct / Skip Tables

| Table | Reason |
|-------|--------|
| `akoya_concept` | Defunct (75 records). Concepts now stored in `akoya_request` with `wmkf_request_type = Concept`. |
| `akoya_goverify` | Tax/compliance fields are duplicated on `account`. No need to query this table directly. |

---

## Key Business Logic

### Alternate Payee Pattern
An applicant institution may not be eligible to receive payment due to tax status. In that case, the foundation pays the institution's associated fundraising organization (the "payee"). Tracked by:
- `wmkf_usingpayee` on akoya_request (boolean flag)
- `_akoya_payee_value` on akoya_request (payee org lookup)
- `akoya_alternatepayee` on akoya_requestpayment (per-payment flag)

### Status Lifecycle
`akoya_requeststatus` is the meta status. The concept and phase status fields provide granular outcomes:
1. **Concept stage** → `wmkf_researchconceptstatus` or `wmkf_socalconceptstatus`
2. **Phase I** → `wmkf_phaseistatus` (outcome: Invited → Phase II, or Not Invited/Ineligible)
3. **Phase II** → `wmkf_phaseiistatus` (outcome: Approved, Declined, Deferred, Withdrawn)

### Fiscal Year
`akoya_fiscalyear` stores labels like "June 2025", not calendar years. Filter with `contains()` or combine with date range on `akoya_submitdate`.

### Payment vs Requirement
The `akoya_requestpayment` table holds two unrelated record types differentiated by `akoya_type`. Always specify which type when querying.

---

## Implementation

All annotations are implemented in:
- **`shared/config/prompts/dynamics-explorer.js`** → `TABLE_ANNOTATIONS` object and `buildSystemPrompt()` function
- **15 tables** fully annotated with field descriptions, types, option set values, and query rules

Last updated: 2026-05-08 (status-clarification pass; underlying TABLE_ANNOTATIONS unchanged since Session 84)
