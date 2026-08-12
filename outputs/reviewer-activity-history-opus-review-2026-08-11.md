# Claude Opus adversarial review: reviewer activity-history drawer

**Date:** 2026-08-11  
**Mode:** read-only review of `main` at `d4cd8061`  
**Artifact status:** recovered from Claude's persisted plan after the background
daemon stopped. Claude completed the substantive review, but the job remained at
the plan-approval boundary; it made no repository edits, commits, live writes, or
deployments.

## Verdict

The product intent is sound, but the proposed append-only Dataverse activity
entity is premature and more expensive than the first useful increment requires.
Ship a clearly labeled history drawer derived from current reviewer fields first.
Probe Dynamics email activity and settle the evidence/retention requirements
before designing an exact ledger.

## Ranked findings

### Blocking

1. **Email opens have no implemented source.** `wmkf_emailopenedat` has no live
   writer. The only real engagement signal is portal first access,
   `wmkf_proposalfirstaccessed`, stamped in
   `lib/services/external-review/context-service.js:88-92` through
   `lib/dataverse/adapters/reviewer-suggestion.js:1240`. Drop "email opened" or
   label this event "Portal first accessed."

2. **The proposal skips an existing owner gate.**
   `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md:189-216` first requires a
   read-only metadata/source probe of Dynamics email activity. Its preferred
   order is to extend/query the existing email activity, then fall back to a
   small append-only dispatch entity keyed to that activity. Any new plan must
   explicitly align with or supersede that decision and receive owner review.

3. **Engagement generation does not exist and cannot be reconstructed.**
   `ENGAGEMENT_STAMP_RESET_ENTRIES` in
   `lib/dataverse/adapters/reviewer-suggestion.js:793-813` clears lifecycle
   stamps when a reviewer is removed and re-added. Legacy generations are
   already lossy. If an exact ledger is later built, generation must first
   become durable suggestion state and increment in the same ETag-guarded write
   as the reset; a generation column on activity rows alone is insufficient.

4. **Several timestamps mean "claimed," not "sent."** Reminder and thank-you
   sweeps claim before dispatch and do not roll back on send failure
   (`lib/services/reviewer-reminder-sweep.js:261-317`,
   `lib/services/reviewer-thankyou-sweep.js:86-139`). Extension saves can land
   while notification fails (`lib/services/reviewer-due-extension.js:296-317`),
   and invitation dispatch can be `unconfirmed`
   (`lib/services/review-manager/send-emails-service.js:747-800`). Derived rows
   must say "recorded" or "delivery unconfirmed," not assert "sent." An exact
   result vocabulary needs at least `claimed`, `sent`, `send_failed`,
   `unconfirmed`, and `recorded_no_send`.

### Serious

5. **Email activity IDs are not generally captured.** Of the five reviewer
   email paths, only `send-emails-service.js` captures the `emailId` returned by
   `createAndSendEmail`. Extension, reminder, thank-you, and sufficient-review
   withdrawal sends currently discard it.

6. **Current email activities regard the request, not the reviewer suggestion.**
   Reviewer sends pass `regardingType: 'akoya_request'`; per-reviewer lookup would
   otherwise rely on the recipient address, which is fragile. This makes the
   required probe material and may favor a row carrying both suggestion and
   email-activity references.

7. **The substrate choice is unresolved.** Native Dataverse field audit already
   captures suggestion field changes with actor and before/after values. The
   repository also has Postgres append-only audit precedents, notably
   `policy_publish_audit`, with intent-before-mutation and outcome-after patterns.
   Dataverse offers CRM visibility and shared retention but requires a schema
   wave, registry work, an adapter, an Atlas page, and runtime round trips.
   Postgres is cheaper but creates a second system of record. This is an owner
   tradeoff, not an implementation default.

8. **An idempotency key needs enforcement and event-specific semantics.** In
   Dataverse, it must be an alternate key with duplicate-key handling. Reminder
   duplicates may be bugs, while each extension resend is a real attempt and
   must remain visible.

9. **Ledger failure behavior is undefined.** A blocking ledger adds a new send
   failure mode; a best-effort ledger lies by omission. If an exact ledger is
   required, use a two-phase intent/outcome model and represent "ledger
   unavailable" explicitly.

10. **A future route needs request binding and a security-matrix entry.** Require
    both `requestId` and `suggestionId`, then verify server-side that the
    suggestion belongs to the request. Decide whether all staff who can access
    the request may see actor identity, recipient details, and send failures.

### Moderate

11. **Do not materialize a legacy backfill.** Re-added rows have lost prior
    generation stamps, and some existing stamps overstate dispatch success.
    Compute legacy history at read time, label it derived from current record
    state, and visually separate it from any future exact ledger.

12. **Current Last Action is not chronological.** At
    `shared/components/reviewers/ReviewerManagePanel.js:1793`, it uses
    `thankyouSentAt || reviewReceivedAt || reminderSentAt || materialsSentAt`.
    That is fixed precedence, not a maximum timestamp. Replacing it with true
    recency is a deliberate behavior change.

13. **No shared accessible drawer primitive exists.** The drawer needs focus
    trapping, Escape close, focus restoration, an accessible label, async-load
    announcement, and an explicit stale-state policy. Existing row refreshes do
    not refresh an already-open drawer.

14. **Keeping Notes separate is correct.** Notes are a mutable memo, not event
    evidence. Separately, the current notes save path does not check `resp.ok`;
    that is adjacent but out of scope unless the drawer surfaces notes.

15. **Testing and release must be discriminating.** Required tests include:
    claimed-but-failed reminder wording, generation reset isolation,
    suggestion/request authorization, distinct extension resend attempts, and
    accessible drawer behavior. Runtime/schema work belongs on a feature branch
    with deliberate promotion.

## Revised recommended plan

### Phase 0 — Probe and decide

Run the existing read-only Dynamics email-activity metadata/source probe. Decide
whether the feature is operational convenience or evidence that could feed
reviewer-reliability/payability decisions. Then choose the substrate and
reconcile the existing due-date plan.

### Phase 1 — Derived drawer, no schema and no new route

Replace Last Action with an accessible drawer computed from the reviewer DTO.
The projection already carries materials, reminders, review receipt, thank-you,
due-date override, effective deadline, token state, portal first access, status,
and response type. Add only the missing existing fields needed for invitation,
response, and pre-response reminder milestones. Label all entries as derived
from current record state and use evidence-safe wording. Do not backfill. Decide
whether the replacement summary preserves fixed precedence or uses true
recency, and close or refresh the drawer after row mutations.

### Phase 2 — Exact ledger, only if Phase 0 justifies it

First add durable engagement generation. Capture Dynamics email IDs at all
reviewer send sites. Use two-phase intent/outcome records, event-specific dedup,
and the full result vocabulary. Instrument in evidentiary-value order: deadline
change and extension notification, invitation, materials, reminders, review
receipt, thank-you, and terminal transition. Do not add email-open tracking and
do not materialize legacy events.

### Phase 3 — Lazy-load route only if volume warrants it

Add a secured route only when ledger size makes inline projection impractical.
Bind `suggestionId` to `requestId` server-side and add the route to
`docs/API_ROUTE_SECURITY_MATRIX.md`.

## Product decisions required before exact-ledger implementation

1. Dataverse, Postgres, or extended Dynamics email activity after the probe?
2. Align with or supersede the existing dispatch-evidence plan?
3. Operational convenience only, or immutable evidence for later scoring?
4. Drop "email opened" or rename the existing signal "Portal first accessed"?
5. Replace Last Action entirely, and use fixed precedence or true recency?
6. Confirm no materialized backfill.
7. Blocking, two-phase ledger writes or a consciously weaker best-effort log?
8. Which staff may see actor identity and delivery details?
