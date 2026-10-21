---
name: feedback-owner-review-burden-must-shrink
description: "Owner, S623 (2026-10-20): Stage B co-PI backfill grew from 'build a resolve' to 58 people to verify by hand — more owner work than the backfill had cost so far. Before handing over any review list, count it against the owner's effort to date; if it grows, stop and re-scope instead of adding checks."
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read before producing any owner review/approval workbook or list, and at `/start` when resuming the Research Institution at Award backfill.

Do: state the count of rows the owner must judge by hand and compare it with the previous hand-off; group strong-evidence rows into single decisions (as Stage A did); when a fix or a review round adds rows to the owner's list, present that as a scope choice (drop the row type, defer it, or accept the cost) before building it.
Do not: hand over a row-by-row file and fix the format afterwards; answer each owner correction with another check that feeds more rows back to the owner; keep shipping review-hardening rounds while the owner's own burden grows.
Ground truth: the owner's words in S623; `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` §3.2.

**Why:** in S623 the first workbook asked for ~200 per-row answers ("that's worse than before"); regrouping still left 58 individual checks, and each owner correction (Billinge moved, Diaz is a liaison) added a new rule and new review rows. Owner: "I can't deal with this anymore … this seems to be mushrooming. We're now verifying 58 people by hand which is a larger task than what we've done thus far." Same pattern as [[feedback-anchor-multisession-features-to-the-original-ask]] and [[feedback-latency-plan-scope-accretion-postmortem]].

**How to apply:** for this backfill, re-scoped 2026-10-21: the owner approves strong-evidence groups only, and a staff member works every individual-check row in AkoyaGO through `scripts/build-research-copi-staff-workbook.mjs`; the agent applies the answers. Do not route staff-workbook rows back to the owner one by one.
