---
title: Reviewer Completion and Honorarium Decision Brief
domain: reviewer-workbench
kind: decision
status: draft
summary: "Discussion brief separating review receipt, automated thank-you processing, PD review approval, honorarium eligibility, and final authorization to remit."
canonical: false
cataloged: 2026-09-03
owner: product-engineering
related:
  - docs/REQUEST_WORKBENCH_SCOPING.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/agent-wiki/topics/finance-honoraria.md
  - .claude-memory/project-reviewer-closeout-payability.md
---

# Reviewer Completion and Honorarium Decision Brief

## Purpose

This document preserves the open product discussion about what **Review
Received**, **Thanked**, and **Complete** should mean when a Program Director's
review approval may also make a reviewer eligible for an honorarium. It is a
discussion brief, not an approved implementation plan.

The immediate conclusion is that the automated thank-you cron should **not** be
changed to mark reviewers Complete until the human approval and payment-control
semantics are settled.

## Verified Current State

### Review receipt

- [VERIFIED via `lib/services/reviewer-thankyou-sweep.js:137-142`] The automated
  thank-you sweep treats `wmkf_reviewreceivedat` as the durable signal that a
  review was received.
- [VERIFIED via `lib/services/review-receipt-guard.js:32-44`] Current receipt
  writers accept only an active, accepted, nonterminal engagement that does not
  already have a receipt, and bind the write to the authorizing row ETag.
- [VERIFIED via `docs/REQUEST_WORKBENCH_SCOPING.md:119-121`] The historical
  Workbench design treated a returned review as awaiting a separate PD closeout.

### Automated thank-you

- [VERIFIED via `lib/services/reviewer-thankyou-sweep.js:83-125`] The cron builds
  the courtesy attachment, claims `wmkf_thankyousentat` with an ETag-conditional
  write, and then sends the email. It deliberately does not roll the marker back
  or retry after a post-claim send failure.
- [VERIFIED via `lib/services/reviewer-thankyou-sweep.js:83-93`] The automated
  path currently writes only the thank-you marker. It does not set
  `wmkf_reviewstatus=complete` or `wmkf_completedat`.
- [VERIFIED via `lib/services/review-manager/send-emails-service.js:910-947`]
  The retained manual compatibility path differs: after a successful thank-you
  send, it marks a nonterminal reviewer Complete.

This explains the observed Production behavior: reviewers whose reviews were
received and whose automated thank-you was processed generally remain **Review
Received** in the Track Reviewers table.

### Complete / PD closeout

- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1764-1886`] A
  transition to `reviewStatus='complete'` writes the Complete picklist value and
  idempotently stamps `wmkf_completedat`; if the receipt stamp is empty, the
  helper also supplies it.
- [VERIFIED via
  `lib/dataverse/schema/wave5/01_wmkf_appreviewersuggestion_workbench.json`] The
  field was introduced for “PD has read the review and is done paying attention”
  semantics.
- [VERIFIED via `docs/REQUEST_WORKBENCH_SCOPING.md:119-120`] The historical UI
  design described Complete as the PD reading the returned review and marking it
  complete, not merely an email event.

### Honorarium creation and payment control

- [VERIFIED via `.claude-memory/project-honorarium-payment-landscape.md`] For a
  reviewer who accepts and does not opt out, the portal can create a linked
  honorarium `akoya_request`; request creation is not proof of payment.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:2109-2115`] The
  per-request reviewer engagement stores the link to that honorarium through
  `wmkf_HonorariumRequest`.
- [VERIFIED via repository-wide source search, 2026-09-03]
  `wmkf_authorizationtoremitpaymentflag` has no application writer. Current app
  source does not automatically authorize remittance when a review becomes
  Complete.
- [VERIFIED via `.claude-memory/project-reviewer-closeout-payability.md`] A later
  product direction proposed a PD-entered payability disposition at review
  closeout while retaining a separate Operations payment gate, but that field
  and workflow remain unbuilt.

## Why the Proposed Cron Change Is Unsafe as Written

The reviewed prompt at
`outputs/codex-prompt-2026-09-03-reviewer-complete-status.md` assumed that
“review received and reviewer thanked” and “Complete” were the same real-world
state. The PD-approval scenario shows they are not necessarily the same:

1. a reviewer submits a review;
2. the automated system sends or attempts the thank-you;
3. a PD reads the review and decides whether it satisfactorily fulfills the
   engagement;
4. that human decision may establish honorarium eligibility;
5. Operations or Finance separately authorizes and processes remittance.

Marking Complete during the cron's pre-send claim would bypass step 3. It could
also mark a review Complete even when the subsequent email send fails. Existing
automatically thanked rows should therefore not be bulk-changed to Complete
until the meaning of Complete is approved.

## Recommended Lifecycle Model for Discussion

| Event | Suggested authority | Existing durable evidence | Meaning |
| --- | --- | --- | --- |
| Review received | Reviewer portal or authorized staff receipt path | `wmkf_reviewreceivedat`; status `review_received` | The review exists and can be evaluated. |
| Thank-you processed | Automated thank-you sweep | `wmkf_thankyousentat` | The at-most-once thank-you workflow was claimed; History remains honest that delivery may not be provable. |
| Review approved / engagement complete | Program Director | `wmkf_reviewstatus=complete`; `wmkf_completedat` | The PD reviewed and accepted the work. |
| Honorarium eligibility | Program Director | **Unbuilt; decision required** | The completed review qualifies the reviewer for an honorarium. |
| Authorization to remit | Operations/Finance | Honorarium request's `wmkf_authorizationtoremitpaymentflag` | The separate financial control permits payment processing. |

This model keeps communication, programmatic review approval, and financial
authorization separate. It also explains why a reviewer can legitimately be
both **Review Received** and **Thanked** while still awaiting PD approval.

## Recommended Direction

1. Proceed with the presentation-only change that gives the existing Complete
   badge a deeper success green.
2. Do **not** make the thank-you cron set Complete.
3. Preserve or clarify an explicit PD action such as **Approve review / Mark
   Complete**.
4. When a linked honorarium exists and the reviewer did not opt out, have that PD
   action record honorarium **eligibility**.
5. Preserve a distinct Operations/Finance authorization-to-remit step unless the
   owner explicitly decides that the PD should control the final remit flag.
6. For an opt-out reviewer or a reviewer with no linked honorarium, the PD should
   still be able to approve the review and mark the engagement Complete without
   a financial write.
7. Do not backfill existing Review Received rows merely because a thank-you
   marker exists; those rows may still be waiting for the human approval step.

## Decisions for the Next Session

### 1. What exactly does the PD approve?

Recommended answer: the PD confirms that the returned review satisfactorily
fulfilled the engagement. That action sets Complete and its timestamp.

### 2. Does PD approval establish eligibility or final payment authorization?

Recommended answer: it establishes eligibility through a dedicated reviewer-
engagement payability value. Operations/Finance retains the final
`wmkf_authorizationtoremitpaymentflag` control on the linked honorarium request.

Alternative: the PD action directly sets the authorization-to-remit flag. This
is simpler but merges program approval with a final financial control and should
be adopted only as an explicit owner/Operations decision.

### 3. What dispositions are required?

At minimum, decide whether the PD needs more than a positive approval:

- **Eligible / approved** — satisfactory review; Complete.
- **Not eligible** — review was received but should not be paid.
- **Not applicable** — reviewer opted out or no honorarium exists.

The existing `withdrew` and `released` terminal statuses describe engagements
that ended before a satisfactory review; they should not be repurposed as
post-review payment decisions.

### 4. Should the thank-you wait for PD approval?

Current behavior sends the thank-you after receipt, before PD approval.
Recommended answer: keep that timing unless staff want the message itself to
communicate acceptance of the review. The thank-you and approval records should
remain independent either way.

### 5. How should existing rows be handled?

Recommended answer: do not infer PD approval from `wmkf_thankyousentat`. After
the final model is approved, survey current-cycle rows and expose the PD approval
action for those still at Review Received. Any automated repair must use the
approved human-decision evidence rather than the email marker alone.

## Likely Implementation Shape After Approval

This is deliberately not yet a build plan. A later plan should trace:

1. Track Reviewers PD action and server authorization;
2. the reviewer-suggestion Complete transition and ETag behavior;
3. the linked honorarium request lookup;
4. the chosen eligibility persistence field;
5. whether and where the final remit flag is written;
6. partial success across the reviewer and honorarium records;
7. opt-out, missing-link, terminal, duplicate-click, and concurrency behavior;
8. downstream Operations visibility, Atlas/schema work, tests, and durable-doc
   reconciliation.

Until that contract is approved, the original reviewer-Complete prompt should
be treated as **NEEDS REWORK**, with only its badge-color portion safe to retain.
