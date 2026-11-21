# Manual service checks — final Opus review

Date: 2026-11-21. Reviewer: Claude Opus (`claude-opus-5-5`), invoked through verified `claude.ai` OAuth subscription authentication outside the Codex sandbox. Provider API credential variables were removed from the CLI environment. Read-only review; no publishing or deployment. Marker: `SERVICE-UPDATE-CHECKS-20261121-C`. Earlier rounds requested changes; the fixes and local verification are recorded in [the build receipt](SERVICE_UPDATE_CHECKS_BUILD_2026-11-21.md). The reviewer inspected source and tests; Codex ran the reported tests and gates.

The following is the reviewer's final report.

**Verdict: approved.** The residual M1 fix and the L-a, L-b and L-c fixes are sound. I found no remaining correctness or security defects, and no direct regressions. This was read-only, marker SERVICE-UPDATE-CHECKS-20261121-C.

## Fixes verified
- **M1 (pending change when its source then fails):** When a source fails and the stored baseline is pending, the result now keeps the pending flag and "Needs attention". It also keeps the last successful lines, the original "changed from" evidence and the retained timestamp, and says plainly that the result is not fresh (`check-sources.js:125-130`). The baseline is carried forward unchanged.
  - The UI shows the retained date and the previous evidence, and keeps "Start review from findings" when a source is unavailable but pending (`ExternalServiceCheckResults.js:15,18,21`).
  - The draft adds the "not a fresh observation" line (`ExternalServicesSection.js:135`). The UI test at `external-services-ui.test.js:165-173` checks for the button and that disclaimer.
  - If a review is acknowledged and that same source then fails, the cleared baseline is still saved (`checks.js:14` to `check-sources.js:130`). That is the correct outcome.
- **L-a (billing "Changed" every day):** The fingerprint is now model, token type and whether a local rate exists (`check-sources.js:94`). I confirmed that `localCentsPerMtok` is a real field on the audit rows (`pricing-checks.js:85,89`), so the "has a local rate" part works. The percentage appears only in the displayed lines.
- **L-b (SerpAPI "Changed" every month):** The fingerprint is now plan name, price and monthly limit only (`check-sources.js:107`). The renewal date is display-only, and low allowance is a separate attention flag, so a monthly reset doesn't count as a change.
- **L-c (too many events count as a review):** A review now counts only if `max(updated_at)` is later than the previous check's database `checked_at` (`check-store.js:29`).
  - **Mid-check reviews:** A review's `updated_at` is set when its save starts. The check's `checked_at` is set when the check finishes. So a review saved while a check is running can never count, and the change stays pending rather than showing a false "No change detected".
  - **Other cases:** A check that was interrupted leaves `checked_at` and the stored snapshot as they were. On the very first check, `checked_at` is empty, so nothing counts as a review.
  - **Atlas:** It records the limitation that editing an old review also counts as a review (`postgres-external-services.md:39`).
- **Setup required:** The "Check for updates" button is disabled when check storage hasn't been set up (`ExternalServicesSection.js:203`).

## Minor notes (no action needed)
- **Redundant condition:** The "different review revision" check in `checks.js:11` is already implied by the timestamp comparison. It does no harm.
- **Threshold flicker:** A billing row that hovers around the 5% threshold will move in and out of the flagged set, and each move shows "Changed". This is the same kind of noise as L-a but much rarer, and it comes from reusing the cron's rule.
- **Lost POST response:** If a check finished but the UI never showed its results, a review started from the older on-screen results would still acknowledge the newer findings. The reload after saving then shows those findings. This falls under the documented limitations of this simple version.

I read `pricing-checks.js` only for the audit-row fields. I did not re-read the route handler.