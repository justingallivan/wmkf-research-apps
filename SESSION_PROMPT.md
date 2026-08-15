# Session 433 Prompt: Revocation Hardening Re-Review Complete — Owner Merge Decision Next

## Session 431 Summary

Session 431 implemented the owner-authorized Tier-2 disabled-account
revocation hardening in the dedicated worktree
`WMKF_Apps-claude-revocation-hardening` on branch
`codex/claude-revocation-hardening` (base `d32e2d56`, post-merge `main`).
Claude Fable orchestrated: three Sonnet builders with disjoint file
ownership implemented the accepted audit's §10.2 behavioral invariants; two
independent Opus adversarial reviewers then a third delta reviewer verified
the result. An independent Codex merge review subsequently found that the
accepted DELETE-before-replacement link-profile race contradicted the durable
revocation invariant. Justin authorized Codex to fix it on this branch.
Codex preserved the caller row for `createNew`, made existing-profile transfer
transactional, added truthful zero-row archive semantics and discriminating
tests, and reconciled the durable record. Claude then completed an independent
three-pass Opus adversarial re-review with no unresolved blocking or
high-confidence findings. The branch remains NOT merged and awaits Justin's
deliberate merge decision.

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
   - `link-profile` locks and verifies the live caller inside a transaction.
     `createNew` finalizes the temporary row in place; existing-profile claims
     lock caller + target and commit DELETE + UPDATE atomically, rolling the
     DELETE back on any failed target outcome. Archive reports success only
     when its UPDATE affects a row.
   - All revocation predicates are NULL-fail-closed (only
     `is_active === true` grants; review-round remediation).
   - No tombstone/denylist, no migration; `is_active = false` is the durable
     revocation mechanism; hard-delete reprovisioning stays an accepted
     residual.
2. **51 new revocation tests** across `tests/unit/nextauth-revocation.test.js`
   (11), `tests/unit/bare-auth-revocation.test.js` (8),
   `tests/unit/link-profile-revocation.test.js` (20),
   `tests/unit/database-service-archive.test.js` (2), and
   `tests/unit/utils/auth.test.js` (+10 including discriminating zero-row and
   NULL fixtures). The Codex additions prohibit createNew DELETE/INSERT,
   require caller + target row locks, prove a post-DELETE target failure rolls
   back rather than commits, and pin zero-row archive failure. Claude's
   re-review round added the self-claim (own temp-row id, numeric and string)
   cases and healthy-connection-release assertions on all success paths.
3. **Adversarial review record** (invariant table, builder assignments, all
   three Opus passes, Codex's merge review/remediation, every finding
   disposition with evidence, residuals):
   `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`
   (status: complete).
4. **Durable docs reconciled:** `docs/AUTHENTICATION_SETUP.md` (two contract
   rows), `docs/agent-wiki/topics/security-auth.md` (revocation bullet,
   layer wording per reviewer 1), source-file docblocks.
5. **Verification:** Claude's pre-Codex full-unit run executed 7,652 tests and
   reproduced only the two failures also present on pristine baseline
   `d32e2d56` (`reconcile-probe-entity-set-count` and
   `notification-trust-model-pushup`). On the Codex-remediated tree Codex's
   targeted revocation run passed 91/91 across five suites; after Claude's
   re-review round added two tests, the five-suite run passes 93/93 and
   Claude's own full-unit run on the final tree passed 7,660/7,662 (same two
   pre-existing baseline failures only). `check:api-routes` + self-test,
   `check:types`, `npm run lint` (0 errors), `npm run build`,
   `check:agent-invariants`, and the relevant doc gates + self-tests all
   passed; `git diff --check` is clean.

### Commits (all on `codex/claude-revocation-hardening`)

- `445dd1f8` — Implement disabled-account revocation hardening (audit §10.2 invariants)
- `6268e26b` — Remediate Opus review findings: fail-closed NULL is_active + record review
- `7b8b3d95` — Close Session 431 with reviewed revocation-hardening handoff
- `b85a84f9` — Fix revocation-linking concurrency ordering (owner-authorized Codex remediation)
- `49b4c402` — Prepare Claude race-fix re-review handoff (Codex)
- `1244718b` — Close Claude re-review; add self-claim/healthy-release tests and reconcile records
- `613771e0` — Fix final delta-review documentation and test-comment nits

## Next Items

### Verified Open

1. **Owner's deliberate merge decision for `codex/claude-revocation-hardening`.**
   Evidence: Codex's remediation and Claude's independent three-pass Opus
   re-review are complete with no unresolved blocking or high-confidence
   findings. No further reviewer gate remains open; `main` auto-deploys.
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
   (after Claude's independent re-review of the Codex delta). `main`
   auto-deploys.
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
"Residual risks": applicant pass-through on bare-auth routes (pre-existing,
proxy-guarded), jwt fall-through/`requireAuth` backstop coupling, double
`is_active` read on `requireAuthWithProfile` routes, `/api/health` 503 during
a Postgres outage, and hard-delete/email-only reprovisioning (no tombstone by
owner decision). The link-profile 409 and createNew DELETE/INSERT races are
resolved, not residuals.

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
| `pages/api/auth/link-profile.js` | Locked caller guard + transactional identity transfer |
| `tests/unit/*revocation*.test.js` | The new regression suites |

## Testing

```bash
# in the WMKF_Apps-claude-revocation-hardening worktree
npx jest tests/unit --silent          # expect 2 known baseline failures only
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:types && npm run lint && npm run build
```
