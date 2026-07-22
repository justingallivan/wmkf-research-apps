# Session 366 Prompt: Reviewer holistic evaluation hardening

## Session 365 Summary

Session 365 ran an adversarial review of Session 364's reviewer-holistic M1
work. Every material Session 364 claim was recomputed from raw artifacts or
re-executed with the branch's own code and survived falsification; no
correctness defects were found. Two MEDIUM process/coverage findings were
recorded for the next evaluation cycle. No production or evaluation behavior
was changed.

### What Was Completed

1. **Adversarial review of commit `e94e8f78` + Session 364 handoff**
   - Benchmark v2 verified: 25 Bind / 15 Abstain over 40 cases; the v1→v2 diff
     is exactly the four owner clarifications (Sang and Harcombe label flips,
     Tsai and Landsman anchor corrections) and nothing else.
   - Pilot integrity verified by independent recomputation: 100 candidates are
     exactly the first-10 package rows per proposal, arm assignments match the
     original unblinding map with zero mismatches, and the 61–61
     eligible-shortlist aggregate plus the 6 wrong-person rows (5
     redesign-only, none shortlisted) reproduce bit-for-bit.
   - Run provenance verified: the manifest fingerprint recomputes to the same
     value before and after the fixtureVersion edit and matches
     `execution-v1.json`.
   - Frozen v1 assets confirmed untouched; scored-pilot validation, the
     manifest unit test, and branch doc gates re-run green.

2. **Review document committed**
   - `docs/audits/session-364-adversarial-review-2026-07-17.md` records the
     verification evidence and findings F1–F5 for Codex/agent reference.

3. **Session-start hygiene**
   - All 57 `check:*` gates and self-tests green on `main` at session start.

### Commits

- `cabbfb8` - docs(audits): adversarial review of Session 364 reviewer-holistic work
- Session handoff commit: created by the stop workflow

## Next Items

### Verified Open

1. **F1 (MEDIUM): frozen-manifest mutation is unenforced.**
   Evidence: `docs/audits/session-364-adversarial-review-2026-07-17.md` §F1;
   `e94e8f78` edited `status: "frozen"`
   `docs/audits/reviewer-holistic-evaluation-manifest-v1.json` in place and
   updated the pinning test literal in the same commit.
   Fix on the feature branch: record fixture changes as an amendment/history
   entry (or manifest-v2), or explicitly document that `identityBenchmark`
   sits outside the freeze/fingerprint scope.

2. **F2 (MEDIUM): default `eval:reviewer-holistic:m1` gate never validates the
   active v2 identity fixture.**
   Evidence: review doc §F2; `DEFAULT_IDENTITY_PATH` in
   `scripts/validate-reviewer-holistic-m1-assets.js` (branch) still points at
   v1, and branch-wide grep shows no code ties
   `manifest.identityBenchmark.fixtureVersion` to a real benchmark file.
   Fix on the feature branch: derive the default identity path from the
   manifest fixtureVersion (fail closed if missing) or validate both versions;
   add a manifest↔benchmark version consistency check.

3. **Broader Wave 13 migration remains gated.**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` I1.2–I1.3
   and `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.
   Policy-reader migration, automated/staff callers, correction/revocation,
   merge behavior, backfill, and suggestion COI fields are not promoted by the
   completed evaluation.

### Owner Decision Needed

1. **Whether to authorize any production reviewer-redesign pilot.**
   Evidence: the scoped offline pilot was evaluation-only and production
   remains legacy-default. The review confirmed the "needs final-output
   filtering first" conclusion (redesign wrong-person 6/74 vs baseline 1/74).
   Any live pilot still requires the F2 assignment, attribution, safety, and
   promote/stop gates in the active plan.

2. **Whether/when to merge `codex/m1-evaluation-foundation` (19 commits) to
   main.** Evidence: `git rev-list --count main..codex/m1-evaluation-foundation`
   = 19; the branch is evaluation tooling and audit assets only, but merging is
   a deliberate promotion step under the campaign release strategy.

### Parked

1. **F3/F4 (LOW) hardening from the review.**
   Evidence: review doc §F3–F4 (pilot artifact reuses
   `evaluationVersion: reviewer-proposal-head-to-head-v1`; import-filename
   fallback is fail-open but contained). Fold into the F1/F2 fix pass if it
   happens; not worth a standalone session.

2. **Fresh scoped rerun after final-output filtering.**
   Evidence: `outputs/reviewer-holistic-m1/reviewer-holistic-m1-10-pilot-failure-analysis-v1.md`.
   Re-open only if the owner wants to test a new filter or a revised
   topicality/eligibility rubric; create a new evaluation version rather than
   overwriting the current artifacts.

3. **Dataverse target interlock `warn` → `on`.**
   Evidence: `CLAUDE.md` and `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.
   Re-open only after the planned production log-observation gate.

### Verify Before Acting

1. **Do not cite the scoped pilot as the original full M1.2 result.**
   Evidence: `reviewer-holistic-m1-10-pilot-scope-v1.json` records 100 scored
   candidates versus 345 in the original package (independently reverified in
   Session 365).

2. **Do not mutate the frozen v1 evaluation to add a new rubric or scope.**
   Create a new evaluation version and manifest entry first. (F1 shows this
   guardrail also needs to cover the manifest itself.)

3. **Retirement/emeritus exclusions must be explicitly annotated before a
   future rerun.** Otherwise they remain indistinguishable from generic
   `independentEligible = false` judgments.

4. **Do not infer the origin of the one-row Wave 13 person baseline.**
   Evidence: the prior smoke restored person `1` / suggestion `0` but did not
   inspect or adjudicate the pre-existing person row. Run the read-only
   population/detail probe before making organic-throughput or migration
   claims.

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
   remain as the audit row; any new production run needs fresh authorization
   and exact deployment attestation.

3. **Do not re-litigate the Session 364 results.** They are independently
   verified; see `docs/audits/session-364-adversarial-review-2026-07-17.md`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/audits/session-364-adversarial-review-2026-07-17.md` | Session 365 adversarial review: verification evidence + findings F1–F5 |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active reviewer redesign plan and evaluation status |
| `docs/audits/reviewer-holistic-evaluation-manifest-v1.json` | Frozen M1 evaluation contract (F1/F2 target, on feature branch) |
| `scripts/validate-reviewer-holistic-m1-assets.js` | M1 asset validator whose default path F2 fixes (feature branch) |
| `outputs/reviewer-holistic-m1/` | Local/ignored paid-run and scoped-pilot artifacts |

## Testing

```bash
npm run eval:reviewer-holistic:m1   # on the feature branch; default still validates v1 (F2)
npm run check:docs-catalog
npm run check:fact-consistency
npm run check:doc-symbol-refs
```

F1/F2 fixes belong on `codex/m1-evaluation-foundation`, not `main`. Do not run
another paid or production evaluation without a new owner decision and a new
evaluation version.
