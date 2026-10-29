---
title: Cycle foundations — role and production calendar read-only checks
domain: platform
kind: audit
status: partial
summary: "Production roles, cycle rows, request linkage and GOApply date census; date propagation, intended Research opportunity and milestone authority remain unresolved. No live writes."
owner: product-engineering
related:
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md
---

# Cycle foundations — 2026-10-21 PT

## Scope and reproducibility

User authorized foundational **read-only** checks, including new Admin roles and actual cycle records. Source review uses remote-main snapshot `f6a96a6320e3a2520b1bdf00a17ba71a52a81bc7` (roles merged in `4822bb267`), not the older main checkout or this planning branch's role definitions. No checkout, merge, role assignment or production business mutation was performed.

Probe: `scripts/probe-cycle-foundations.cjs`. Run with `--env-file <existing local environment file> --output <new JSON path>`. It loads only application Dataverse credentials, requires the expected production hostname, enables the existing production-read interlock and calls only `client.get` against Dataverse. The sole POST acquires an application OAuth token; there are no model calls, emails, jobs, flow executions or data writes.

Final successful capture: **2026-10-22T03:22:26.086Z** (October 21 Pacific), 25 Dataverse GET calls, zero failed sections. Every collection reports completed pagination; aggregate counts are FetchXML aggregates, not the capped Dataverse `$count`. The metadata census reads 29/39/615/104 attributes for operations cycles/reviewer cycles/requests/GOApply respectively. Sanitized, bounded evidence is in `docs/audits/cycle-foundations-2026-10-21-evidence.json`; the full local intermediate output is not a tracked artifact.

## Findings

### 1. Shared roles are defined and assigned; calendar authority is still a decision

[VERIFIED via release source and production settings/user GETs]

| Shared role | Live assignee | Stored setting key |
|---|---|---|
| President | Allison Keller | `board_writeups.president` |
| CSO | Beth Pruitt | `board_writeups.cso` |
| Grants Manager | Sarah Hibler | `board_writeups.grants_manager` |
| Program Coordinator | Duncan Spore | `board_writeups.program_coordinator` |
| Systems Specialist | Connor Noda | `board_writeups.systems_specialist` |

All five stored assignees resolve to enabled Dataverse system users. This does not independently prove profile/app-access eligibility. Each role has one optional `systemUserId` in a version-1 setting, read through `getRole(role)`. Admin staffing editing remains superuser/current Grants Manager controlled. The new Program Coordinator and Systems Specialist roles allow active linked staff without Workbench access, and do not themselves confer calendar permissions. Board activation still requires only President, CSO and Grants Manager. Sources at the recorded release: `lib/services/board-writeups/model.js`, `config.js`, `pages/api/workbench/staffing.js`, `shared/components/staffing/StaffingPanel.js`.

**Justin decision remains open:** choose the existing role responsible for calendar maintenance, plus the desired notification/escalation mapping. Existing assignees are not an implicit selection.

### 2. There are two real, differently populated cycle tables

[VERIFIED via complete production collections and live metadata]

| Cycle | Operations `wmkf_grantcycle` | Reviewer `wmkf_appgrantcycle` |
|---|---|---|
| D26 | Present; board date December 10, 2026 | Present; meeting date and review deadline blank |
| J27 | Present; board date June 10, 2027 | Present; meeting date and review deadline blank |
| D27 | **No row in this capture** | Present; meeting date and review deadline blank |

Operations has 143 historical/current rows; all have active state 0. Only 55 codes match the apps' modern two-digit J/D convention; other historical records include March/September and four-digit-year codes. An active-state filter alone cannot define the working-cycle catalog, and existing strict modern-code helpers cannot safely ingest this table wholesale.

The operations table's current custom attributes are its ID, name, cycle code and Board Meeting Date. No submission/reviewer/presentation milestone columns were found in its complete attribute enumeration. **[Historical as of 2026-10-21; superseded 2026-10-28]** Connor has since added eleven milestone date columns, all null on D26, J26 and J27 (`docs/audits/grant-cycle-dates-2026-10-28-evidence.json`; alignment log D43). The older production-derived schema snapshot also declares `wmkf_cyclename`, but the current metadata has no such attribute; do not provision/repair schema as part of this read-only check.

Reviewer configuration has 10 rows; **all ten** have null meeting dates and review-return deadlines, and all have `wmkf_isactive=true`. Existing dated configuration is elsewhere: the singleton reviewer timeline has a blank cycle label and July–September 2026 dates; board settings contain confirmed D26 configuration with 23 requests, November 2 materials due and December 10 board end. These facts do not select which store should own future dates.

**Connor contract questions:** when/how future operations rows are created (including D27); whether operations owns only board dates or will maintain additional milestones; how GOApply and apps should share those values without two editable copies. These are targeted choices, not an instruction to add duplicate tables.

### 3. Request cycle links exist but need a legacy fallback

[VERIFIED via complete aggregate results] Across **all programs and historical eras**, 25,808 requests were counted: 20,300 have a cycle lookup; 5,508 do not. This is not a list of broken Research records and is not authorization for a backfill.

All 21 requests currently linked to J27 are ordinary Southern California grants: 13 have June 2027 meeting dates and eight have no meeting date. This is evidence that the cycle lookup is in use, not evidence that the new Research single-phase intake is operational. Meeting-date-only discovery misses those eight rows; lookup-only conversion would omit unlinked historical requests.

[VERIFIED metadata] Both the request and operations meeting-date fields have `SourceType=0` and are writable. The request date is not a calculated-field reference to the cycle date. Visible definition metadata contains an activated `WMKF_Set Grant Cycle from Opportunity` process on GOApply status tracking (`akoya_currentphasestatus` update), and draft meeting-date rules on requests. The 23 cycle-entity plugin-step records returned only the platform `ObjectModel Implementation` name. This does **not** prove no external synchronization exists or that any identified workflow has executed successfully.

**Connor contract question:** does changing the Board Meeting Date update linked request dates, through which mechanism, and are existing requests intentionally allowed to retain different dates? No live date edit was attempted to answer this.

### 4. A December 7 Research opportunity exists, but its intended mapping is unconfirmed

[VERIFIED via all 24 GOApply opportunity rows and field metadata] Three opportunities have a cycle lookup; 21 do not.

| GOApply record | Name | Cycle lookup | Stored Phase 1 Due Date | Publish Date |
|---|---|---|---|---|
| 001024 | Research Application | Blank | December 7, 2026 | Blank |
| 001001 | Research Application | D26 | May 1, 2026 | Populated |
| 001025 | Research Application | Blank | May 1, 2026 | Blank |
| 001002 | Southern California Concepts | J27 | November 2, 2026 UTC value | Populated |

Record 001024 is active with enabled status and its date matches the supplied provisional J27 timeline, but **it is only a candidate** until Connor confirms the intended form and cycle assignment. Blank publication data and active status do not prove the portal is open/closed; portal configuration may use other records. Raw date values are retained in the evidence; exact local cutoff hours and Dataverse DateTime behavior were not verified.

**Connor contract questions:** is 001024 the intended J27 Research form; how/when does it receive its J27 link; what is the real publication/open window and submission cutoff; where are any per-phase dates maintained? These do not reopen the parked custom intake portal.

### 5. Review cutoff and post-board follow-up remain separate

[OWNER-CONFIRMED] Reviews stop being accepted months before the board meeting; abstract requests through Awardees are an example of post-board work. No post-board review-acceptance window is proposed. This probe did not inspect reviewer-by-reviewer token expiry or exercise a submission, so current cutoff enforcement is outside its acceptance evidence. Keep the business boundary resolved and verify the implementation when changing review eligibility. Post-award completion rules belong to their individual workflows.

## What remains before implementation

- **Justin:** choose calendar role/responsible party; confirm exception/escalation ownership. General task-default and policy-inheritance proposals can be reviewed in their delivery slices.
- **Connor:** confirm Research opportunity mapping/publication, board-date propagation, future cycle-row creation and date-field ownership. These are the remaining external contracts for calendar cutover.
- **Agent engineering checks, not owner decisions:** consume the new role contract from the released revision; define modern-cycle catalog filtering without discarding historical access; resolve missing-link/date behavior per request; verify deployed non-secret cycle pins before worker changes; complete the per-slice tests and bounded cohort comparisons. Do not make another calendar or ask staff to duplicate existing dates while these checks are pending.

The independent local reviewer agreed with the interpretation above, including the all-program scope of missing links, Southern California scope of J27 rows, candidate status of 001024, and the limits of source-type/workflow metadata.

Validation: probe syntax and evidence arithmetic checked; 17 relevant documentation/security/boundary gate and sequential self-test commands passed. These checks do not verify live date propagation or portal execution.

## Failed/replaced reads and limits

The first run of `node scripts/probe-cycle-foundations.cjs --env-file <existing local environment file> --output /tmp/cycle-foundations-2026-10-21.json` reached production `https://wmkf.crm.dynamics.com` and had one failed request aggregate GET: `/akoya_requests?fetchXml=...` used unsupported `operator="before"` with value `2028-01-01`, HTTP 400 / `0x80041120`. It was changed to `lt` and succeeded. A later run targeting `/tmp/cycle-foundations-2026-10-21-verified.json` tried virtual opportunity name fields in a GOApply GET and received HTTP 400 / `0x80060888`; excluding attribute-backed virtual names succeeded in the final capture. **Neither failure changed state.** The first automation pass read 2,116 visible workflow rows; the final reproducible pass narrows to type-1 definitions, all cloud flows plus relevant entities (260 definitions), complete pagination. Workflow references are discovery evidence only; no raw definitions are retained.

No Dataverse/Graph/GOApply writes, role changes, live sends, paid/model calls, deployments or schedule changes occurred. No current Vercel environment readback, Power Automate execution history, portal browser acceptance, request mutation or propagation experiment was performed. **Verdict: bounded live census complete; integration readiness still partial.**
