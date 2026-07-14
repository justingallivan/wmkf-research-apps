# Session 365 Prompt: Promote the reviewer measurement and policy foundations

## Session 364 Summary

Session 364 followed the owner-selected low-touch path after the Wave 13
production smoke. It built the behavior-free M1 evaluation foundation, captured
the observational channel baseline, assembled and owner-approved the 40-case
identity evidence pool, explicitly parked human labeling, completed the C0.4
send-eligibility audit, and added the inert Stage A action-policy foundation.
It also restored PR #61 CI and diagnosed the recurring PostgreSQL SSL warning
without changing production configuration.

### What Was Completed

1. **M1 measurement foundation and low-touch baseline built**
   - Added fail-closed M1 asset validators, draft identity/proposal evaluation
     assets, and unit coverage.
   - Captured the aggregate-only M1.3 production baseline: 668 suggestion
     engagement rows, 275 exclusive-token rows, 393 multi-touch rows, and 11
     observed source tokens. The artifact contains no names, emails, or proposal
     content and is observational rather than causal evidence.
   - Assembled the M1.1 public-evidence pool with 20 hazard and 20 clean-positive
     proposed cases. The owner approved the pool unchanged, then explicitly
     parked labeler/adjudicator selection, labeling, adjudication, rubric and
     threshold approval, and freeze.
   - M1.2 remains an empty draft contract; no held-out proposal cohort or PD
     scorer has been selected.

2. **C0.4 send-eligibility contract audited**
   - The audit found that render/send cannot currently observe authoritative
     Wave 13 person-binding and proposal-COI currency, and that render may rotate
     external-token state before send.
   - The fresh explicit-target population evidence remains one person row and
     zero suggestion rows with any Wave 13 value. Runtime fail-closed enforcement
     would therefore block essentially all current outreach.
   - Runtime enforcement remains gated on explicit population/classification,
     shadow reason counts, render-time token protection, server-owned stage
     semantics, and a separate owner-approved Tier-2 promotion.

3. **C0.4 Stage A foundation built but kept inert**
   - Added the pure `reviewer-action-policy` helper with the closed result set
     `eligible | legacy_unclassified | binding_invalid | derived_stale |
     coi_unknown | coi_conflict | coi_stale`.
   - Added shared Wave 13 field lists and exact specialized person/suggestion
     projections, preserving the applicant-excluded refusal.
   - Complement-driven tests cover malformed, null, stale, conflict, unknown,
     current-clear, and projection behavior.
   - A raw-symbol census found no runtime caller. Render/send behavior and
     production behavior remain unchanged.

4. **PR CI repaired and branches published**
   - Updated the stale Playwright campaign-settings expectation to include the
     current `desiredCount` payload.
   - PR #61 (`codex/m1-evaluation-foundation`) finished with 8 passing checks
     and no failures.
   - Draft PR #62 (`codex/c0-4-action-policy-foundation`) is stacked on PR #61
     and finished with 7 passing checks and no failures.

5. **PostgreSQL SSL warning diagnosed read-only**
   - `/api/cron/drain-submissions` constructs `pg.Pool` directly from
     `POSTGRES_URL` (falling back to `DATABASE_URL`).
   - Vercel inspection confirmed the selected production URL comes from the
     connected `expert-reviewers-neon-db` Marketplace resource and carries
     `sslmode=require` with no `uselibpqcompat` flag.
   - `pg-connection-string@2.13.0` currently aliases `require` to strict
     `verify-full` and warns that its next major version will adopt standard,
     weaker libpq `require` semantics. The observed requests still returned 200.
   - No environment value, Marketplace resource, connection code, or SSL
     configuration was changed.

6. **Durable documentation reconciled**
   - The active implementation plan, reviewer project memory, Atlas pages,
     service catalog, reviewer-identity wiki, audit, and this handoff agree that
     M1.1 labeling is parked and C0.4 Stage A is inert.
   - `CLAUDE.md` was reviewed and left unchanged: no global convention, endpoint,
     schema, script convention, or configuration contract changed.
   - `DEVELOPMENT_LOG.md` was left unchanged because these are draft measurement
     and containment foundations, not a production milestone.

### Commits

- `0c212291` - `feat: build reviewer M1 evaluation foundation`
- `d00dd62b` - `feat: assemble reviewer identity benchmark pool`
- `eae225bf` - `docs: park M1 identity labeling`
- `3282ad07` - `docs: audit reviewer send eligibility`
- `22acddbf` - `test: align campaign settings payload`
- `bf4c72da` - `feat: add inert reviewer action policy`

## Next Items

### Verified Open

1. **PR #61 is green and awaits deliberate merge.**
   Evidence: PR #61 reported 8 passing checks / 0 failures at the Session 364
   stop; branch tip `22acddbf` is pushed to
   `origin/codex/m1-evaluation-foundation`.
   Description: re-check the live PR state, then merge if the owner wants the
   M1 foundations and C0.4 audit on `main`.

2. **Draft PR #62 is green but stacked on PR #61.**
   Evidence: PR #62 reported 7 passing checks / 0 failures at the Session 364
   stop; branch tip `bf4c72da` is pushed to
   `origin/codex/c0-4-action-policy-foundation`.
   Description: only after PR #61 merges, re-check the diff, retarget PR #62 to
   `main`, rerun/confirm CI, and decide whether to promote the inert Stage A
   foundation.

### Owner Decision Needed

1. **Choose whether to merge PR #61 and then promote PR #62.**
   Evidence: both PRs are green, but PR #62 is intentionally a separate stacked
   branch. Neither open PR should be described as shipped to `main`.
   Decision needed: merge order and timing.

2. **Choose whether to schedule an explicit SSL-mode cleanup.**
   Evidence: production uses a Marketplace-managed Neon URL with
   `sslmode=require`; current `pg` behavior is strict and successful, but the
   parser logs a future-semantics warning on direct `pg.Pool` cold starts.
   Decision needed: leave the non-urgent warning for the provider/dependency to
   resolve, or authorize a reviewed code-level normalization to
   `sslmode=verify-full` across all direct runtime `pg` callers. Do not casually
   hand-edit Marketplace credentials.

3. **M1.2 still needs a ten-proposal cohort and named PD scorer.**
   Evidence: `docs/audits/reviewer-holistic-proposal-evaluation-v1.json` remains
   intentionally empty and the active plan records the owner freeze gate.
   Decision needed: resume only when the owner has time for the hands-on scoring
   exercise.

### Parked

1. **M1.1 human labeling and freeze.**
   Evidence: the owner approved the 40 proposed cases unchanged, then explicitly
   parked the exercise on 2026-07-14; all expected labels and labelers remain
   null with adjudication pending.
   Re-open trigger: explicit owner instruction to resume and select labelers,
   adjudicator, rubric, and thresholds.

2. **Dataverse target interlock `warn` → `on`.**
   Evidence: `CLAUDE.md` and
   `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.
   Re-open only after the planned production log-observation gate.

### Verify Before Acting

1. **Do not wire C0.4 Stage A into render or send.**
   Evidence currently available: one person row and zero suggestion rows carry
   any Wave 13 value; the helper and projections intentionally have no runtime
   caller.
   Required preflight: complete the separately owner-gated I1/I2 writers and
   classification, produce shadow reason counts, define server-owned template
   stage semantics, and run `/contract-reconcile` before any Tier-2 promotion.

2. **Re-check the stacked PR topology before merge or retarget.**
   Evidence currently available: PR #62 is based on
   `codex/m1-evaluation-foundation`, not `main`.
   Required preflight: confirm PR #61 has merged, refresh the branch/diff, and
   ensure PR #62 contains only the Stage A delta.

3. **Audit every direct runtime `pg` caller before an SSL fix.**
   Evidence currently available: the warning is visible on
   `/api/cron/drain-submissions`, while `pages/api/intake/submit.js` and
   `lib/services/irs-bmf-service.js` also construct `pg.Pool` from the same URL
   family.
   Required preflight: verify current Marketplace values and dependency
   semantics, preserve pooled/non-pooled selection, and test certificate and
   hostname verification without exposing credentials.

4. **Do not infer the origin of the one-row Wave 13 person baseline.**
   Evidence currently available: the production smoke restored the exact
   pre-run population of person `1` / suggestion `0`, but did not inspect the
   pre-existing row.
   Required preflight: run the read-only population/detail probe before making
   organic-throughput or migration claims.

### Do Not Reopen Without New Decision

1. **Do not delete reviewer acceptance job `25`.**
   Evidence: the owner explicitly chose “keep the job”; the row is completed,
   `attempts=0`, with no error.

2. **Do not rerun the production binding smoke or `scripts/pr4-e2e.js`.**
   Evidence: the positive control completed with verified cleanup; any new
   production run requires fresh owner authorization and exact deployment
   attestation.

3. **Do not start M1.1 labeling from the approved case pool alone.**
   Evidence: case approval did not approve labels, labelers, the rubric,
   thresholds, an adjudicator, or freeze; the exercise is explicitly parked.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active reviewer redesign plan and owner gates |
| `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md` | Durable reviewer direction, M1 status, and C0.4 constraints |
| `docs/audits/reviewer-holistic-identity-benchmark-v1.json` | Owner-approved but unlabeled 40-case M1.1 pool |
| `docs/audits/reviewer-holistic-proposal-evaluation-v1.json` | Empty M1.2 evaluation contract |
| `docs/audits/reviewer-channel-baseline-2026-07-14.json` | Aggregate-only M1.3 production baseline |
| `scripts/validate-reviewer-holistic-m1-assets.js` | Fail-closed M1 asset validator |
| `scripts/probe-reviewer-channel-baseline.js` | Explicit-target read-only M1.3 probe |
| `scripts/collect-reviewer-holistic-identity-cases.js` | Reproducible M1.1 evidence collector |
| `docs/audits/reviewer-c0-4-send-eligibility-audit-2026-07-14.md` | Whole-flow C0.4 audit and staged scope |
| `lib/services/reviewer-action-policy.js` | Pure inert Stage A policy evaluator |
| `lib/utils/reviewer-action-policy-fields.js` | Shared exact Wave 13 projection literals |
| `lib/dataverse/adapters/potential-reviewer.js` | Specialized person action-policy projection |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Specialized suggestion action-policy projection |
| `pages/api/cron/drain-submissions.js` | Direct `pg.Pool` path that emits the SSL warning |

## Testing

```bash
# M1 draft assets and focused Stage A behavior
npm run eval:reviewer-holistic:m1
npm test -- --runInBand tests/unit/reviewer-holistic-m1.test.js tests/unit/reviewer-action-policy.test.js tests/unit/reviewer-action-policy-projections.test.js

# Full verification used in Session 364
TZ=UTC npm test -- --runInBand
npm run check:types
npm run lint
npm run check:agent-wiki
npm run check:atlas
npm run check:docs-catalog
npm run check:fact-consistency
npm run check:doc-symbol-refs
npm run check:build-claim-freshness
npm run check:doc-currency
npm run check:memory-router
git diff --check
```

Session 364 verification passed 486 suites / 5,645 tests under `TZ=UTC`, type
checking, lint with 0 errors (50 pre-existing warnings), all listed documentation
gates and their self-tests, secret scanning, and scaffolding-token checks. The
first local full-test run had one timezone-sensitive PubMed date failure under
`Europe/Madrid`; that targeted test and the full suite passed under `TZ=UTC`.
