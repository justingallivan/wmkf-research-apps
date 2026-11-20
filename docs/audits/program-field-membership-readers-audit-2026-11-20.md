---
title: Program-Field Membership Readers Audit — 2026-11-20
summary: "Read-only classification of runtime readers of the request Program field (_akoya_programid_value) against the J27+ Grant-program membership rule; five live readers would drop or misroute a blank-Program J27 request."
canonical: false
owner: product-engineering
last_verified: 2026-11-20
---
Status: point-in-time evidence report from a static code read by a delegated agent
(no code run, no Production reads). Denominator: every `lib/`, `pages/`, `shared/`
file matching `_akoya_programid_value|akoya_programid` outside `_archived/` (30
files), plus importers of `researchPrograms` / `granteeResearchPrograms`.
Items 1 and 3 were re-read by the session [VERIFIED via
program-briefing-service.js:88-108, request-liaison.js:40-44]; the rest are
agent-reported [ASSUMED until re-read]. Re-check the cited lines before acting.
Repo baseline: main @ dbf9be991.

## Why

Owner decision 2026-11-19: for J27-or-later cycles, Research membership is decided
by the Grant program (`_wmkf_grantprogram_value`), not the Program field, because a
J27 request can have a blank Program field. PR #658 applied this to proposal lists
only. Memory: `.claude-memory/project-program-field-retired-use-grant-program.md`.
The owner chose this audit on 2026-11-20 before deciding which other readers change.

## Owner question this raises

The Grant program only says "Research". The **Science & Engineering vs Medical
Research split exists only in the Program field.** The program briefing groups by
that split and Proposal Ranking compares within it (`programKey`). For J27, those
readers need another S&E/MR source, or J27 must stop splitting. Decide that before
fixing items 1 and 4 below.

Later the same day, Connor's intake map (`docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`)
showed two relevant facts [REPORTED by Connor]: (a) step 1 sets `wmkf_grantprogram` = Research
and does not list `akoya_programid`, so blank Program is the expected J27 state; (b) discipline
keywords carry `wmkf_keywordinternalprogram` ("legacy MR/SE bucket"), reachable from the
request's primary discipline `wmkf_programareaserved`. That is a **candidate** S&E/MR source,
not a decision: it is filled only by the planned step 3.
Connor then said (2026-11-20) MR/SE "is set at the same time as the primary keyword";
the owner's understanding is that step 3 writes the request's `akoya_programid`, as
today, so the Program-field readers work for J27 once step 3 is live. Until then J27
requests have a blank Program field and the class A readers below still miss them. Item 2 (title cron) also changes once
step 3 is live, because step 3 writes the short title itself.

## Live readers that decide membership (class A)

Ordered by when a real J27 request first reaches them. Real J27 proposals arrive
after 2026-12-07.

| # | Reader | Evidence | Surface | Blank-Program J27 request |
|---|---|---|---|---|
| 1 | `lib/services/meeting-tracker/program-briefing-service.js` | `:93` Program filter ANDed into the query; `:106` validation; `:159` program key | PC Meeting Tracker program briefing | Dropped by the query; if present, the briefing fails `briefing_membership_invalid`. Matters from first J27 submissions. The `:94` comment records Program-field SE/MR membership as deliberate (plan F2). |
| 2 | `lib/services/cron/generate-grantee-titles-service.js` | `:70-74` Phase I Invited filter with Program clause | Grantee-title cron | Silently gets no generated title. Early 2027 (Phase I Invited). |
| 3 | `lib/services/contacts/request-liaison.js` (`isResearchProgram`) → `lib/services/site-visit/applicant-contacts.js:42` | `request-liaison.js:42`, `:111`, `:118` | Liaison for grantee invites, reminders, scheduled email; site-visit contacts and materials | Treated as non-Research: Liaison falls back to another contact or none, so email can go to the wrong person. Spring 2027. Highest blast radius. |
| 4 | `lib/dataverse/adapters/proposal-ranking-source.js` | `:96-97` Program filter, no year branch; `:193` blank Program mislabeled `mr` | Proposal Ranking | Absent from ranking; mislabeled Medical Research if present. Spring 2027. |
| 5 | `lib/services/dynamics-explorer/tools/get-related.js` | `:544` in `queryInstitutionLiaisonRequests` | Dynamics Explorer "requests for a contact" | Silently omitted. Low severity. |

## Award-time readers (class B — become A when J27 awards exist, mid-2027)

- `lib/services/workbench/grantee-deliverables/awardees-service.js:73-75` — Awardees tab and its cycle list. Not cycle-parameterized; would need Program-in-set OR (cycle ≥ 2027 AND Grant-program-in-set).
- `lib/services/workbench/grantee-deliverables/cycle-export-service.js:65-67` — cycle export.
- `lib/services/proposal-ranking/research-funding.js:60-65` — awarded-grant funding history; a blank-Program J27 award degrades to "unavailable".

## Already correct or display-only (classes C/D)

- Fixed: `lib/services/proposal-lists/list-snapshot-service.js:131-145` (year ≥ 2027 branch, fail-closed).
- Display/select only: `workbench/request-search-service.js` (already prefers Grant program), `workbench/dashboard-service.js`, `pre-site-visit/{proposal-core-service,funding-history}.js`, `reviewer-request-context.js`, `site-visit-materials/{collection-service,reminder-sweep}.js` (projection feeding item 3), `test-requests/presite-sandbox-deps.js`, `dynamics-explorer/tools/get-entity.js`, `dynamics-explorer-taxonomy.js`.
- Other: `dataverse/adapters/grant-request.js:333` supports both fields (callers choose; not traced); `bill/honorarium-onboard-orchestrator.js:182` writes a constant; `dataverse-export/*` groups historical declines and buckets a null Program as unattributed (loud, not silent); `shared/config/researchPrograms.js` / `granteeResearchPrograms.js` define and re-export the IDs.
- Prompt text: `shared/config/prompts/dynamics-explorer.js` (`:92`, `:368`, `:371`, `:634`) documents Program as a request filter and could steer the model to filter J27 requests by it.
- Archived, no live callers: `grant-reporting/lookup-grant-service.js`.

## Suggested fix pattern

Copy the proposal-lists branch: for cycles 2027+, filter on `_wmkf_grantprogram_value`
using `resolveDiscoveryScope(...).readinessOnlyProgramIds`, fail closed on an empty
scope; keep the Program field for pre-2027. Runtime change: branch per the campaign
release strategy.

## Unknowns

- Which Grant program IDs `readinessOnlyProgramIds` returns (live catalog; not read).
- Whether any Grant-program-level S&E/MR equivalent exists.
- Exact J27 Invited and site-visit dates (calendar not checked).
- Callers of `aggregateLinkedCycles` and the export compiler; whether the email services
  beyond `REQUEST_LIAISON_FIELDS` need the same projection change.
