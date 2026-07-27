---
name: Interim grant report auto-evaluation
description: Planned automation for yearly interim-report evaluation; source plumbing exists, while the target field, prompt examples, current privileges, and build remain unverified prerequisites.
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
status: active
scope: dynamics
last_verified: 2026-07-27 via grant-reporting extraction and SharePoint-bucket source; target field and automation remain planned
---

## Recall Rule

Read this when: building backend automation to evaluate yearly interim grant reports and write results back to Dynamics.

Do:
- Reuse the bucket + Graph plumbing from `pages/api/grant-reporting/extract.js` and `lib/utils/sharepoint-buckets.js` — document discovery is already solved.
- First confirm with Connor which `akoya_request` field holds the staff evaluation (or whether a new `wmkf_ai_interim_evaluation` field is needed); get real past examples before writing the prompt.

Do not:
- Reopen the architecture solely because write access was previously granted;
  re-probe current Dynamics/SharePoint privileges as an operational preflight.
- Build a final-narrative-completeness prompt; interim eval is year-over-year progress, a thinner `compareProposalToReport`.

Ground truth: `pages/api/grant-reporting/extract.js`, `lib/utils/sharepoint-buckets.js`, `compareProposalToReport` helper; Field Set B fields deployed 2026-05-07.

# Interim grant report auto-evaluation

In addition to the final reports the Grant Reporting app currently handles, grantees submit **yearly interim reports** during multi-year grants. Today, staff read each interim report manually and write their evaluation into a field on the corresponding `akoya_request` record in Dynamics.

This is a natural fit for the same backend-automation pattern we're using for other apps:

- PowerAutomate triggers on a Dynamics status change (e.g., interim report attached / status flips to "interim received")
- Backend endpoint pulls the new report from SharePoint (via the same `getRequestSharePointBuckets` + `GraphService.listFiles` path Grant Reporting already uses)
- Claude generates the evaluation against the original proposal — likely a thinner version of the existing `compareProposalToReport` helper, focused on year-over-year progress rather than final-narrative completeness
- Result is written back to the staff evaluation field on the request record

**Why:** Same motivation as the rest of the backend-automation work — staff time on routine evaluations, consistent format, source-of-truth in Dynamics. Interim reports are higher-volume than final reports (one per year per active grant), so the automation payoff is meaningful.

**How to apply:** Build when prioritized. Dynamics write access was verified on
2026-04-14 and SharePoint write on 2026-05-01; those dated results establish
feasibility, not current authorization. Re-run the relevant read-only privilege
checks before implementation or smoke. Steps:

1. Identify (with Connor) which `akoya_request` field holds the staff evaluation today, or whether a new `wmkf_ai_interim_evaluation` field is needed. (Field Set B fields were deployed 2026-05-07; check if there's already a suitable target.)
2. Build the prompt to mirror what staff actually write — get a few real examples from past evaluations first.
3. Reuse the bucket + Graph plumbing from `pages/api/grant-reporting/extract.js` and `lib/utils/sharepoint-buckets.js`; the document discovery work is already done.
4. Expose a stateless endpoint that PowerAutomate can call (service-token auth), and a small UI in Grant Reporting for staff to preview/override before write-back.
