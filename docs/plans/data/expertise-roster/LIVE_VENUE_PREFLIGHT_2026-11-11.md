# Live attachment and matching venue — preflight evidence

[VERIFIED via the coordinating session's final checks and exact Opus review] The
minimal venue is source-built and Opus returned READY. The final single command
passed 194 tests across 12 suites (`outputs/roster-final-focused-tests.log`). Build
exited zero; scoped lint, types, model-warming and DAL gates/self-tests passed.
This supersedes the earlier separate 30/3 and 99/7 test checkpoints. See the
[exact build review](LIVE_VENUE_BUILD_OPUS_5_5_REVIEW_2026-11-11.md).

The browser-only prompt boundary requires the approved model `claude-sonnet-5-5`
and maxTokens 4096 after target validation. The shared usage logger catches
synchronous initial SQL failures and synchronous/asynchronous fallback failures,
so logging failure cannot turn a persisted matching result into request failure.
This is implemented behavior, not evidence of a live paid model call.

[VERIFIED via the coordinating session's real OAuth browser walkthrough and private
`browser-workbench-preflight-20261111/result.json`] Request 1000339's Workbench
Reviews tab, Add Feedback and one-off form loaded. The form was canceled without
saving or uploading. All 46 profiles, including the canary ETag, were unchanged;
public SQL matched and the owned fixture was removed. Parsed private logs contained
eight Azure AD POSTs and 17 Dataverse GETs, with no Dataverse writes.

This was a bounded page/form preflight, not a clean whole-application run. A stale
cookie from the prior venue secret produced `JWT_SESSION_ERROR` before fresh SSO.
Known direct-Vercel profile, migration and Alert SQL errors remained, and the
Review Manager synthesis job state was unavailable through direct Vercel SQL.
Reviews and the feedback form loaded; synthesis was not exercised. No claim is
made that every request succeeded or all app surfaces work in this venue.
Screenshot: `roster-attachment-preflight.jpg` in the session's private visualization
artifacts. No actual attachment upload or model inference ran.

Exact shared-storage and metered-model approval remains pending. The existing
[remaining plan](REMAINING_FLOW_REHEARSAL_2026-11-11.md) governs scope, external
object receipts, residual retention and cleanup. Runtime build/preflight success
does not authorize or prove live attachment or paid matching execution.
