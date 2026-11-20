# Expertise roster — handoff for Connor

The Expertise Roster is live in production Dataverse and maintained through
**Admin → People & Access → Expertise Roster**.

**Environment:** `https://wmkf.crm.dynamics.com`  
**Table:** Expertise Profiles — `wmkf_expertiseprofile`  
**Entity set:** `wmkf_expertiseprofiles`  
**Primary key:** `wmkf_expertiseprofileid`

Use Dataverse **List rows** with **Filter rows**:

```text
statecode eq 0
```

That returns active profiles across all three categories.

| Purpose | Logical fields |
|---|---|
| Identity | `wmkf_expertiseprofileid`, `wmkf_name` |
| Category | `wmkf_category`: **100000000** = Research Program Staff; **100000001** = Consultant; **100000002** = Board |
| Matching content | `wmkf_expertise`, `wmkf_primaryfields`, `wmkf_keywords`, `wmkf_subfieldsspecialties`, `wmkf_methodstechniques`, `wmkf_distinctions` |
| Background | `wmkf_role` (title), `wmkf_affiliation`, `wmkf_keckaffiliation`, `wmkf_keckaffiliationdetails`, `wmkf_orcid` |
| Lead-PD eligibility | `wmkf_leadpdeligible` |
| Staff identity | `_wmkf_staffuser_value` — existing Dataverse `systemuser` GUID |
| Contact identity | `wmkf_contactguid` — optional Contact GUID stored as **text**, not a lookup |
| Manual email | `wmkf_preferredemail` |

For **lead-PD candidates**, use:

```text
statecode eq 0 and wmkf_category eq 100000000 and wmkf_leadpdeligible eq true and _wmkf_staffuser_value ne null
```

Pass the expertise/background fields into the existing matching step. Return the
**profile GUID** with each recommendation; use the linked **Staff User GUID** when
resolving a PD assignment. Don't join by name or email.

Amy Rowat is active and lead-PD eligible. Her stored email is a **future address**:
include her in matching, but do not treat that address as evidence of mailbox
availability, grant app access, or send her anything.

Existing Contact links are preserved. If email resolution is later needed, linked
profiles use the active Contact's current `emailaddress1`; only unlinked profiles
use `wmkf_preferredemail`. An unavailable linked Contact must not silently fall
back to the manual address.

Keep roster maintenance in Admin; the flow only needs reads. Your actual production
connection still needs a read check. Backend automation and Expertise Finder
retirement remain separate work.

Verified against the deployed schema and roster contract on November 19, 2026.
See the [production execution report](EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md)
for migration and acceptance evidence.
