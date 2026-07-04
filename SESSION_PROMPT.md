# Session 329 Prompt: Verify thank-you cron proof, clean up rehearsal data, schedule data-layer Stage 0

## Session 328 Summary

Session 328 executed the staged review-submission rehearsal end-to-end with the
owner driving the browser (request 1002788, reviewer "Test Case"
rarebit.skits-6f@icloud.com). The rehearsal proved the full pipeline live —
invite → accept → S325 drain-queue confirmation (1 job, completed, 0 retries)
→ portal submit (11 answer rows) → Reviews tab Compare/Export → AI synthesis
(1,709-char JSON persisted) — and surfaced two production blockers plus four
UX/correctness gaps, all fixed and deployed same-session. Two new features
shipped (thank-you sweep, materials preflight guard) and the Dataverse
data-access layer migration plan was authored, adversarially verified, and
committed (execution NOT started).

### What Was Completed

1. **Rehearsal tooling + execution**
   - `scripts/probe-review-rehearsal-state.mjs` (read-only before/after
     snapshot) and `reset-reviewer-for-testing.js --clear-synthesis`.
   - Rehearsal executed; S325 drain carryover CLOSED (verified completed job).

2. **Production blockers found by the rehearsal (fixed + deployed)**
   - `claude-sonnet-5` was unregistered → Executor fail-closed 500. Registered
     in `model-capabilities.js` + `model-pricing.js` ($3/$15, 1M/128K).
   - Synthesis prompt `wmkf_ai_maxtokens` 2000 → truncated JSON under
     Sonnet 5 default adaptive thinking. Seed + live row (owner-approved
     PATCH) now 8000.

3. **Release-flow overhaul (owner decisions)**
   - Release emails default to the tokenized portal link; email attachment
     behind new admin setting `reviewer.release.attach_proposal_email`
     (default OFF, fails closed; admin card added). Kills the public-Blob
     proposal copy in the default path.
   - Release button respects checkbox selection (subset of accepted).
   - Materials preflight guard: new GET `/api/review-manager/materials-preflight`
     shares the portal's `isReviewerMaterial` filter (hoisted
     `listReviewerMaterials`); empty folder → amber banner + "Release anyway?".

4. **Portal/lifecycle correctness**
   - Token `ops` claim enforced fail-closed on proposal/upload/submit/draft
     routes (`tokenHasOp`; behavioral no-op for all minted tokens).
   - Submit changeset now advances `wmkf_reviewstatus` → 100000003
     (Review Received) atomically; Track badge + work-remaining follow.
   - Submitted portal view hides the empty "hasn't shared materials" card.

5. **Thank-you sweep (new automation)**
   - `lib/services/reviewer-thankyou-sweep.js` + cron
     `/api/cron/send-review-thankyous` (vercel.json `30 10 * * *`).
     Claim-before-send on `wmkf_thankyousentat` (at-most-once); DOCX courtesy
     copy of the reviewer's own review attached as real bytes
     (activitymimeattachments, never Blob); attachment failure degrades to
     plain send. `fetchAnswersBySuggestion` hoisted to
     `lib/services/review-answers.js` (re-sanitization preserved).

6. **Data-access layer migration plan (docs only)**
   - `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`: 9 stages, ratchet+gate,
     restriction-context fold-in gated on owner go/no-go. Baselines
     complement-derived + fresh-context verified (0 refuted). NOT started.

### Commits

- `467d3b1b` scripts: rehearsal cleanup + snapshot tooling
- `23e65f71` fix(models): register claude-sonnet-5
- `f57b37d4` fix(prompts): review-synthesis maxtokens 2000→8000
- `19e3cd3d` fix(reviewers): Release button respects selection
- `9a776b8e` fix(external): enforce token ops claim (fail closed)
- `8de6487d` feat(reviewers): link-first release + attachment admin toggle
- `31b71770` fix(portal): hide empty materials card after submission
- `cd7f908e` fix(external): submit advances wmkf_reviewstatus
- `51573c79` feat(reviewers): thank-you sweep + DOCX courtesy copy
- `03a26842` feat(reviewers): materials preflight guard
- `a2131328` docs: data-access layer migration plan

## Next Items

### Verified Open

1. **Verify the first thank-you cron run, then clean up the rehearsal data.**
   Evidence: cron `30 10 * * *` in vercel.json (`51573c79`). [VERIFIED
   2026-07-04 via live probe] exactly 2 suggestions system-wide have
   `wmkf_reviewreceivedat` set; the older (6ad328b4…, received 2026-05-27)
   already has `wmkf_thankyousentat` set so is NOT eligible — the Test Case
   row (1e9815ea…) is the only sweep-eligible row.
   Steps: after the first run post-deploy, check rarebit.skits-6f@icloud.com
   for the thank-you + DOCX attachment; check the maintenance run record and
   `wmkf_thankyousentat` via
   `node scripts/probe-review-rehearsal-state.mjs --requestNumber 1002788 --email rarebit.skits-6f@icloud.com`.
   THEN clean up:
   `node scripts/reset-reviewer-for-testing.js --email rarebit.skits-6f@icloud.com --requestNumber 1002788 --clear-synthesis --commit`
   and re-probe to confirm pristine. Cleanup before the cron proof loses the
   free E2E test — owner agreed to let the cron fire first.

2. **Owner browser spot-check of the new release flow.**
   Evidence: `8de6487d` + `03a26842` deployed; unit-proven, not browser-driven.
   Check: release modal shows portal-link note (no file picker); on 1002788
   specifically, the empty-materials amber warning + "Release anyway?" confirm
   (its Reviewer_Downloads folder is genuinely empty).

### Owner Decision Needed

1. **Schedule data-access migration Stage 0 (census probe + baseline).**
   Evidence: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` (owner approved
   scope/cadence S328; execution not started). Stage 0/1 are docs+gate only,
   zero behavior change — good filler for any session.

2. **Manual review-due reminder P2 hardening** (carried from S327).
   Evidence: `lib/services/reviewer-manual-reminder.js:106-107`,
   `pages/api/review-manager/send-review-reminder.js:63-65` (echoes low-level
   `result.errors`), `lib/services/reviewer-reminder-sweep.js:301-305`.
   Decide: fix now or when the surface is next touched.

3. **Campaign-settings UX revisit** (owner ask S326).
   Evidence: `.claude-memory/project-campaign-settings-ux-revisit.md`
   [OWNER-REPORTED, not source-verified]. Preflight per that memory before
   scoping.

4. **Review rendition formatting pass** (owner ask S328).
   Evidence: `.claude-memory/project-review-output-formatting.md`. Courtesy
   copy ships first-pass; staff DOCX/PDF also to be restyled — one effort over
   the shared `composeReviewReport` seam. Owner schedules.

### Parked

1. **Spec-audit docs recovery** (work computer only, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

2. **Institution-COI ledger calibration.**
   Evidence: `scripts/probe-institution-coi-breakdown.mjs`; needs accumulated
   `coi_dropped` rows.

### Verify Before Acting

1. **Track badge on the TEST row stays "Materials Sent" until cleanup** — the
   status-transition fix (`cd7f908e`) is forward-only. Not a bug; do not
   "fix" it; cleanup resets the row.

2. **AwardeeTab stale-response guard** is narrow: only `copyWebsiteHtml()`
   (`shared/components/workbench/AwardeeTab.js:302-318`) lacks the
   request-check. Only if touching AwardeeTab.

3. **Old S322 cleanup suggestions**: grep live callers first
   (`docs/DEAD_CODE_DELETION_MANIFEST.md` correction history).

4. **At-most-once email semantics are owner-approved design** for BOTH the
   acceptance confirmation (S325) AND the new thank-you sweep (S328).
   Product/ops approval required before retry-on-failure.

5. **Synthesis concurrent-generate race remains accepted** (S326 contract;
   S327/S328 did not change it). No locking without an owner ask.

### Do Not Reopen Without New Decision

1. **S325 drain-queue monitoring is CLOSED** — first accept verified completed
   (S328 probe: 1 job, completed, 0 retries, confirmation sent).
2. **Synthesis replay fixture is MOOT** — rehearsal produced real synthesis
   output; owner decision #2 from S327 answered by events.
3. **review-synthesis.generate IS visible/editable in /admin → Prompt
   Templates** (locale sort puts it after reviewer-finder entries; verified by
   owner S328).
4. **Do not re-add CodeQL** (`180e9046`, `198fbd97`).
5. **Do not delete `lib/services/anthropic-admin.js`** (pricing cron imports).
6. **Two advisory hooks remain retired; `pre-commit-self-review.js` kept**
   (`docs/HARNESS_INSTRUCTION_AUDIT_S322.md`).
7. **Client-side export remains the decision** until a Power Automate flow
   exists (`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` | Staged data-layer migration plan; Stage 0 not started. |
| `lib/services/reviewer-thankyou-sweep.js` | Thank-you sweep (claim-before-send, DOCX attachment). |
| `pages/api/cron/send-review-thankyous.js` | Cron route (10:30 daily, vercel.json). |
| `lib/services/review-answers.js` | Shared answer-snapshot reader (re-sanitizing). |
| `shared/utils/review-report.js` / `review-report-docx.js` | Report composition + `composeSingleReviewCopy` / server DOCX. |
| `pages/api/review-manager/materials-preflight.js` | Reviewer-visible file count for release warning. |
| `pages/api/review-manager/release-settings.js` | Attach-proposal-email admin setting (GET/PUT). |
| `lib/external/reviewer-materials.js` | `listReviewerMaterials` — ONE filter for portal + preflight. |
| `lib/external/verify-suggestion-token.js` | `tokenHasOp` ops-claim predicate. |
| `lib/external/build-review-submission.js` | Submit parentPatch (now sets reviewstatus 100000003). |
| `scripts/probe-review-rehearsal-state.mjs` | Read-only rehearsal state probe. |
| `scripts/reset-reviewer-for-testing.js` | Cleanup incl. `--clear-synthesis`. |

## Testing

```bash
# Rehearsal state / cleanup
node scripts/probe-review-rehearsal-state.mjs --requestNumber 1002788 --email rarebit.skits-6f@icloud.com
node scripts/reset-reviewer-for-testing.js --email rarebit.skits-6f@icloud.com --requestNumber 1002788 --clear-synthesis   # add --commit to apply

# This session's suites
npx jest tests/unit/reviewer-thankyou-sweep.test.js tests/unit/review-single-review-copy.test.js \
  tests/unit/send-review-thankyous-cron.test.js tests/unit/materials-preflight.test.js \
  tests/unit/reviewer-manage-proposal-attachment.test.js tests/unit/build-review-submission.test.js \
  tests/unit/materials-view-files-card.test.js tests/unit/verify-suggestion-token.test.js \
  tests/integration/external-review-routes.test.js tests/integration/external-review-submit-route.test.js \
  tests/integration/external-review-draft-route.test.js

# Gates for these surfaces
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:trust-boundary-guid && npm run check:route-lifecycle-auth
npm run check:model-registry && npm run check:status-enum-parity
```

Notes:
- Known pre-existing red: `tests/unit/pricing-canary.test.js` (verified failing
  identically on unmodified main during S328; unrelated to this session).
- Full `npm run build` was exercised via the 5 production deploys this session
  (all READY); the last local full-suite run was 3835/3836 (the pricing-canary
  pre-existing failure).
