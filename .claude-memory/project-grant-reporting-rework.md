---
name: Grant Reporting capability preservation
description: Standalone Grant Reporting retirement; preserve assessment, editing, export, prompts, services, and historical data for a future home.
type: project
status: active
scope: strategy
last_verified: 2026-11-19 via owner retirement decision and preservation inventory
---

# Grant Reporting — retirement and capability preservation

[VERIFIED — owner direction, 2026-11-19] Retire the standalone Grant Reporting
application while preserving its useful capabilities. This advances the October 21
request to integrate those capabilities elsewhere; it does not choose their new home.

The source change is described in `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md`:
the page becomes a retirement notice and its APIs become authenticated HTTP 410
responses. Original page/API implementations are retained under `_archived/`.
Deployment and live acceptance are separate verification steps.

Preserve the archived page's proposal-versus-report assessment editor, extracted
fields, staff edits, regeneration modes, and Word export. Preserve
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
Choose the new destination and persistence contract with the owner before building
an integration. Do not reconstruct the assessment/editing flow from memory: use
the preserved page and service. Do not reopen standalone UI development without a
new decision. Earlier roadmap/Power Automate proposals are historical alternatives.
