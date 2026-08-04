---
name: project-reviewer-find-usage-cadence-blocks-observation-windows
description: "Reviewer search runs ~twice per year (owner, 2026-08-04), so production observation windows gated on organic Reviewer Find traffic collect no data — the S397 blob-cache '~90d window gates Candidate B' sequencing is VOID."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-08-04
---

## Recall Rule
Read before proposing, or before honoring, any "soak", "observation window",
"watch production for N days", or "wait for traffic" gate on Reviewer Find or
another campaign-driven surface here. Also read when picking the next Reviewer
Find latency increment.

## The fact
WMKF staff run reviewer search **about twice per year** [owner statement,
2026-08-04 — business cadence, not derivable from code]. Reviewer Find is not a
continuously-exercised surface between campaigns.

## Why it matters
Session 397 shipped the warm-revisit proposal blob cache (Candidate A) with a
"~90 day observation window, one blob-sweep cycle" documented as gating the
Candidate B go/no-go. At twice-a-year usage there is no organic traffic in that
window: it would have produced **zero** data while blocking follow-on latency
work for a quarter. The gate read as conservative but was vacuous — the same
failure shape as [[feedback-vacuous-clean-results-print-the-denominator]],
where an empty result set was mistaken for a clean one.

## How to apply
- Never gate follow-on Reviewer Find work on elapsed calendar time or accrued
  organic traffic. Evidence for this surface comes from **deliberate** owner- or
  orchestrator-driven smokes on a chosen request.
- Passive hazard-watching may stay passive and open-ended (e.g. the blob sweep's
  delete-after-hit window, `lib/services/maintenance-service.js`, `blob_days`
  default 90) — but it must never be a **prerequisite** for the next increment.
- Before proposing any soak period on another surface here, check its real usage
  cadence first. Other campaign/seasonal surfaces (invite sends, reminder crons,
  review-form submissions) are likely to have the same problem.
- The one-increment-at-a-time, tier-gated discipline from
  [[feedback-latency-plan-scope-accretion-postmortem]] **still holds**. Only the
  wait-for-traffic gate is void; this is not license to batch increments.

Related: [[project-reviewer-find-roster]].
