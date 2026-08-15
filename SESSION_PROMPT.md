# Session 432 Prompt: Revocation Hardening Implemented & Reviewed — Codex Read-Only Review Next

## Session 431 Summary

Session 431 implemented the owner-authorized Tier-2 disabled-account
revocation hardening in the dedicated worktree
`WMKF_Apps-claude-revocation-hardening` on branch
`codex/claude-revocation-hardening` (base `d32e2d56`, post-merge `main`).
Claude Fable orchestrated: three Sonnet builders with disjoint file
ownership implemented the accepted audit's §10.2 behavioral invariants; two
independent Opus adversarial reviewers then a third delta reviewer verified
the result. **No invariant was refuted; the review cycle converged with zero
unresolved blocking or high-confidence findings.** The branch is pushed and
NOT merged.

### What Was Completed

1. **All 12 §10.2 invariants implemented and regression-tested.**
   - `signIn` looks up the caller's `azure_id` unfiltered and denies a
     not-explicitly-active row before the `last_login` UPDATE and all
     provisioning/notification/reconcile side effects.
   - `jwt` invalidates any staff token (`return {}`) whose
     `is_active = true` lookup returns zero rows, with or without a prior
     `profileId`; DB errors keep the token and defer to route guards'
     fail-closed 503.
   - Bare `requireAuth` does a live per-request `is_active` read for
     non-applicant sessions (profileId, falling back to azure_id) — covering
     blob-proxy, upload-handler, health, api-capabilities; 403 on
     disabled/missing, 503 on DB error.
   - `requireAuthWithProfile` / `requireAppAccess` fail closed on zero rows.
   - `link-profile` verifies the live caller before any write in BOTH
     branches, with `is_active = true` conditional writes and a
     rowcount-checked final UPDATE (409) as TOCTOU backstop.
   - All revocation predicates are NULL-fail-closed (only
     `is_active === true` grants; review-round remediation).
   - No tombstone/denylist, no migration; `is_active = false` is the durable
     revocation mechanism; hard-delete reprovisioning stays an accepted
     residual.
2. **41 new revocation tests** (verified by per-file jest runs + diff count) across `tests/unit/nextauth-revocation.test.js`
   (11), `tests/unit/bare-auth-revocation.test.js` (8),
   `tests/unit/link-profile-revocation.test.js` (12), and
   `tests/unit/utils/auth.test.js` (+10 incl. discriminating zero-row and
   NULL fixtures), each mutation-checked against the pre-fix code. Reviewer 2
   mapped every §10.2 required-regression bullet to a concrete test.
3. **Adversarial review record** (invariant table, builder assignments, all
   three Opus passes, every finding disposition with evidence, residuals):
   `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`
   (status: complete).
4. **Durable docs reconciled:** `docs/AUTHENTICATION_SETUP.md` (two contract
   rows), `docs/agent-wiki/topics/security-auth.md` (revocation bullet,
   layer wording per reviewer 1), source-file docblocks.
5. **Verification, all green on the final tree:** full unit suite (7,652
   tests; only the two failures that reproduce on pristine baseline
   `d32e2d56`: `reconcile-probe-entity-set-count`,
   `notification-trust-model-pushup` — pre-existing `main` drift, untouched
   here); `check:api-routes` + self-test; `check:types`; `npm run lint`
   (0 errors); `npm run build`; doc gates + self-tests (doc-currency,
   fact-consistency, doc-symbol-refs, agent-wiki, canonical-pointers,
   build-claim-freshness, docs-catalog); `git diff --check`.

### Commits (all on `codex/claude-revocation-hardening`)

- `445dd1f8` — Implement disabled-account revocation hardening (audit §10.2 invariants)
- `6268e26b` — Remediate Opus review findings: fail-closed NULL is_active + record review
- (Session 431 closeout commit follows this file's update)

## Next Items

### Verified Open

1. **Codex independent read-only review of `codex/claude-revocation-hardening`.**
   Evidence: this branch at origin; work-order handoff sequence. Codex
   reviews the diff `d32e2d56..HEAD` against
   `docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md` §10.2
   and the implementation record. Do not merge before this review.
2. **Two pre-existing unit failures on `main`** (`reconcile-probe-entity-set-count`,
   `notification-trust-model-pushup`).
   Evidence: reproduced on pristine `d32e2d56` by three independent runs this
   session. Out of scope here; fix on `main`.
3. Security Operating Plan drift (~12 controls unrecorded since 2026-05-05) —
   reconcile with `/sweep` (carried from S430; this session's controls are
   recorded in the implementation audit, not yet in the SOP).
4. `check:trust-boundary-guid` / `check:status-enum-parity` CI backstop
   (carried from S430).
5. Untracked secret-rotation names absent from `lib/utils/tracked-secrets.js`
   (carried from S430).
6. Stale doc counts (DAL migration plan adapters; CANONICAL_COUNTS re-derive)
   (carried from S430).

### Owner Decision Needed (sequence preserved from the work order)

1. **Review and deliberately merge `codex/claude-revocation-hardening`**
   (after Codex's read-only review). `main` auto-deploys.
2. **Workbench observability Stage 1** in a FRESH worktree off post-merge
   `main` (never this worktree or the plan-review worktree).
3. **Stage 2** only after a measured Stage 1 baseline and separate
   authorization.
4. **Intake proxy routing + intake CSRF together** in their own pre-launch
   workstream (extending applicant routing without Origin validation makes
   the latent gap live). Note: the revocation record adds a related residual —
   `requireAuth`'s applicant exemption on bare-auth routes must be revisited
   if the applicant surface classification widens.
5. Campaign window / release posture `[NEEDS OWNER]` (carried).
6. Vercel log-retention confirmation at measurement-window start (carried).
7. Verifier-deselect hardening decision (carried; recommendation: keep
   revoke and deselect distinct).
8. Run the 7-item read-only production-probe list (owner-executed; carried).

### Accepted Residuals This Session (owner may overturn at merge review)

See `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`
"Residual risks": claim-branch 409 race (reprovisioning class), applicant
pass-through on bare-auth routes (pre-existing, proxy-guarded), jwt
fall-through/`requireAuth` backstop coupling, createNew transient signout
window, double `is_active` read on `requireAuthWithProfile` routes,
`/api/health` 503 during a Postgres outage, hard-delete/email-only
reprovisioning (no tombstone by owner decision).

### Do Not Reopen Without New Decision

1. Reviewer merge org-open access (T1) / staff-wide document reads (D4) —
   accepted by-design 2026-08-15 (carried from S430).
2. Full Request Workbench Data Plane big-bang refactor — deferred (carried).
3. Grantee recipient override + stateless invitation tokens — accepted risks
   (carried).
4. Tombstone/denylist for hard-deleted azure_ids — explicitly out of scope by
   owner decision; requires new authorization.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md` | Implementation + adversarial-review record (invariants, dispositions, residuals) |
| `docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md` | The accepted audit this branch implements (§10.2 invariants) |
| `pages/api/auth/[...nextauth].js` | signIn disabled-denial + jwt zero-row invalidation |
| `lib/utils/auth.js` | requireAuth live active check; fail-closed helpers |
| `pages/api/auth/link-profile.js` | Live caller guard + conditional persistence ordering |
| `tests/unit/*revocation*.test.js` | The new regression suites |

## Testing

```bash
# in the WMKF_Apps-claude-revocation-hardening worktree
npx jest tests/unit --silent          # expect 2 known baseline failures only
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:types && npm run lint && npm run build
```
