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

"Created by Connor" and "created by the apps" for fields added since October 16
come from a Production metadata audit on November 16. Dynamics records the
creator of these fields only as SYSTEM. Fields made by the apps are defined in
this repository and were added through its schema files; fields not defined here
were most likely added by Connor by hand. The May 2026 `wmkf_ai_` fields (keywords,
methodologies, risk flags, team info) predate that audit; they are defined in
`lib/dataverse/schema/wave2-existing/akoya_request-ai-extensions.json` and were
built on the apps side under Connor's May 6 delegation.

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
| K | Personnel (length scales with team size) | `wmkf_ai_teaminfo`, created by the apps May 2026; repurposed for readable text (same team information, new format) | ✅ Description changed to "Summary of key personnel and expertise" in the repo and, per Connor, in Dynamics |
| L | Rationale (Intake), kept as a version | `wmkf_ai_fitrationale` exists, but is paired with a fit rating from the older Phase I tool | ⚠️ See decision 1 |
| M | Field keywords, from a list | `wmkf_ai_keywords` (JSON list), created by the apps May 2026 | ✅ List source: the Keywords table `wmkf_programlevel3` (seeded: 259 rows, probe 2026-11-19) |
| N | Methods keywords, from a list | `wmkf_ai_methodologies` (JSON list), created by the apps May 2026 | ✅ List source: the Keywords table `wmkf_programlevel3` (seeded: 259 rows, probe 2026-11-19) |
| O | Flags (Claude, intake) | `wmkf_ai_riskflags` (JSON list), created by the apps May 2026 | ⚠️ See decision 2 |
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
| W | Triage reason | `wmkf_declinereason` (Decline Reason), with `wmkf_denialnotes` (Invite/Decline Notes) for Other text | ✅ Existing fields verified by owner-run probes, 2026-11-19; owner confirmed all eight options provisioned |
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

## Applicant answers from the J27 form

Not workbook columns, but available inputs for the remaining prompts. Applicants fill
these in on the J27 portal application form (owner, November 17); they were added to
the Request by hand on October 22. Definitions and limits are from the
[Research Program application instructions](https://www.wmkeck.org/wp-content/uploads/2026/08/WMKF_Research_Application_Instructions_260826.pdf)
(dated August 26, 2026).

| Field | Form item | What the applicant is asked | Limit | Could inform |
|---|---|---|---|---|
| `wmkf_summaryscientificquestion` | Scientific Question | The motivating question, accessible to a scientist outside the field; no methods or frameworks | 300 characters | Flag: unclear basic science question |
| `wmkf_summarypotentialimpact` | Potential Impact | If the question is answered, what changes? Two distinct downstream consequences | 600 characters each | Flag: limited impact; Rationale |
| `wmkf_summaryrisks` | Risks | Potential risks to success (mitigation goes in the narrative) | 300 characters | Flag: feasibility |
| `wmkf_summaryenablingadvances` | Enabling Advances | Novel advances that make the research possible or timely | 300 characters | Rationale |
| `wmkf_summarynewarea` | New Area | If new for the team, how it differs from the team's prior work | 600 characters | Rationale |
| `wmkf_summarypeergroups` | Peer Groups | 2–4 peer groups, what they do and how this differs | 300 characters each | Keywords; flag: overlap with existing funding |
| `wmkf_summarypriorsupport` | Prior Support | If preliminary data are included, all prior funding used to generate them | 600 characters | Flags: overlap with existing funding or a recent Keck award |
| `wmkf_summaryaiuse` | AI Use | How generative AI was used in preparing the proposal | 300 characters | **Nothing.** The instructions say applications will not be evaluated on this answer |
| `wmkf_pipublications` | Publications (Project Info) | Up to 5 team publications most relevant to the project, with DOI and one sentence on how each relates to and differs from it | 300 characters each | Personnel; flag: limited impact or incremental |
| `wmkf_iacucanimalmodels` | Animal Models (Project Info) | Whether the project uses animal models requiring IACUC approval, and which | — | Staff note; not a flag in the workbook |

The "could inform" column is a suggestion, not a decision. These are the applicant's
own claims, so prompts should weigh them against the proposal rather than repeat them.

Other facts from the instructions that matter for the prompts:
- **Key personnel** are the PI and co-PIs only (institutional PI status), each with a
  project role of up to 150 characters. Collaborators who are not key personnel appear
  only in the narrative and the optional **Collaboration Letters** PDF. When present,
  the letters are attached to the staff version of the application (owner, November 17).
  The intake flow does not pass them to prompts (owner, November 17), so the Personnel
  prompt finds collaborators in the narrative only.
- **Project Narrative**: six pages, with three required sections in this order: State
  of the Field and the Gap; Approach; Feasibility.
- **Project Abstract** (`wmkf_abstract`): written for a general audience and published
  on the Foundation website if funded.
- The program description (page 1) lists what the Foundation does not fund
  (disease-specific, translational or applied work; optimization of existing
  techniques; incremental extensions) and says overlap with recently funded Keck
  projects is held to a higher standard. These match the workbook's flags 1, 2 and 6.

## Decisions needed before adding fields

1. **Rationale versions.** The workbook keeps four: Intake, Field Analysis, After
   review and Final. **Waiting on Beth** (discussed with Connor, November 17): does
   anyone need to read earlier versions in normal use, for example side by side or
   by the Chairs, or only look them up occasionally? Options:
   - one Rationale field plus a Rationale stage field, overwritten at each stage,
     with Dynamics audit history keeping earlier versions. Least work, but earlier
     versions are hard to show in the apps, views or flows. Production keeps audit
     history forever (owner, November 17), so earlier versions are not lost;
   - four separate text fields on the Request, each version always readable; or
   - a separate table with one row per version, keeping full history.

   Also open: whether workbook column Q ("Staff notes = Rationale, AI drafted,
   human edited") is the staff-edited Intake Rationale or a separate note.
2. **Flag detail.** The Flags sheet holds one row per proposal per flag. Each row has
   three settings (Claude at intake, Claude at Field Analysis, PD final), a reason
   of at most 25 words, two quotes each with page and section, and a PD comment.
   Options:
   - a JSON field for each Claude run plus one for the PD's choices, in the same
     style as the existing `wmkf_ai_riskflags`, or
   - a child table with one row per flag, which is easier to filter and report on.

## Summary of what is missing

Connor creates the missing fields (owner, November 17).

**Intake (needed for the prompts now):**
- Personnel: no new field; `wmkf_ai_teaminfo` repurposed (description changed)
- Open questions
- Rationale (Intake), once decision 1 is made
- The flag structure, once decision 2 is made

**Later stages (can wait until those stages are built):**
- Certified by and Certified date
- PD notes
- Advance questions sent (date)
- Offramp reason (from a list)
- Staff recommendation, if it is not already covered by another field
- Rationale (Field Analysis, After review, Final), once decision 1 is made

## Not yet checked

- Whether the other existing fields above already hold data. (Per Connor, 2026-11-17:
  the four May `wmkf_ai_` fields hold no data and no flow writes them yet; the new
  intake flows will.)
- The *(likely)* matches, which need confirmation from the people who use them.
- The flag rubric, which the workbook marks as a placeholder.
- The keyword lists: per Connor (relayed by the owner, 2026-11-18), the authoritative list is the
  Keywords table `wmkf_programlevel3`. It holds 259 rows, 247 active
  [VERIFIED via the owner-run `node scripts/probe-keyword-taxonomy.cjs --target=prod`, 2026-11-19]. `wmkf_keywordtype` separates Discipline, Method and
  Object of Study keywords (12 legacy rows have no type); `wmkf_keyworddisciplinebranch`
  is the broad area and is set on Discipline rows only (Earth and Space Sciences,
  Engineering, Life Sciences, Mathematics and Computing, Physical Sciences);
  `wmkf_keyworddisciplinegroup` is the subcategory (11 under Discipline, 9 under Method,
  8 under Object of Study). A Request reaches the table through two lookups,
  `wmkf_programlevel3` and `wmkf_programareaserved`, and also has the `wmkf_ai_keywords`
  text field. The one request with any of them filled points to `wmkf_programareaserved`
  [VERIFIED via the owner-run `node scripts/probe-request-keywords.cjs --target=prod`, 2026-11-19: one request in all of Production has any of the three fields filled, intake test 1003526, whose `wmkf_programareaserved` points at the Discipline keyword "Structural Biology" (Life Sciences / Molecular and Cellular Biology); `wmkf_programlevel3` and `wmkf_ai_keywords` are empty on every request]. An older table catalog (`docs/archive/DATAVERSE_CUSTOM_TABLES_2026-06-05.md`)
  lists the table's display name as "Program Service Area".

## Triage reason verification — November 19, 2026

[VERIFIED via owner-run `scripts/probe-request-triage-reasons.cjs` and
`scripts/probe-request-decline-notes.cjs`, outputs supplied in chat.] All 36 supplied
requests have a Decline Reason matching the workbook category after label mapping:
15 Limited impact, 10 Continuation/incremental, eight Too applied/translational,
two Implementation/risk and one Basic science question unclear. Thirteen have
Invite/Decline Notes. The notes are private and are not copied into this document.

The owner confirmed all eight options provisioned after running
`scripts/extend-request-decline-reasons.mjs`: the five existing values remain separate,
including Limited impact and Continuation/incremental; the additions are Overlap with
existing funding, Overlap with a recent Keck award and Other. No new field is needed.
The scoring-specific editors deployed to Production on November 19 (PR #644,
`2ab19cd5d`; Vercel Ready verified in the release session). Scored proposals show
Staff rationale; Not Scored proposals show Reason, with a text box for Other and
preserved existing notes for other choices.

**Single-save follow-up [Production-live November 19, 2026]:** PR #645 /
`755e4a96d` deployed in Vercel `dpl_CNZLeiiDGHsb8HeF6q71tjd4ufKy` (Ready,
verified in the release session). The
Initial Assessment form switches between those fields immediately without saving
on selection. One **Save assessment** writes the decision and selected details in
one staff-attributed, ETag-conditional Dataverse update. Changing the decision still
requires the lead Program Director or a superuser; same-decision staff annotation
edits retain their existing permissions. Hidden notes and rationale are omitted from
the write, drafts survive choice/tab switches, and conflicts preserve drafts until
explicit reload. Live metadata still validates the reasons and Other-text limit.
No additional provisioning was required. PR #646 / `1882697dc` then removed the
form's View proposal link in Production (`dpl_E3LsnFC1BwUZFuXZA9Qo5HBKEoNA`,
Ready verified in the release session). Full CI passed for both releases;
signed-in saves were not exercised.

## Sources

- Workbook columns: read-only extraction of the OneDrive copy of the workbook,
  November 16, 2026.
- Fields created since October 16 (creation dates, solution, creator): owner-run
  read-only Production metadata audit, November 16, 2026.
- Older fields and *(likely)* matches: `docs/atlas/dataverse-akoya-request.md`,
  `docs/atlas/dataverse-wmkf-requestdocument.md`, `docs/atlas/dataverse-proposal-ranking.md`
  and `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md`. Matches marked *(likely)* are
  inferred from field names and descriptions, not confirmed.
