---
name: Grant Reporting capability preservation
description: Closed 2026-11-20 — preserved Grant Reporting capabilities are archived with no app destination; an expanded version is expected inside the automatic flows and will be designed fresh.
type: project
status: closed
scope: strategy
last_verified: 2026-11-20 via owner decision in chat and caller grep of lib/services/grant-reporting/
---

# Grant Reporting — retirement and capability preservation

[VERIFIED — owner decision, 2026-11-20] **Archived; no new home.** Staff are not
using the preserved assessment flow. The owner expects an expanded version that
runs inside the automatic (Power Automate) flows; that will be designed fresh, not
built by re-homing this code. Do not propose Workbench or other app destinations
for it. The preserved code stays where it is as reference (no code was moved):
`extract-service.js`, `lookup-grant-service.js` and `grant-report-word-export.js`
have no live callers; `classify-file.js` remains live (Reviewer Finder proposal
loader, request file corpus rules). Nothing in Dataverse was changed.

[VERIFIED — owner direction, 2026-11-19] Retire the standalone Grant Reporting
application while preserving its useful capabilities. This advances the October 21
request to integrate those capabilities elsewhere; it does not choose their new home.

The source change is described in `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md`:
the page becomes a retirement notice and its APIs become authenticated HTTP 410
responses. Original page/API implementations are retained under `_archived/`.
Production release verified 2026-11-20 UTC (PR #651, `ce4bc2618`, deployment `dpl_2KcHR8Gd5vEUE9hxFBmd92mtNDBx`; signed-in notice smoke). Signed-in check 2026-11-20 (owner's browser): both Grant Reporting APIs return 410 `APP_RETIRED` to POST and 405 to GET.

Preserve the archived page's proposal-versus-report assessment editor, extracted
fields, staff edits, regeneration modes, and Word export. Per the retirement plan, the assessment/regeneration and editing flow is the reuse target; the old extraction workflow and Word export are preserved as reference only, not future requirements. Preserve
`lib/services/grant-reporting/extract-service.js`, the prompt and output-schema
modules, and `shared/utils/grant-report-word-export.js`. The retained extraction
service does not save report fields to `akoya_request`; its best-effort
`wmkf_ai_run` logging may be the only durable copy of historical generated output.
No prompt row, audit record, uploaded document, request field, or access grant is
deleted by the retirement.

`lib/services/grant-reporting/classify-file.js` is still imported by Workbench's
reviewer proposal loader. Its directory name is not permission to remove it.
The lookup service and shared SharePoint discovery helpers are also preserved.

## Recall Rule

Read before reusing Grant Reporting capabilities or considering data cleanup.
The capability is archived (2026-11-20); report-assessment automation will be a
fresh design in the automatic flows. Treat the preserved page and service as
reference for that design, not as code to re-home. Do not reopen standalone UI development without a
new decision. Earlier roadmap/Power Automate proposals are historical alternatives.
