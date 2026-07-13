# Session 362 Prompt: adversarial review before a reviewer-binding smoke

## Session 361 Summary

The first production caller of the Wave 13 reviewer identity-binding writer is
deployed, but no positive durable binding event has yet been observed. Rather
than wait indefinitely for an organic reviewer acceptance, the owner requested
a Claude handoff that adversarially reviews both the deployed code and the
existing production-touching PR4 test runner before any smoke test is designed
or run.

### What Was Completed

1. **Identity-receipt lifetime and writer contracts were hardened**
   - The owner selected a 14-day TTL for reviewer-candidate attestation receipts.
   - The adversarial-review fixes tightened timestamp normalization, transition
     complements, signed-decision enforcement, shared field authority, batch
     correlation uniqueness, and the production Wave 13 preflight contract.
   - PR #55 merged these changes to `main` at `3a90785c`.

2. **The first durable binding-writer caller was promoted**
   - Acceptance-drain self-report now passes the durable job's stable
     `accepted_at` into `capture-self-reported-orcid.js`.
   - Clean and already-bound rows use the versioned writer. Only typed
     `legacy_classification_required` may take the transitional two-write
     fallback; every other writer failure stops downstream work and leaves the
     durable job retryable.
   - PR #57 merged at `00ffb09c`; Vercel deployment
     `dpl_4YpnVVdRmDHyuzgPVSKXNcx22bKu` reached READY on production aliases.
   - Immediate scheduled-drain observation found no error-level logs, while the
     dated post-deploy population probe still found zero Wave 13 rows. That is
     not a permanent current-state guarantee.

3. **Durable documentation was reconciled after promotion**
   - PR #56 merged the docs-catalog dependency repair at `851f693b`.
   - PR #58 merged the first-caller production status at `53f85236`.
   - The implementation plan, data model, person Atlas, service catalog,
     reviewer-identity wiki, and project memory agree that the caller is live
     while broader writers/readers remain gated.

4. **A read-only adversarial-review handoff was prepared for Claude**
   - `docs/REVIEWER_IDENTITY_BINDING_PRODUCTION_SMOKE_ADVERSARIAL_REVIEW_HANDOFF.md`
     requires a whole-flow review of the deployed caller and
     `scripts/pr4-e2e.js`, then an attack on the proposed dedicated-smoke design.
   - The brief forbids live writes, production smoke execution, implementation,
     commits, and pushes. Claude's only permitted write is the requested review
     artifact under `outputs/`.
   - The handoff landed directly on `main` as docs-only commit `937df5fe`.

### Commits

- `42b4e7d5` - `fix(reviewer): shorten identity receipt TTL`
- `722ebe3b` - `fix(reviewer): harden identity binding contracts`
- `3a90785c` - Merge PR #55, reviewer-attestation TTL and hardening
- `9f244036` - `fix(docs): remove ignored review dependency`
- `851f693b` - Merge PR #56, docs-catalog repair
- `1978413b` - `feat(reviewer): activate durable self-report binding`
- `00ffb09c` - Merge PR #57, first production binding caller
- `533180c1` - `docs(reviewer): record binding caller promotion`
- `53f85236` - Merge PR #58, production-live documentation
- `937df5fe` - `docs(reviewer): hand off binding smoke adversarial review`

## Next Items

### Verified Open

1. **Have Claude perform the read-only adversarial review.**
   Evidence: the controlling brief is
   `docs/REVIEWER_IDENTITY_BINDING_PRODUCTION_SMOKE_ADVERSARIAL_REVIEW_HANDOFF.md`;
   the required output
   `outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md`
   was verified absent at session close.
   Start with `/start`, follow the handoff literally, use `/contract-reconcile`
   in review mode, and produce only the named output artifact.

### Owner Decision Needed

1. **Choose the smoke implementation only after reviewing Claude's verdict.**
   Evidence: the handoff requires separate verdicts for deployed code, the
   current PR4 script, and the proposed smoke architecture.
   Decide whether to implement a dedicated guarded smoke, repair the PR4 runner,
   use a persistent fixture, accept a narrower proof, or continue waiting for an
   organic positive control. This decision also owns production fixture/request
   selection, cleanup authority, and whether acceptance-job audit rows may be
   deleted.

### Parked

1. **Broader Wave 13 caller and reader migration.**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` and
   `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.
   Automated writers, staff correction, merge/revocation, backfill, action-policy
   readers, and structured suggestion COI currency remain gated.

2. **Unrelated operational follow-ups.**
   Evidence: prior session carryover, unchanged by Session 361.
   Interlock `warn` to `on`, Daily Maintenance operational confirmation,
   `label_conflict` spot-check, reviewer-institution linking, and address-based
   onboarding remain outside this slice.

### Verify Before Acting

1. **Refresh production evidence before treating the zero-population snapshot as current.**
   Evidence currently available:
   `docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md` and the
   post-deploy observation recorded in the person Atlas.
   An organic binding may appear at any time; use read-only population/log/job
   inspection before planning or implementing against the old zero-row result.

2. **Re-prove every production-smoke safety precondition before execution.**
   Evidence currently available: the adversarial-review handoff's Part C and
   residual owner gates.
   Verify the request/fixture is approved and non-live, excluded side effects are
   mechanically prevented, cron races and interruption are safe, exact cleanup
   permissions are known, audit-retention policy is resolved, and final baseline
   restoration is measurable.

### Do Not Reopen Without New Decision

1. **Do not run `scripts/pr4-e2e.js` or any production smoke from the handoff session.**
   Evidence: the Claude brief is explicitly read-only and forbids all PR4,
   setup, cleanup, cron, and live-write execution.

2. **Do not change the 14-day reviewer-attestation TTL as part of smoke work.**
   Evidence: owner decision implemented in `42b4e7d5` and merged through PR #55.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_IDENTITY_BINDING_PRODUCTION_SMOKE_ADVERSARIAL_REVIEW_HANDOFF.md` | Controlling Claude review brief |
| `scripts/pr4-e2e.js` | Existing production-touching runner under review; do not run |
| `lib/services/reviewer-acceptance-drain.js` | Durable worker and side-effect ordering |
| `lib/services/capture-self-reported-orcid.js` | Stable-event binding entry point and typed fallback |
| `lib/services/reviewer-identity-binding-writer.js` | Versioned, fail-closed Wave 13 writer |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Migration status and broader gates |
| `docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md` | Dated metadata/population evidence |

## Testing

For the Claude review, use only read-only inspection, static gates, and focused
mock/disposable-state tests permitted by the handoff. Do not run the production
smoke or any PR4 setup/cleanup command.

After any later documentation changes, run the applicable docs catalog,
fact-consistency, symbol-reference, build-claim-freshness, doc-currency, memory
drift, and `git diff --check` gates, including each defined self-test
sequentially.
