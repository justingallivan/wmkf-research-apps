# Session 345 Prompt: Resume reviewer-invite send-side validation & Dynamics decomposition (Checkpoint C)

## Session 344 Summary

Prompt-governance session. Fully closed the S343 prompt-legacy-audit follow-up: **sunset the
four PDF-upload document-processing apps**, **removed dead prompt generators**, and **wired the
peer-review summarizer to the shared Executor** (a Codex-reviewed cross-layer migration). Also
answered an owner "where is the delete-reviewer feature" question (it's by-design, not a bug).

### What Was Completed

1. **Sunset the 4 PDF-upload apps** (`f9d9a593`). Removed `phase-ii-writeup`,
   `batch-proposal-summaries`, `batch-phase-i-summaries`, `phase-i-writeup` from `APP_REGISTRY`
   (out of nav/home/admin grant UI); added `sunset-candidate` entries to `APP_LIFECYCLE_REGISTRY`.
   Pages + API routes LEFT ROUTABLE, code retained (NOT archived) as the reference for a future
   Dataverse-native migration. Grants retained. Regenerated `CANONICAL_COUNTS` (app count 16→12)
   + reconciled 5 restatements. `@deprecated`/sunset markers on `createStructuredDataExtractionPrompt`
   + the 3 process routes + the dormant `phase-ii.extract-structured` row.
2. **Removed 2 dead prompt generators** (`18b7578b`). `createThemeSynthesisPrompt` +
   `createActionItemsPrompt` (zero call sites) deleted from `peer-reviewer.js` + barrel.
3. **Wired peer-review-summarizer to the Executor** (`1559e8dc`, hardened `4dd5c84b`).
   `process-peer-reviews.js` now runs the `peer-review-summarizer.analyze`/`.questions`
   `wmkf_ai_prompt` rows via `executePrompt()` — staff `/admin` edits take effect. Per-review A7
   wrapping preserved (route-owned); rows re-seeded with `a7_preamble` + `{{a7_preamble}}` system
   prompt. **Design → Codex review → build** flow; both Codex passes' findings folded in. Added
   `executePrompt({ assertSystemIncludes })` — fail-closed A7 guard tied to the composed prompt.
   Verified: byte-identical content parity, real e2e smoke, 5178 tests, build, gates green.
4. **Diagnosed "where is the delete-reviewer feature"** (no code change). "Remove entirely" is
   shipped but intentionally two-step: soft-remove a reviewer first ("Remove from this request"),
   then expand the collapsed "Removed (N)" section → "Remove entirely" (red). `canManage`-gated.
5. **Documented CodeGraph as per-machine, auto-synced, never committed** (`a42f55d5`).

### Commits (all pushed to main)
- `f9d9a593` sunset 4 PDF-upload apps · `18b7578b` remove dead peer-review generators
- `71a6d1d6` migration plan (Codex-reviewed) · `1559e8dc` wire peer-review to Executor
- `4dd5c84b` fix A7 fail-open (assertSystemIncludes) + document sunset access (Codex review #2)
- `a42f55d5` CodeGraph wiki note · `ab87872a`/`feeac51a`/`63a4ded3`/`a1ee639a` doc reconciliations

## Next Items

### Verified Open

1. **Resume reviewer-invite send-side validation** (carried S341/S342/S343 — still only the
   read-only half is done). Evidence: `git log 64ab81a5..HEAD` has no send-path commits (verified
   S344); `reviewer-invite-capture-mode-not-full-sandbox.md`. Unexercised: capture-send +
   "possibly sent — verify" retry state, abstract-edit save + 409 compare-and-set. Requires a
   THROWAWAY reviewer suggestion + proposal (capture blocks email only — still mints Dataverse
   tokens + stamps lifecycle).
2. **Continue the Dynamics decomposition — Checkpoint C (`write-core.js`, Stage 6).** Evidence:
   `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` (A+B EXECUTED; C–F pending; `lib/dataverse`
   untouched S344 — verified). C = DAL entity-write core, DEDICATED review (4 `assertTrustedDalContext`
   sites, impersonation fallback, 412/ETag, `updateIfEmpty`). Highest-risk cluster is D (`changeset.js`).

### Owner Decision Needed

1. **"Remove entirely" discoverability.** Evidence: `shared/components/reviewers/ReviewerInvitePanel.js:458-513`;
   owner raised S344 (couldn't find it). The permanent-delete is a deliberate two-step behind the
   collapsed "Removed (N)" section. If that's too hidden, options: surface it on active rows behind
   the confirm modal, or default-expand "Removed". Needs an owner call before touching a shipped flow.
2. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md`
   (owner ask S343). Payable/not-payable flag + potential/invited reset button. Needs build-shape decision.
3. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.
   Optional ratcheting beyond the closed 2-route untrusted surface. (Carried, unchanged.)

### Parked

1. Residual prompt-legacy write-path audit ([ASSUMED]) — confirm no other LLM free-text reaches a
   length-capped `akoya_request` field. Evidence: `project-prompt-legacy-audit-followup.md`; low priority.
2. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
3. Product/UX asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings
   UX revisit (`project-campaign-settings-ux-revisit.md`).
4. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md` (S339 flagged).
5. Dependabot #53 merge once real tests green. Evidence: `gh pr checks 53`.

### Do Not Reopen Without New Decision

1. **Peer-review Executor migration is SHIPPED** (`1559e8dc`/`4dd5c84b`). Evidence:
   `project-peer-review-executor-migration.md`, `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`. The
   legacy generators are ROLLBACK-ONLY, not the live path; don't "restore" them as the source.
2. **4 PDF-upload apps are SUNSET** (`f9d9a593`). Evidence: `APP_LIFECYCLE_REGISTRY`,
   `docs/PROMPT_LEGACY_AUDIT.md` disposition banner. Code retained by design for DV-native migration;
   superusers can't browser-load them (documented + accepted) — don't re-add keys to `ALL_APP_KEYS`.
3. **"Remove entirely" two-step is by design** (S343). Don't add a one-click permanent-delete on
   active reviewers without an owner decision (see Owner Decision #1).

### Verify Before Acting

1. **Prompt rows are LIVE in Dataverse** (`peer-review-summarizer.*` re-seeded S344 with `a7_preamble`).
   If re-seeding or editing these rows, keep `{{a7_preamble}}` in the system prompt — the route's
   `assertSystemIncludes: reviewNonces` fail-closes if it's dropped (that's intended). Evidence:
   `scripts/seed-peer-review-summarizer-prompts.js`, `shared/config/prompts/peer-reviewer-dynamics.js`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `pages/api/process-peer-reviews.js` | Peer-review route — now Executor-driven; route-owns A7; `assertSystemIncludes` fail-closed |
| `lib/services/execute-prompt.js` | Executor; new `assertSystemIncludes` option (throws after compose / before Claude call) |
| `scripts/seed-peer-review-summarizer-prompts.js` | Publishes the 2 peer-review rows (incl. `a7_preamble` var) |
| `shared/config/appRegistry.js` | `APP_REGISTRY` (12 active) + `APP_LIFECYCLE_REGISTRY` (4 sunset-candidates) |
| `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md` | The migration design + both Codex reviews + verification |
| `docs/PROMPT_LEGACY_AUDIT.md` | Fable per-prompt audit + S344 disposition banner |

## Testing

```bash
npm test                                                  # full suite (5178 green as of S344)
npm run build
npx jest tests/unit/execute-prompt-payload-boundary.test.js   # incl. assertSystemIncludes fail-closed tests
# Peer-review Executor path (real Claude call + Dataverse; use a throwaway):
#   node scripts/seed-peer-review-summarizer-prompts.js --dry-run   # inspect the live rows
# Reviewer-invite send-side (still to do; THROWAWAY record):
#   REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev   # capture blocks email, NOT Dataverse writes
```
