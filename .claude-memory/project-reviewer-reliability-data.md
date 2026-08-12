---
name: project-reviewer-reliability-data
description: "Owner goal (S369) — capture whether a reviewer is on time and reliable; terminal status is live, a mutable per-engagement due-date override is staged, and durable deadline evidence remains a separate dispatch-ledger design."
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-08-11 via source and read-only production Dataverse for the extension gap; terminal-status baseline via 2026-07-24 production deployment and controlled smoke
  originSessionId: a7559eb5-34f5-41fd-b0cb-f1a84da8d8d0
---

## Recall Rule

Read before scoping reviewer lifecycle status, closeout, review-history display,
materials dispatch tracking, or any reviewer-quality metric. Do not add deadline
fields opportunistically to the terminal-status feature.

Owner goal (Justin, S369): WMKF wants durable evidence of reviewer quality —
whether reviewers are on time and reliable — not just participation counts.

## Verified state

- `aggregateReviewHistory()` counts
  `wmkf_appreviewersuggestion` rows with `wmkf_reviewreceivedat ne null`.
- `wmkf_accepted` supplies a denominator, but an accepted row with no received
  review cannot distinguish a dropout from work still in flight.
- Marking a dropout `complete` stamps `wmkf_reviewreceivedat`, creating a false
  successful review in future history.
- `withdrew` and `released` are live post-accept terminal statuses without
  completion/receipt timestamps. Production Dataverse was provisioned and
  verified with `withdrew=100000005` and `released=100000006`; PR #79 / merge
  `fd610837` deployed the accepted/null-status repair on 2026-07-24. A controlled
  production smoke read back `Withdrew`, token revoked, accepted preserved, and
  no received/completed timestamp. That is the historical production baseline.
  Production merge `70f51f45` superseded that behavior on 2026-07-24:
  staff-recorded `withdrew` now applies the full withdrawal contract —
  `accepted=false`, `declined=true`, token revoked, exact linked honorarium
  deleted, and acceptance follow-up cancelled.
- `wmkf_reviewduedate` is request-level mutable state, so production still lacks
  durable evidence of the deadline communicated for each materials dispatch.
- Dynamics email sending already creates a durable email activity and returns
  its `emailId`.

## Current decisions

1. **Terminal statuses remain split.**
   - `withdrew`: reviewer ended the accepted engagement; negative reliability
     evidence.
   - `released`: WMKF ended it; reliability-neutral.
2. **Ship terminal safety independently.** It stops the active false-completion
   workaround and does not depend on deadline measurement.
3. **Do not use the discarded HMAC repair design.** The expiring receipt plus
   mutable first/last fields could not represent out-of-order repairs or
   engagement reuse without additional durable identity.
4. **Design deadline evidence around ordered dispatches.** Probe whether the
   existing Dynamics email activity can carry suggestion identity, engagement
   generation, communicated due date, and sent state. If not, use a small
   append-only dispatch entity keyed to the email activity.
5. **Keep payability separate.** It annotates genuinely completed reviews and
   does not replace terminal engagement status.

## Verified per-reviewer extension gap (Session 416, 2026-08-11)

- [VERIFIED via source + read-only production Dataverse probe] Request `1002926`
  has proposal-wide `wmkf_reviewduedate=2026-09-09`; Mohammad Hafezi (the live
  reviewer row is spelled `Mohamed Hafezi`) accepted and was granted an
  individual extension to 2026-09-14. No suggestion-level due
  date exists, so the portal and acceptance/calendar surfaces retain September 9.
- Both automatic reminder flags on that request are null, which the cron treats
  as disabled (`=== true` is required). His current portal token expires
  2026-11-04, and final submission enforces token/lifecycle state rather than the
  displayed request due date. The September 14 exception is operationally safe,
  but it is tracked outside the product.
- **Implementation staged on `codex/reviewer-due-date-override` (2026-08-11):**
  [VERIFIED via branch source and focused tests] a nullable DateOnly
  `wmkf_reviewduedateoverride`, accepted-row Track Reviewers extension modal,
  dedicated `review-due-extension` writer, override-first resolver, and the
  full staff → portal/email/calendar/reminder/token consumer fan-out are
  implemented. A non-null extension must be strictly after the request's
  original deadline, with no maximum; the PD may restore the original date.
  Saving or restoring commits the date first and then automatically sends the
  confirmed reviewer a fixed-subject email with the new effective deadline,
  assigned-PD signature, and stable-UID calendar update. Notification failure
  leaves the date saved and exposes a retry that re-reads durable state. The
  admin panel owns the body default only; the Invite surface has no editor.
  Invitation response timing remains separate. A fresh re-add clears the stale
  override; past dates fail closed using the Foundation-Pacific calendar date.
  Editing alone does not rotate a live delivered token. The accepted-reviewer
  due + 90d window is intentionally retained through the Board meeting and is
  comfortably longer than ordinary roughly two-week reviewer extensions.
- **Production remains request-only:** [VERIFIED via read-only typed metadata
  2026-08-11] `wmkf_appreviewersuggestion.wmkf_reviewduedateoverride` is ABSENT
  in production. Required release order is Wave 18 schema apply/publish/exact
  verification, seed the missing `email.reviewer_extension.body` setting, then
  deliberate Tier-2 runtime promotion. No schema/settings write or runtime
  promotion has occurred from this branch.
- Do not conflate that mutable operational override with the append-only
  dispatch/deadline evidence needed for reviewer-reliability measurement. Run
  `/contract-reconcile` before implementation; this crosses Dataverse schema,
  staff UI/API, external portal, email, cron, token lifecycle, Atlas, and tests.

## Terminal-status implementation boundary

- Dedicated UI action and `/api/review-manager/terminal-transition`.
- Fresh request-ownership and lifecycle predicate.
- ETag-guarded status + token-revocation write; staff-recorded `withdrew` also
  corrects accepted/declined response state and atomically deletes the exact
  linked honorarium while `released` remains status-only.
- Adapter-level irreversibility for all status-changing callers.
- Receipt-writer guards at external submit, manual entry, mark-without-file, and
  staff/reviewer upload.
- Uploads use unique attempt folders. Every 412 loser is orphaned and never
  deleted; winner inspection is intentionally absent.
- Total UI/service/status-map coverage enforced by `check:status-enum-parity`.
- No due-date schema, repair route, or reliability metric in this slice.

Detailed contract:
`docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`.
