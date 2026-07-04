---
name: project-campaign-settings-ux-revisit
description: "Owner wants campaign settings (reviewer reminder config) revisited — low prominence, and set-once defaults should carry forward without per-flow re-confirmation"
status: active
metadata: 
  node_type: memory
  type: project
  originSessionId: d94dfa1d-10af-49d9-89dc-949fad29bfe0
---

Owner note (S326, 2026-07-03): revisit the reviewer **Campaign settings** surface
(Reviewers tab → `CampaignConfigModal` → `/api/review-manager/campaign-config`,
backing columns on `akoya_request`: enable toggles + lead days + respond offset +
review due date).

Two owner-reported problems [OWNER-REPORTED, not yet source-verified]:

1. **Prominence** — the settings entry point is hard to find; PDs don't discover it.
2. **Defaults don't carry** — once a PD sets campaign config, future emails and
   flows should follow it automatically; today it appears to require re-confirming
   the settings each time. Desired behavior: set-once, applies to subsequent
   sends/flows on that request (and possibly as a PD-level default for new
   requests) unless the PD deliberately changes it.

Before building: verify claim 2 against the actual send flows (which flows re-ask,
what "confirmed every time" concretely means in `send-emails.js` /
`ReviewerManagePanel` / invite paths), then scope whether the fix is UI-only or
needs a PD-level default store. Related planned work: the Reviews tab build-out
([[project-reviewer-hold-step-decouple]] domain; plan doc
`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` Phase 1 touches the reminder
machinery but NOT campaign settings — keep the two scopes separate).
