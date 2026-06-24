# Session 283 Prompt: Abstract cron + acknowledgement copy + open polish

## Session 282 Summary

A short, focused session on `main` (no branch drift). Started red on CI, ended green; built one new gate; corrected a stale handoff item and the process that let it through.

### What Was Completed

**1. Fixed red CI on every commit** (`909ee461`). Two stale-after-S281-refactor failures, neither a product regression:
- **Tests/Jest** — `check:doc-symbol-refs` (added to CI in S281's `d6c7d0a6`) called `fs.existsSync` on `scripts/dynamics-schema-diff.json`, a **gitignored generated artifact** — present on a dev disk (green locally), absent in CI's clean checkout (red). The gate's "path exists or it doesn't" premise is false for gitignored artifacts. Fix: batch `git check-ignore --stdin` over candidate violations and skip ignored paths (matches ignore rules even when the file is absent; fails closed on git error). Added a self-test case (nested `.gitignore`, no keyword).
- **E2E/Playwright** — S281's `4d45b4c8` renamed the button "Release to reviewers (N)" → "Release **proposal** to reviewers (N)"; the test still matched the old text and timed out. Updated the regex. Verified the spec passes locally (1 passed).

**2. Built `check:build-claim-freshness` gate** (`33495798`). The complement of `doc-symbol-refs`, closing the planned-path lifecycle: a memory/wiki line describing a path as *planned/not-built* where that path **now EXISTS** is a stale build claim. **Precision over recall** — a first pass with a proximity window produced 6/6 false positives (bare "planned" labels, design-doc refs, multi-path lines flagging the wrong path); rewrote to anchor the keyword as the *direct construction* on the path (`to live at X`, `planned: X`, `` `X` (planned) ``), which eliminated all 6. Self-test: 4 positives + 8 negatives + live-baseline-clean. Wired into package.json, CI Tests job, `/start` list (+ backfilled the missing `check:instruction-architecture` line), `docs/CI_GATES_REFERENCE.md`. Reuses the gitignore-skip from #1.

**3. Reconciled SESSION_PROMPT #4 — reviewer-invitation `reviews.wmkeck.org` migration was already DONE** (`92c4a65c`). Traced the producer: the invitation link's domain has ONE source — `buildExternalUrl` (`lib/external/token-lifecycle.js:181`) → `getReviewerPortalBaseUrl()` → `REVIEWER_PORTAL_BASE_URL` — used by `render-emails.js:165` via `mintAndStore`. `REVIEWER_PORTAL_BASE_URL` is set in Production (`vercel env ls`; value smoke-verified `https://reviews.wmkeck.org` on 2026-06-23). No hardcoded host anywhere in reviewer email/link code. It rode forward as an "open task" for a session though `project-branded-domains.md` already recorded it live — a phantom todo.

**4. Hardened the `/stop` skill against phantom next-steps** (`6c6f35b0`). Added a Step-3 discipline: every "next step" is a carryover *claim*, not a worklist — verify each against memory/source/Atlas before writing it actionable; mark already-shipped/blocked/parked items as such. Extends `/start` Step 5's destructive-carryover skepticism to additive "do X" items. Captured the same lesson in memory (`feedback-verify-additive-carryover-not-just-destructive`).

### Commits (this session — all on `main`, pushed)
- `6c6f35b0` stop skill: verify each next-step against ground truth before listing it actionable
- `92c4a65c` reconcile SESSION_PROMPT #4 (reviews.wmkeck.org migration already DONE)
- `33495798` add `check:build-claim-freshness` gate
- `909ee461` fix red CI (doc-symbol-refs gitignored false-positive + stale E2E button label)

## Potential Next Steps

> Per the new `/stop` discipline, each item below was checked against source/memory this session.

### 1. Auto-on-award abstract cron — VERIFIED still unbuilt; the open engineering item
An idempotent `pages/api/cron/*` route that pre-generates the publishable **abstract** for research awardees. VERIFIED distinct from the existing `generate-grantee-titles.js` cron, which handles the edited *title* at the Phase I→II ("Invited") board flip and explicitly defers "abstract assembly" to later. **Check `project-phaseistatus-decision-lifecycle` for the correct trigger** (when to generate edited titles vs abstracts — title at Invited; abstract timing differs). Mirror the title cron's resilience shape (idempotent write-when-empty + ETag/If-Match, soft time budget, bounded concurrency, research-only via `GRANTEE_RESEARCH_PROGRAM_IDS`). See `docs/GRANTEE_PORTAL_BUILD_PLAN.md`. Optional.

### 2. Finalize the AI + COI acknowledgement TEXT — owner content task (no code)
VERIFIED infra built: Dataverse `wmkf_policies` slots `reviewer-coi` + `reviewer-ai-use` → `wmkf_policyversions`; admin editor `shared/components/admin/PoliciesSection.js` + `pages/api/admin/policies.js` (superuser, versioned publish); shown to reviewers via `lib/external/policy-fetcher.js` → `PolicyAckModal` in `Stage2aView.js`. The published version of each slot is **placeholder text** (owner-confirmed). This is from-scratch authoring of the real COI + AI-use copy by Justin, then Publish via admin → Policies (versions, not edit-in-place; bump label; body ≥50 chars).

### 3. Reviews tab — live smoke when real review data exists — BLOCKED (no accepted reviewers yet)
Built + tested in S281, smoked only to the empty state. When a reviewer actually submits, eyeball the populated rendering (decoded Q1/Q3/Q10 ratings + download link) in `shared/components/workbench/ReviewsTab.js`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/check-build-claim-freshness.js` (+ `-self-test`) | NEW gate: stale "planned/not-built" claims whose cited path now EXISTS (CI-on-push) |
| `scripts/check-doc-symbol-refs.js` | sibling gate; now skips `.gitignored` paths via `git check-ignore` |
| `lib/external/token-lifecycle.js` | `buildExternalUrl`/`getReviewerPortalBaseUrl` — single producer of the reviewer link domain |
| `pages/api/cron/generate-grantee-titles.js` | the TITLE cron (template/resilience pattern to mirror for the abstract cron) |
| `shared/components/admin/PoliciesSection.js` / `pages/api/admin/policies.js` | acknowledgement (COI/AI) admin editor |
| `.claude/skills/stop/SKILL.md` | now enforces ground-truth verification of next-steps |
| `docs/CI_GATES_REFERENCE.md` | gate mechanics (new `build-claim-freshness` section + reconciled `doc-symbol-refs` gitignore note) |

## Gotchas / Continuity

- **Branch discipline (shared working dir):** one git driver at a time; `git status --short --branch` before any commit/checkout (concurrent Codex-app session shares the dir). See `feedback-verify-branch-before-git-action.md`.
- **CI gates run in the Tests/Jest job** (`.github/workflows/test.yml`) — a doc/memory edit that introduces a dangling path (`doc-symbol-refs`) or a stale "planned" claim for an existing path (`build-claim-freshness`) fails CI on push. Annotate or fix; gitignored artifacts are auto-skipped.
- **`NEXTAUTH_URL` = `https://applications.wmkeck.org`** (Production, verified). Don't trust `vercel env pull` for it (Sensitive reads back `""`); use `/api/health`. `REVIEWER_PORTAL_BASE_URL`/`GRANTEE_PORTAL_BASE_URL` are non-sensitive but a *full* prod env pull is permission-gated.
- **Email copy live source is Dataverse**, not code (`wmkf_appsystemsettings` / `/admin → Email Defaults`); `lib/seed/email-defaults/*` is backup. `rebaseline-email-defaults.mjs --force-keys` CLOBBERS admin edits.
- **Test data parked (OWED CLEANUP):** request **1002788** (D26, GUID `feabe26f-dc1b-f111-8341-000d3a306da2`) was flipped to **Advancing** to exercise reviewer email flows (applicant-recommended reviewers have self-linked emails → invites go to Justin; the applicant-recommended PROMOTE path runs NO Claude verification). **Revert to Set-aside when done testing.**
- **Latest-link-wins:** reviewer email rendering with `{{externalLink}}` mints a new hash, invalidating prior links.
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only — confirm it's just those before chasing a "red" run. (These are testPathIgnore-excluded in CI, so the CI Jest job stays green.)
- **Working preference:** Justin optimizes for first-time correctness over fix-later; upfront overhead on starts/stops/commits is wanted. Bias toward prevention. `feedback-first-time-correctness-over-rework.md`.

## Testing

```bash
npm test                          # full suite (only the 2 known-red above should fail locally)
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test  # the new gate
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run lint
```
