# Session 301 Prompt: Reviewer in-browser authoring — start Phase 0

## Session 300 Summary

A design-heavy session: shipped one small reviewer review-form code change, then
produced and hardened (through three Codex review passes) a build plan for the
larger reviewer review-form rework. No production app code beyond the quick win —
the authoring build is plan-complete and ready to start.

### What Was Completed

1. **"Unable to answer" removed from the review-form picklists (SHIPPED).** The
   `value: 99` option is gone from Q1 impact / Q3 risk / Q10 overall. Validation now
   rejects 99; any pre-removal stored 99 decodes to "Not provided" (graceful — no
   aggregation code depended on it). Reconciled in one pass: schema, the
   `labelForReviewRating` comment, 3 unit tests (75 pass), and 2 plan docs. Gates green.
2. **Reviewer in-browser review-form authoring build plan (PLAN-COMPLETE, converged).**
   Pivot from "structured ratings + uploaded narrative PDF" → a full in-browser
   authoring surface: 8 new rich-text questions (Q2/Q4–Q9/Q11, exact wording embedded),
   tiptap WYSIWYG, Postgres-backed autosave drafts, and a **point-in-time answer-snapshot
   child table** (`wmkf_appreviewanswer`) as the Dataverse system of record. Decisions
   locked: submit is final/read-only; all free-text required except Q11; standard
   formatting set; uploads hidden-not-deleted; store both sanitized HTML + plain text;
   questions in code for v1 (snapshot guarantees fidelity), staff-editable later.
   Ran **three Codex design passes** — all P0/P1/P2 + pivot findings folded in. Codex
   verdict: "Yes with conditions — Phase 0 can start."

### Commits
- `10bb61c1` — Remove "Unable to answer" from review-form picklists (shipped)
- `8885bfe0` — Add build plan (initial: per-question columns)
- `ee499edd` — Revise: snapshot child table + Codex pass-1 fixes
- `83e85170` — Fold Codex pass-2 findings ($batch helper, idempotency, child read, drift)
- `4e1f56a2` — Fold Codex pass-3 findings; plan converged (Phase 0 ready)

## Next Items

### Verified Open

1. **Reviewer in-browser authoring — Phase 0 (HEADLINE; hands-on, do together).**
   Evidence: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` §3a, §8.
   Create the `wmkf_appreviewanswer` child table + the `(suggestion, questionkey)`
   alternate key in Dataverse (Justin + Claude — Connor not required). Zero new parent
   columns. Then Phase 1 (sanitizer + bypass tests → `review_drafts` migration `021` →
   `ReviewDraftService` → draft GET/PUT routes) is buildable with no external dependency.
   Full phasing (0→5) and every Codex-hardened contract are in the plan.

2. **Reviewer authoring — Phase 2.5 `$batch` feasibility spike (do before Phase 3).**
   Evidence: plan §5a; `lib/services/dynamics-service.js` (no changeset helper exists);
   `pages/api/admin/prompts/[name].js:12` ("Dataverse has no $batch transaction").
   Confirm the Dataverse `$batch` changeset endpoint works in this environment before
   building `DynamicsService.executeChangeset`. Non-atomic fallback is documented but
   marked DO-NOT-SHIP until P0-R1/P0-R2 are designed.

### Owner Decision Needed

1. **Staff-editable questions now, or defer?** Plan §0 #6 assumes defer (code-in-v1 +
   snapshot fidelity; Dataverse-authored questions a later phase). Confirm at Phase 0.
2. **Remit-flag candidate — build it?** (carried from S300, not revisited) Set
   `wmkf_authorizationtoremitpaymentflag` on review-completion. Evidence:
   `.claude-memory/project-honorarium-payment-landscape.md`. Natural pairing with the
   authoring flow (both touch the submit path).
3. **Ops/Steph BILL-honorarium update** — drafted, Justin to send. `scratchpad/ops-bill-honorarium-update.md`.
4. (carried, not revisited) BILL API access · self-report PNI field · Workbench access
   boundaries · generic write-helper restriction policy · applicant-exclusion policy ·
   awardee onboarding · Dataverse settings auditing · GRANTEE_PORTAL title-field provenance.

### Gates A Real Launch (soft deadlines)

1. Stage-2A pre-cycle TODOs (COI policy body `[PLACEHOLDER]`; `wmkf_policy*` delete-priv).
   Evidence: `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md`.
2. Intake-portal virus-scan E2E before real applicants. Evidence:
   `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.
3. J27 cluster (~Dec 2026) — doc-capture table, grant-phasing relabel, triage dashboard,
   prompt-storage Phase 1/2. Design-locked.

### Parked By Design / Already Tracked

PD-override-correction sync · honorarium BILL capture-only lock · Wave-1 role-elevation
revert · drain-table drops (date-gated 2026-07-01) · VRP/Perplexity coupling · Dynamics
sandbox stale schema · nomenclature/app-sunset sweep · deferred code cleanup.

### Verify Before Acting

1. Long-stale pre-S294 carryovers — model real-replay signoff, request `1002788` triage,
   Restore-Removed-Candidates E2E. Verify each against source/docs/probes before acting.

### Do Not Reopen Without New Decision

1. **c01a9baa reviewer-email-defaults deploy** — confirmed live (S297).
2. **Reviewer↔CRM-contact boundary epic** — email/affiliation stay alert-only.
   Evidence: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` | The converged authoring build plan (Phase 0→5, all Codex-hardened contracts). |
| `lib/external/review-form-schema.js` | Review-form schema (now 4 fields; gains `richtext` type + 8 questions in the build). |
| `lib/services/intake-draft-service.js` | The Postgres draft/autosave pattern the reviewer drafts mirror. |
| `lib/services/dynamics-service.js` | Single-row writes only — the `$batch` changeset helper must be built (plan §5a). |
| `shared/components/external/MaterialsView.js` | The `stage2b` surface the authoring form replaces. |
| `shared/components/workbench/ReviewsTab.js` | Staff read-back; gains the narrative answers in Phase 4. |

## Testing

```bash
# Review-form unit tests (incl. the "Unable to answer" removal):
npx jest tests/unit/review-form-schema.test.js tests/unit/review-rating-decode.test.js \
         tests/unit/reviews-tab.test.js tests/unit/review-upload.test.js
# stage2b preview (when building the editor): paused Playwright spec, headed —
# recreate from tests/e2e/reviewer-return-upload.spec.js (buildContext({view:'stage2b'})).
```

## Gotchas / Continuity

- **The authoring plan is plan-only — no code written.** Phase 0 (Dataverse child table)
  is a hands-on step to do with Justin, not solo.
- **Codex rescue wrapper was flaky this session** — it stuck in a polling loop and never
  returned the third-pass output via the agent channel; the result was pulled directly
  from `~/.codex/sessions/.../rollout-*.jsonl`. If the wrapper stalls again, read the
  latest rollout file's final assistant message rather than re-pinging indefinitely.
- **Stored XSS is the top build risk** — reviewer HTML rendered to staff. Sanitize
  server-side on write AND render with `sanitize-html` (never DOMPurify+jsdom — serverless
  incompat). The plan §4 has the executable allowlist contract.
- **Submit atomicity** rests on the unbuilt `$batch` changeset helper; spike first (§5a).
