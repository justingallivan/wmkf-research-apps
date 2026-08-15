---
name: project-reviewer-reliability-data
description: "Owner goal (S369) — capture whether a reviewer is on time and reliable; terminal status and a mutable per-engagement due-date override are live, while durable deadline evidence remains a separate dispatch-ledger design."
status: active
metadata:
  node_type: memory
  type: project
  last_verified: 2026-08-15 via current source, focused tests, docs/atlas/dataverse-wmkf-appreviewersuggestion.md, and the active terminal-status/dispatch-evidence plan
  originSessionId: a7559eb5-34f5-41fd-b0cb-f1a84da8d8d0
---

## Recall Rule

Read before scoping reviewer lifecycle status, closeout, review-history display,
materials dispatch tracking, or any reviewer-quality metric. Do not add deadline
fields opportunistically to the terminal-status feature.

Owner goal (Justin, S369): WMKF wants durable evidence of reviewer quality —
whether reviewers are on time and reliable — not just participation counts.

## Current contract

- `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js and focused tests]`
  `aggregateReviewHistory()` counts received-review timestamps. Treating a dropout as
  `complete` would therefore create false positive reliability evidence.
- `[VERIFIED via lib/services/review-manager/terminal-transition-service.js,
  shared/config/reviewerStatus.js, and
  docs/atlas/dataverse-wmkf-appreviewersuggestion.md]` The terminal statuses are live:
  `withdrew` means the reviewer ended an accepted engagement and is negative reliability
  evidence; `released` means WMKF ended it and is reliability-neutral. Neither stamps a
  received/completed timestamp. The dedicated ETag path revokes the token; staff-recorded
  withdrawal also corrects response state and removes the exact linked honorarium.
- `[VERIFIED via lib/services/reviewer-due-extension.js,
  lib/external/reviewer-due-date.js, and the Atlas]` A nullable suggestion-level
  `wmkf_reviewduedateoverride` is live for accepted reviewers. Its dedicated writer and
  shared resolver feed staff display, portal, email/calendar, reminders, and token
  lifecycle. It is mutable operational state, not historical proof of what deadline was
  communicated.

## Still deferred

Durable deadline evidence is **not built**. The active design is an ordered materials-
dispatch identity that records the communicated due date and sent state, preferably
anchored to the existing Dynamics email activity; use a small append-only dispatch entity
only if that activity cannot carry the contract. The discarded expiring-HMAC/first-last
repair design cannot represent out-of-order repairs or engagement reuse.

Payability remains separate: it annotates genuinely completed reviews and does not replace
terminal engagement status.

## Boundaries

- Do not infer on-time performance from the mutable request due date or per-reviewer
  override alone.
- Do not add deadline-evidence fields opportunistically to terminal-status work.
- Keep `withdrew` and `released` distinct throughout producers, rollups, reminders, portal
  gates, and UI mappings; `check:status-enum-parity` covers only its registered maps.
- Run `/contract-reconcile` before implementing dispatch evidence: it crosses Dataverse
  schema, staff UI/API, external portal, email, cron, tokens, Atlas, and tests.

Canonical detail and dated production evidence:
`docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` and
`docs/atlas/dataverse-wmkf-appreviewersuggestion.md`.
