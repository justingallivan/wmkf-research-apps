---
title: User-Perceived Latency Baseline — Controlled Production Read Probe
domain: operations
kind: audit
status: historical
summary: "Historical partial Production probe: dependency timings for one Tracker reload, with no page latency, deployed revision, or before/after performance measurement."
canonical: false
cataloged: 2026-10-02
last_verified: 2026-10-03
owner: product-engineering
related:
  - docs/plans/USER_PERCEIVED_PERFORMANCE_PLAN_2026-10-02.md
---

# User-Perceived Latency Baseline — Controlled Production Read Probe

## Retention and interpretation — October 4, 2026

Retained as unique historical observation, not a current baseline or performance acceptance result. The original observations and limitations below are unchanged and were not independently remeasured during retention review. The later Tracker implementation record on main (`docs/plans/MEETING_TRACKER_READ_PERFORMANCE_EXECUTION_2026-10-03.md`) establishes reduced fixture call counts; it does not replace this probe with production latency measurements. Because this probe did not resolve its deployed commit, it cannot be attributed to a specific before/after implementation state.

The companion October 2 plan is now historical, with a separate disposition of completed and remaining work. Its Stage 0 reference below describes the original proposal only.

## Scope and limits

- **Live window:** 2026-10-03 03:44–03:49 UTC; four sequential browser navigations, followed by one 60-second Vercel request-log query. The live probes stopped before the authorized ten-minute limit.
- **Target:** signed-in Chrome session on `applications.wmkeck.org`; Vercel project metadata resolved `wmkf_research_apps` in the `justin-gallivans-projects` scope. The matching log records were Production, came from `applications.wmkeck.org`, and all three relevant server requests belonged to one deployment. The deployed commit was not resolved, so the local source HEAD (`fb5d39fc907f80d294a55157f81726c6671f0204`) is recorded separately and is not asserted to be the running revision.
- **Paths:** a Cycle D26/program-filtered Meeting Tracker dashboard and one already-open request in the Workbench reviewer tab. Each was opened twice, sequentially, in the existing authenticated Chrome profile. The initial direct Site Visit page was exploratory only and is excluded from results.
- **Safety:** requests were normal authenticated GET/page loads. No data edits, email, uploads, AI generation, migration, or schema change was performed. No request number, record GUID, user name, response body, or query value is retained here.

## What was observed

The Meeting Tracker dashboard rendered the selected cycle and 12 proposal rows with 12 visit links, with no visible loading or error state. The direct Workbench request resolved its request heading and showed the Reviewers tab without a visible error. These observations establish that the pages loaded with usable content for this signed-in session; they do not establish render latency.

| Path | Sequential opens | Page result | Browser/page latency |
|---|---:|---|---|
| Meeting Tracker dashboard | 2 | Selected cycle; 12 proposal rows; no visible error | Not measured |
| Workbench direct request | 2 | Request heading resolved; Reviewers tab visible; no visible error | Not measured |

The controlled navigation windows were 03:47:34.811–03:47:36.089Z and 03:48:23.445–03:48:24.184Z for Tracker; 03:48:03.863–03:48:04.348Z and 03:48:18.761–03:48:19.846Z for Workbench. These are browser-call timestamps used to search the bounded log slice, not latency estimates; only the second Tracker window matched the API records below. Tool-call elapsed time is excluded as a latency measure. Page-scope `performance` was unavailable, so browser navigation, resource, and render timings could not be captured.

## Available server evidence

One unfiltered Vercel Production request-log slice covered 03:47:30–03:48:30Z. It returned 750 request records, below the 5,000-record cap. The three matching Tracker API requests were all successful GETs from Production on the custom application domain, on one deployment:

| Server route | Requests | Status |
|---|---:|---|
| Meeting Tracker dashboard API | 2 | 200 for both |
| Meeting Tracker sessions API | 1 | 200 |

The two dashboard calls may represent initial cycle-picker hydration and selected-cycle load; this is an inference, not proven request-parameter attribution. Each parent request record contained nested `workbench.dependency` entries, though the events had no `routeName` or `correlationId`. Attribution here relies on the probe owner's inspection of the enclosing request record, not on independent route identity in the events. These durations describe individual dependency calls and are not additive route latency; parallel dependencies overlap.

| Dashboard API parent record | Dependency class | Calls | Outcome | Observed dependency-call duration range |
|---|---|---:|---|---:|
| A | Dataverse `akoya_requests` | 2 | 2 success | 113–267 ms |
| A | Dataverse `systemusers` | 1 | success | 129 ms |
| A | Dataverse `unknown` | 1 | success | 107 ms |
| B | Dataverse `akoya_requests` | 3 | 3 success | 111–167 ms |
| B | Dataverse `systemusers` | 2 | 2 success | 113–144 ms |
| B | Dataverse `unknown` | 18 | 18 success | 103–338 ms |
| B | Dataverse `wmkf_appreviewersuggestions` | 1 | success | 214 ms |

`unknown` is the telemetry resource classification; it does not establish which Dataverse entity was read. No dependency duration was found for the Workbench direct-request opening, and no `/api/workbench/resolve-request` record was present in the captured slice. The recorded `/workbench` middleware row cannot be attributed to the direct-request navigation. Thus the direct request was visually resolved, but its server request and dependency timings remain unmeasured.

## Evidence verdict and next measurement

- **Verified:** both target pages rendered usable content in the signed-in Production session; Tracker made two dashboard GETs and one sessions GET in the matched second navigation window; the two dashboard request records carried the dependency durations above, all successful.
- **Not measured:** browser page-ready latency, total dashboard route latency, the first Tracker open's matching API logs, direct Workbench route/API latency, and organic-user p50/p95. This is not a complete latency baseline.
- **Next no-runtime-change method:** capture a short Chrome DevTools Network/Performance trace while opening the two pages in the same signed-in session; retain only navigation timing, API path class, status, and duration, with identifiers, query values, headers, and bodies removed. Keep server dependency durations as a separate layer and correlate them only where the parent request record or correlation metadata proves the link.

The temporary raw Vercel log capture contained unrelated Production request metadata and has been removed after producing this privacy-safe summary. No raw browser content or identifiers were retained.

## Fresh-context evidence review

A separate Luna agent, `/root/latency_evidence_review_luna`, read this report and the target routes, dashboard service, and dependency telemetry source without making live calls or edits. It confirmed that the source supports overlapping dependency reads, not an end-to-end timer, and that the report does not establish Dataverse dominance or a refactor's latency benefit. Parent A totals 4 reported events; parent B totals 24, ranging from 103–338 ms. The reviewer checked this table's arithmetic but could not independently validate the underlying events or ranges after raw-log deletion. The no-write observation is supplied by the probe owner; route-source inspection alone cannot prove every browser action. The review required the inference and attribution qualifications above. Browser latency, total route latency, deployed source revision, and representative workload coverage remain unknown.

The relevant documentation currency, catalog, symbol-reference, build-claim, and fact-consistency gates and available self-tests passed. These check document conventions and registered claims; they do not validate the production timing aggregates. The run does not close the migration plan's Stage 0 baseline requirements.
