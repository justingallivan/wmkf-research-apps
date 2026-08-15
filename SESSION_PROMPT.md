# Session 428 Prompt: Run the Fable Production, Security, and Refactor Audit

## Session 427 Summary

Session 427 completed and promoted the reviewer rich-text toolbar work, including
the simpler toolbar for staff entering a review manually. It then converted the
planned overnight architecture exercise into a Fable-led master brief that combines
current-state auditing, bounded read-only production probes, semantic security
review, measured performance diagnosis, evidence-based refactor selection, and an
Opus-reviewed staged migration plan.

The Fable brief is on `main`. It now requires Fable to create a clean dedicated
branch from current `origin/main` before editing any audit or planning artifact.
`main` was clean and synchronized with `origin/main` at session close.

### What Was Completed

1. **Reviewer rich-text controls were simplified and promoted.**
   - The external reviewer answer editor uses the restricted skinny toolbar.
   - Staff manual review entry now uses the same skinny toolbar rather than the
     more complex control set.
   - Sanitization and documentation were aligned with the six supported controls:
     bold, italic, subscript, superscript, undo, and redo.

2. **The Fable audit/refactor exercise was made executable.**
   - `docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md` assigns Fable architecture
     ownership, bounded reconnaissance to lower-tier models, future stage coding to
     Sonnet, and fresh-context adversarial review to Opus.
   - It integrates repository/live-state audit, read-only production probes,
     semantic security review, performance measurement, refactor candidate scoring,
     staged planning, review disposition, and a separately authorized implementation
     loop.
   - The Request Workbench Data Plane is explicitly a hypothesis to confirm, narrow,
     replace, or reject—not a predetermined architecture decision.
   - Production writes, implementation, deployment, merging, and pushing `main`
     remain outside the planning authorization.

3. **The next-session branch boundary was made mandatory.**
   - Fable must run `/start`, fetch `origin`, verify a clean worktree, and create a
     dedicated non-`main` branch from current `origin/main` before writing artifacts.
   - Dirty or unpushed work is a stop-and-coordinate condition; Fable must not stash,
     discard, or build on uncertain state.

### Commits

- `69f4d8eb` - Merge reviewer compact toolbar
- `25b39d1d` - fix(reviewers): simplify manual entry toolbar
- `d4992b99` - docs: add Fable audit and refactor master brief
- `e472ad55` - docs: require a dedicated Fable planning branch

## Next Items

### Verified Open

1. **Execute the Fable audit and planning brief on a dedicated branch.**
   Evidence: `docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md` is on `main` at
   `e472ad55`; its Phase 0 requires a clean non-`main` branch from current
   `origin/main` before any artifact edits.
   Start with `/start`, create the branch, and follow the brief phase by phase. Stop
   after the corrected, Opus-reviewed staged plan unless Justin separately authorizes
   implementation.

2. **The abstract-save timeout reconciliation remains branch-only.**
   Evidence: `f69e3289` remains on `codex/fix-abstract-save-timeout`; it is not an
   ancestor of `main`, and `git log origin/main..codex/fix-abstract-save-timeout`
   still lists the commit.
   Keep this separate from the Fable audit unless its source or production evidence
   becomes relevant to a measured Workbench contract.

### Owner Decision Needed

1. **Promote the abstract-save timeout branch?**
   Evidence: `f69e3289` is implemented and pushed but remains outside `main`.
   Decide separately from the Fable planning exercise.

2. **Authorize implementation after Fable completes the reviewed plan?**
   Evidence: the master brief makes implementation Phase 8 dormant until Justin
   explicitly names and authorizes the first stage.

### Parked

1. Graph-backed canonical DOCX-to-PDF conversion for Reviews export.
2. Per-reason cron `skipped` counters and sticky per-user reminder defaults.
3. Excel export still carries the full referral clause in the match-reason blob.
4. Invite-tab needs-merge alerts, exact activity ledger, and bespoke invitation due
   dates.
5. SharePoint/Purview operational follow-ups requiring Connor or the M365 compliance
   admin; evidence remains in
   `outputs/sharepoint-retention-handoff-to-codex-2026-08-13.md`.

### Verify Before Acting

1. **Reviewer-token eligibility and automatic-reminder safety are audit leads, not
   accepted current findings.**
   Evidence currently available: the Fable brief names
   `lib/external/token-lifecycle.js`, reviewer send/regeneration services, and
   `pages/api/cron/reviewer-reminders.js` as mandatory confirm-or-refute traces.
   Re-run the entire caller-to-authority-to-persistence trace before proposing a
   repair or exposing campaign toggles.

2. **Reviewer merge authorization is a mandatory confirm-or-refute trace.**
   Evidence currently available:
   `.claude-memory/project-merge-candidates-authorization-gap.md` records the
   app-level-versus-request-scope concern. Fable must re-check the current route,
   service, callers, design decision, data predicate, and partial-failure behavior
   before assigning severity or prescribing a fix.

3. **Dataverse latency is not yet established as the main cause of slow UI updates.**
   Evidence currently available: the Fable brief records overlapping Workbench reads,
   broad post-mutation refresh hypotheses, and missing dependency-level timing as
   items to measure. Do not select caching or a data-plane refactor before Phase 4
   distinguishes external latency, application-generated calls, server work, and
   client rendering.

4. **Existing audit scripts are partial until source inspection proves otherwise.**
   Evidence currently available: `scripts/audit-dataverse-state.js` and
   `scripts/audit-postgres-state.js` are named as probe inputs, not comprehensive
   truth. Inspect every operation before execution and reject any probe with writes
   or sensitive output.

### Do Not Reopen Without New Decision

1. **Adding heading or list controls to the reviewer rich-text toolbar.** The owner
   selected the restricted skinny toolbar for both reviewer entry and manual staff
   entry.
2. **Treating `codex/reviewer-skinny-toolbar` as unpromoted.** Its work is already on
   `main`; the ancestry check and empty `origin/main..codex/reviewer-skinny-toolbar`
   log confirm it.
3. **Using API keys or API credits for Claude Code/Codex agent sessions.** OAuth only.
4. **Restoring the independent client-side Reviews PDF renderer.** Word-only remains
   the current decision; a future PDF converts the canonical DOCX.
5. **Retiring `DEVELOPMENT_LOG.md`.** It remains the milestone record, not a
   per-session diary.
6. **Arming automatic reviewer reminders before their authority contract is
   re-verified and any required hardening is complete.**

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md` | Governing next-session audit, security, refactor-selection, review, and optional implementation brief |
| `shared/components/external/RichReviewEditor.js` | Restricted reviewer rich-text editor |
| `shared/components/workbench/ManualReviewEntryForm.js` | Staff manual review entry using the same skinny toolbar |
| `lib/external/sanitize-review-html.js` | Review HTML allowlist aligned with supported controls |
| `.claude-memory/project-merge-candidates-authorization-gap.md` | Preliminary merge authorization concern requiring fresh verification |
| `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` | Release tier, rehearsal, rollback, and production-write constraints |
| `docs/CI_GATES_REFERENCE.md` | Gate scope, enforcement, and serial self-test rules |

## Testing

Session 427 verification on the integrated `main` tree:

```bash
npx jest tests/unit/manual-review-entry-form.test.js tests/unit/sanitize-review-html.test.js tests/unit/rich-review-editor.test.js --runInBand
npx eslint lib/external/sanitize-review-html.js shared/components/external/RichReviewEditor.js shared/components/workbench/ManualReviewEntryForm.js tests/unit/manual-review-entry-form.test.js tests/unit/sanitize-review-html.test.js tests/unit/rich-review-editor.test.js
npm run check:docs-catalog
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:secret-scan
npm run check:scaffolding-tokens
npx next build --webpack
```

Focused tests passed 43/43. ESLint had zero errors and one non-blocking
`react-hooks/set-state-in-effect` warning in `ManualReviewEntryForm.js`. The canonical
Turbopack build reached TypeScript and then hit the documented managed-environment
process/port permission panic twice; the prescribed Webpack fallback completed with
zero errors and zero warnings.
