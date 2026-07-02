# Session 316 Prompt: Honorarium go-live prep + remaining memory hygiene

## Session 315 Summary

This session continued the memory-hygiene/doc-governance work and then reviewed
Claude's parked honorarium portal-creation plan so the next executor has a cleaner
implementation runway.

### What Was Completed

1. **Docs catalog and maintenance guardrails**
   - Added catalog frontmatter to all top-level `docs/*.md` files and generated
     `docs/DOCS_CATALOG.md`.
   - Added `generate:docs-catalog` / `check:docs-catalog`, wired the gate into CI,
     documented it in `docs/CI_GATES_REFERENCE.md`, and added Claude hooks for
     format and commit-time catalog checks.
   - Renamed the no-context intake docs to clearer names and refreshed the catalog.

2. **Memory hygiene follow-through**
   - Trimmed the ready Dynamics/Power Tools memory package:
     `.claude-memory/project-dataverse-power-tools.md` and
     `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`.
   - Reconciled the honorarium no-BILL memory/wiki/docs so they point at
     `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` and the portal-as-sole-creator
     decision, with payment still offline/deferred.

3. **Honorarium strategy review and readiness edits**
   - Reviewed Claude's `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` against
     `lib/bill/honorarium-onboard-orchestrator.js`,
     `lib/bill/honorarium-discriminators.js`,
     `pages/api/external/review/[token]/respond.js`,
     `scripts/backfill-honorarium-capture-only.mjs`, and related tests.
   - Updated the plan from "design/not built" to "config-gated draft exists; not
     live until env flip plus deployment/restart."
   - Added the adversarial readiness gaps to the plan, finance wiki, credentials
     runbook, and repo memories: the historical backfill must first enforce the same
     required-address completeness check as fresh accept and must include
     `akoya_title` in its request reload.

### Commits

- `c9cc0d51` — Document honorarium go-live readiness gaps
- `7695f9b5` — Clarify honorarium portal creation plan status
- `5a192ae1` — Add docs catalog maintenance hooks
- `2e5269e5` — Add docs catalog metadata gate
- `5427e1f1` — Rename intake reconciliation docs
- `e419bb29` — Reconcile honorarium no-BILL memory
- `d9d5f614` — Trim Dynamics memory guardrails
- `93d0faed` — Update Session 315 memory handoff

## Next Items

### Verified Open

1. **Patch honorarium capture-only backfill before execution.**
   Evidence: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §6;
   `scripts/backfill-honorarium-capture-only.mjs` currently reloads
   `REQUEST_SELECT` without `akoya_title` and only skips an entirely empty
   reconstructed address; `pages/api/external/review/[token]/respond.js` defines
   the fresh-accept required fields via `missingRequiredAddressFields`.
   Required change: add `akoya_title` to the backfill request select/reload shape,
   add a required-address completeness check matching fresh accept
   (`line1`, `city`, `postalCode`, `country`, `phone`), and add focused script/unit
   coverage or a dry-run-safe verification.

2. **Honorarium no-BILL go-live sequence, after backfill hardening or if only live
   accepts are in scope.**
   Evidence: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §2 and
   `docs/CREDENTIALS_RUNBOOK.md` optional flags.
   Required sequence: re-run/confirm discriminator GUIDs, set
   `HONORARIUM_PROGRAM_ID`, `HONORARIUM_GRANTPROGRAM_ID`,
   `HONORARIUM_TYPE_ID`, unset `HONORARIUM_ONBOARDING_DEFERRED`, keep
   `BILL_ONBOARDING_DEFERRED=true`, set/confirm `honorarium.default_amount`,
   deploy/restart so module-load env constants take effect, then dry-run the
   hardened backfill for the target cycle before any `--execute`.

3. **Continue memory hygiene cleanup queue, Batch C or another bounded package.**
   Evidence: `docs/audits/memory-cleanup-queue-2026-07-02.md`.
   Dynamics/Power Tools first targets are already done in `d9d5f614`; choose the
   next bounded package rather than reopening those completed trims.

### Owner Decision Needed

1. **Connor — GoApply-linkage question.**
   Evidence: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §7.
   Sent 2026-07-01, awaiting reply: do any payment, folio, Ops dashboard, or report
   paths require `_akoya_goapplyapplication_value`, `_akoya_goapplyphase_value`, or
   `_akoya_goapplysubmitter_value` on honorarium rows? App-created rows are
   structurally absent those GoApply lookups.

2. **Connor — honorarium to proposal self-lookup schema change.**
   Evidence: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §8/§9.
   Proposed lookup: `akoya_request -> akoya_request`, tentative
   `wmkf_relatedproposal`. Once Connor creates it, verify the live navigation
   property name/casing from metadata before uncommenting the orchestrator TODO.

3. **Writeup-generator tab + reviewer-database browse.**
   Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`.
   Needs product prioritization before implementation.

4. **Remit flag on review completion.**
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md`;
   `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §3b.
   Decide whether review submit/PD completion should wire
   `wmkf_authorizationtoremitpaymentflag`; payment remains offline this cycle.

### Verify Before Acting

1. **Confirm request 1003125 shows all 5 renamed applicant reviewers.**
   Evidence currently available: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
   Required preflight: have Duncan reload the Find tab or run a read-only live check
   before treating roster cache staleness as still present.

2. **D26 triage-null sweep.**
   Evidence currently available: `pages/api/workbench/dashboard.js` around the D26
   dashboard filter.
   Offered but not run: a read-only sweep of D26 `akoya_requests` where triage is
   null and status is not Phase II Pending. Re-derive the query before running.

3. **Applicant-suggested roster cache-staleness product fix.**
   Evidence currently available:
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` and
   `reviewer-search-logic.js:123`.
   Re-read current roster/enrichment code before implementing; do not assume the
   S313 finding is still live.

### Parked

1. **Reviewer-materials attach-and-verify build (option 2).**
   Evidence: `docs/agent-wiki/topics/external-reviewer-portal.md`; design commit
   `a84e5f8b`.
   Re-open trigger: owner asks to build the attach-and-verify flow.

2. **Email template bracket-alias cleanup.**
   Evidence: `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5 and
   `.claude-memory/project-email-template-token-syntax.md`.
   Re-open trigger: soak is explicitly greenlit. Do not remove `[bracket]` aliases
   before that.

3. **Track Reviewers board-identity fields + Excel export.**
   Evidence: `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9.
   Re-open trigger: owner prioritizes the read-only surface/export.

4. **Invite-modal campaign timeline collapse.**
   Evidence: `shared/components/reviewers/InviteEmailModal.js` around the
   campaign-timeline block.
   Re-open trigger: owner greenlights the low-effort UI cleanup.

5. **Reviewer nice-to-haves #4 and #5.**
   Evidence: `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4/§5.
   Re-open trigger: owner prioritizes reviewer-memory flag/searchable notes or
   controlled expertise-tag taxonomy.

6. **Full BILL payment pipeline enablement.**
   Evidence: `lib/bill/honorarium-onboard-orchestrator.js`;
   `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §1; `.claude-memory/project-bill-honorarium-integration.md`.
   Re-open trigger: leadership decides to enable person-payee/BILL onboarding next
   cycle. Current cycle is request creation only; payment remains offline by check.

### Do Not Reopen Without New Decision

1. **Honorarium no-BILL memory reconcile.**
   Evidence: `e419bb29`; `.claude-memory/project-honorarium-payment-landscape.md`;
   `docs/agent-wiki/topics/finance-honoraria.md`.
   This is done; do not carry the old "memory reconcile" task forward.

2. **Dynamics/Power Tools first memory trim package.**
   Evidence: `d9d5f614` changed
   `.claude-memory/project-dataverse-power-tools.md` and
   `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`.
   Continue with Batch C or another package, not these completed first targets.

3. **Digit-stripping name normalization is load-bearing.**
   Evidence: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.

4. **Thank-you email has no secure-link button.**
   Evidence: `pages/api/review-manager/send-emails.js`; commit `3817944e`.

5. **`{{proposalTitle}}` and `{{proposalClause}}` are distinct.**
   Evidence: `.claude-memory/project-email-template-token-syntax.md`.

6. **Email template dual-syntax `[bracket]` aliases are intentional.**
   Evidence: `.claude-memory/project-email-template-token-syntax.md`.

7. **h-index is not staff-editable in reviewer edit modals.**
   Evidence: `CandidateEditModal.js`; commit `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` | Current no-BILL honorarium request-creation plan, open Connor items, and backfill readiness gaps. |
| `scripts/backfill-honorarium-capture-only.mjs` | Historical capture-only backfill; must be hardened before execution. |
| `lib/bill/honorarium-onboard-orchestrator.js` | Config-gated honorarium create body and BILL-tail handoff. |
| `lib/bill/honorarium-discriminators.js` | Module-load discriminator env constants; deploy/restart required after env flip. |
| `docs/DOCS_CATALOG.md` | Generated top-level docs inventory; regenerate with `npm run generate:docs-catalog`. |
| `docs/CI_GATES_REFERENCE.md` | Gate catalog, including docs catalog, agent wiki, and memory/router gates. |
| `docs/audits/memory-cleanup-queue-2026-07-02.md` | Remaining memory cleanup queue after Dynamics first targets. |

## Testing

```bash
# Honorarium/backfill work
npx jest tests/unit/honorarium-onboard-orchestrator.test.js tests/unit/respond-required-address.test.js --runInBand
npx jest tests/integration/external-review-routes.test.js --runInBand

# Durable docs / memory work
npm run generate:docs-catalog
npm run check:docs-catalog
npm run check:doc-currency
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
npm run check:agent-wiki
npm run check:fact-consistency
npm run check:memory-router
```
