# Session 302 Prompt: Reviewer in-browser authoring — build executeChangeset, then Phase 3 (submit)

## Session 301 Summary

Built **Phases 0, 1, and 2 plus the Phase 2.5 feasibility spike** of the reviewer
in-browser review-form authoring rework (plan: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md`).
Each phase was Codex-reviewed and (for the UI) browser-verified in Chromium. The
reviewer stage2b surface is now an in-browser rich-text authoring form with autosave;
**final submit is intentionally NOT built yet** (Submit button disabled) — that's Phase 3.

### What Was Completed

1. **Phase 0 — Dataverse `wmkf_appreviewanswer` child table (PROD).** Answer-snapshot
   entity: 7 columns + `wmkf_Name` primary, N:1 lookup to `wmkf_appreviewersuggestion`,
   and the `(suggestion, questionkey)` alternate key. Created via schema-as-code
   (`lib/dataverse/schema/wave8-review-answer-snapshot/`). Sandbox couldn't host it
   (schema-stale), so prod dry-run → execute.
2. **Phase 1 — data layer + sanitizer (no UI).** `lib/external/sanitize-review-html.js`
   (DOM-free `sanitize-html`, 36-case bypass suite), migration `021_review_drafts.sql`
   (**applied to the live DB**), `lib/services/review-draft-service.js`, and the
   `GET/PUT /api/external/review/[token]/draft` route (server-sanitize on write, finality
   + materials-sent gates, richtext maxLength enforcement).
3. **`computeEngagementState` extracted** to pure `lib/external/review-engagement-state.js`
   (Codex P1) — shared by context + draft routes without the page's I/O graph.
4. **Phase 2 — the UI (full cutover, owner-approved).** 8 rich-text questions added to
   `review-form-schema.js`; `RichReviewEditor` (tiptap, toolbar = sanitizer allowlist);
   controlled `ReviewAuthoringForm` (autosave). `MaterialsView` now renders the authoring
   form — the file-upload card is gone (route/infra retained server-side, hidden per §7).
   Browser-verified (Playwright/Chromium). All Codex Phase-2 findings fixed: P0 draft-load
   race, P1 richtext maxLength, P2 token remount / picklist normalization / dead
   `formSchema` field / submitted-view E2E.
5. **Phase 2.5 spike — `$batch` atomic changeset GO.** `scripts/probe-dataverse-batch-changeset.mjs --execute`
   against prod confirmed multi-op commit + atomic rollback + per-op `If-Match`. **Refutes**
   the "Dataverse has no $batch transaction" belief. Phase 3 uses the clean atomic path;
   the §5a non-atomic fallback (and its unsolved P0-R1/P0-R2) is dropped.

### Commits
- `48a53018` — Phase 0: `wmkf_appreviewanswer` child table (prod)
- `e044bbd3` — Phase 1: data layer + sanitizer
- `b95a5dab` — Extract `computeEngagementState` to a pure lib module
- `91ccf6bf` — Mark `review_drafts` migration applied to the live DB
- `aac92f7d` — Phase 2a: 8 rich-text schema questions
- `50b2b4ba` — Phase 2b: in-browser review form replaces file upload
- `40bdc059` — Phase 2 E2E: stage2b authoring spec
- `3a4a07b6` — Phase 2 review fixes: draft-load race (P0) + richtext maxLength (P1)
- `fc3ce7e5` — Phase 2 P2: `key={token}` remount
- `9df8fdcc` — Phase 2 P2 mop-up: picklist norm, drop dead formSchema, submitted E2E
- `20b56b3f` — Reconcile plan: drop stale formSchema baseline mention
- `d4fe590b` — Phase 2.5: `$batch` changeset feasibility probe
- `c7bf1804` — Phase 2.5 spike result: `$batch` atomic changeset works in prod (GO)

## Next Items

### Verified Open

1. **Phase 2.5 Part B — build `DynamicsService.executeChangeset` + isolated tests (HEADLINE).**
   Evidence: plan §5a step 2/3; spike GO (`c7bf1804`); reusable building blocks in
   `scripts/probe-dataverse-batch-changeset.mjs` (multipart body builder + response parser).
   `executeChangeset(operations, { actingUserSystemId })`: build the `multipart/mixed`
   changeset (per-op `Content-ID` + `If-Match`), parse the multipart response, surface
   per-op failures in the single-row helpers' structured-error shape, reuse the
   token/headers/`bypassDynamicsRestrictions` plumbing. Unit tests: body construction,
   response parse, per-op `If-Match`, all-or-nothing rollback.
2. **Phase 3 — `/submit` route + lifecycle.** Evidence: plan §5/§8/§9.
   `buildReviewSubmission(validated) → { parentPatch, answerRows }` (single producer);
   `/submit` POST → finality precheck (409 if `wmkf_reviewreceivedat` set) + `executeChangeset`
   (upsert answer rows by alternate key + parent rating/affiliation/receivedat PATCH,
   parent `If-Match`-guarded) → delete draft post-commit → tighten token window. Then:
   reviewer-token `/upload` finality guard (P0-1), `context.js` prefill post-submit from
   child rows, `submitted` view read-only, and **wire the now-disabled Submit button**.
   Must enforce: snapshot-fidelity backstop (assert `questionorder/text/type` present —
   Codex S301 P1), exactly-3 rating rows + live-picklist validity (P1-N4/P1-R3), and
   richtext required/empty-after-strip + maxLength validation at submit.
3. **Phase 4 — workbench read-back.** Keyed child read (`queryRecords('wmkf_appreviewanswers', …)`,
   §6) in `/api/review-manager/reviewers`; `ReviewsTab` renders the narrative answers
   (re-sanitize before `dangerouslySetInnerHTML`). Complete the P1-1 consumer fan-out here.
4. **Phase 5 — lifecycle integration + cleanup.** Delete review draft on token revoke +
   regenerate (NOT `mintAndStore`); draft GC in the maintenance cron; document the dormant
   upload infra; full gate sweep + the `stage2b` E2E in CI.

### Owner Decision Needed

1. **Remit-flag candidate — build it?** (carried, not revisited) Set
   `wmkf_authorizationtoremitpaymentflag` on review-completion; natural pairing with the
   Phase 3 submit path. Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.
2. **Ops/Steph BILL-honorarium update** — drafted, Justin to send. `scratchpad/ops-bill-honorarium-update.md`.
3. (carried) BILL API access · self-report PNI field · Workbench access boundaries ·
   generic write-helper restriction policy · applicant-exclusion policy · awardee onboarding ·
   Dataverse settings auditing · GRANTEE_PORTAL title-field provenance.

### Parked / Design-Locked (not this epic)

1. **Staff-editable questions — DECIDED: defer.** Design note recorded (plan §0 #6): unlike
   the fixed-field admin editors, that surface must allow a **variable number** of questions
   (add/remove/reorder). The `wmkf_appreviewanswer` snapshot already supports it (more rows,
   never new columns). Re-open as its own phase after the authoring flow ships.
2. Stage-2A pre-cycle TODOs · intake virus-scan E2E · J27 cluster (~Dec 2026) — soft-deadline launch gates.
3. PD-override sync · honorarium BILL capture-only lock · Wave-1 role-elevation revert ·
   drain-table drops (date-gated 2026-07-01) · VRP/Perplexity coupling · Dynamics sandbox
   stale schema · nomenclature/app-sunset sweep · deferred code cleanup.

### Verify Before Acting

1. Long-stale pre-S294 carryovers — model real-replay signoff, request `1002788` triage,
   Restore-Removed-Candidates E2E. Verify each against source/docs/probes before acting.

### Do Not Reopen Without New Decision

1. **`$batch` is available in prod** — verified S301 (`project-dataverse-batch-changeset-available`).
   Do not build a non-atomic mirror on the strength of the `prompts/[name].js` "no $batch" comment.
2. **stage2b file-upload UI is removed** (S301 cutover) — the upload route/infra is retained
   server-side but intentionally not surfaced (plan §7). Don't "restore" it as a regression.
3. c01a9baa reviewer-email-defaults deploy — live (S297). Reviewer↔CRM-contact boundary —
   email/affiliation stay alert-only (`docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` | The build plan (Phases 0–2 + 2.5 done; §5a/§8 are the Phase 3 contract). |
| `scripts/probe-dataverse-batch-changeset.mjs` | The `$batch` spike — reusable multipart builder + response parser for `executeChangeset`. |
| `lib/services/dynamics-service.js` | Single-row helpers only; add `executeChangeset` here (Phase 2.5 Part B). |
| `lib/external/review-form-schema.js` | 12 fields (affiliation + 3 ratings + 8 richtext); `field.order` drives the snapshot. |
| `pages/api/external/review/[token]/draft.js` | The autosave route (the `/submit` sibling-to-build mirrors its guards). |
| `shared/components/external/ReviewAuthoringForm.js` | The authoring form; Phase 3 wires its disabled Submit button. |
| `.claude-memory/project-dataverse-batch-changeset-available.md` | Why Phase 3 uses the atomic path. |

## Testing

```bash
# Phase 1/2 unit + integration:
npx jest tests/unit/sanitize-review-html.test.js tests/unit/review-draft-service.test.js \
         tests/unit/review-form-schema.test.js tests/integration/external-review-draft-route.test.js
# stage2b authoring E2E (builds + Chromium; 3 tests):
npx playwright test tests/e2e/reviewer-stage2b-authoring.spec.js --project=chromium
# Re-run the $batch spike (prod write, self-cleaning; needs a test suggestion GUID):
node scripts/probe-dataverse-batch-changeset.mjs --suggestion=834d3453-e061-f111-a826-000d3a3065b8 --execute
```

## Gotchas / Continuity

- **Submit is disabled by design** until Phase 3 wires `/submit`. The authoring form
  autosaves but cannot finalize — reviewers can't complete a review until Phase 3 ships.
- **Full `npm test` is green except the documented expected-red** `bill.test.js` /
  `discovery-verification-status.test.js` (`project-bill-com-integration-tests-known-red`).
- **The Codex review agent** (`ae0bc93ae4435252d`) holds the full Phase 0–2 review thread;
  resume it via SendMessage for continuity on Phase 3 reviews.
- **Probe `--execute` is a prod write** (creates+deletes `__probe*` answer rows) — gated by
  the auto-mode classifier; Justin runs it. Test suggestions live under request 1002788.
