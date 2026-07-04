# Session 327 Prompt: Reviews-tab consumption suite live; first-submission verification ahead

## Session 326 Summary

Session 326 planned and shipped the entire **workbench Reviews-tab consumption
build-out** (4 phases, all deployed to production), verified the S325 drain
deployment, and ran a browser drive against live data. The portal is being
built AHEAD of the December-2026 review cycle — zero reviews have ever been
submitted through it (owner-stated), which bounds what could be runtime-verified.

### What Was Completed

1. **Plan + assessment.** Verified the reviewer submission pipeline is complete/live
   and the gap was staff consumption. Wrote `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`
   (4 phases, owner-confirmed decisions: schema-free rendering, live-question-set
   ordering, client-side export with Dataverse-data Power-Automate seam, sweep-shared
   nudge machinery).

2. **Phase 1 — Outstanding tracking + manual nudge (LIVE, drive-verified).**
   DTO adds `submitted`/`daysSinceMaterialsSent`; Outstanding section in
   `ReviewsTab`; new POST `/api/review-manager/send-review-reminder` →
   `lib/services/reviewer-manual-reminder.js`, reusing the review-due cron's
   claim-before-send (shared `wmkf_remindersentat`+`wmkf_remindercount` marker —
   manual+cron can never double-send; manual re-send allowed by design).

3. **Phase 2 — Schema-free comparison matrix (LIVE).** "Compare" toggle: ratings
   grid (average/spread, labels from each snapshot row's own `answerText`) +
   per-question narrative browser. Pure derivation in `shared/utils/review-matrix.js`;
   `liveQuestions` rides the reviewers GET fail-soft. Retired keys badged "Prior
   cycle"; "not asked" distinct from empty. Plus a stale-response guard on the
   tab's load fetch (monotonic fetch-id).

4. **Phase 3 — Panel-prep export (LIVE).** Pure `composeReviewReport` +
   `htmlToBlocks` tokenizer (sanitizer-allowlist grammar only) → client-side DOCX
   (full fidelity) + PDF (inline formatting flattened, documented). Also fixed a
   Phase 1 regression (outstanding/submitted filters now share the
   `reviewReceivedAt` signal — lists structurally disjoint).

5. **Phase 4 — AI synthesis (LIVE; awaiting first submission to exercise).**
   Tier-1 prompt `review-synthesis.generate` seeded v1 (create-only bootstrap);
   `reviews_digest` declared untrusted (Executor wraps, caps at 60k with visible
   truncation marker); strict-JSON output validated/bounded → NEW prod Dataverse
   column `akoya_request.wmkf_reviewsynthesisjson` (wave11 applied 2026-07-03,
   live-probed). POST `/api/review-manager/synthesize-reviews` (409
   `no_submitted_reviews` before any LLM call; regeneration via explicit
   `overwrite`). Shape-sanitizing DTO parse guarantees the card renders only
   strings. Deploy order mattered: column BEFORE code (unprovisioned-column
   selects hard-400).

6. **S325 carryover #1 CLOSED.** Drain deployment verified: prod build on exact
   SHA; `/api/cron/drain-reviewer-acceptances` live (fail-closed 401 without
   cron secret).

7. **Browser drive (PASS, zero-submission era).** On `applications.wmkeck.org`
   against live data: tab render, Outstanding rows (disabled-nudge tooltip via
   accessible name), both empty states, correct ABSENCE of Compare/Export with
   zero submissions, clean console, request-switch stale-guard. Lesson recorded:
   staff sign-in exists ONLY on applications.wmkeck.org — the external hosts'
   /auth/signin is a dead end by design (memory `project-branded-domains.md`
   HAZARD section + portal wiki topic).

8. **Evaluator handoff log** for a companion LLM: `outputs/SESSION_326_REVIEW_HANDOFF.md`
   (~3,930 lines, Parts 1-5 with full diffs and per-phase skepticism targets).
   ⚠️ `outputs/` is gitignored — this file exists ONLY on the home machine.

### Commits

- `a5b83349` docs: Reviews tab consumption build-out plan
- `ce83023e` docs: wire plan into wiki; pin nudge marker semantics
- `5ad9d99a` memory: campaign-settings UX revisit note (owner ask)
- `b107b940` feat: Phase 1 — outstanding tracking + manual review-due nudge
- `ceeac840` feat: Phase 2 — schema-free comparison matrix
- `b103f84a` fix: stale-response guard on ReviewsTab load
- `e6991f35` feat: Phase 3 — panel-prep export (DOCX/PDF) + Phase 1 regression fix
- `1f69966f` docs: browser-drive results + D26 verification boundary
- `5a613c58` docs+memory: host hazard (staff sign-in only on applications.wmkeck.org)
- `fc9ab2c7` feat: Phase 4 — AI synthesis (schema+seed were pending at commit time)
- `cbc3f571` docs: Phase 4 go-live executed (wave11 provisioned, deployed, prompt seeded)

## Next Items

### Verified Open

1. **Staged test submission to verify the populated consumption suite end-to-end.**
   Evidence: zero portal submissions exist (owner-stated S326; route 409s
   `no_submitted_reviews`); recipe documented in
   `docs/agent-wiki/topics/external-reviewer-portal.md` (S308 `regenerate-token`
   procedure — mint a magic link for a test reviewer without email, opt out of
   honorarium, fill + submit the live form). This is the one action that
   runtime-proves Compare, Export, and Synthesis at once, ahead of real D26 reviews.

2. **Monitor first live reviewer accept through the S325 drain queue** (carryover,
   second half). Evidence: cron route verified live this session; no accept
   observed yet. Inspect `reviewer_acceptance_jobs` for a completed row or a
   retryable failure after the next real accept.

3. **Triage the companion-LLM evaluation** of `outputs/SESSION_326_REVIEW_HANDOFF.md`
   when the owner runs it. Evidence: log finished at Part 5 this session; findings
   in review-matrix/review-report/synthesis are "least field-tested" by design.
   NOTE: the log file is local to the home machine (outputs/ gitignored).

4. **Campaign-settings UX revisit** (owner ask, S326). Evidence:
   `.claude-memory/project-campaign-settings-ux-revisit.md` — low prominence +
   set-once defaults should carry forward without per-flow re-confirmation.
   Preflight: verify which send flows actually re-ask before scoping.

5. **`AwardeeTab.js` unguarded id-keyed fetch** (same stale-response pattern fixed
   in ReviewsTab `b103f84a`). Evidence: grep this session found it as the only
   remaining sibling. One-line fix whenever that tab is next touched.

### Measure Later

1. **Institution-COI ledger calibration.** Evidence:
   `scripts/probe-institution-coi-breakdown.mjs` documents the read-only
   measurement. Run with enough accumulated `coi_dropped` rows to validate
   Phase C thresholds. (Unchanged from S325.)

### Owner Decision Needed

None at stop.

### Parked

1. **Spec-audit docs recovery on the work computer** (~2026-07-08). Evidence:
   `.claude-memory/project-spec-audit-docs-recovery-parked.md`. Do not re-search
   local/origin; target is unpushed `codex/spec-audit` work.

### Verify Before Acting

1. **Do not apply old S322 cleanup suggestions without fresh caller checks.**
   Evidence: `docs/DEAD_CODE_DELETION_MANIFEST.md` correction history.

2. **Acceptance confirmation email remains at-most-once by design** — do not
   change to retry-on-failure without a product/ops decision. Evidence:
   `lib/services/reviewer-acceptance-drain.js` pre-send `claimedAt` guard.

3. **Synthesis concurrent-generate race is ACCEPTED, not a bug.** Two concurrent
   Generate clicks can both run the LLM; last write wins on the column
   (staff-initiated, no side effects beyond tokens). Evidence: route header in
   `pages/api/review-manager/synthesize-reviews.js` + handoff log Part 5. Do not
   "fix" without an owner ask.

### Do Not Reopen Without New Decision

1. **Do not re-add CodeQL as a required private-repo gate.** Evidence: `180e9046`,
   `198fbd97`.
2. **Do not delete `lib/services/anthropic-admin.js` as dead code.** Evidence:
   pricing-refresh cron imports it.
3. **Two advisory hooks remain retired by owner approval**
   (`doc-edit-reconcile-reminder.js`, `memory-placement-reminder.js`). Evidence:
   `docs/HARNESS_INSTRUCTION_AUDIT_S322.md`.
4. **`pre-commit-self-review.js` deliberately kept.** Evidence: same audit doc.
5. **Client-side export (no server export route / no roll-up column) until a
   Power Automate flow exists to consume one.** Evidence: plan doc governing
   decision 4 (owner decision S326); the pure composition module is the seam.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | The 4-phase plan; all phases DEPLOYED; verification-boundary + status source of truth. |
| `shared/components/workbench/ReviewsTab.js` | The tab: Outstanding, Cards/Compare, Export, Synthesis card. |
| `lib/services/reviewer-manual-reminder.js` | Manual nudge service (shared marker claim-before-send). |
| `shared/utils/review-matrix.js` | Pure schema-free matrix derivation (Phase 2; consumed by Phase 3). |
| `shared/utils/review-report.js` (+`-docx.js`, `-pdf.js`) | Pure report composition + HTML tokenizer; client-side renderers. |
| `pages/api/review-manager/synthesize-reviews.js` | Synthesis route (409 on zero submissions; overwrite-gated regeneration). |
| `shared/config/prompts/review-synthesis.js` | Prompt source of truth (untrusted variable decl + output/validation schemas). |
| `scripts/seed-review-synthesis-prompt.js` | Create-only seed; v1 SEEDED in prod 2026-07-03. |
| `lib/dataverse/schema/wave11-review-synthesis/` | Schema-as-code for `wmkf_reviewsynthesisjson`; APPLIED to prod 2026-07-03. |
| `pages/api/review-manager/reviewers.js` | DTO: outstanding fields, liveQuestions (fail-soft), shape-sanitized reviewSynthesis. |
| `outputs/SESSION_326_REVIEW_HANDOFF.md` | Companion-LLM evaluation log (LOCAL ONLY — outputs/ gitignored). |

## Testing

```bash
npm test -- tests/unit/reviewer-manual-reminder.test.js tests/unit/review-matrix.test.js tests/unit/review-report.test.js tests/unit/synthesize-reviews.test.js tests/unit/review-manager-reviewers-synthesis-dto.test.js tests/unit/reviews-tab.test.js
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:route-lifecycle-auth && npm run check:route-lifecycle-auth:self-test
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:trust-boundary-guid && npm run check:trust-boundary-guid:self-test
npm run build
```

Live probes run this session (read-only unless noted):
- Vercel API: production deployments READY on exact SHAs `b107b940`…`fc9ab2c7`.
- `/api/cron/drain-reviewer-acceptances` → 401 (fail-closed, route live).
- Prod Dataverse `$select=wmkf_reviewsynthesisjson` → HTTP 200 (column live;
  WRITE: created via wave11 `--execute`).
- Prompt seed `--execute` (WRITE): `review-synthesis.generate` v1, exactly one
  current row verified.
