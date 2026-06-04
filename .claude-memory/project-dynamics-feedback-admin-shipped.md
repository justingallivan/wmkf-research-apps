---
name: project-dynamics-feedback-admin-shipped
description: Dynamics Explorer thumbs-feedback admin surface is fully shipped — don't re-list as a P1 from stale audits.
metadata:
  type: project
  status: closed
  scope: dynamics
  last_verified: S187 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: an audit or carryover re-lists "build the dynamics_feedback admin surface" as a P1/TODO.

Do:
- Treat it as a stale-premise carryover and verify against live state before any work — the surface already shipped.
- Point to `DynamicsFeedbackSection` in `pages/admin.js` as the canonical reader.

Do not:
- Rebuild the feedback admin surface.
- Conflate `dynamics_feedback` (user-facing thumbs) with `dynamics_query_log` (operational telemetry) — a real query_log gap is net-new tooling, scoped separately.

Ground truth: `pages/api/dynamics-explorer/feedback.js`, `pages/admin.js` (`DynamicsFeedbackSection`), `dynamics_feedback` table, `FeedbackService.cleanupOldFeedback`.

The Dynamics Explorer thumbs-up/down feedback flow is end-to-end shipped:

- **Writer:** `pages/api/dynamics-explorer/feedback.js` POST (any user with dynamics-explorer access)
- **Reader:** same file's GET + PATCH (superuser-only)
- **Admin UI:** `pages/admin.js` `DynamicsFeedbackSection` (currently ~line 1645, unconditionally wired ~line 2282) with summary stats, status/type filters, expand-to-review, mark-reviewed/resolved actions
- **Storage:** `dynamics_feedback` table with status / feedback_type / category / conversation_context / admin_note / reviewed_by / reviewed_at columns
- **Retention:** `FeedbackService.cleanupOldFeedback(180)` runs in the daily maintenance cron (resolved-only after 180d)

**Why:** S186 readiness audit item #10 said "no admin page reads dynamics_feedback / dynamics_query_log; either build /admin/dynamics-feedback or remove the thumbs UI." Verified S187: the dynamics_feedback admin surface was already shipped (likely pre-audit) — the audit framing was stale. The dynamics_query_log half of the audit conflated two tables: query_log is operational telemetry written by chat.js (every query), not user-facing feedback, and not what the audit was actually asking for.

**How to apply:** If a future audit / carryover re-lists "build dynamics_feedback admin surface" as P1, treat it as a stale-premise carryover and verify against live state before doing any work. The `DynamicsFeedbackSection` in `pages/admin.js` is the canonical reader. If a real gap surfaces with `dynamics_query_log` (e.g. denied-query pattern surveillance), that is net-new operational tooling, not the audit item that already shipped — scope it separately.
