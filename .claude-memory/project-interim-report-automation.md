---
name: Interim grant report auto-evaluation
description: Interim-report evaluation concept with reusable extraction plumbing; destination and implementation scope are undecided pending product-direction review
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
status: active
scope: dynamics
last_verified: 2026-10-22
---

**Verification scope:** owner direction recorded 2026-10-21 was read alongside the current source pointers on 2026-10-22. No privilege or live SharePoint probe was run.

## Recall Rule

Read this when: revisiting whether and where to automate yearly interim-report evaluation after the Grant Reporting product direction is decided.

Do:
- Reuse the bucket + Graph plumbing from `pages/api/grant-reporting/extract.js` and `lib/utils/sharepoint-buckets.js` if the owner selects this capability for implementation. The proposal-versus-report evaluation purpose and reusable document-discovery plumbing remain useful.
- First confirm with Connor which `akoya_request` field holds the staff evaluation (or whether a new `wmkf_ai_interim_evaluation` field is needed); get real past examples before writing the prompt.
- Read `.claude-memory/project-grant-reporting-rework.md` before choosing a destination, scope, or timeline: the 2026-10-21 owner direction leaves those undecided and supersedes this older plan's fixed Grant Reporting UI and Power Automate endpoint proposal.

Do not:
- Treat the older small-UI plus PA-callable endpoint proposal below as an approved destination or build order. It is historical planning pending the owner direction review.
- Reopen architecture solely because old write-access checks passed; they were dated results, not current privilege evidence.
- Build a final-narrative-completeness prompt; the proposed evaluation purpose is year-over-year progress, a thinner `compareProposalToReport`.

Ground truth: owner direction in `.claude-memory/project-grant-reporting-rework.md`; reusable plumbing in `pages/api/grant-reporting/extract.js`, `lib/utils/sharepoint-buckets.js`, and `compareProposalToReport`; Field Set B fields deployed 2026-05-07. This memory does not establish the destination, prompt input contract, or current access.

# Interim grant report auto-evaluation

In addition to the final reports the Grant Reporting app currently handles, grantees submit **yearly interim reports** during multi-year grants. Today, staff read each interim report manually and write their evaluation into a field on the corresponding `akoya_request` record in Dynamics.

This older proposal suggested the following implementation path. It is retained as a dated design idea, not current direction:

- PowerAutomate triggers on a Dynamics status change (e.g., interim report attached / status flips to "interim received")
- Backend endpoint pulls the new report from SharePoint (via the same `getRequestSharePointBuckets` + `GraphService.listFiles` path Grant Reporting already uses)
- Claude generates the evaluation against the original proposal — likely a thinner version of the existing `compareProposalToReport` helper, focused on year-over-year progress rather than final-narrative completeness
- Result is written back to the staff evaluation field on the request record

**Why:** Same motivation as the rest of the backend-automation work — staff time on routine evaluations, consistent format, source-of-truth in Dynamics. Interim reports are higher-volume than final reports (one per year per active grant), so the automation payoff is meaningful.

**Historical prerequisites and proposal (2026-07-27):** Dynamics write access was verified on
2026-04-14 and SharePoint write on 2026-05-01; those dated results establish
feasibility, not current authorization. Re-run the relevant read-only privilege
checks before implementation or smoke. Steps:

1. Identify (with Connor) which `akoya_request` field holds the staff evaluation today, or whether a new `wmkf_ai_interim_evaluation` field is needed. (Field Set B fields were deployed 2026-05-07; check if there's already a suitable target.)
2. Build the prompt to mirror what staff actually write — get a few real examples from past evaluations first.
3. Reuse the bucket + Graph plumbing from `pages/api/grant-reporting/extract.js` and `lib/utils/sharepoint-buckets.js`; the document discovery work is already done.
4. The old proposal selected a stateless Power Automate-callable endpoint (service-token auth) and a small Grant Reporting UI for staff preview/override. Revisit this destination only after the owner selects the future home and scope.
