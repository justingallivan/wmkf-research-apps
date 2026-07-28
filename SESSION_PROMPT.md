# Session 383 Prompt: Synthesis promotion and operational follow-through

## Session 382 Summary

Session 382 eliminated the accumulated Dependabot security backlog through one
reviewed rollup, proved the dependency graph on the repository's Node 20/npm 10
CI runtime, and deployed the result to production.

### What Was Completed

1. **Dependabot vulnerability inventory and remediation**
   - Verified 49 open alerts on `main`: 1 critical, 32 high, 9 moderate, and
     7 low across 13 package families.
   - Updated or overrode the affected NextAuth, Undici, DOMPurify, body-parser,
     linkify-it, ws, js-yaml, Babel, PostCSS, Sharp, and UUID versions.
   - Removed unused `multer` from the active dependency graph. Renamed the
     immutable historical `.harness-backups/.../package.json` snapshot so
     GitHub no longer treats it as an active npm manifest; its recorded hash
     and byte count remain unchanged.

2. **Brace-expansion compatibility boundary**
   - The newest brace-expansion advisory affects every upstream release through
     5.0.7, but older minimatch consumers require the legacy callable API while
     5.0.8 exposes a named `expand` API.
   - Added `vendor/brace-expansion-compat`: a bounded legacy-compatible adapter
     based on upstream 1.1.16 behavior, with output-count, accumulated-length,
     and brace-depth limits. Its named API delegates to official 5.0.8.
   - CI exposed an npm 11/npm 10 portability difference for override-only local
     packages. `58d713a1` fixed it by declaring the local package directly and
     referencing that exact dependency from the override. A clean npm 10.8.2
     install then resolved both APIs correctly.

3. **Compatibility and adversarial verification**
   - Added real-package regressions for UUID-v5 identity stability, ExcelJS
     conditional-format UUID use, malformed NextAuth Bearer input, and both
     brace-expansion APIs including exploit-class bounded output.
   - Local verification passed: `npm audit` at zero; 527 Jest suites / 6,269
     tests; 24 Playwright tests; TypeScript; production builds under Turbopack
     and Webpack; Node 20 focused tests and Sharp conversion; lint with zero
     errors; harness, secret, and agent-invariant gates.
   - Three independent review passes found the initially missed 2026
     brace-expansion advisory, identified focused compatibility tests, and
     removed one redundant direct ESLint-internals pin. No high- or
     medium-severity finding remained.

4. **Release and live security reconciliation**
   - PR #93 passed Jest, Playwright, Gitleaks, Semgrep, Trivy, Vercel Preview,
     and Claude review, then squash-merged to `main` as `c325afd5`.
   - Production deployment `dpl_4LBja725wdLHsATtLhLVZkCMSso3` reached Ready on
     all aliases. The post-deploy error-level log query returned no logs, and
     public alias smokes returned their expected authentication redirects.
   - All post-merge main checks passed. GitHub's live Dependabot count
     reconciled from 49 open alerts to zero.
   - PRs #83, #84, #85, #86, #87, #89, #90, and #91 were closed as superseded
     by #93.

### Commits

- `26523561` — Resolve Dependabot security alerts
- `58d713a1` — Make the local brace-expansion override portable to npm 10
- `c325afd5` — Squash merge PR #93 to `main`

## Next Items

### Verified Open

1. **Publish and prove the review-synthesis reliability contract.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`;
   `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`; `0afea876`.
   The reliability code is deployed, but the governed
   `review-synthesis.generate` prompt version carrying the tracked output schema
   still needs publication followed by one controlled post-fix production
   smoke. Success is a valid persisted synthesis or a typed clean no-write
   failure with complete audit evidence.

2. **Verify outgoing Server-Side Sync on the configured role mailbox.**
   Evidence: `docs/TODO_EMAIL_NOTIFICATIONS.md`;
   `docs/CLAUDE_TO_CODEX_HANDOFF_2026-07-27.md`.
   Sender resolution is proven, but mailbox SSS remains explicitly
   unverified. A post-resolution send failure is logged and swallowed while
   the dashboard alert persists, so email delivery can stop without breaking
   alert storage.

3. **Execute Q9 app-access Stage 4 when it reaches the product sequence.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
   `.claude-memory/project-app-access-control.md`.
   Stage 2 acceptance is satisfied and Stage 4 remains ready, not executed.
   Preserve the bounded admin-list prerequisite, ordinary-user Preview smoke,
   reversible grant/revoke restoration, authenticated override check, and
   production log watch.

4. **Resolve or explicitly defer the P1 auth-status policy divergence.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `pages/api/auth/status.js`;
   `lib/utils/auth-policy.js`.
   The public status endpoint can report `enabled:false` while
   production-mode server enforcement remains on. Use `/contract-reconcile`
   before changing this client-bootstrap/server-enforcement contract.

5. **Triage routine Dependabot PR #94 separately from the security release.**
   Evidence: GitHub PR #94 and the live Dependabot alert API on 2026-07-28.
   The PR contains 11 ordinary minor/patch updates, changes only
   `package.json`/`package-lock.json`, and currently has green automated checks.
   It is not a security regression: the live alert count remains zero. Review
   it on normal maintenance priority rather than folding it into the completed
   vulnerability incident.

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
   for established correspondence remains a separate product decision.

### Parked

1. **Brace-expansion vendor adapter removal.**
   Evidence: `vendor/brace-expansion-compat/index.js`; `package.json`.
   Remove only when every installed parent chain accepts the official patched
   API. A blind 5.0.8 substitution breaks older minimatch consumers because
   they call the package as a function.
2. The four placeholder Workbench tabs until calendar and complete workflow
   contracts are approved.
3. Applicant intake while WMKF evaluates the GOApply re-engineering.
4. Automated BILL onboarding; honorarium payment remains offline.

### Verify Before Acting

1. Read the live governed prompt row before synthesis publication. The tracked
   prompt config is not proof that the new schema contract is current in
   Dataverse.
2. Re-freeze GitHub refs, artifacts, PRs, branches, and local worktrees
   immediately before any public-history action. The remediation plan's
   2026-07-27 topology is explicitly a dated baseline; PR #94 and the completed
   #93 release already prove that it has changed.
3. Do not auto-trigger synthesis until the approved participating-invitation
   readiness state machine is implemented and tested.
4. Do not replace the brace-expansion adapter based only on a scanner version;
   exercise legacy callable and modern named consumers under Node 20/npm 10.
5. Leave the untracked `.codex/` directory alone. It contains local worktree
   metadata, not session documentation.

### Do Not Reopen Without New Decision

1. The completed 49-alert Dependabot security rollup. Re-open only for a new
   alert or a demonstrated compatibility defect; routine PR #94 is separate.
2. The eight superseded individual Dependabot PRs (#83–#91, excluding #88).
3. The completed 139-file local source disposal.
4. A drafts-folder workflow for reviewer release emails; edit-before-send is
   the accepted workflow.
5. The four-body reviewer-copy migration; verification already returned
   `no-change=4`.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `package.json` | Direct dependency and global security-override contract |
| `package-lock.json` | npm 10/11-compatible resolved dependency graph |
| `vendor/brace-expansion-compat/` | Bounded legacy API plus official 5.0.8 named API |
| `tests/unit/dependency-security-compat.test.js` | UUID, ExcelJS, and brace compatibility regressions |
| `tests/unit/signin-server-props.test.js` | Real NextAuth malformed-Bearer regression |
| `.github/dependabot.yml` | Exact sanitize-html 2.17.6 compatibility ignore |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical product sequence and audit follow-ups |
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | Synthesis runtime evidence and promotion contract |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | App-access Stage 4 implementation and release gates |
| `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` | Owner-gated current-tree/history cleanup plan |

## Testing

```bash
rtk npm ci --cache /tmp/wmkf-npm-cache
rtk npm audit
rtk npm test -- --runInBand
rtk npx playwright test
rtk npm run check:types
rtk npm run build
rtk npm run check:docs-catalog
rtk npm run check:fact-consistency && rtk npm run check:fact-consistency:self-test
rtk npm run check:doc-symbol-refs && rtk npm run check:doc-symbol-refs:self-test
rtk npm run check:memory-router && rtk npm run check:memory-router:self-test
rtk npm run check:doc-currency && rtk npm run check:doc-currency:self-test
rtk npm run check:secret-scan && rtk npm run check:secret-scan:self-test
rtk npm run check:agent-invariants
```
