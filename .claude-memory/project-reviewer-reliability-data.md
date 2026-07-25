---
name: project-reviewer-reliability-data
description: "Owner goal (S369) — capture whether a reviewer is on time and reliable; terminal status is the active prerequisite, durable deadline evidence is a separate dispatch-ledger design."
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-07-24 via production deployment, controlled smoke, terminal-transition-service, Dynamics email service, and Atlas
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
  The current feature branch changes staff-recorded `withdrew` to the full
  withdrawal contract: `accepted=false`, `declined=true`, token revoked, exact
  linked honorarium deleted, and acceptance follow-up cancelled. It is not
  production-deployed yet.
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
