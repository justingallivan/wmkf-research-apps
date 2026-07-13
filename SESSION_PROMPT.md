# Session 364 Prompt: Choose the next reviewer-identity slice

## Session 363 Summary

Session 363 completed the Codex takeover of the Wave 13 reviewer-binding smoke,
merged the reviewed implementation, and executed the owner-authorized production
positive control with cleanup while retaining the completed queue job.

### What Was Completed

1. **Round-3 and round-4 findings closed**
   - Completed-only deployment attribution now requires the exact job in
     `completedJobIds`; lease-guarded outcomes fail closed.
   - Incremental recovery state is persisted across every production write
     boundary and fatal signal/error path.
   - Cleanup fences, signal/main coordination, deterministic failure
     classification, fixture authorization, and the hook false positive were
     hardened.
   - Independent round-4 focused re-review returned **NO FINDINGS**.

2. **PR #60 merged and deployed**
   - `de60fb96` implemented the final adversarial-remediation set.
   - `a872fbcf` committed owner authorization for request `1002379`
     (`54e2b88b-04b9-f011-bbd3-6045bd02b4cc`).
   - PR #60 merged to `main` at `5bb6a8b8`.
   - Exact production deployment:
     `dpl_BqCBSFWoRto2noQdrovHG7fBsA6X`.

3. **Production smoke passed with verified cleanup**
   - Smoke `smoke-reviewer-binding-20260713232414` completed against request
     `1002379`.
   - Postgres job `25` completed with `attempts=0` and no error.
   - Maintenance run `15060` attributed that exact completed job to the
     expected deployment.
   - Exact Wave 13 `self_reported` binding assertions passed; no contact link
     or system alert was created.
   - Synthetic suggestion and person rows were deleted and absence-verified.
     Population returned to the exact pre-smoke baseline: person `1`,
     suggestion `0`.
   - Job `25` was deliberately retained as the completed audit row.
   - Local gitignored recovery/result artifact:
     `outputs/smoke-reviewer-binding-20260713232414-result.json`.

4. **Durable documentation reconciled**
   - The production execution record, active reviewer plan, reviewer-identity
     wiki, project memory, milestone log, and this handoff now record the same
     completed state.
   - `CLAUDE.md` was reviewed and left unchanged: no global convention,
     endpoint contract, or configuration rule changed.

### Commits

- `de60fb96` - `fix(reviewer): harden binding smoke recovery`
- `a872fbcf` - `chore(reviewer): authorize binding smoke fixture`
- `5bb6a8b8` - Merge PR #60

## Next Items

### Verified Open

1. **Broader Wave 13 migration remains gated.**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` I1.2–I1.3
   and `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.
   Policy-reader migration, automated/staff callers, correction/revocation,
   merge behavior, backfill, and the four suggestion COI fields are not
   promoted by the smoke.

### Owner Decision Needed

1. **Choose the next reviewer-redesign slice.**
   Evidence: the active hybrid plan has both measurement foundations (M1) and
   broader identity/policy work (I1) still gated.
   Decide whether the next session should advance measurement/baseline work or
   design one narrow additional identity/policy promotion. Do not infer a
   promotion decision from the successful smoke.

### Parked

1. **Dataverse target interlock `warn` → `on`.**
   Evidence: `CLAUDE.md` and
   `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.
   Re-open only after the planned production log-observation gate.

### Verify Before Acting

1. **Do not infer the origin of the one-row Wave 13 person baseline.**
   Evidence: the smoke's fresh pre-run population was person `1` /
   suggestion `0`; cleanup restored exactly that state, but the smoke did not
   inspect or adjudicate the pre-existing row.
   Run the read-only population/detail probe before making organic-throughput or
   migration claims.

2. **PostgreSQL SSL-mode warning is observed, not diagnosed.**
   Evidence: the post-smoke Vercel error-level scan showed one
   `pg-connection-string` deprecation/security warning on
   `/api/cron/drain-submissions`; the request returned HTTP 200 and was
   unrelated to the reviewer smoke.
   Trace the live connection-string source and marketplace configuration before
   changing SSL parameters.

### Do Not Reopen Without New Decision

1. **Do not delete reviewer acceptance job `25`.**
   Evidence: the owner explicitly chose “keep the job”; the row is completed,
   `attempts=0`, with no error.

2. **Do not rerun the production smoke or run `scripts/pr4-e2e.js`.**
   Evidence: the positive control is complete and cleaned up; any new production
   run requires a fresh owner authorization and exact deployment attestation.
   `scripts/pr4-e2e.js` remains quarantined for this purpose.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md` | Production smoke design, review, and execution record |
| `scripts/smoke-reviewer-binding.js` | Manual owner-gated production runner |
| `scripts/lib/smoke-reviewer-binding-core.js` | Pure safety, attribution, assertion, and cleanup contracts |
| `scripts/lib/smoke-reviewer-binding-fixtures.js` | Committed owner-approved fixture allowlist |
| `lib/services/reviewer-acceptance-drain.js` | Queue drain and per-outcome job telemetry |
| `pages/api/cron/drain-reviewer-acceptances.js` | Deployed cron and maintenance-run deployment fingerprint |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active broader reviewer redesign plan |
| `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md` | Current reviewer-identity direction and constraints |

## Testing

```bash
npm test
npm run check:types
npm run lint
npm run check:docs-catalog
npm run check:fact-consistency
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
npm run check:doc-currency
npm run check:memory-drift:no-write
git diff --check
```

The production smoke is complete. Do not rerun it from a routine development
session.
