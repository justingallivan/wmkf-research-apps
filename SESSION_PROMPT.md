# Session 300 Prompt: Reviewer review-form rework (queued)

## Session 299 Summary

A long, mostly-investigation session: closed both open honorarium threads, ran a
cost optimization, shipped the parallel-agent skill, and did a full docs-staleness
cleanup via a Codex parallel worktree. No production app code shipped — the one
near-term build (the reviewer review-form rework) was deliberately set aside for a
dedicated next session.

### What Was Completed

1. **Honorarium Thread 2 — RESOLVED + REFUTED.** The `wmkf_*approval` fields are
   **not** dead org-wide (full-table scan, `scripts/probe-akoya-approval-flags-deadness.js`):
   3 of 4 are populated (`wmkf_authorizationtoremitpaymentflag` 303 Yes; ED/DO approval
   datetimes 323/611; only `wmkf_controllerapproved` unused). Reconciled the contradicting
   "all dead" claim across two memory files.
2. **Honorarium Thread 1 — RESOLVED.** Connor's manual classification is a **fixed,
   fully-automatable template** (Individual / Honorarium / Research Reviewer / $250 flat /
   cycle meeting-date), 87/87, no per-reviewer judgment (`scripts/probe-akoya-honorarium-classification-step.js`).
3. **Remit-flag scope decision (Justin).** Our app *may* set
   `wmkf_authorizationtoremitpaymentflag` when a review lands (`wmkf_reviewreceivedat`) as a
   fulfillment/eligible-to-pay trigger; **all approvals stay out of scope.** Tracked
   candidate, not committed (revises the S188/S206 "integration never touches this flag").
4. **SerpAPI downgraded** Production→Developer ($150→$75/mo, 5k searches) — usage was
   ~1.7% of plan (account API). Justin executed it; cost fact reconciled across 5 files.
5. **`parallel-agent-worktree` skill shipped** (`ca07945e`) over the worktree runbook.
6. **Stale-audit cleanup** — verified F-001 + F-002 already resolved in code; drain-table
   "deferred cleanup" superseded (migration 018). Doc stamped + archived.
7. **Docs staleness audit (Codex parallel worktree)** — Codex reviewed all 309 `docs/`
   files → 21 KEEP / 39 ARCHIVE / 2 DELETE. Acted on in full: 2 deletes, **39 archived to
   `docs/archive/`** with every inbound full-path ref rewritten (docs/memory/code); 11
   doc/structure gates green. Report kept as the snapshot.
8. **Ops/Steph BILL-honorarium update drafted** → `scratchpad/ops-bill-honorarium-update.md`
   (ready to send/convert; Justin's to send).
9. **Reviewer review-form reviewed** (not changed). The "submit your review" surface is the
   external portal `stage2b` view (`MaterialsView.js`), a 4-question schema-driven form
   (`lib/external/review-form-schema.js`) + file upload. **Rework queued for S300.**

### Commits
- `d8a2aded` / `6dd8cfa1` / `67a532b7` / `a38c26a6` - Docs staleness audit + archive 39 + 2 deletes
- `af53c885` / `22a9f64b` - SerpAPI downgrade to Developer + cost-fact reconcile
- `784c26f1` - Stale-audit F-001/F-002 stamped resolved
- `63d4ff26` - Thread 1: classification is a fixed automatable template
- `6d15133c` - Dangling-threads register folded into SESSION_PROMPT
- `e88d8852` / `fc12c384` - Remit-flag candidate scope decision + trigger
- `beba534b` - Thread 2: refute "approval flags dead"
- `ca07945e` - parallel-agent-worktree skill

## Next Items

### Verified Open

1. **Reviewer review-form rework (HEADLINE — Justin set this aside for a focused session).**
   The reviewer "submit your review" screen is the external portal `stage2b` view. The
   structured form is **schema-driven, 4 questions** in `lib/external/review-form-schema.js`
   (affiliation + Q1 impact / Q3 risk / Q10 overall; free-text Qs stay in the uploaded PDF);
   layout in `shared/components/external/{ReviewFormFields,MaterialsView}.js`; write path
   `lib/services/review-upload.js` (sets `wmkf_reviewreceivedat`). Justin wants changes to
   how it "looks and acts" — start by previewing, then edit the schema.
   **Preview recipe (verified S299):** the E2E harness mocks `stage2b` with no token/Dataverse —
   recreate a throwaway spec from `tests/e2e/reviewer-return-upload.spec.js` (`buildContext({view:'stage2b'})`
   + `mockPortal`) ending in `await page.pause()`, then `npx playwright test <spec> --headed`
   (reuses a `next build && next start -p 3100`; harness uses `--webpack`).

### Owner Decision Needed

1. **Remit-flag candidate — build it?** Set `wmkf_authorizationtoremitpaymentflag` on
   review-completion (`wmkf_reviewreceivedat`). Sync already initializes the flag on 87/87
   honoraria, staff never flip it → clean fit. Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.
   Natural pairing with the form rework (same flow).
2. **Ops/Steph BILL-honorarium update** — drafted; Justin to send. `scratchpad/ops-bill-honorarium-update.md`.
3. **BILL API access** — the only thing that *removes* (vs relocates) honorarium friction;
   portal onboarding built + gated → Ops/leadership.
4. **Self-report PNI segmentation field** — build the small version now or wait? → owner.
5. **Reviewer-Workbench access boundaries** (team-open read set? reviewer-mgmt = lead PD only?
   writeup-edit perms + CSO/President view?) → Justin. Evidence: `.claude-memory/project-reviewer-apps-redesign-direction.md`.
6. **Generic write-helper restriction policy** — should `createRecord/updateRecord/deleteRecord`
   enforce restrictions internally, or only route-level? → owner. Evidence: `docs/archive/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md`.
7. **Applicant-exclusion policy** — how broadly may a PI exclude reviewers → foundation.
   Evidence: `.claude-memory/project-applicant-exclusion-policy-pending.md`.
8. **Awardee onboarding** — GAL-sent status field unknown, discover in Dataverse first → Connor.
9. **Dataverse settings auditing** → Connor (re-open when he sets scope + flips the audit flag).
10. **GRANTEE_PORTAL title-field provenance** (`wmkf_wmkfprojectdescription` vs `wmkf_projecttitle1`)
    → Connor + Sarah (doc-only; doesn't block the build). Evidence: `docs/GRANTEE_PORTAL_BUILD_PLAN.md`.

### Gates A Real Launch (soft deadlines)

1. **Stage-2A pre-cycle TODOs** — COI policy body still `[PLACEHOLDER]`; `wmkf_policy*`
   delete-privilege role unrestricted. Both before slice 1 ships to a real cycle. Evidence:
   `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md`.
2. **Intake-portal virus-scan E2E** — before the portal goes live to real applicants.
   Evidence: `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.
3. **J27 cluster (~Dec 2026)** — `wmkf_requestdocument` doc-capture table, grant-phasing
   relabel model, ~300-proposal triage dashboard, prompt-storage Phase 1/2. Design-locked.

### Parked By Design / Already Tracked

PD-override-correction sync (`docs/agent-wiki/topics/reviewer-identity.md`) · honorarium BILL
capture-only lock · Wave-1 role-elevation revert · drain-table drops (date-gated 2026-07-01)
· VRP/Perplexity provider coupling · Dynamics sandbox stale schema · nomenclature/app-sunset
sweep · deferred code cleanup · `docs/REVIEWER_IDENTITY_RECONCILIATION_EDITS.md` four
doc-hygiene questions.

### Verify Before Acting

1. **Long-stale pre-S294 carryovers** — model real-replay signoff, request `1002788` triage,
   Restore-Removed-Candidates E2E. Verify each against source/docs/probes before acting.
   (NOTE: "reviewer-portal upload design" is removed from this list — confirmed **shipped + live**
   S299: `stage2b` upload via `pages/api/external/review/[token]/upload.js` + `review-upload.js`.)

### Do Not Reopen Without New Decision

1. **c01a9baa reviewer-email-defaults deploy** — confirmed live (S297).
2. **Reviewer↔CRM-contact boundary epic** — `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`;
   email/affiliation stay alert-only.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/external/review-form-schema.js` | The 4-question reviewer review-form schema (S300 rework target). |
| `shared/components/external/MaterialsView.js` | The `stage2b` "submit your review" screen. |
| `lib/services/review-upload.js` | Review-upload write path (sets `wmkf_reviewreceivedat`). |
| `docs/DOCS_STALENESS_AUDIT_2026-06-28.md` | The staleness-audit record (acted on; snapshot). |
| `.claude-memory/project-honorarium-payment-landscape.md` | Honorarium onboarding→payment current-state + remit-flag candidate. |
| `.claude/skills/parallel-agent-worktree/SKILL.md` | The parallel Claude+Codex worktree workflow. |

## Testing

```bash
# Reviewer review-form preview (S300): recreate a paused stage2b spec, then:
npx playwright test <spec> --headed       # mocks stage2b; no token/Dataverse
# Codex worktree reuse (parked, ready):
git -C ../WMKF_Apps-codex fetch origin && git -C ../WMKF_Apps-codex checkout -B codex/<task> origin/main
npm run check:agent-invariants            # symlink invariants
```

## Gotchas / Continuity

- **Codex worktree is parked** at `../WMKF_Apps-codex` (`codex/parked`, at the latest
  `origin/main`). Reuse it; don't recreate. `node_modules` + symlinks intact.
- The **reviewer review-form is schema-driven** — most "what it asks" changes are one file
  (`review-form-schema.js`); the E2E harness is the only way to preview `stage2b` (token-authed,
  state-driven — a plain URL won't render it).
- **Remit-flag candidate revises a settled decision** — five docs/memories say "integration
  never touches `wmkf_authorizationtoremitpaymentflag`." Reconcile all of them only if/when it's built.
