# J27 Review Workbook: where each column is stored in Dynamics

Prepared November 16, 2026.

This maps every column of the J27 Review Workbook mock-up (v10.1, sheet
`1 Review (staff master)`, plus the Flags and Lists sheets) to a Dynamics field, and
lists what is still missing. The workbook reflects what Beth has in mind for the J27
review process. It is a strong guide, not a final specification.

## How to read this

- ✅ **Exists**: a field is already in Production and fits the column.
- ⚠️ **Partial / decide**: a field exists but does not fully fit, or a design choice
  is needed first.
- ❌ **Missing**: no field found.
- *(likely)*: the best available match, not yet confirmed with the people who use it.

"Created by Connor" and "created by the apps" come from a Production metadata
audit on November 16. Dynamics records the creator of these fields only as SYSTEM.
Fields made by the apps are defined in this repository and were added through its
schema files; fields not defined here were most likely added by Connor by hand.

Unless noted, fields are on the Request (`akoya_request`).

## Intake: from the portal

| Column | Workbook header | Field | Status |
|---|---|---|---|
| A | Request # | `akoya_requestnum` | ✅ |
| B | PD (lead) | `wmkf_programdirector` | ✅ |
| C | Organization | `akoya_applicantid` | ✅ |
| D | Program | `wmkf_grantprogram` / `akoya_programid` *(likely; confirm which)* | ✅ |
| E | Request ($) | Existing request amount field *(likely)* | ✅ |
| F | Applicant title | `akoya_title` | ✅ |
| G | Applicant abstract | `wmkf_abstract` | ✅ |

## Intake: written by Claude

| Column | Workbook header | Field | Status |
|---|---|---|---|
| H | Short title | `wmkf_wmkfprojectdescription` | ✅ |
| I | Executive Summary (at most 200 words) | `wmkf_layabstract`, created by the apps Nov 9, 2026; staff editor live | ✅ |
| J | Methodology, page 1 (2 sentences to 100 words) | `wmkf_ai_methodologysummary`, created by Connor Nov 16, 2026 | ✅ |
| K | Personnel (length scales with team size) | Only `wmkf_ai_teaminfo`, which is JSON, not readable text | ❌ Needs a text field |
| L | Rationale (Intake), kept as a version | `wmkf_ai_fitrationale` exists, but is paired with a fit rating from the older Phase I tool | ⚠️ See decision 1 |
| M | Field keywords, from a list | `wmkf_ai_keywords` (JSON list), created by Connor May 2026 | ✅ Controlled list still a placeholder |
| N | Methods keywords, from a list | `wmkf_ai_methodologies` (JSON list), created by Connor May 2026 | ✅ Controlled list still a placeholder |
| O | Flags (Claude, intake) | `wmkf_ai_riskflags` (JSON list), created by Connor May 2026 | ⚠️ See decision 2 |
| P | Open questions, with page and section, added to by every prompt | none | ❌ Missing |
| Q | Staff notes / rationale (AI drafted, staff edited) | `wmkf_initialassessmentrationale`, created by the apps Nov 13, 2026 *(likely)* | ⚠️ Confirm it is the same thing |

## First Cut

| Column | Workbook header | Field | Status |
|---|---|---|---|
| R | First Cut? (Y/N) | `wmkf_phaseistatus` (Scored / Not Scored) *(likely)* | ✅ |
| S | Certified by (lead PD) | none | ❌ Missing |
| T | Certified date | none | ❌ Missing |
| U | Flags (Claude, Field Analysis) | see decision 2 | ⚠️ |
| V | Flags (PD final) | see decision 2 | ⚠️ |
| W | Triage reason | `wmkf_triagestatus` holds the decision, not the reason | ❌ Missing |
| X | Field Analysis (one-page document) | `wmkf_ai_fieldprimer` *(likely)* | ✅ |
| Y | PD notes, added to over time | none | ❌ Missing |
| Z | Rationale (Field Analysis), kept as a version | none | ❌ See decision 1 |
| AA | Background & Impact (225–275 words) | Writeup sections on the Request Document record *(likely)* | ✅ |
| AB | Methodology, body (225–275 words) | Writeup sections on the Request Document record *(likely)* | ✅ |
| AC | Questions for the team | Pre-Research Presentation Brief document *(likely)* | ✅ |
| AD | Advance questions sent (date) | none | ❌ Missing |

## Semi-finalist and after review

| Column | Workbook header | Field | Status |
|---|---|---|---|
| AE | Semi-finalist? (Y/N) | `wmkf_phaseiistatus` *(likely)* | ✅ |
| AF | Reviewer summary | `wmkf_staffreviewsummary`, created by the apps Nov 13, 2026 | ✅ |
| AG | Rationale (After review), kept as a version | none | ❌ See decision 1 |
| AH | Staff recommendation | none found | ❓ Unclear |
| AI | Offramp reason, from a list | none; only the free-text note exists | ❌ Missing |
| AJ | Offramp note | `wmkf_offrampjustification`, created by the apps Nov 14, 2026 | ✅ |
| AK | Referee Comments (225–275 words) | Board writeup *(likely)* | ✅ |

## Finalist

| Column | Workbook header | Field | Status |
|---|---|---|---|
| AL | Research presentation summary | `wmkf_staffvisitassessment`, created by the apps Nov 13, 2026 *(likely)* | ✅ |
| AM | Research Presentation write-up (225–275 words) | Board writeup *(likely)* | ✅ |
| AN | Rationale (Final), kept as a version | none | ❌ See decision 1 |
| AO | Rank | Proposal Ranking storage | ✅ |
| AP | Recommend for | Proposal Ranking storage *(likely)* | ✅ |

## Status and details

| Column | Workbook header | Field | Status |
|---|---|---|---|
| AQ | Current stage | Calculated from the status fields; no storage needed | ✅ |
| AR | East/West | Derived from existing records | ✅ |
| AS | Institution type | Derived from existing records | ✅ |

## Decisions needed before adding fields

1. **Rationale versions.** The workbook keeps four: Intake, Field Analysis, After
   review and Final. Options:
   - four separate text fields on the Request (simplest), or
   - a separate table with one row per version.
2. **Flag detail.** The Flags sheet holds one row per proposal per flag. Each row has
   three settings (Claude at intake, Claude at Field Analysis, PD final), a reason
   of at most 25 words, two quotes each with page and section, and a PD comment.
   Options:
   - a JSON field for each Claude run plus one for the PD's choices, in the same
     style as the existing `wmkf_ai_riskflags`, or
   - a child table with one row per flag, which is easier to filter and report on.

## Summary of what is missing

**Intake (needed for the prompts now):**
- Personnel, as readable text
- Open questions
- Rationale (Intake), once decision 1 is made
- The flag structure, once decision 2 is made

**Later stages (can wait until those stages are built):**
- Certified by and Certified date
- Triage reason
- PD notes
- Advance questions sent (date)
- Offramp reason (from a list)
- Staff recommendation, if it is not already covered by another field
- Rationale (Field Analysis, After review, Final), once decision 1 is made

## Not yet checked

- Whether the existing fields above already hold data, or are written by Connor's
  Power Automate flows.
- The *(likely)* matches, which need confirmation from the people who use them.
- The controlled keyword lists and the flag rubric, which the workbook marks as
  placeholders.

## Sources

- Workbook columns: read-only extraction of the OneDrive copy of the workbook,
  November 16, 2026.
- Fields created since October 16 (creation dates, solution, creator): owner-run
  read-only Production metadata audit, November 16, 2026.
- Older fields and *(likely)* matches: `docs/atlas/dataverse-akoya-request.md`,
  `docs/atlas/dataverse-wmkf-requestdocument.md`, `docs/atlas/dataverse-proposal-ranking.md`
  and `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md`. Matches marked *(likely)* are
  inferred from field names and descriptions, not confirmed.
