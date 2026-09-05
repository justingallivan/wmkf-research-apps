---
name: project-reviewer-closeout-payability
description: "Approved direction — PD reviewer closeout records eligible/not eligible/not applicable on the engagement; Operations/Finance retains final remit authority."
status: active
metadata: 
  node_type: memory
  type: project
  last_verified: 2026-09-04 via owner decisions, source build/tests, Production metadata/runtime select, and honorarium/request flag probes
  originSessionId: 4eb6d1fe-c277-43b8-977b-92cc18644286
---

## Recall Rule

Read when scoping reviewer reset/closeout or an Ops payment signal. Keep the
pre-accept reset and post-accept payability annotation separate; never delete a
financial honorarium request as a reset mechanism.

Owner-endorsed direction (Justin, S343, 2026-07-07). Two-part framing for the
"reviewer/test-case gets promoted to a state we can't undo" problem:

1. **Potential/invited limbo → data reset ("back to square one").** Lower-effort
   companion piece (proposed, not yet greenlit): a "Reset reviewer" action that
   clears the full engagement stamp set (the S343 `ENGAGEMENT_STAMP_RESET`),
   revokes the token, and either keeps the row as a fresh candidate or removes it
   via `hardDeleteById`. Primitives already exist. See [[project-reviewer-closed-work-archive]]
   context in [[reviewer-workbench-lifecycle]] wiki.

2. **Accept-side "oops, don't pay" → annotation, NOT teardown (APPROVED and
   source-built; deployment pending).**
   Never delete the honorarium `akoya_request` (a financial record) for a bad/test
   accept. Instead, extend the **review closeout** so a PD marks payability.
   **SUPERSEDED IN PART (owner, S369, 2026-07-22):** `did_not_serve` is NOT a
   payability value — it is the missing terminal *status*, split into
   `withdrew` (reviewer bailed) vs `released` (PD stood them down). Eligibility
   therefore belongs only to the received-review closeout path. See
   [[project-reviewer-reliability-data]]. Operations/Finance consumes the
   closeout disposition separately when deciding payment.

**Why:** post-accept resets are rare and dangerous (they orphan honorarium
requests, uploaded reviews, review-answer snapshots). Payment is already manual +
offline-by-check with a human gate (see [[finance-honoraria]] wiki: "keep payment
offline by check until … separately approved and verified"), so an annotation is
sufficient — it decouples limbo/reset (data side, potential/invited) from
don't-pay (annotation, accept side) and never touches the money path.

**[OWNER DECISION 2026-09-04]:** Complete means the lead PD evaluated and closed
a received review. The same one-row, ETag-bound action records `eligible`,
`not_eligible`, or `not_applicable` on `wmkf_appreviewersuggestion`. Null means
no disposition recorded. The thank-you remains a receipt acknowledgement and
must not set Complete. No closeout path writes
`akoya_request.wmkf_authorizationtoremitpaymentflag`; Operations/Finance retains
that separate final authority.

For a linked honorarium where the reviewer did not opt out, the UI asks only
**Should an honorarium be paid?** and maps Yes/No to `eligible`/`not_eligible`.
No requires a nonblank request-scoped note in the UI, route, and service. If the
reviewer opted out or no honorarium is linked, the UI skips the question and
records `not_applicable`; notes remain optional.

**[VERIFIED via read-only Production metadata/runtime `$select` 2026-09-04]:**
the manually created local Picklist `wmkf_honorariumeligibility` is
published/readable, nullable, has no default, and has exact values
`100000000..100000002`. The tracked source preflight reports one divergence:
the live description lacks the explicit Operations/Finance-authority warning.
All 159 exact honorarium requests had the separate authorization flag
explicitly false, while a broader Research-request scan found 87 true values;
the field is live elsewhere but is not the reviewer-closeout signal.

Implementation contract:
`docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md`. The app route/UI
and thank-you decoupling are source-built on
`codex/reviewer-closeout-eligibility-app`; deployment is pending. Operations has
built the AkoyaGO system view but has not surfaced it. The owner accepted that
interface step as a later follow-up; never compensate by writing the final remit
flag.
