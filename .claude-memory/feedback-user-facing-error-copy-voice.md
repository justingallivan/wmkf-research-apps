---
name: feedback-user-facing-error-copy-voice
description: "User-facing transient-failure copy blames the system in plain language, never questions the user's access/permissions, and gives an action ladder (retry → contact an administrator); the owner may set copy verbatim — implement it unedited."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: 254e35a3-23a1-4b23-8afb-d16003287fac
  modified: 2026-08-06T19:24:58.175Z
---

## Recall Rule

Read this when writing or rewording any user-facing error message, banner, or
guard response — especially for transient/system failures (5xx, lookups,
timeouts).

`[VERIFIED via lib/utils/auth.js and
tests/unit/invite-preview-error-retry.test.js, 2026-08-15]` The owner-set 503
copy remains the live `requireAppAccess` response and the retry surfaces preserve
the same system-blame/action-ladder contract.

## What happened (S404, 2026-08-06)

The shared 503 from `requireAppAccess` read "Unable to verify application
access; please retry". It took THREE rounds of owner correction to land:

1. "Which application?" — 'application' reads as a GRANT application at a
   grants foundation; jargon collided with domain vocabulary.
2. "Permissions to what?" — naming whose permissions without naming the object
   still begged the question.
3. "But she is in the Reviewers app!" — the fatal flaw: every draft implied
   the USER's access was in doubt, when the failure was the server's own
   Dataverse query. A user already inside the app reads "your access" wording
   as nonsense or as an account problem.

The owner then set the copy verbatim: "I'm having trouble accessing the
server. This is usually a temporary blip. Please press retry and if the
problem doesn't resolve, contact an administrator."

**Why:** error copy is read by a non-technical person mid-task. What matters
to them: whose fault (the system's), is my work lost (say if not), what do I
do (retry), what if that fails (escalation path). Accuracy about internal
mechanisms (grants, lookups, apps) is beside the point and actively misleads.

**How to apply:**
- Transient/system failures: first person or system-as-subject ("I'm having
  trouble…", "The system had a problem…"), NEVER "your access/permissions"
  unless the user's access is genuinely the cause (a true 403).
- Plain words over precision: "temporary blip" beats "lookup failure".
- Always give the action ladder: retry → contact an administrator.
- Say what did NOT happen when the user fears a side effect ("No emails have
  been sent").
- When the owner dictates copy, ship it verbatim — do not wordsmith
  ([[feedback-cite-ground-truth]] spirit: the owner's text is ground truth).
- Watch for jargon that collides with domain vocabulary ("application" at a
  grants foundation). Related: [[feedback-stakeholder-email-tone]],
  [[feedback-affordance-consistency-beats-deduplication]].
