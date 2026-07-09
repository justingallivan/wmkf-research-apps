# Session 349 Prompt: Dispatch the Fable holistic reviewer review, or staff review-rescue tool

## Session 348 Summary

Memory-hygiene + strategy-setup session. Fixed a red gate, executed the second wave
of the 2026-07-02 memory-hygiene program (built the never-built advisory + a
code-grounded triage of 75 high-risk memories), reconciled several durable-state
facts with the owner (intake portal parked; spec-audit recovery; a reviewer-identity
design question), and authored a holistic-review prompt for Fable on reviewer finding +
disambiguation.

### What Was Completed

1. **Red gate fixed — `check:docs-catalog`** (`22328b6c`). Build-plan frontmatter still
   listed `ReviewFormFields.js` (deleted S347). Removed the stale `related:` path; cleared
   a false-positive scope-claim hook by rewording one body phrase.

2. **Built `check:memory-health` advisory (audit Slice 5)** (`be8c0065`). Read-only,
   never-fails gate — `scripts/check-memory-health.js` + `npm run check:memory-health`,
   wired into `/start`. Flags active memories: `shadow-atlas`, `weak-basis`,
   `no-recall-rule`, `oversize-routed`, `stale-routed`. `--json` emits a triage worklist.
   Documented in `docs/CI_GATES_REFERENCE.md`.

3. **S348 code-grounded memory triage** (`1cec59d9`, `61e2c4ef`, `c7f71821`). 6 parallel
   sonnet subagents code-grounded all 75 high-risk memories; every applied edit
   independently re-verified. Fixed drift in 8 memories (notably: `project-reviewer-
   institution-match` → **stale** — its account-matching/`parentcustomerid` plan was
   owner-reversed 2026-06-27; `project-system-model` self-contradictory app count 18/16 →
   live 12 via CANONICAL_COUNTS; 3 files → closed). Cross-cutting fixes: `researcher.js`
   misleading identity comments, `STRATEGY.md` "17 tools" → "a dozen". Report:
   `docs/audits/memory-triage-2026-07-08.md`.

4. **Owner reconciles** (`3141e252`, `3d84ff44`). Spec-audit recovery: user re-sighted
   commit `370f3867` on the work computer (still unpushed); recorded the one-command
   recovery. Intake portal build recorded as **PARKED** (Connor re-engineering GOApply)
   across a new status memory + wiki banner + router + build-triggering leaf memories.

5. **Fable holistic-review prompt** (`bc1438da`). `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md`
   — pointer-based, reframe-first, full-latitude prompt for a top-level Fable session to
   reassess reviewer finding + disambiguation holistically. Success anchored on the
   "surface and inform, human decides" frame (failure-severity ordering left open).

### Commits (all on main, pushed)
- `bc1438da` docs(reviewer): add Fable holistic-review prompt
- `3d84ff44` docs(memory): record intake-portal build as PARKED
- `3141e252` docs(memory): spec-audit recovery — feature shipped on main, ref 370f3867 re-sighted
- `c7f71821` docs(strategy): mark researcher.js staleness link as accepted
- `61e2c4ef` fix(memory-audit): correct misleading identity comments + stale tool count
- `1cec59d9` docs(memory): S348 code-grounded triage — fix drift in 8 memories + report
- `be8c0065` feat(memory-health): add advisory check:memory-health
- `22328b6c` docs(review-questions): drop stale ReviewFormFields.js related-path

## Next Items

### Verified Open

1. **Dispatch the Fable holistic reviewer review (owner runs it).**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md`.
   Run in a NEW top-level Fable session (broader subagent access than a Claude-spawned
   subagent): `git pull`, set model to `claude-fable-5`, then "Read and execute
   `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md`". Do NOT run `/start` or `/stop` in
   that session (skips the gate battery; keeps our session narrative out of Fable's fresh
   read). Fable writes to `outputs/reviewer-holistic-review-fable-findings.md` (gitignored).
   Bring the findings back to a Claude working session to decide + reconcile into
   memory/docs.

2. **Build the staff "manual review rescue" tool.** (Carried from S348, not started.)
   Evidence: `project-staff-review-rescue-tool.md`; `project-reviewer-upload-dormant-not-deleted.md`.
   Dedicated edge-case surface (NOT on Track Reviewers) to manually enter a full structured
   review when the portal breaks. Must mirror the FULL `ReviewAuthoringForm` (3 ratings + 8
   rich-text via `getActiveQuestionSet`), route through `lib/external/build-review-submission.js`
   so staff-entered ≈ portal. Backends exist. **Blocked on placement decision (below).**

### Owner Decision Needed

1. **Reviewer-identity `confirmed` sentinel — downgrade automated spine `confirmed` to
   `probable`?** Evidence: `project-reviewer-self-report-orcid-sticky-confirmed.md`;
   `docs/audits/memory-triage-2026-07-08.md` (finding #1); `lib/services/reviewer-identity-resolver.js:261,279`;
   `lib/dataverse/adapters/researcher.js` (sticky guards). `confirmed` was designed as a
   human-attestation-only sentinel, but the automated spine now emits it — so a fallible
   automated identity inherits the un-downgradeable stickiness meant for human attestations.
   Options: (A) spine emits `probable` only [simplest]; (B) split the sentinel / add a
   provenance flag; (C) accept it [not advised on a safety path]. May be subsumed by the
   Fable review (#1 Verified Open). First step if pursued directly: trace downstream consumers
   of the resolver's `confirmed`.
2. **Staff rescue tool placement.** Evidence: `project-staff-review-rescue-tool.md`.
   Admin/superuser page vs. Reviews tab — decide before building Verified Open #2.
3. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md`
   (owner ask S343). Payable/not-payable flag + potential/invited reset button. (Carried.)
4. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`. (Carried.)

### Owner Action (off-machine)

1. **Recover the `codex/spec-audit` design docs.** Evidence: `project-spec-audit-docs-recovery-parked.md`.
   Commit `370f3867` (holds `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` +
   `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`) is unpushed on the **work computer** — confirmed
   still unreachable here (`git cat-file -t 370f3867` fails). The fast-response *feature*
   already shipped to main (`a3103b3c`), so only the design docs remain. On the work
   computer: `git push origin 370f3867:refs/heads/codex/spec-audit`, then a Claude session
   here fetches + `git merge --no-ff`.

### Parked

1. "No longer needed" stand-down flow for ACCEPTED reviewers. Evidence: S347 discussion —
   `withdraw-sufficient` only targets invited-pending. Re-open if owner wants it.
2. Product/UX asks: review-output formatting (`project-review-output-formatting.md`),
   campaign-settings UX revisit (`project-campaign-settings-ux-revisit.md`).
3. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md`.
4. Dependabot #53 merge once real tests green. Evidence: `gh pr checks 53`.

### Do Not Reopen Without New Decision

1. **Intake portal build is PARKED (owner decision S348).** Evidence:
   `project-intake-portal-parked.md`, agent-wiki `intake-portal` banner. Connor is
   re-engineering GOApply for the next cycle; our portal effort (admin UI +
   institution-typeahead) is on the back burner pending adoption. Design memories are
   retained-for-revival, NOT stale — don't spin up intake build/planning, and don't mark
   the design memories stale/closed.
2. **S348 memory triage results are code-grounded — don't re-litigate.** Evidence:
   `docs/audits/memory-triage-2026-07-08.md`. `project-reviewer-institution-match` is
   correctly stale (owner-reversed account-matching); `project-system-model` counts point to
   CANONICAL_COUNTS by design (don't re-hardcode).
3. **`ReviewFormFields.js` deleted (S347); Track Reviewers legacy upload/mark-received
   removal intentional (S347).** Evidence: `433d2b42`, `a1354ed9`,
   `project-reviewer-upload-dormant-not-deleted.md`. Use `ReviewAuthoringForm` for the
   rescue tool; backend routes retained-not-dead.
4. **"Remove entirely" on active rows via Remove ▾ (S347); local dev auth correct (S346);
   DynamicsService decomposition (S345) / peer-review Executor migration (S344) / 4 PDF-app
   sunset (S344) all COMPLETE.** Don't revert or re-inline.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md` | The Fable holistic-review prompt (Verified Open #1) |
| `scripts/check-memory-health.js` | New advisory memory-hygiene gate (`npm run check:memory-health`) |
| `docs/audits/memory-triage-2026-07-08.md` | S348 triage report + cross-cutting findings |
| `.claude-memory/project-intake-portal-parked.md` | Intake-portal PARKED status (owner decision) |
| `.claude-memory/project-spec-audit-docs-recovery-parked.md` | spec-audit recovery (one-command push on work computer) |
| `lib/services/reviewer-identity-resolver.js` | `classifySpineEvidence` — emits `confirmed` (:261,279); the sentinel question |
| `lib/dataverse/adapters/researcher.js` | `writeIdentityDecision`/`clearIdentityFields` sticky-`confirmed` guards |
| `shared/components/external/ReviewAuthoringForm.js` | Model for the staff review-rescue tool |
| `lib/external/build-review-submission.js` | Canonical structured-review producer; reuse for rescue tool |

## Testing

```bash
npm run lint && npm run check:types
npm run check:memory-health          # advisory worklist (never fails); --json for machine-readable
npm run check:memory-router && npm run check:memory-router:self-test
# Fable review: NEW session, model claude-fable-5, "Read and execute docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md"
#   (do NOT run /start or /stop in the Fable session)
```
