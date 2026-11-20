---
title: "Power Automate Research Intake Flows"
domain: document-workflows
kind: spec
status: active
summary: "Connor's Research intake flow map (2026-11-20): what each Power Automate step writes, where, in what format, and when it runs."
canonical: true
owner: product-engineering
last_verified: 2026-11-20
related:
  - docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md
  - docs/plans/PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md
  - docs/BACKEND_AUTOMATION_PLAN.md
---

# Power Automate Research Intake Flows

## Provenance and how to read this

**Source:** Connor's "Research intake — what is written where, and in what format",
as of 2026-11-20, sent to the owner as a text file
(`intake-field-map-2026-11-20.txt`). Sections 1–8 below transcribe it in the same
structure and wording, with every field name, option value, length and JSON
format copied exactly. Two changes only: section headings were turned into
Markdown, and the two example PD nicknames in the PD-scores format were replaced
with placeholders.

**Evidence level:** everything in sections 1–8 is **Connor's report**
`[REPORTED by Connor 2026-11-20]`; the Vercel side has not probed the flows. The
only items independently confirmed are the three compliance fields on
`akoya_request` (types, and the four `wmkf_ai_compliancecheck` options), read from
Production Dataverse metadata on 2026-11-20 `[VERIFIED via read-only attribute
metadata read, 2026-11-20]`. Do not upgrade any other line to verified without a
named, owner-approved read.

**Status labels are Connor's and must not be rounded up:**

| Label | Meaning |
|---|---|
| `[LIVE]` | running in production |
| `[BUILT]` | built and tested, live once step 3 exists |
| `[PLANNED]` | design decided, not built |
| `[MANUAL]` | set by staff, no flow writes it |

At 2026-11-20: steps 1 and 2 are **LIVE**; step 3 (AI review) is **PLANNED**;
step 5 (staff version) is **BUILT but not live** (it waits on step 3); steps 6–7
are **PLANNED**; steps 0 and 4 are vendor/manual.

**Scope:** Research applications on the production phase only (phase
`51cf300c-f2b1-f111-aaac-000d3a361c1f`). All names are Dataverse logical names;
"request" means `akoya_request`.

## Sequence at a glance

```text
Step 0  Portal (vendor)           creates request, simple form fields, uploads to SharePoint
Step 1  Application data  LIVE    request fields, personnel, suggested reviewers, CRO
          └─ wmkf_ingeststage: Tables in progress → Tables done ───────┐
Step 2  Documents         LIVE    Submission-Documents/*.pdf          ◄┘
          └─ Documents in progress → Documents done ──────────────────┐
Step 3  AI review         PLANNED prompts → request fields, keyword rows, AI run log ◄┘
          └─ AI review in progress → AI review done (= awaiting coordinator review)
Step 4  Coordinator review MANUAL akoya_submissionaccepted = Yes (+ fix primary discipline)
          └─ triggers ────────────────────────────────────────────────┐
Step 5  Staff version     BUILT   staff-version PDF, front matter, Narrative-Bibliography ◄┘
Step 6  PD assignment     PLANNED batch, started by staff after the deadline
Step 7  PD packets        PLANNED batch, started by staff; safe to re-run
```

## 1. Stage tracking

On the status tracking row, `akoya_goapplystatustracking`:

| Field | Type | Values / meaning |
|---|---|---|
| `wmkf_ingeststage` | Choice | The relay between the automated steps. `682090000` Tables in progress (step 1 start; also the reset on resubmission) · `682090001` Tables done (step 1 end → triggers step 2) · `682090002` Documents in progress · `682090003` Documents done (step 2 end → triggers step 3) · `682090004` AI review in progress · `682090005` AI review done (step 3 end = awaiting coordinator review) · `682090006` Failed |
| `wmkf_ingesterror` | Text (2,000) | `"<Step>: <message>"` for the last failure; cleared when a step starts. |

After step 3, state lives on the request:

| Field | Who writes it | Meaning |
|---|---|---|
| `akoya_submissionaccepted` | [MANUAL] | Coordinator acceptance; triggers step 5. |
| `wmkf_phistaffversioncompleteflag` | [BUILT] | Set by step 5 on success. |
| `wmkf_readyforreview` | [MANUAL] | Staff handoff for review; no flow writes it. |

- **Resubmission:** step 1 clears `akoya_submissionaccepted` and
  `wmkf_phistaffversioncompleteflag`.
- Step 3 sets `akoya_submissionaccepted` to **No** if it was already Yes
  (acceptance must follow the AI review).

## 2. Step 0 — Portal (vendor automations, not Connor's)

Creates the request and maps the simple form fields, **for example** (Connor's
list is illustrative, not exhaustive): `akoya_title`, `akoya_request` (amount),
`akoya_expenses` (budget), `wmkf_summaryscientificquestion`,
`wmkf_summarypotentialimpact`, `wmkf_summaryrisks`, `wmkf_summaryenablingadvances`,
`wmkf_summarynewarea`, `wmkf_summarypeergroups`, `wmkf_summarypriorsupport`,
`wmkf_summaryaiuse`, `wmkf_granteeimagecaption`, `wmkf_iacucanimalmodels`,
`wmkf_pipublications`, `wmkf_abstract` (raw; cleaned by step 1).

Uploads land in the request's SharePoint folder (akoyaGO site, `akoya_request`
library).

## 3. Step 1 — Application data `[LIVE]` (flow: Research Application Fields)

### Request (`akoya_request`)

| Field | Content |
|---|---|
| `wmkf_abstract` | Text. Applicant abstract, cleaned in place (PDF line breaks removed). |
| `wmkf_excludedreviewers` | Text. One excluded reviewer per line: `{first} {last} ({info}) — {reason}`. `" ({info})"` is omitted when blank. |
| `wmkf_projectleader` | Lookup → `contact`. The PI's contact. |
| `wmkf_type` | = Program |
| `wmkf_grantprogram` | = Research |
| `wmkf_request_type` | = Request |
| `wmkf_phaseistatus` | = Pending Committee Review |
| `wmkf_numberofyearsoffunding` | = 3 |
| `wmkf_grantcycle` | From the GOapply opportunity. |

Not in Connor's list: the legacy Program field `akoya_programid` (see
section 9).

### Personnel (PI + co-PIs) — clear-and-rebuild on each run

- **`contact`** — matched on `emailaddress1` (created if new): `firstname`,
  `lastname`, `salutation`, `jobtitle`, `department`, `wmkf_orcid`,
  `wmkf_copiorganizationname` (institution as typed), `wmkf_co_pi` (co-PIs),
  `parentcustomerid` (fill-if-empty).
- **`wmkf_apprequestperson`** — one row per person: `wmkf_request`,
  `wmkf_contact`, `wmkf_role` (`100000000` PI / `100000001` Co-PI),
  `wmkf_lineorder` (form order, PI = 1), `wmkf_projectresponsibilities` (stated
  role, up to 150 characters), `wmkf_institutionatawardraw` (institution as
  typed), `wmkf_institutionataward` (account, when it resolves),
  `wmkf_assignmentkey`.

### Suggested reviewers (5 per application) — never deleted or rebuilt

- **`wmkf_potentialreviewers`** — matched on `wmkf_emailaddress` (created if new):
  `wmkf_firstname`, `wmkf_lastname`, `wmkf_name`, `wmkf_title`,
  `wmkf_organizationname` / `wmkf_primaryaffiliation`.
- **`wmkf_appreviewersuggestion`** — one row per request + reviewer:
  `wmkf_request`, `wmkf_potentialreviewer`, denormalized
  `wmkf_reviewerfirstname` / `lastname` / `title` / `affiliation` / `email`,
  `wmkf_notes` = stated expertise, `wmkf_sources` = `"applicant"` (appended to an
  existing row's sources), `wmkf_suggestionlabel` = `"{title} — {first} {last}"`.

### Chief research officer

`contact` (matched on email) → `account.wmkf_researchleader` on the **applicant
organization**, NOT the request's own `wmkf_researchleader`.

## 4. Step 2 — Documents `[LIVE]` (flow: Research Application Documents)

No Dataverse fields beyond the stage. SharePoint, in the request folder:

```text
Submission-Documents/Project-Narrative_<num>.pdf
Submission-Documents/Bibliography_<num>.pdf
Submission-Documents/Biosketches_<num>.pdf
Submission-Documents/Other-Support_<num>.pdf
Submission-Documents/Collaboration-Letters_<num>.pdf          (if uploaded)
Submission-Documents/Graphical-Abstract_<num>.<png|jpg>
Submission-Documents/declarationofstatus_<applicant AKA or name>.pdf   (if uploaded)
```

## 5. Step 3 — AI review `[PLANNED]`

Prompts marked "tested" have passed on a test request. Each task is one prompt
from `wmkf_ai_prompt`, run in sequence on the same cached documents. **Every field
is overwritten on each step-3 run** (it never runs after staff review starts).

### Request (`akoya_request`)

| Field | Type | Content | Prompt |
|---|---|---|---|
| `wmkf_wmkfprojectdescription` | Text (2,000) | Short project title. | `grantee-title.generate` (tested) |
| `wmkf_layabstract` | Text | Executive summary, plain text, one paragraph of 150–200 words. | `intake.executive-summary` (tested) |
| `wmkf_ai_methodologysummary` | Text | Methodology, plain text, 2–4 sentences, at most 100 words. | `intake.methodology` (tested) |
| `wmkf_ai_teaminfo` | Text | Personnel summary, plain text: one entry per person, PI first, separated by blank lines. | `intake.personnel` (tested) |
| `wmkf_recommendationrationale` | Text | Rationale for recommendation, plain text, 3+ sentences, at most 100 words (impact, innovation, key risks). Staff edit it later. Runs after the executive summary and methodology, and reads their fresh outputs. | `intake.rationale` (tested) |
| `wmkf_programareaserved` | Lookup → `wmkf_programlevel3` (keyword table) | The PRIMARY DISCIPLINE. The coordinator may repoint it in step 4. The AI's original pick stays in `wmkf_ai_keywords`. | `intake.keywords` (tested, v4) |
| `wmkf_ai_keywords` | Text (10,000) | JSON, format `wmkf-keywords/1` (below). | `intake.keywords` |
| `wmkf_ai_methodologies` | Text (10,000) | JSON, format `wmkf-methods/1` (below). | Not stated by Connor [ASSUMED: `intake.keywords`, since its source block is "same as above"] |
| `wmkf_ai_pdscores` | Text (100,000) | JSON, PD expertise scores (below). Scores ONLY; step 3 never assigns a PD. | Not yet written |
| `wmkf_ai_injectionflag` | Yes/No | Hidden-instruction screen; flags for staff, never blocks. | Not yet written |
| `wmkf_ai_injectionnotes` | Text (10,000) | The quoted passages and their source document. | Not yet written |
| `wmkf_ai_compliancecheck` | Choice | `682090000` Compliant / `682090001` Non-Compliant / `682090002` Human Review (`682090003` Reviewed is for staff). | Not yet written |
| `wmkf_ai_complianceissues` | Text | Plain-language list of clerical issues. Advisory only. Also receives a line when any prompt returns `INSUFFICIENT_MATERIAL`. | Not yet written |
| `wmkf_ai_fitassessment` | Choice | `682090000` Fit / `682090001` Not a Fit / `682090002` Unclear. | Not yet written |
| `wmkf_ai_fitrationale` | Text | — | Not yet written |

### Keyword table (`wmkf_programlevel3`)

A term the AI coins (one not in the table) becomes a new row: `wmkf_name`,
`wmkf_keywordtype` (Discipline / Method / Object of Study),
`wmkf_keyworddisciplinegroup` (the group the AI chose),
`wmkf_parentgrantprogram` = Research, `wmkf_needsreview` = Yes.

The table holds 247 seeded Research rows (70 disciplines, 82 methods, 95 objects
of study). Disciplines also carry `wmkf_keyworddisciplinebranch` and
`wmkf_keywordinternalprogram` (legacy MR/SE bucket).

### AI run log (`wmkf_ai_run`, one row per Claude call, success or failure)

| Field | Value |
|---|---|
| `wmkf_ai_prompt` | Lookup |
| `wmkf_ai_promptversion` | — |
| `wmkf_ai_request` | Lookup |
| `wmkf_ai_model` | The concrete model id |
| `wmkf_ai_status` | Completed / Failed |
| `wmkf_ai_rawoutput` | Full answer |
| `wmkf_ai_notes` | `"latency=...; tokens in=/out=/cache_create=/cache_read=...; cacheHit=...; stopReason=..."` |
| `wmkf_ai_runsource` | PowerAutomate Auto (`682090000`) in production / PowerAutomate Test (`682090004`) in tests |
| `wmkf_ai_tasktype` | Summary (`682090000`) for title, executive summary, methodology, personnel and rationale; Check-in (`682090002`) for injection screen, keywords, PD scores, clerical and fit |

### `INSUFFICIENT_MATERIAL`

When a text prompt replies with exactly this, its field is left empty, a Teams
notice is posted, and a line is added to `wmkf_ai_complianceissues`.

### `wmkf_ai_keywords` format (`"wmkf-keywords/1"`)

```text
{"schema": "wmkf-keywords/1",
 "source": {"prompt": "intake.keywords", "version": 4, "run": "<wmkf_ai_run id>", "assigned": "<UTC ISO time>"},
 "primary":   {"term": "Structural Biology", "group": "Molecular and Cellular Biology", "coined": false, "id": "<wmkf_programlevel3 id>"},
 "runner_up": {"term": "Chemical Biology", "group": "Chemistry", "coined": false, "id": "<id>"},
 "reason": "<one sentence on what decided the primary>",
 "secondary": [ <item>, ... ],          (0-3 disciplines)
 "objects":   [ <item>, ... ],          (objects of study, at most 8)
 "other":     ["poly(ADP-ribose)", "microcrystal electron diffraction (MicroED)", ...]}  (0-5 free-text terms)
```

`<item>` = `{"term", "group", "coined", "id"}`. `id` = the keyword row; for a
coined term, the new Needs Review row. `runner_up` is `null` when there is no
close second. Empty lists are `[]`.

### `wmkf_ai_methodologies` format (`"wmkf-methods/1"`)

```text
{"schema": "wmkf-methods/1", "source": { ...same as above... }, "methods": [ <item>, ... ]}  (at most 6)
```

### `wmkf_ai_pdscores` format (proposed)

```text
{"prompt": "intake.pd-scores v1", "scored_on": "<UTC ISO time>",
 "scores": [{"pd": "<PD nickname>", "score": 7, "rationale": "<one sentence>"},
            {"pd": "<PD nickname>", "score": 9, "rationale": "<one sentence>"}, ...]}
```

One entry per PD. `pd` = the PD user's Nickname (`systemuser.nickname`).
`score` = integer 0–10.

## 6. Step 4 — Coordinator review `[MANUAL]`

| Field | Action |
|---|---|
| `akoya_submissionaccepted` | Yes = accepted (triggers step 5). |
| `wmkf_programareaserved` | Corrected if the AI's primary discipline is wrong. |

## 7. Step 5 — Staff version `[BUILT]` (flow: Research Intake Staff Version)

**Request:** `wmkf_phistaffversioncompleteflag` = Yes on success (cleared at the
start of each run).

**SharePoint, request folder (akoyaGO):**

| Path | Content |
|---|---|
| `<AKA>_<Primary Keyword>_Staff-Version_<num>.pdf` (no keyword yet → `<AKA>_Staff-Version_<num>.pdf`) | Cover, summary, graphical abstract, project abstract, narrative, bibliography, biosketches, other support, collaboration letters (if any) |
| `Submission-Documents/Front-Matter_<num>.pdf` | Cover, summary, graphical abstract, project abstract |
| `Submission-Documents/Cover-Page_<num>.docx`, `Summary_<num>.docx`, `Graphical-Abstract-Page_<num>.docx`, `Project-Abstract-Page_<num>.docx` | Working files |
| `AI Materials/Narrative-Bibliography_<num>.pdf` | Narrative + bibliography, for AI tools |

**SharePoint, Research staff site** (`Shared Documents/Research/Current Phase I/`):

```text
<AKA>_<num>/<staff version file>
00_All Staff Versions/<staff version file>
```

## 8. Steps 6–7 — PD assignment and packets `[PLANNED]`

**Step 6 — PD assignment** (batch flow, started by staff after the deadline).
Reads `wmkf_ai_pdscores` for every accepted request, assigns and load-balances.
Writes `akoya_request.wmkf_programdirector` (Lookup → `systemuser`, the assigned
PD), plus a reference spreadsheet of the assignments (as last cycle).

**Step 7 — PD packets** (batch flow, started by staff; safe to re-run).
SharePoint, Research staff site (`Current Phase I/`):

```text
00_<PD Nickname>/<staff version file>                one copy per assigned request
00_<PD Nickname>/00_<PD Nickname>_Front-Matter.pdf   all of the PD's front matter, by request number
```

No Dataverse writes.

## 9. What this means for the Vercel app (our analysis, not Connor's)

Checked against our source on 2026-11-20 unless labeled.

1. **Short project title has two writers.** Step 3 would write
   `wmkf_wmkfprojectdescription` using the Dataverse prompt row
   `grantee-title.generate`, the same row our cron uses
   [VERIFIED via `lib/services/grantee-title-service.js:19`]. Our cron fills only
   rows where that field is null, for Phase I Invited requests whose Program field
   is Research [VERIFIED via `lib/services/cron/generate-grantee-titles-service.js:68-76`].
   Once step 3 is live, J27 requests will already have a title and the cron
   becomes a backstop. An Admin edit of `grantee-title.generate` changes both
   writers' output.
2. **J27 requests get no Program field from the flows.** Step 1 sets
   `wmkf_grantprogram` = Research and does not list `akoya_programid`. This
   matches the blank-Program J27 test request behind the Grant-program membership
   rule; see `docs/audits/program-field-membership-readers-audit-2026-11-20.md`.
3. **A possible S&E/MR source.** Discipline keywords carry
   `wmkf_keywordinternalprogram` (Connor: "legacy MR/SE bucket"), reachable from
   the request's primary discipline `wmkf_programareaserved`. This is a
   candidate, not a decision: Connor calls it legacy, and the lookup is filled
   only by step 3, which is not live.
4. **Compliance (owner decision deferred 2026-11-20).**
   - Connor's design is advisory: `wmkf_ai_compliancecheck` plus
     `wmkf_ai_complianceissues`, with acceptance (`akoya_submissionaccepted`)
     manual. The older v3 spec (`docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md`) had the
     AI write `akoya_submissionaccepted` [ASSUMED superseded until Connor
     confirms].
   - `wmkf_ai_compliancesummary` exists in Dataverse [VERIFIED 2026-11-20
     metadata read] but is not in Connor's map.
   - Fit (`wmkf_ai_fitassessment`, `wmkf_ai_fitrationale`) and the injection
     screen are separate step-3 tasks.
5. **Files.**
   - Our staff-version matcher requires exactly one root file whose lowercased
     name ends `_staff-version_{num}.pdf`
     [VERIFIED via `lib/services/workbench-proposal-documents.js:212-228`], so
     Connor's keyword-segment name matches. If a re-run after a keyword change
     left both the keyword-less and the keyword file, the match would fail closed.
   - `AI Materials/Narrative-Bibliography_<num>.pdf` is produced by step 5, which
     is not live; this explains its absence on the J27 test requests.
   - Step 5 writes derived files into `Submission-Documents/` (`Front-Matter_`,
     four `.docx` working files). That contradicts the earlier understanding that
     `Submission-Documents` holds only applicant originals.
   - No listed step produces `Reviewer Materials/Proposal_<num>.pdf`, which
     Reviewer Finder still uses as a fallback. The J27 reviewer copy remains
     unspecified.
6. **Excluded reviewers become structured.** Step 1 writes one reviewer per line
   (`{first} {last} ({info}) — {reason}`). Our parser
   (`lib/services/reviewer-exclusion-parser.js`) was built for heterogeneous D26
   prose and uses an LLM; J27 text could be parsed deterministically.
7. **Suggested reviewers arrive as rows.** Step 1 writes five
   `wmkf_appreviewersuggestion` rows per request with `wmkf_sources` =
   `"applicant"`, appending to an existing row's sources. The app also writes this
   table through `lib/services/reviewer-engagement/`, so the two writers share
   rows.
8. **Step-3 output limits.** Compare with
   `docs/plans/PREFLIGHT_PROMPTS_HANDOFF_2026-11-10.md` and
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` before changing a
   prompt; list differences for the owner rather than reconciling them silently.

## 10. Open questions for Connor

1. When step 5 re-runs after the primary keyword changes, is the earlier
   staff-version file (different name) removed or replaced? Two files would make
   our matcher fail closed.
2. Is `akoya_submissionaccepted` now always manual (superseding the v3 spec's AI
   write), and is `wmkf_ai_compliancesummary` retired or still planned?
3. Is `wmkf_ai_methodologies` written by `intake.keywords` or a separate prompt?
4. What produces the J27 reviewer copy (D26's `Reviewer Materials/Proposal_`)?
5. Is `wmkf_keywordinternalprogram` reliable enough to drive the S&E/MR split for
   J27 briefings and ranking, or is it being retired?
6. Does any step set `akoya_programid`, or is it permanently blank for J27?
