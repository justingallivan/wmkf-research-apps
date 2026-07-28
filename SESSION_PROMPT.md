# Session 382 Prompt: Mailbox verification and synthesis promotion

## Session 381 Summary

Session 381 closed the documentation/memory hygiene audit and local operational
source disposal, established a bounded public-history remediation plan,
completed deterministic app-access acceptance, and shipped the reviewer-email
release contract plus live copy migration.

### What Was Completed

1. **Documentation, memory, and retention hygiene**
   - Reconciled current documentation and memory claims against source, live
     probes, and durable project records.
   - Completed the owner-approved disposal of 139 reviewed ignored/untracked
     regular files (15,287,781 bytes), with zero failures and zero residual
     regular files in scope. The owner-only organizational archive remains.
   - Audited the public current tree and reachable Git history. Current-tree
     redactions shipped, but the retired `modules/expertise_matching` duplicate
     and any history rewrite remain owner-gated.

2. **Q9 app-access acceptance**
   - Replaced the low-signal passive soak with owner-approved deterministic
     enforcement-mode acceptance plus a read-only live inventory.
   - Seven focused suites / 33 tests passed with
     `DATAVERSE_DAL_UNIVERSAL=on`. The inventory found ten active profiles:
     two superusers, six mapped ordinary users with three to five grants, and
     two unmapped read-only profiles.
   - No grant, environment variable, deployment, or saved user session changed.
     Stage 2 is satisfied; Stage 4 transport migration is ready to execute with
     its required ordinary-user Preview and reversible grant/revoke gates.

3. **Review-synthesis reliability**
   - The controlled pre-fix production smoke failed cleanly on incomplete JSON:
     no partial synthesis write occurred, staged review data was restored, and
     the failed append-only AI audit row remains.
   - `0afea876` added complete-text handling, terminal `end_turn` enforcement,
     retained failure diagnostics, capability-gated native JSON schema, and one
     bounded retry for a typed `max_tokens` termination.
   - The code reached production through PR #92. Governed prompt publication
     and one controlled post-fix production smoke remain open; production
     behavior under the new contract is not yet proven.

4. **Reviewer and system-alert email contracts**
   - Separated `SCHOLARLY_POLITE_MAILTO` from
     `NOTIFICATION_EMAIL_FROM`; the dedicated reader is merged and deployed.
   - The configured role sender resolves to an enabled, write-capable Dynamics
     user. Outgoing Server-Side Sync on its mailbox remains unverified.
   - Shipped honorific greetings, corrected release copy, staff
     review-before-send, fail-closed recipient/sender binding, and explicit
     signature-closing preferences.
   - The post-deploy migration updated all four global reviewer bodies
     (`updated=4 failed=0`); the verification dry run returned `no-change=4`.

5. **Release**
   - PR #92 merged as `ab1d2943` after Jest, Playwright, Gitleaks, Semgrep,
     Trivy, Vercel Preview, and Claude review passed.
   - Production reached Ready and all branded aliases were verified.
   - Signed-out sign-in and public reviewer error surfaces rendered. The
     existing staff browser session had expired, so no Microsoft login or full
     authenticated staff smoke was performed.
   - `fad52f8f` recorded the release and migration; its production deployment
     `dpl_63s22wKLxSCFwj7LjjiTVpmKr3yZ` reached Ready and all main-branch
     workflows passed.

### Key Commits

- `2a0c4829` — Merge the documentation and memory hygiene work
- `1436aefc` — Redact current-tree operational data (PR #82)
- `cc91be9c` — Record completed local source disposal
- `01eaf49f`, `aa8adca8` — Close Q9 app-access acceptance gaps and review findings
- `93094ff3` — Record the bounded review-synthesis smoke failure
- `0afea876` — Harden review-synthesis structured output
- `0ec48d2a` — Harden reviewed release-email identity contracts
- `00d077da` — Merge retention audits and finish reviewer-email cleanup
- `ab1d2943` — Merge PR #92 to `main`
- `fad52f8f` — Record the reviewer-email production release

## Next Items

### Verified Open

1. **Publish and prove the review-synthesis reliability contract.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`;
   `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`; `0afea876`.
   The code is deployed. Publish the governed `review-synthesis.generate`
   prompt version carrying the tracked output-schema contract, then run one
   controlled post-fix production smoke. Success means a valid persisted
   synthesis or a typed clean no-write failure with complete audit evidence.

2. **Verify outgoing Server-Side Sync on the configured role mailbox.**
   Evidence: `docs/TODO_EMAIL_NOTIFICATIONS.md`;
   `lib/services/notification-service.js`.
   Sender resolution is proven, but mailbox SSS is not. A failure after
   resolution is logged and swallowed by `notify()` while the dashboard alert
   remains, so email delivery can stop without breaking alert persistence.

3. **Execute Q9 app-access Stage 4 when it reaches the product sequence.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
   `docs/audits/q9-app-access-stage2-acceptance-2026-07-27.md`.
   Build the bounded unfiltered admin-list primitive first, then move app
   access through a registered adapter and `DynamicsService`. Preserve the
   required ordinary-user Preview smoke, reversible grant/revoke restoration,
   authenticated reviewer-finder override check, and production log watch.

4. **Resolve or explicitly defer the P1 auth-status policy divergence.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `pages/api/auth/status.js`;
   `lib/utils/auth-policy.js`.
   The public status endpoint can report `enabled:false` while production-mode
   server enforcement remains on. Use `/contract-reconcile` before changing the
   client-bootstrap/server-enforcement contract.

### Owner Decision Needed

1. **Public Git current-tree and history disposition.**
   Evidence: `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`;
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.
   Decide whether to privately archive/remove or sanitize the retired
   `modules/expertise_matching` duplicate, then separately authorize or defer
   the history rewrite, GitHub cleanup, and clone invalidation.

2. **Retired-table operational scripts.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `scripts/README.md`.
   Twenty-five non-archive scripts still mention the dropped
   `reviewer_suggestions` table. They are blocked from casual use, but
   quarantine/removal needs an owner-approved scope and caller review.

3. **Whether reviewer follow-ups should use first names.**
   Evidence: `docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md`.
   `Dear Dr. <Last>` satisfies the explicit minimum. A warmer first-name mode
   for established correspondence would be a separate product decision.

### Parked

1. The four placeholder Workbench tabs until calendar and complete workflow
   contracts are approved.
2. Applicant intake while WMKF evaluates the GOApply re-engineering.
3. Automated BILL onboarding; honorarium payment remains offline.

### Verify Before Acting

1. Read the live governed prompt row before publication. The tracked prompt
   config is not proof that the new schema contract is current in Dataverse.
2. Re-freeze GitHub refs, artifacts, PRs, and local worktrees immediately before
   any public-history action. The 2026-07-27 topology is a dated baseline, not
   execution authority.
3. Do not auto-trigger synthesis until the approved participating-invitation
   readiness state machine is implemented and tested.
4. Do not treat the signed-out production smoke as an authenticated staff
   smoke; no Microsoft login was performed.
5. Leave the untracked `.codex/` directory alone. It contains local worktree
   metadata, not session documentation.

### Do Not Reopen Without New Decision

1. The completed 139-file local source disposal.
2. A drafts-folder workflow for reviewer release emails; edit-before-send is
   the accepted workflow.
3. The configured sender's visible display name; the owner reviewed and
   accepted it.
4. The four-body reviewer-copy migration; verification already returned
   `no-change=4`.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical product sequence and verified audit follow-ups |
| `docs/TODO_EMAIL_NOTIFICATIONS.md` | Alert sender, recipient routing, and mailbox SSS boundary |
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | Synthesis runtime evidence and promotion contract |
| `shared/config/prompts/review-synthesis.js` | Tracked governed synthesis prompt contract |
| `lib/services/review-manager/synthesize-reviews-service.js` | Bounded synthesis execution and retry |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | App-access Stage 4 implementation and release gates |
| `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` | Owner-gated current-tree/history cleanup plan |
| `docs/audits/local-operational-source-disposal-receipt-2026-07-27.md` | Completed local disposal receipt |
| `docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md` | Reviewer-email review history and behavioral findings |

## Testing

```bash
rtk npm run check:docs-catalog
rtk npm run check:fact-consistency && rtk npm run check:fact-consistency:self-test
rtk npm run check:doc-symbol-refs && rtk npm run check:doc-symbol-refs:self-test
rtk npm run check:memory-router && rtk npm run check:memory-router:self-test
rtk npm run check:doc-currency && rtk npm run check:doc-currency:self-test
rtk npm run check:secret-scan && rtk npm run check:secret-scan:self-test
rtk npm run check:agent-invariants
```
