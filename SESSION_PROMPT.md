# Session 365 Prompt: Reviewer holistic pilot follow-up

## Session 364 Summary

Session 364 completed the revised reviewer-identity benchmark transition,
executed the frozen 60-slot reviewer-holistic run, scored an owner-approved
10-candidate-per-proposal pilot, and reconciled the durable plan. Production
routes remain legacy-default; no redesign behavior was promoted.

### What Was Completed

1. **M1.1 identity benchmark v2 frozen and validated**
   - Revised single-reviewer benchmark contains 25 Bind and 15 Abstain labels.
   - ORCID clarifications for Sang, Landsman, Tsai, and Harcombe are preserved.
   - Validator and manifest now support the v2 benchmark/import pair; targeted
     tests passed.

2. **M1.2 paid execution completed**
   - Frozen executor completed 60/60 slots with 0 failures.
   - Original blinded package contains 345 candidates; the tracked v1
     evaluation asset remains unchanged and unscored.

3. **Scoped 10-candidate pilot scored and unblinded**
   - The editable workbook contains 10 active candidates per proposal (100
     total) and preserves 245 excluded rows.
   - The scoped scored artifact passed `validateProposalEvaluation` with
     `requireScored: true`.
   - Aggregate eligible-shortlist yield tied baseline (61–61); no wrong-person
     candidate was shortlisted in either arm.
   - The raw slate contained five redesign-only wrong-person cases, so the
     redesign remains promising but needs final-output filtering before any
     production decision.

4. **Failure analysis and durable-doc reconciliation**
   - Failure analysis separates identity, topicality, eligibility, and
     retirement/emeritus policy exclusions.
   - The active plan records the scoped pilot and explicitly distinguishes it
     from the unscored 345-candidate comparison.
   - `check:docs-catalog`, `check:fact-consistency`, its self-test, and
     `npm run eval:reviewer-holistic:m1` passed.

### Commits

- `e94e8f7` - Complete M1 identity v2 and record scoped pilot (feature branch)
- Main-branch session handoff commit: created by the stop workflow

## Next Items

### Verified Open

1. **Broader Wave 13 migration remains gated.**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` I1.2–I1.3
   and `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.
   Policy-reader migration, automated/staff callers, correction/revocation,
   merge behavior, backfill, and suggestion COI fields are not promoted by this
   evaluation.

### Owner Decision Needed

1. **Whether to authorize any production reviewer-redesign pilot.**
   Evidence: the scoped offline pilot was evaluation-only and production
   remains legacy-default. Any live pilot still requires the F2 assignment,
   attribution, safety, and promote/stop gates in the active plan.

### Parked

1. **Fresh scoped rerun after final-output filtering.**
   Evidence: `outputs/reviewer-holistic-m1/reviewer-holistic-m1-10-pilot-failure-analysis-v1.md`.
   Re-open only if the owner wants to test a new filter or a revised topicality/
   eligibility rubric; create a new evaluation version rather than overwriting
   the current artifacts.

2. **Dataverse target interlock `warn` → `on`.**
   Evidence: `CLAUDE.md` and `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.
   Re-open only after the planned production log-observation gate.

### Verify Before Acting

1. **Do not cite the scoped pilot as the original full M1.2 result.**
   Evidence: `reviewer-holistic-m1-10-pilot-scope-v1.json` records 100 scored
   candidates versus 345 in the original package.

2. **Do not mutate the frozen v1 evaluation to add a new rubric or scope.**
   Create a new evaluation version and manifest entry first.

3. **Retirement/emeritus exclusions must be explicitly annotated before a
   future rerun.** Otherwise they remain indistinguishable from generic
   `independentEligible = false` judgments.

4. **Do not infer the origin of the one-row Wave 13 person baseline.**
   Evidence: the prior smoke restored person `1` / suggestion `0` but did not
   inspect or adjudicate the pre-existing person row. Run the read-only
   population/detail probe before making organic-throughput or migration claims.

5. **PostgreSQL SSL-mode warning is observed, not diagnosed.**
   Evidence: the prior post-smoke scan recorded one `pg-connection-string`
   warning on `/api/cron/drain-submissions`; trace the live connection-string
   source before changing SSL parameters.

### Do Not Reopen Without New Decision

1. **Do not switch production routes to the redesign.** The evaluation-only arm
   has no production dispatcher or user-selectable arm.

2. **Do not rerun the production smoke, run `scripts/pr4-e2e.js`, or delete
   reviewer acceptance job 25.**
   The prior positive control is complete, cleaned up, and owner-approved to
   remain as the audit row; any new production run needs fresh authorization and
   exact deployment attestation.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active reviewer redesign plan and evaluation status |
| `docs/audits/reviewer-holistic-evaluation-manifest-v1.json` | Frozen M1 evaluation contract |
| `outputs/reviewer-holistic-m1/reviewer-holistic-m1-10-pilot-scored-v1.json` | Scoped 100-candidate scored artifact (local/ignored) |
| `outputs/reviewer-holistic-m1/reviewer-holistic-m1-10-pilot-comparison-v1.json` | Scoped arm comparison (local/ignored) |
| `outputs/reviewer-holistic-m1/reviewer-holistic-m1-10-pilot-failure-analysis-v1.md` | Post-hoc failure and eligibility analysis (local/ignored) |

## Testing

```bash
npm run eval:reviewer-holistic:m1
npm run check:docs-catalog
npm run check:fact-consistency
npm run check:fact-consistency:self-test
```

The scoped pilot is complete. Do not run another paid or production evaluation
without a new owner decision and a new evaluation version.
