# Session 363 Prompt: Codex finishes the binding smoke (round-3 findings)

## Session 362 Summary

Session 362 executed the read-only adversarial review from the Session 361
handoff, then (owner-directed) fixed the P1 it found, built the dedicated
production smoke, and ran three Codex adversarial-review rounds on it. The
effort is handed to Codex via
`docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md` (on the PR #60 branch).

### What Was Completed

1. **Adversarial review delivered (read-only, per the S361 brief)**
   - Verdicts: deployed code READY WITH FIXES; `scripts/pr4-e2e.js` DO NOT
     RUN (all seven prior concerns confirmed plus `upsertByEmail` real-person
     reuse and the dev-mode cron-auth bypass); smoke architecture READY WITH
     NAMED CHANGES (12 named changes).
   - Headline finding F1 (P1): Dataverse drops fractional seconds on DateTime
     round-trips, so the millisecond binding event identity made a job retry
     reclassify its own replay as a rebind or an out-of-order block.
   - Artifact:
     `outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md`
     — **gitignored, exists only on this machine**.

2. **F1 fixed and deployed (PR #59, merged at `38640dd7`)**
   - `capture-self-reported-orcid.js` truncates the self-report event identity
     (`boundAt`/`resolvedAt`) to second precision on both the durable and
     typed-fallback paths; unparseable values still fail closed in the writer.
   - Writer regression test: second-precision stored row + truncated replay
     event → `noop`.

3. **Dedicated production smoke built (PR #60, open, head `09725c4c`)**
   - `scripts/smoke-reviewer-binding.js` + pure safety logic in
     `scripts/lib/smoke-reviewer-binding-core.js` (64 unit tests, no live
     writes) + deliberately empty owner-reviewed fixture allowlist
     `scripts/lib/smoke-reviewer-binding-fixtures.js`.
   - Additive Tier-1 cron telemetry: drain returns claimed `jobIds`; the cron
     records a deployment fingerprint in `maintenance_runs.details` on success
     and failure paths.
   - Hardened through two Codex adversarial rounds (`40d33555`, `76391b1b` —
     the latter implemented by Codex rescue session
     `019f5c30-30cf-7840-827a-e6b3f0b10ccd` and committed on its behalf).

4. **Session docs reconciled**
   - Project memory, reviewer-identity wiki topic, and person Atlas updated for
     the F1 fix and the smoke; Codex takeover handoff committed to the branch.

### Commits

- `0b8d5447` - `fix(reviewer): truncate binding event identity to Dataverse second precision`
- `38640dd7` - Merge PR #59 (F1 fix; deployed to production on merge)
- `fe2c3aeb` - `feat(reviewer): add gated production smoke for the Wave 13 binding chain`
- `40d33555` - `fix(reviewer): harden smoke gating, attribution, and assertions per Codex review`
- `76391b1b` - `fix(reviewer): bind smoke attribution to deployment+job, harden cleanup and fixture gating`
- `09725c4c` - `docs(reviewer): closing handoff for Codex takeover of the binding smoke`
  (the last four are on branch `claude/reviewer-binding-smoke`, PR #60)

## Next Items

### Verified Open

1. **Codex fixes the two round-3 adversarial findings on PR #60.**
   Evidence: the round-3 review output (recorded in
   `docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md`, on the branch) and
   `scripts/lib/smoke-reviewer-binding-core.js:124-129` /
   `scripts/smoke-reviewer-binding.js:275-306`.
   (a) Attribution accepts a CLAIMED-but-not-completed job: the drain fills
   `jobIds` before processing, so record per-outcome ids (e.g.
   `completedJobIds`) and require the smoke job in the completed set of the
   fingerprint-matching run; add the `retried:1, completed:0` regression test.
   Fixing the ignored lease-guarded completion result in
   `processReviewerAcceptanceJob` closes review-artifact finding F2 at the
   same time. (b) Persist an incremental recovery artifact after each
   production write boundary with an outer error/signal handler.
   Then run adversarial-review round 4 before merge.

2. **Merge PR #60 after round 4 is clean.**
   Evidence: https://github.com/justingallivan/wmkf-research-apps/pull/60.
   The smoke cannot attribute correctly until a deployment containing the new
   cron telemetry is live, so merge precedes any run.

### Owner Decision Needed

1. **Commit the approved fixture request GUID.**
   Evidence: `scripts/lib/smoke-reviewer-binding-fixtures.js` is deliberately
   empty and the runner aborts while it is. Recommend a closed cycle's
   `akoya_request`. This is the authorization mechanism — an owner-reviewed
   commit, not a CLI value.
2. **Authorize the smoke run** (operator supplies `--expect-deployment` from
   `vercel inspect`; keep the completed queue row — `--delete-job` only by
   explicit choice; first run without `--cleanup`).

### Parked

1. **Review-artifact finding F3** (deterministic blocked binding outcomes are
   retried 8× before terminal). Evidence: review artifact §5; P3, non-blocking.
2. **Broader Wave 13 caller and reader migration** — unchanged; see
   `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.
3. **Unrelated operational follow-ups** — interlock `warn`→`on`, Daily
   Maintenance confirmation, `label_conflict` spot-check, reviewer-institution
   linking, address-based onboarding. Unchanged by Session 362.

### Verify Before Acting

1. **The `scope-claim-reminder.js` hook blocks every edit to
   `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.**
   Evidence: reproduced three times this session with unrelated edit content;
   it cites prose list items at lines 75–77/95 as count claims. The plan's
   timestamp sentence (~line 294) is one sentence behind the shipped F1 fix.
   Fix the hook or annotate per its instructions — do not work around it.
2. **Wave 13 population may no longer be zero.**
   Evidence: the 2026-07-13 preflight snapshot is dated; an organic binding
   (now on the FIXED code path) may have landed. Re-run the read-only
   preflight before relying on population claims; the smoke compares against
   a fresh pre-run snapshot by design.

### Do Not Reopen Without New Decision

1. **Do not run `scripts/pr4-e2e.js` or any production smoke from a dev
   session.** Evidence: review artifact Part B (seven confirmed defects, two
   new hazards) and the handoff constraints; the smoke is manual and
   owner-executed only.
2. **Do not change the 14-day reviewer-attestation TTL or the Wave 13 gating
   posture.** Evidence: owner decisions, S361 (`42b4e7d5`, PR #55).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_BINDING_SMOKE_CODEX_HANDOFF.md` | Codex takeover brief (on the PR #60 branch) |
| `scripts/smoke-reviewer-binding.js` | Manual owner-gated smoke runner (PR #60) |
| `scripts/lib/smoke-reviewer-binding-core.js` | Pure safety logic; round-3 finding (a) lives here |
| `scripts/lib/smoke-reviewer-binding-fixtures.js` | Empty owner-reviewed fixture allowlist |
| `lib/services/reviewer-acceptance-drain.js` | Drain; `jobIds` telemetry; per-outcome ids TODO |
| `pages/api/cron/drain-reviewer-acceptances.js` | Cron; deployment fingerprint in maintenance details |
| `lib/services/capture-self-reported-orcid.js` | F1 fix (second-precision event identity), deployed |
| `outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md` | Full review artifact (LOCAL ONLY, gitignored) |

## Testing

```bash
npx jest tests/unit/smoke-reviewer-binding.test.js tests/unit/reviewer-acceptance-drain.test.js tests/unit/capture-self-reported-orcid.test.js tests/unit/reviewer-identity-binding-writer.test.js
npm test            # full suite (5572 green at session close)
npm run check:types
# plus the gate+self-test pairs listed in the handoff doc for any new slice
```

Never execute the smoke, the PR4 scripts, or the drain from a dev session.
