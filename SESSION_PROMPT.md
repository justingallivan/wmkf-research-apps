# Session 297 Prompt: Choose next verified objective

## Top-of-session must-knows

1. **Session 296 completed the wiki positive-framing pass.** Implementation commit: `0870fb3c` (`Refactor agent wiki framing`). The stop-session doc commit follows it.
2. **Rollback protection exists.** The pre-wiki-refactor commit is tagged `wiki-pre-positive-framing-2026-06-27` (`b8a1838c`). Preserved originals are in `.harness-backups/2026-06-27-wiki-positive-framing/`.
3. **`check:harness-framing` now scans wiki topics.** `scripts/check-harness-framing.js` includes `docs/agent-wiki/topics/*.md`; the self-test has a wiki-topic fixture.
4. **Use the active-instruction vs rationale-sidecar pattern for future harness/wiki work.** Active guidance should state procedure; historical rationale belongs in sidecars or backups.
5. **Known-red suites carried from S294:** `tests/unit/bill.test.js` and `tests/unit/discovery-verification-status.test.js` only. Confirm any full-suite red is only those two.

## Session 296 Summary

Session 296 took the wiki topic pages that S295 had audited but not refactored, rewrote active guidance toward operating notes and source-grounded procedures, preserved the original topic wording in a backup archive, and expanded the harness-framing gate so future wiki-topic regressions are caught automatically.

### What Was Completed

1. **Wiki topic positive-framing pass**
   - Updated `docs/agent-wiki/topics/*.md` where active guidance used incident-shaped framing.
   - Preserved source-grounded facts, dates, and operational constraints.
   - Renamed several live sections from "Recurring Hazards" / "Gotchas" toward "Operating Notes" where that fit the content.

2. **Rollback backup**
   - Created `.harness-backups/2026-06-27-wiki-positive-framing/` with the pre-refactor topic pages.
   - Added `.harness-backups/2026-06-27-wiki-positive-framing/MANIFEST.md`.
   - Created rollback tag `wiki-pre-positive-framing-2026-06-27` at `b8a1838c`.

3. **Harness-framing gate coverage**
   - Extended `scripts/check-harness-framing.js` to scan `docs/agent-wiki/topics/*.md`.
   - Added a self-test fixture that fails on self-focused wiki-topic framing.
   - Updated `docs/CI_GATES_REFERENCE.md` to document the expanded scope.

### Commits

- `0870fb3c` - Refactor agent wiki framing
- Stop-session commit - Documents Session 296 and creates this Session 297 prompt

## Next Items

### Verified Open

None currently verified from the wiki positive-framing pass. Start the next session by choosing a fresh objective, then verify it against source/Atlas/probes before treating it as actionable.

### Owner Decision Needed

None currently known.

### Parked

1. **PD-override-correction sync**
   Evidence currently available: S296 did not re-verify the S294 carryover. `docs/agent-wiki/topics/reviewer-identity.md` still distinguishes the shipped contact-correction override from deferred edit-and-re-resolve work.
   Re-open trigger: user chooses to continue the reviewer-contact boundary tail after verifying current source paths.

### Verify Before Acting

1. **Long-stale pre-S294 carryovers**
   Evidence currently available: the previous prompt listed model real-replay signoff/Admin Models smoke, request `1002788` triage, Restore Removed Candidates + PD identity override E2E, and reviewer-portal upload design decision as older carryovers.
   Required preflight: verify each against source/docs/probes before carrying it into an actionable worklist.

2. **Any destructive wiki cleanup**
   Evidence currently available: `docs/agent-wiki/index.md` and `.claude/rules/agent-wiki.md` define the wiki as a subordinate routing aid, not authority.
   Required preflight: before removing or retiring a wiki claim, check the authoritative source named by the entry, then preserve rationale in a sidecar when useful.

3. **Any additional harness-framing checker expansion**
   Evidence currently available: `scripts/check-harness-framing.js` now covers root/session instructions, skills, rules, hook output, active memory/router files, `docs/agent-wiki/index.md`, and `docs/agent-wiki/topics/*.md`; rationale and backup paths are excluded.
   Required preflight: inspect active-path and excluded-path coverage before widening the checker, then update `scripts/check-harness-framing-self-test.js` and `docs/CI_GATES_REFERENCE.md` in the same pass.

### Do Not Reopen Without New Decision

1. **Reviewer to CRM-contact boundary epic**
   Evidence: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` and S294 commits record the completed policy: name/title/nickname sync; email and affiliation alert-only.

2. **Email and affiliation contact writes**
   Evidence: S294 owner decision kept email and affiliation alert-only. Do not convert them to contact writes without a new owner decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/agent-wiki/topics/*.md` | Active wiki topic routing pages refactored in S296. |
| `.harness-backups/2026-06-27-wiki-positive-framing/MANIFEST.md` | Backup manifest for original wiki topic wording. |
| `scripts/check-harness-framing.js` | Harness wording gate; now includes wiki topic pages. |
| `scripts/check-harness-framing-self-test.js` | Self-test fixture runner, including wiki-topic coverage. |
| `docs/CI_GATES_REFERENCE.md` | Gate catalog entry updated for expanded harness-framing scope. |
| `docs/AGENT_HARNESS_STYLE_GUIDE.md` | Style guide for active instructions and rationale sidecars. |

## Testing

```bash
npm run check:harness-framing
npm run check:harness-framing:self-test
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:scaffolding-tokens
npm run check:scaffolding-tokens:self-test
git diff --check
```

Full `npm test` was not run in S296.

## Gotchas / Continuity

- Do not run broad style rewrites inside `.harness-backups/`; those files intentionally preserve original wording.
- `check:harness-framing` excludes rationale and backup paths by design; active guidance should stay procedural, while sidecars/backups may preserve historical rationale.
- The wiki remains a retrieval/routing aid. Source files, Atlas pages, canonical docs, and live probes remain authoritative for state claims.
