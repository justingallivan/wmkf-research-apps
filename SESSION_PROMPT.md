# Session 381 Prompt: Reviewer email cleanup, merge, and migration

> **Branch note.** The original Claude work remains unchanged on
> `codex/claude-bug-fixes`. Codex created
> `codex/reviewer-email-contract-cleanup`, added contract fixes, and merged the
> completed `codex/local-retention-inventory` history into that isolated branch.
> PR #92 merged that combined branch to `main` at `ab1d2943` on 2026-07-28.

## Session 381 Release — Complete

- PR #92 passed Jest, Playwright, Gitleaks, Semgrep, Trivy, Vercel Preview, and
  Claude review, then merged as `ab1d2943`.
- Vercel production deployment `dpl_FUkr89hrrMCL59wkTkG2FtkRXxhb` reached
  **Ready** and owns the `applications`, `reviews`, `grantees`, and
  `submissions.wmkeck.org` aliases.
- The signed-out production sign-in surface rendered, and the public reviewer
  route returned its expected malformed-link state for a synthetic token. The
  existing staff browser session had expired, so no Microsoft login was
  initiated during the smoke.
- The required post-deploy reviewer-copy migration first reported four
  `change` rows, then wrote all four with `updated=4 failed=0`. A verification
  dry run reported `no-change=4`; the pre-write transcript retains the complete
  prior values as the rollback source.

## Session 380 Summary

Session 380 began as a configuration question — program directors received the
reviewer-quota alert from a named individual's mailbox — and expanded into
reviewer email copy, a staff review-before-send step for the reviewer release,
and a live-settings migration. A Codex adversarial review returned **no-ship**
with seven findings; Codex applied the fixes and Claude reviewed them, finding
one further defect in Codex's own work.

The original eleven Claude commits remain pushed on
`codex/claude-bug-fixes`. Codex's cleanup branch adds fail-closed reviewed-email
contracts and preserves the concurrent retention/privacy work.

## Local Operational Retention Milestone — Complete

The owner-approved, fail-closed source disposal removed all 139 reviewed
ignored, untracked regular files (15,287,781 bytes) with zero failures and zero
residual regular files in scope. Preflight reverified every source hash, all 82
archive-backed copies, all 20 separately preserved unique-source files, and
source/archive separation. The owner-only organizational archive remains
retained; five excluded dependency symlinks remain untouched.

Use
`docs/audits/local-operational-data-retention-audit-2026-07-27.md` and
`docs/audits/local-operational-source-disposal-receipt-2026-07-27.md` for the
privacy-safe evidence. This closes only the ignored local regular-file
component; reachable public Git history remains unresolved under
`docs/audits/public-repository-pii-history-audit-2026-07-27.md`.

## Public Git History Remediation — Owner Decisions Pending

Read-only GitHub preflight and a disposable `git-filter-repo` simulation are
complete. The 2026-07-27 preflight found 68 branch refs, one tag, 91 PR head
refs, nine PR merge refs, nine open PRs, 1,942 Actions artifacts, zero forks,
and four linked local worktrees. That worktree count is a dated snapshot; new
isolated cleanup worktrees have since been added.

The targeted simulation selected 694 non-current historical blobs across 65
audited paths plus three history-only commit-message contacts. It removed all
selected objects/values, preserved the then-current public `main` tree exactly,
and passed object-integrity checks. All 91 PR head refs changed, so a real
rewrite requires GitHub Support cleanup and full old-clone invalidation.

A later semantic review reopened the current-tree privacy prerequisite:
`modules/expertise_matching` is a non-production reference/demo that
duplicates the protected 38-person production roster and retains person-linked
cycle assignment/usage findings. The production app, authenticated API, and
database remain live and are not removal targets. The owner must decide
whether to privately archive and remove the retired duplicate or retain a
sanitized public design/findings record. The earlier dry-run counts validate
mechanics but are not a complete final removal specification.

No external or destructive action is yet authorized. Use
`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` for the execution invariants,
alternatives, exact decision list, and final-freeze requirement.

### What Was Completed

1. **System-alert sender moved off an individual mailbox**
   - `NOTIFICATION_EMAIL_FROM` was doing double duty as the Dynamics sender and
     the NCBI/Europe PMC contact address; `SCHOLARLY_POLITE_MAILTO` now carries
     the latter, falling back to the old var when unset.
   - A read-only Dataverse probe confirmed the configured role mailbox resolves
     to an enabled, write-capable Dynamics sender. Row identity and display
     metadata are intentionally not retained in public documentation.
   - The owner set both vars in Vercel and deployed.

2. **Reviewer email greeting and release copy**
   - `{{greeting}}` renders `Dear Dr. <Last>` on every reviewer email, not only
     invitations; `buildReviewerGreeting` is the single definition.
   - Release copy no longer thanks an unresponsive reviewer for a "willingness
     to review" they never expressed.
   - Fixed two live parsing defects: `"Jane Roe, Ph.D."` yielded surname
     `"Roe,"`, and `Mrs.` resolved to `Mr.`

3. **Review-before-send for the reviewer release**
   - New read-only `POST /api/review-manager/render-withdraw-emails`;
     `withdraw-sufficient` accepts per-suggestion `overrides`; new
     `ReleaseEmailModal`. Staff edit each note before it sends.
   - Sending **is** the release (the lifecycle write deliberately precedes the
     email), so a true "save to drafts" was not built; the owner accepted
     edit-before-send instead.

4. **Live-settings migration**
   - `scripts/migrate-reviewer-email-copy.mjs` pushes seed copy onto the live
     `wmkf_appsystemsettings` rows. Dry-run default; `--execute` writes; aborts
     before any write when a read fails.

5. **Review loop**
   - Codex adversarial review: 7 findings, no-ship. Codex fixed all 7.
   - Claude's review of those fixes found Codex's rewritten Playwright test
     failed on a strict-mode locator violation — Codex had reported Playwright
     as unverifiable when in fact Chromium merely would not launch in its
     sandbox.
   - Full handoff, including Claude's self-assessment and three unimplemented
     remediation proposals: `docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md`.

6. **Codex cleanup of the reviewed-email contract**
   - A reviewed batch now requires complete subject, body, recipient, and sender
     bindings for every selected suggestion; missing or partial overrides fail
     before the lifecycle write.
   - Recipient or Program Director sender drift after preview fails closed.
   - Profile Settings now persists an explicit “signature includes its own
     closing” flag. New arbitrary staff-authored closings are preserved when
     marked; a bounded recognizer exists only for legacy pre-flag preferences.
   - Final-correction verification: focused contract run 9 suites / 110 tests;
     related-test impact run 63 suites / 652 tests; Playwright
     reviewer-invite/release flow 6/6 after a successful production build;
     TypeScript and targeted ESLint clean. The full Jest run had 524 suites /
     6,262 tests pass; its only failures were the three `selftest-fixture`
     tests because the auxiliary-worktree sandbox denied their temporary
     directories. The API
     route self-test then passed outside that sandbox, status-parity self-test
     passed 17/17, and the route, parity, docs, memory, fact, and secret gates
     are green.

### Verification at `ac41a7c7`

525 suites / 6259 tests; Playwright 6/6 in a real browser; 15 code gates and 11
doc gates with their paired self-tests; ESLint clean.

### Commits

- `677a0b32` — Separate the scholarly API contact address from the alert sender
- `b4ef3a25` — Record alerts@wmkeck.org as the selected alert sender
- `b413d5c6` — Confirm alerts@wmkeck.org resolves as a Dynamics sender
- `ec5c8a2c` — Reconcile the sender change to applied
- `a497d158` — Greet reviewers by honorific and fix the release-email copy
- `82f4edf2` — Add the reviewer email copy migration
- `0f7d1348` — Document the interlock requirements for the email settings scripts
- `66a5fb28` — Drop the closing lines that would double the PD signature
- `c91244ee` — Let staff review and edit release emails before sending
- `e3a471e7` — Fix the review findings on the release flow and reviewer emails
- `ac41a7c7` — Hand off the reviewer-email session to Codex

## Prior Session 379 Summary

Session 379 implemented review-synthesis structured-output reliability:
`executePrompt` preserves normalized full text and stop metadata, requires
`stopReason=end_turn` before persistence, and capability-gates prompt-level
native JSON schema; `synthesizeReviews` retries one confirmed
`claude_output_truncated` once with a bounded doubled budget. Session 378 had
run the bounded production smoke that failed as designed (incomplete JSON, no
partial write) and fully restored the synthetic state.

## Next Items

### Verified Open

1. **Verify outgoing Server-Side Sync on the configured role mailbox.**
   Evidence: `lib/services/notification-service.js:85-88`.
   The sender resolves, but if SSS is not enabled the send fails *after*
   resolution and `notify()` swallows it — alert email stops silently while
   dashboard alerts keep working. Check the `mailboxes` row for that systemuser,
   or Power Platform admin → Email Configuration → Mailboxes.

2. **Finish the review-synthesis promotion — the code is already committed.**
   Evidence: `0afea876` on `main`; `docs/CURRENT_WORK_QUEUE.md`.
   Corrects a stale carryover: Session 379's prompt said "commit … remain", but
   the hardening landed at `0afea876`. What actually remains is publishing the
   governed prompt version, a deliberate deploy, and one controlled post-fix
   production smoke.

4. **Resolve or explicitly defer the P1 auth-status policy divergence.**
   Evidence: `pages/api/auth/status.js`, `lib/utils/auth-policy.js`.
   `/api/auth/status` can report `enabled:false` while production-mode server
   enforcement remains on. Use `/contract-reconcile` first — `RequireAuth`,
   `Layout`, and the home page consume it.

5. **Proceed with Q9 app-access Stage 4 from the deterministic acceptance
   baseline.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`.
   Stage 2 is satisfied; preserve the required ordinary-user Preview smoke,
   reversible grant/revoke check, authenticated reviewer-finder check, and
   production log watch.

### Owner Decision Needed

1. **Whether the staff "first name basis" feedback wants more than
   `Dr. <Last>`.**
   Evidence: staff feedback relayed 2026-07-27; the individual's name is not
   retained in this public handoff.
   They asked for "Dr. [Last Name] **at least**", which reads as a floor. If
   warmer first-name follow-ups are wanted for reviewers already in
   correspondence, that is a separate change.

2. **Public Git history remediation decisions.** The current-tree
   expertise-matching duplicate and the owner-gated history rewrite remain
   unresolved under `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`.

3. **Retired-table script disposition** and the **read-only live probe pack** —
   both carried forward from Session 379, unchanged.

### Parked

1. Automatic synthesis triggering and another production regeneration until the
   approved readiness state machine is implemented.
2. Implementation of the four placeholder Workbench tabs pending the
   design/calendar gate.
3. A drafts-folder workflow for reviewer emails. The owner closed this: sending
   is the release, and edit-before-send meets the need.

### Verify Before Acting

1. **`before.txt` is stale.** Re-capture the dry run before any `--execute`.
2. **The migration overwrites staff-edited wording** on four global reviewer
   bodies. It does not touch per-PD invitation/materials templates.
3. **Do not treat "could not verify" from any agent as a caveat.** Codex
   reported Playwright unverifiable; it ran fine in Claude's environment and
   immediately exposed a real defect in Codex's own fix.
4. **Do not cite the seed constants as a runtime fallback.** They are init data;
   a blank live row skips the send with an ops alert.

### Do Not Reopen Without New Decision

1. **The configured role mailbox's visible sender name** — owner reviewed and
   accepted; public docs intentionally omit the internal display value.
2. **Drafts-folder delivery for reviewer emails** — owner closed it as a
   non-issue.
3. **The acceptance-body content change** — owner chose the fuller copy
   (inline withdraw link + PD contact line) over a greeting-only edit.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md` | Session outcomes, unrun follow-ups, self-assessment, unimplemented proposals |
| `lib/services/review-manager/withdraw-sufficient-service.js` | Release preview + send, per-row guards, recipient and sender binding |
| `shared/components/reviewers/ReleaseEmailModal.js` | Staff review-before-send UI |
| `pages/api/review-manager/render-withdraw-emails.js` | Read-only draft renderer |
| `lib/utils/email-generator.js` | `buildReviewerGreeting` + `parseRecipientName` (live invitation path) |
| `lib/utils/reviewer-email-closing.js` | Custom/fallback signature-closing composition |
| `scripts/migrate-reviewer-email-copy.mjs` | Live-settings copy migration (dry-run default) |
| `lib/services/email-defaults.js` | Why seed constants are not a runtime fallback |
| `docs/TODO_EMAIL_NOTIFICATIONS.md` | Sender contract and the SSS verification steps |
| `docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md` | Audit method, corrections, residual drift, probe boundary, and recommendations |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority queue plus verified audit follow-ups |
| `docs/CI_GATES_REFERENCE.md` | Actual enforcement tiers and serial fixture guidance |
| `docs/AUTHENTICATION_SETUP.md` | Correct emergency bypass contract |
| `pages/api/auth/status.js` | Open client-bootstrap/server-enforcement divergence |
| `lib/utils/auth-policy.js` | Effective fail-closed auth policy |
| `docs/EXECUTOR_CONTRACT.md` | Reconciled Executor input/output/failure contract |
| `docs/APPLICATION_STATE_ATLAS.md` | Data-layer routing and ownership |
| `scripts/README.md` | Blocked legacy operational script guidance |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Current product execution sequence |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | App-access DAL Stage 4, now unblocked by deterministic context acceptance |
| `docs/audits/local-operational-data-retention-audit-2026-07-27.md` | Local retention findings, preservation boundary, and completed source-disposal status |
| `docs/audits/local-operational-source-disposal-receipt-2026-07-27.md` | Privacy-safe aggregate receipt for the completed 139-file disposal |
| `docs/audits/public-repository-pii-history-audit-2026-07-27.md` | Current-tree privacy findings, including the unresolved retired expertise-matching duplicate, and reachable-history findings |

## Testing

```bash
rtk npx jest tests/unit tests/integration --runInBand
rtk npx playwright test tests/e2e/program-director-invite.spec.js
rtk npm run check:types
rtk npm run check:api-routes && rtk npm run check:api-routes:self-test
rtk npm run check:fact-consistency && rtk npm run check:fact-consistency:self-test
rtk npm run check:docs-catalog
rtk npm run lint
```

`check:agent-invariants` cannot pass from this auxiliary Git worktree because
Git's shared-worktree layout does not materialize the root-only
`.agents/skills` and `.claude-memory` symlink invariants there. Run it again
from the final integrated primary checkout; no invariant file was changed by
the reviewer-email cleanup.
