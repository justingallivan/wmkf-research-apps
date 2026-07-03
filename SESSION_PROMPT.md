# Session 320 Prompt: Clean main after reviewer merge; pick the next real follow-up

## ⇒ In flight: delegated reviewer-gating strategy review

A fresh reviewing LLM (repo access) has been briefed to evaluate whether the
reviewer-finder fail-closed gate system over-gates or fires gates at the wrong
stage/input, and to produce a redesign design doc. **The brief is
`docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` — start there.** Its expected
output is `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` (not yet written). This grew
out of the S320 Cause #2 deep-diagnosis below.

## Session 319 Summary

This session closed the reviewer-feature branch tangle and left the repo clean on
`main`. Codex and Claude first collided in the same checkout; the work was
reconciled into dedicated worktrees, independently verified, merged, pushed, and
build-tested. The important outcome: reviewer referral seeding and the
Dataverse-grounded reviewer analyze metadata fix are both on `origin/main`.

### What Was Completed

1. **Branch reconciliation completed.**
   - Primary checkout `/Users/gallivan/Code/WMKF_Apps` is clean on `main`.
   - `origin/main` is `a4668068`.
   - `origin/codex/referral-seeding-build` is `ff54c60c`.
   - `origin/codex/program-area-normalization` is `83b585b4`.
   - Both feature branches landed through real two-parent merges:
     `a4a47bc9` (program-area) and `4f31f045` (referral).

2. **Reviewer referral seeding shipped.**
   - PDs can paste externally referred names into the Find flow.
   - The UI labels external referrals as "Externally-Referred" and keeps the
     existing applicant lane as "Applicant-Referred".
   - `b997cf37` preserves referred provenance when a seed and discovery result
     normalize to the same name.
   - `ff54c60c` fixed the remaining persistence gap: the background Find-roster
     write now receives the same deduped, referral-preserving survivor list that
     the UI displays, so reload does not drop the badge/referrer.

3. **Reviewer analyze no longer asks the LLM to infer Dataverse-owned request metadata in normal request-backed flow.**
   - `/api/reviewer-finder/analyze` now requires `requestId`.
   - It loads trusted title, PI, Co-PIs, institution, abstract, and program
     metadata from Dataverse before calling Claude.
   - `composeAnalyzePrompt()` slims PART 1 when request context exists and does
     not include `PROGRAM_AREA` in the model task.
   - `ClaudeReviewerService` overlays trusted Dataverse metadata onto
     `proposalInfo`, while `normalizeSuggestionProgramArea()` protects the save
     path from overlong/placeholder values.
   - Live read-only probe confirmed request context resolves for boss-flow
     requests `1002916` and `1002926`.

4. **Docs and agent handoff reconciled.**
   - `docs/REVIEWER_REFERRAL_SEEDING_DESIGN.md` now marks the S320 pre-merge
     attribution blocker resolved and documents the exact normalized-name
     limitation.
   - `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md` remains the audit pointer
     for the historical metadata-overload problem.
   - `docs/agent-wiki/topics/reviewer-origination.md` reflects the shipped
     referral-seeding behavior.
   - Separate worktrees exist so Claude/Codex do not need to share the primary
     checkout.

### Commits

- `a4668068` - docs: reconcile reviewer feature merge status
- `4f31f045` - merge: referral seeding reviewer workflow
- `a4a47bc9` - merge: program-area reviewer metadata normalization
- `ff54c60c` - fix(referral-seeding): dedupe surfaced referral roster rows
- `b997cf37` - fix(referral-seeding): preserve Externally-Referred badge on seed<->discovery collision
- `83b585b4` - Source reviewer analyze metadata from Dataverse
- `695b6784` - docs: reconcile referral-seeding status before final attribution fix
- `a9da0268` - docs: flag pre-merge fix for referral seed<->discovery collision (S320 audit)
- `70ee3f2d` - Build reviewer referral seeding
- `da95457e` - Correct referral seeding implementation plan

## Next Items

### Verified Open

1. **Cause #2 - enrichment email-coverage miss (deep-diagnosed S320; now delegated).**
   Evidence: `scripts/probe-no-email-breakdown.mjs` (120d: 482 selected, 11 no-email,
   5 true Cause #2) plus live OpenAlex domain probes run S320. **Corrected finding:**
   the resolved faculty-page tier is NOT the main lever. In 4 of 5 cases a *correct*
   institutional email was found and discarded by a gate — two by
   `verified_domain_contradiction` (`_validateEmailAgainstVerifiedDomain`) trusting a
   single OpenAlex last-known-institution domain that was a legit secondary
   affiliation (`hhmi.org` vs `princeton.edu`) or an OpenAlex mis-map
   (`calu.edu` vs `upenn.edu`); two by `isNameConsistentEmail` `name_mismatch` on the
   correct domain; one never-fetched page. The fetch tier
   (`_attachEmailFromResolvedPage`, `REVIEWER_PAGE_EMAIL_TIER_ENABLED` default OFF)
   cannot rescue the domain-contradiction cases — its fetch is bound to the same wrong
   domain. **Now handed to a fresh reviewing LLM — see the in-flight pointer at the top
   of this file and `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md`.**

2. **B2 - enrichment-timeout partial-return.**
   Evidence: `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` section B2.
   `enrichCandidates` throws on abort and discards enrichment already computed.
   Treat as deferred reviewer-email reliability work, not part of the referral
   or program-area merge.

### Owner Decision Needed

1. **Whether to delete merged remote feature branches.**
   Evidence: `git ls-remote --heads origin main codex/referral-seeding-build codex/program-area-normalization`.
   Both feature branches are merged and preserved on origin. Keeping them is
   harmless; deleting them is optional cleanup.

### Parked

1. **Spec-audit docs recovery.**
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Two design docs live only on the user's work computer, unpushed. Re-open when
   the user is back at that machine around 2026-07-08: push `codex/spec-audit`
   from there, then fetch/review/merge here. Do not re-search local/origin first.

### Verify Before Acting

1. **Reviewer-finder metadata prompt assumptions.**
   Evidence currently available: live read-only probe for requests `1002916` and
   `1002926`, plus `pages/api/reviewer-finder/analyze.js` requiring `requestId`.
   If touching this path, re-check the caller -> route -> `loadReviewerRequestContext`
   chain before claiming the LLM is or is not asked to infer request metadata.

2. **The 53 roster rows Codex backfilled in S317 are benign, not a todo.**
   Evidence currently available: prior S317/S318 dry-run handoff.
   Re-run `scripts/dryrun-reviewer-email-reconcile.mjs` and confirm 0-would-write
   before any recovery work.

### Do Not Reopen Without New Decision

1. **Claude/Codex branch collision.**
   Evidence: `main` is clean at `a4668068`, both features are merged, and
   dedicated worktrees exist. Do not unwind or re-merge these branches.

2. **Referral seed<->discovery attribution blocker.**
   Evidence: `b997cf37`, `ff54c60c`, and
   `docs/REVIEWER_REFERRAL_SEEDING_DESIGN.md`. The known remaining limitation is
   exact normalized-name matching only ("R. Smith" vs "Robert Smith" can still
   produce two rows); do not expand to fuzzy matching without a new decision.

3. **Program-area save crash / request-backed metadata redundancy.**
   Evidence: `83b585b4`, live request-context probe for `1002916`/`1002926`, and
   `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md`. Normal Workbench analyze
   flow now requires request context.

4. **No duplicate Hafezi on request 1002926.**
   Evidence: prior S319 verification found one correctly reused record. Do not
   re-run recovery without a new symptom.

5. **S317 reviewer-email fixes and cron are shipped.**
   Evidence: prior commits `7212a5e2` and S319 summary. The open work is Cause #2
   and B2 only.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_REFERRAL_SEEDING_DESIGN.md` | Implemented referral-seeding plan, resolved attribution fix, exact-name limitation. |
| `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md` | Historical LLM metadata-overload audit and Dataverse-backed fix. |
| `shared/components/reviewers/ReviewerSearchSection.js` | Find flow UI; sends `requestId`, referral seeds, display/roster dedupe. |
| `shared/components/reviewers/reviewer-search-logic.js` | Referral-preserving normalized-name dedupe helper. |
| `lib/services/reviewer-request-context.js` | Trusted Dataverse request metadata loader and result overlay. |
| `lib/services/reviewer-prompt-composer.js` | Analyze prompt slimming when trusted request metadata exists. |
| `lib/services/claude-reviewer-service.js` | Reviewer analyze service; passes request context into prompt composition and overlays metadata. |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `normalizeSuggestionProgramArea()` and reviewer suggestion persistence. |
| `.claude-memory/project-spec-audit-docs-recovery-parked.md` | Parked spec-audit recovery instructions for the work computer. |

## Testing

```bash
# Final merged-main verification already run in S319/S320 reconciliation:
npm run build
npm run check:agent-invariants

# Combined reviewer/program-area/referral unit coverage:
npx jest tests/unit/reviewer-suggestion-programarea-normalize.test.js tests/unit/reviewer-request-context.test.js tests/unit/claude-reviewer-service.test.js tests/unit/reviewer-analyze-route.test.js tests/unit/reviewer-prompt-composer.test.js tests/unit/reviewer-search-logic.test.js tests/unit/reviewer-provenance.test.js tests/unit/reviewer-candidate-export.test.js tests/unit/reviewer-route-identity-gate.test.js --runInBand

# Relevant doc/gate surfaces:
npm run check:docs-catalog
npm run check:agent-wiki && npm run check:agent-wiki:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:atlas && npm run check:atlas:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
```
