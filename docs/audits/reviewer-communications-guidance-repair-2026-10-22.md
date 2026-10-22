# Reviewer communications guidance repair — 2026-10-22

**Scope baseline:** `10f6c80c7`. This is a bounded repair report for assigned reviewer-communications documentation and two source-comment clarifications. It records corrected claims and evidence; it is not a whole-repository reconciliation verdict. Parent verification is recorded below.

## Files in this repair

- `.claude-memory/reviewer-invite-capture-mode-not-full-sandbox.md`
- `.claude-memory/project-external-reviewer-file-access.md`
- `.claude-memory/project-reviewer-accept-decline-links.md`
- `.claude-memory/project-site-visit-materials-planning-handoff.md`
- `.claude-memory/project-dataverse-batch-changeset-available.md`
- `docs/agent-wiki/topics/external-reviewer-portal.md`
- `docs/REVIEWER_ENGAGEMENT_SPEC.md`
- `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`
- `docs/REVIEWER_MATERIALS_FOLDER_SPEC.md`
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`
- `lib/external/token-lifecycle.js` (comments only)
- `lib/external/reviewer-token-ttl.js` (comments only)
- `docs/audits/reviewer-communications-guidance-repair-2026-10-22.md`

## Corrected claims and source basis

- **Capture mode and preview:** preview rendering uses a non-live placeholder; final send-boundary minting happens in `send-emails-service.js::sendEmails` before the capture transport branch. The invitation lifecycle stamp is a separate write. The capture memory preserves the July preview-mint behavior as dated history and limits the current no-mint claim to token authority. The separate abstract edit remains outside capture behavior. Source: `lib/services/review-manager/render-emails-service.js::renderEmails`, `send-emails-service.js::sendEmails`, `lib/external/token-lifecycle.js::mintAndStore`, and reviewer-suggestion adapter.
- **Post-receipt expiry helper:** `extendForPostSubmissionWindow` assigns stored expiry to `Date.now() + 7 days` by default. This is not additive to the existing stored expiry, can shorten it, and leaves the signed JWT `exp` unchanged. It creates no editing permission; the shared receipt guard blocks later received-review writers. Source: `lib/external/token-lifecycle.js::extendForPostSubmissionWindow`, adapter `extendExternalTokenExpiry`, and the receipt guard used by review-upload writers. Historical S125 wording is retained with the corrected semantics.
- **Review-due token TTL:** `computeReviewerTokenExpiry` uses the due date at 23:59:59 UTC plus 2 days for nonaccepted reviewers or 90 days for accepted reviewers; absent, malformed, or nonfuture due dates fall back to now + 90 days. Acceptance alone does not replace an already issued invitation token. Source: `lib/external/reviewer-token-ttl.js::computeReviewerTokenExpiry` and send-boundary callers.
- **Due-date extension preflight:** only a non-null override save with a stored token hash reaches the token preflight. A revoked token rejects; an active token must cover the requested date, or the route returns `token_recovery_required` before the date write. Missing hash skips that token check, and null restore skips this preflight. No extension rotates token authority; notification follows the saved date and may report partial success. Source: `pages/api/review-manager/review-due-extension.js`, its service, token verifier, and adapter.
- **Preview, capture, and portal access:** historical production mint/revoke smoke is explicitly historical; opening a token link may persist first access, and revocation can delete drafts. A local HMAC secret does not authorize production target writes. Current release/rehearsal authorization and disposable-data boundaries remain linked in the portal wiki.
- **Dataverse changesets:** the memory retains the June S302 raw transport API, ordered raw-URL operation shape, first-consumer description, and atomicity rationale under a historical heading. It distinguishes that helper from the later DAL `runChangeset` wrapper, which validates named entity-set operations; its Stage 7 trusted-context assertion is later still. Current reviewer submission writes parent receipt/status/affiliation while both ratings remain in answer snapshots. Source: `lib/services/dynamics-service.js::executeChangeset`, `lib/dataverse/core/changeset.js::runChangeset`, and current `build-review-submission` service.
- **Site Visit planning:** the handoff records the 2026-09-17 owner retirement of automatic reminder scheduling: route retained, unscheduled, and requiring a new owner decision to schedule. Dry run is described as no-send/no-claim with audit writes. Manual reminders, the parked exact-500-MB transfer, and declined simultaneous-large tests remain represented.
- **Engagement closeout:** thank-you is documented as a courtesy communication claim/copy, not completion or payment eligibility; lifecycle adapter writes only the thank-you marker.

## Preserved history and owner holds

Historical decisions and observations remain dated and labeled, including S125 upload-expiry intent, S275/S302 implementation context, S308/S346 portal-smoke history, July 2026 preview behavior, and production observations whose deployment association is date-bounded. The applicant intake extension remains parked unless revived by a new owner decision; the shipped Site Visit materials product stays separate. Automatic Site Visit reminder scheduling remains retired by owner decision, and the reviewer-reminder schedule remains separately paused under its existing owner hold. No schedule, release, or production authorization was inferred.

## Remaining uncertainty and follow-up

Production state beyond the dated receipts is not re-probed here. The repository-wide restatement scan is still in progress: parent/delegated follow-up owns remaining hits in `docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`, and `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md`, including the cron schedule wording. The repair agent ran no gates or tests; parent review and verification are recorded below.


## Parent review and verification

Parent independently reviewed the changed guidance against the token TTL,
receipt guard, due-extension branches, raw-transport/core changeset call path,
Git ancestry and dated release records. Review corrections fixed the changeset
call direction, absolute stored-expiry semantics, null-restore exception,
historical/current boundaries and metadata formatting. The two source files
changed in this batch have identical Babel non-comment tokens to the baseline;
application behavior is unchanged.

The parent ran the relevant document checks and sequential self-tests: agent
invariants, memory router, fact consistency, canonical pointers, document-symbol
references, build-claim freshness, agent wiki, Atlas, API route coverage, harness
framing, document currency and docs catalog. Metadata/date and summary errors
were corrected and the affected checks rerun successfully. The memory-router
self-test emitted its existing listener warnings; API coverage retains existing
unknown-guard warnings for the three token-scoped applicant-materials routes.
Neither warning is a new runtime or authorization verdict. No production probe,
send, deployment, environment or worktree change was performed.

This closes the bounded edited-file repair review. Other restatements and broader
domain audits remain tracked separately; it is not a whole-repository clean-state
claim.
