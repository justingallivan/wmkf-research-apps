# Session 398 Prompt: Post-Step-1 steady state

> **Handoff, 2026-08-04 (Session 397).** Production is healthy and carries the
> first tier-gated latency increment (warm-revisit proposal blob cache),
> owner-smoked with a measured ~47% warm-settle cut. All smoke scaffolding is
> removed and verified. Nothing here is urgent. Run `/start` first.

## Session 397 Summary

A long full-arc session: housekeeping → dependency fix → Step 0 measurement →
Step 1 build/review/ship/verify/cleanup.

### What Was Completed

1. **Housekeeping (carryover items 2–5 from S396 handoff)**
   - Wiki topic `reviewer-workbench-lifecycle.md` reconciled post-revert,
     stale marker cleared (`30af076d`).
   - P3 incident-window render check: verdict **RENDERS** — all 7 Aug 1–3
     staff identity confirmations carry the baseline shape (SELECT-only
     production probe; disconfirming condition checked per row).
   - Branches `reviewer-find-revert-baseline` (merged, verified ancestor) and
     later `fix/reviewer-find-proposal-blob-cache` (merged) deleted
     local+origin. `claude-config` settings.json committed/pushed (`db372ca`).
2. **brace-expansion high advisory cleared (`3130733e`)** — no `--force`
   needed: the advisory sat on the vendored compat shim's upstream pin
   (`vendor/brace-expansion-compat`, `npm:brace-expansion@5.0.8` → `5.0.9`).
   Verified via shim smoke + types + full suite + build; promoted by owner ff;
   Dependabot confirms only the postcss moderate remains.
3. **Reviewer Find incremental latency plan — owner-approved and ACTIVE**
   - **Step 0 (measured, production)**: warm revisit ≈5.9s settle; roster GET
     cheap (p50 17 rows/~36 KB); the repeated work was `load-proposal` (full
     PDF re-download + Blob re-upload every mount,
     `ReviewerFindPanel.js:193-199` + `load-proposal-service.js`) and the
     ungated Haiku exclusion parse (`applicant-reviewers-service.js:163`).
     No pre-existing timing telemetry existed anywhere.
   - **Step 1 SHIPPED**: deterministic version-keyed blob cache in
     `lib/services/reviewer-finder/load-proposal-service.js`
     (`efa6aa5e` + `bc3a8739` + `122e6661`; main ff → `c4e08fcc`).
     Review chain: sonnet build → orchestrator trace → opus
     READY-WITH-NOTES (3 hardenings: parity test, null-guard vs weakened
     hash, head-error warn) → Codex adversarial needs-attention (1 hardening
     taken: size validation on hit + list→download race guard; 1 finding
     adjudicated pre-existing, deferred). 6,784 tests green.
   - **Production-verified**: `1003010` MISS→HIT (miss path proven on a
     request Preview never touched); `1002903` HIT at ~3.1s vs 5.9s baseline.
   - **Cleanup COMPLETE**: Preview env var removed, Entra registration
     restored to exactly four permanent callbacks (owner-run `az` verified),
     branch deleted.
4. **Durable docs reconciled** (`2fe397c0`, `7b71fc02`): SESSION_PROMPT
   active-plan section, wiki blob-cache subsection, memory-router latency
   line, DEVELOPMENT_LOG milestone entry (this session).

### Commits (session, chronological)
- `30af076d` docs(wiki): reconcile reviewer-workbench-lifecycle post-revert
- `2c8d3662` docs: mark S397 housekeeping done
- `3130733e` fix(deps): brace-expansion upstream pin 5.0.8 → 5.0.9
- `1d1753f7` docs: record brace-expansion fix in handoff
- `efa6aa5e` fix(reviewer-finder): cache proposal Blob upload on warm revisits
- `bc3a8739` fix(reviewer-finder): opus review hardenings
- `122e6661` fix(reviewer-finder): size validation on hit + miss-path race
- `c4e08fcc` docs(wiki): az-cli write path for temporary Entra callbacks
- `2fe397c0` docs: record Step 1 ship + active plan + routing
- `7b71fc02` docs: cleanup complete — Entra callbacks restored

## Next Items

### Verified Open

1. **Blob-cache observation window (~90d, one blob-sweep cycle, from
   2026-08-04).** Evidence: `outputs/reviewer-find-warm-revisit-step0-findings.md`
   (gitignored working doc; durable summary below and in the wiki topic).
   Passive: watch for `[load-proposal] blob cache` MISS-rate anomalies or the
   documented delete-after-hit window (analyze fails `Failed to fetch uploaded
   file`, reload self-heals) in any owner report. No action unless signal.

### Owner Decision Needed

1. **postcss moderate advisory** (last remaining). Evidence: Dependabot
   alert 62; `npm audit` — pinned under `next`, likely needs a `next` upgrade.
   Tier the upgrade deliberately if approved.
2. **Enrichment-cache staleness on in-place proposal updates**
   (PRE-EXISTING, found by Codex adversarial review, verified not introduced
   by Step 1). Evidence: `outputs/reviewer-find-warm-revisit-step0-findings.md`
   "Separate backlog item"; `reviewer-search-logic.js:531-560` gate matches
   unversioned `enrichedProposalKey`. Decide priority; fix shape recorded.

### Parked

1. **Candidate B (exclusion-parse cache).** Re-open trigger: observation
   window data shows remaining warm-revisit latency justifies it, owner
   approves a new increment. Evidence: Step 0 findings doc.
2. **~1.9s client mount delay before the Find panel fetches.** Deliberately
   left — render-sequencing work is closest to the S395 burn zone. Re-open
   only inside an approved increment.

### Verify Before Acting

1. **Any expansion of latency work.** Required preflight: read
   `.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md`;
   one increment at a time, tier-gated, own observation window.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` and branch
   `reviewer-find-outcome-contract` (abandoned, kept for history — never
   merge/cherry-pick). Evidence: incident doc resolution section.
2. Request `1002903` mutation work — remains a read-only case absent a new
   exact owner authorization. Evidence: incident doc operational cautions.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/reviewer-finder/load-proposal-service.js` | Warm-revisit blob cache (head→hit / download+put miss) |
| `outputs/reviewer-find-warm-revisit-step0-findings.md` | Step 0/1 evidence trail (gitignored working doc) |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Blob-cache subsection + adjudicated hazards |
| `vendor/brace-expansion-compat/` | Vendored shim; upstream pin now 5.0.9 |

## Testing

```bash
npm run check:types
npx jest tests/unit/load-proposal-service.test.js tests/unit/load-proposal.test.js
npx jest   # full suite, 6,784
# Production cache evidence: vercel logs <prod-deployment> --json | grep "blob cache"
```
