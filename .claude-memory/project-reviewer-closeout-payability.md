---
name: project-reviewer-closeout-payability
description: "Owner ask (S343) — add a PD \"did-their-duty / payable-or-not\" disposition to review closeout so ops has a clean signal; the accept-side guardrail for reviewer/test-case limbo."
status: active
metadata: 
  node_type: memory
  type: project
  last_verified: 2026-07-22 via reviewer-suggestion adapter, Atlas, and repo-wide payability search
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

2. **Accept-side "oops, don't pay" → annotation, NOT teardown (THIS action item).**
   Never delete the honorarium `akoya_request` (a financial record) for a bad/test
   accept. Instead, extend the **review closeout** so a PD marks payability:
   e.g. `completed_payable` / `completed_not_payable` / `did_not_serve`. Ops reads
   that flag when deciding payment.

**Why:** post-accept resets are rare and dangerous (they orphan honorarium
requests, uploaded reviews, review-answer snapshots). Payment is already manual +
offline-by-check with a human gate (see [[finance-honoraria]] wiki: "keep payment
offline by check until … separately approved and verified"), so an annotation is
sufficient — it decouples limbo/reset (data side, potential/invited) from
don't-pay (annotation, accept side) and never touches the money path.

**[VERIFIED via source/Atlas, 2026-07-22]:** no payability/did-not-serve field exists in
the adapter or Atlas; this remains unbuilt. Closeout today only writes `wmkf_reviewstatus=complete` +
`wmkf_completedat` (a binary "done" marker — no payability). This is ADDITIVE: one
new field (payability disposition or boolean) on `wmkf_appreviewersuggestion`, set
in the existing closeout UI, surfaced wherever ops views honorarium requests. Low
effort; scope as its own tiny feature separate from the reset button. Closeout
writer: `reviewStatus:'complete'` path in review-manager; field would need Atlas +
schema-as-code coverage (new durable column).
