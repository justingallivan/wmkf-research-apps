---
title: Workbench Observability Stage 1 — Production Preflight and Before-Baseline
domain: architecture
kind: audit
status: active
summary: "Production promotion evidence, Vercel JSON-shape correction, and the non-identifying controlled GET-only before-baseline for Workbench Stage 1."
canonical: false
cataloged: 2026-08-15
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md
---

# Workbench Observability Stage 1 — Production Preflight and Before-Baseline

## Promotion and scope

- **Deployment:** `main` merge `30ed5fe02a8effd0a447a980c1b3070c68bac0f9`, Vercel deployment
  `dpl_AEHShYKKSb4WxeuxkUZgMRbLp3kB`, READY in Production at 2026-08-16 00:53:40Z.
- **Domain check:** the authenticated custom application domain resolved to that exact deployment
  and project `[VERIFIED via Vercel alias API]`.
- **Smoke:** a signed-in staff session loaded the Workbench dashboard and existing-request detail,
  Find, and Track views. Only navigation and GET/read behavior were exercised. No PATCH, DELETE,
  dismiss, merge, send, selection, status change, or other production mutation was performed.
- **Scope:** this is the Stage 1 before-baseline and opening preflight, not itself the later Stage 2
  authorization and not evidence of organic-user latency. The subsequent owner decision is recorded
  below.

No request number, Dataverse GUID, reviewer/applicant name, email, filename, response body, URL
query, or other business identifier is retained in this report.

## Production log-shape finding and correction

The unfiltered Production preflight falsified the plan's assumed extraction path:

- Each `vercel logs --json` line is a **request record** with a `.logs[]` array of child console
  lines.
- The record's top-level `.message` duplicates only one child log; it is not a complete rendering
  of all console output for the request.
- In the first complete bounded slice set, top-level `.message` found **14** telemetry events while
  flattening `.logs[]` found **116**. All 116 passed the full v1 validator and had 116 unique
  `eventId`s.

The plan's filter of record now flattens `.logs[]`, validates each discriminator-bearing child
message fail-closed, retains only safe record metadata plus the validated event, and deduplicates
only on `eventId`. The unfiltered RAW capture is a restricted transient artifact because it can
contain unrelated application logs; it is deleted after validation or on validation failure.

A broad six-minute unfiltered query reached the explicit 5,000-record limit and was rejected as
truncated. Two-minute unfiltered slices over the controlled activity returned below the limit and
were accepted. Across the two bounded slice sets used here: 144 Vercel request records contained
294 validated nested telemetry lines; overlap-safe `eventId` dedup produced **293 unique events**.

## Controlled fixture coverage

The labels below deliberately contain no business identity. Each row represents one signed-in
page-load sequence against an existing request. All **39 correlated target-route dependency
events** reported `success`; the UI returned usable target views.

| Fixture stratum | `/reviewers` person reads | `/my-candidates` person reads | `/decline-referrals` person reads | Target events | Result |
|---|---:|---:|---:|---:|---|
| Small/typical saved set | 2 | 2 | 0 | 15 | Target reads successful |
| Empty person-id sets | 0 | 0 | 0 | 9 | Empty short-circuits observed; target reads successful |
| Active + removed + decline-referral sets | 2 | 4 | 1 | 15 | Target reads successful |
| More than 25 ids in one set | unavailable | unavailable | unavailable | — | Recorded unavailable; no production state manufactured |

`person reads` above means events with `dependency == 'dataverse'` and
`resourceClass == 'wmkf_potentialreviewerses'`. The counts match the current chunk-aware formula:
two reads per nonempty reviewer/active/removed set and one unchanged read per nonempty decline set.
The combined fixture's four candidate reads are the separate active and removed pairs; they are not
an accidental retry.

One separate non-target document/applicant-review load displayed a fetch warning during the empty
fixture. The three target routes still completed successfully, while the same surrounding page
activity emitted uncorrelated Graph `drive-item` 4xx events. This is recorded for Track A
classification and is not attributed to Stage 1 or silently counted as a target-route failure.

## Controlled latency descriptors for the Stage 2 numerator

These values describe dependency calls in three deliberate production page loads. They are not an
organic latency sample and must not be quoted as staff-experience p50/p95.

| Fixture | Route | Calls | p50 ms | p95 ms | Outcome |
|---|---|---:|---:|---:|---|
| Small/typical | `/api/review-manager/reviewers` | 2 | 94 | 321 | success |
| Small/typical | `/api/reviewer-finder/my-candidates` | 2 | 95 | 110 | success |
| Empty person-id sets | all target routes | 0 | — | — | short-circuit |
| Active + removed + decline | `/api/review-manager/reviewers` | 2 | 128 | 314 | success |
| Active + removed + decline | `/api/reviewer-finder/my-candidates` | 4 | 95 | 115 | success |
| Active + removed + decline | `/api/workbench/decline-referrals` | 1 | 99 | 99 | success |

Percentiles use nearest-rank over the individual dependency calls. With these intentionally tiny
cells, call count is the decision-useful baseline; the latency figures are descriptive only.

## Track A retention and next checks

Live probes at window start verified:

- Vercel team plan: **Pro**.
- Observability Plus: **not enabled**.
- Log Drains: **none configured**.
- [Current official Vercel runtime-log retention](https://vercel.com/docs/logs/runtime) for base
  Pro: **one day**.

Therefore the 48-hour safety window cannot be evaluated by waiting until hour 48 and querying once.
Complete unfiltered slices must be exported at least daily; 12-hour slices are the operating target.
Track A remains open until 2026-08-18 00:53:40Z and measures validated telemetry events/day,
malformed events, extraction truncation, unexpected classifications/outcomes, and visible log cost.
The ~50,000 telemetry-events/day stop/re-scope threshold remains in force.

The owner authorized Stage 2 after reviewing this controlled baseline. Track A remains open in
parallel and is not a calendar or organic-traffic prerequisite; an actual named stop condition still
pauses further rollout work. Stage 2 was subsequently merged to `main` at `06a615fc` and its first
Production deployment, `dpl_8wHbRErjdbaaqLtKNSfqHo8TUV3B`, reached READY at
2026-08-16 03:01:20Z. The Stage 2 after-baseline then passed on
`dpl_3BU1Zstkn1ZhEhabfvNE5MFNpdpq`; its non-identifying evidence, extraction record, formula
comparison, and exact-request-identity limitation are in
`docs/audits/workbench-read-coalescing-stage2-production-after-baseline-2026-08-15.md`.

## Evidence verdict

- Promotion/deployment claim: **VERIFIED**.
- Exact custom-domain deployment claim: **VERIFIED**.
- Runtime event contract on bounded Production slices: **VERIFIED** (293 unique events; validator
  accepted all discriminator-bearing nested lines).
- Three target-route before-baseline contracts: **VERIFIED** for the three available strata above.
- More-than-25-id fixture: **UNKNOWN / unavailable without manufacturing state**.
- 48-hour whole-app volume and cost posture: **OPEN** pending Track A completion.
- Stage 2 state: **PRODUCTION-LIVE; CONTROLLED AFTER-BASELINE PASSED** — the source-certain
  call-count reduction is verified across the available structural strata; Track A remains an
  independent concurrent safety watch unless a named stop condition fires.
