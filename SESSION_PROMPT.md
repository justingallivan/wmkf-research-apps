# Session 398 Prompt: Post-Step-1 steady state

> **Handoff, 2026-08-04 (Session 397).** Production is healthy and carries the
> first tier-gated latency increment (warm-revisit proposal blob cache),
> owner-smoked with a measured ~47% warm-settle cut. All smoke scaffolding is
> removed and verified. Nothing here is urgent. Run `/start` first.

## Session 398 progress (2026-08-04, same day — latency dig SET ASIDE by owner)

All gates were green at start; git clean. The latency thread below is
**deliberately set aside** (owner, 2026-08-04) in favor of the major queue
items (`docs/CURRENT_WORK_QUEUE.md` Current sequence). Do not resume it
without an owner pick from the increment options.

1. **Traffic-gated observation window VOIDED** (`88cf40b1`): reviewer search
   runs ~twice per year, so the S397 "~90d window gates Candidate B" was
   vacuous. New memory
   `project-reviewer-find-usage-cadence-blocks-observation-windows`;
   reconciled in DEVELOPMENT_LOG, findings doc, and here.
2. **Client-side measurement pass (5 production loads, owner's Chrome).**
   Both S397 [ASSUMED] attributions resolved; full data in
   `outputs/reviewer-find-warm-revisit-step0-findings.md` "Client-side
   capture" + "Dig pass" sections. Headlines: the pre-fetch gap is
   ~1.1–1.35s of sequential auth-gating fetches (a RequireAuth
   render-race unmount/remount — not script); `applicant-reviewers` is the
   dominant cost (median ~4.0s at N=4 slots, ~2.9s fixed floor at N=0) and
   its Haiku exclusion parse NEVER fired on 1002903; `load-proposal` blob
   HIT confirmed both loads (residual 1.7–3.3s is the SharePoint listFiles
   invalidation check, by design).
3. **Dig pass (3 Sonnet agents + orchestrator).** Decomposition: ingestion
   critical path = 1 + 2N + 2 sequential Dataverse round-trips, N almost
   always 5 when nonzero (slot census bimodal: 363 zero / 207 four-five).
   Exclusion-text prevalence: 43/570 (~8%) substantive. The survey needed a
   one-off owner-authorized `DATAVERSE_ALLOW_PROD_READS=yes` (command-scoped,
   nothing to clean up); the interlock correctly fail-closed first.
4. **Excluded-reviewers structured intake plan** (`766b6cd2`, routing
   `bd3bc534`): `docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` — schema
   contract for Connor reconciliation; repo-side Phases A/B buildable without
   the form. Queued under dependency-bound work.

### Increment C — SHIPPED + PRODUCTION-VERIFIED (2026-08-04, same day)
Owner picked C; built on branch `fix/require-auth-render-race` (deleted
post-merge), main ff `912ab995 → 27aba5be`.
- **Change**: RequireAuth keeps children mounted through session resolution
  (the 'loading' spinner branch unmounted ProfileProvider+AppAccessProvider
  mid-flight, discarding the in-flight app-access fetch); new
  `shared/utils/auth-enabled.js` dedupes `/api/auth/status` across
  RequireAuth + Layout + pages/index.js (in-flight promise memo, same
  `window.__AUTH_ENABLED__` key).
- **Review chain**: author adversarial pass → Codex adversarial
  (needs-attention → 1 medium CONFIRMED: non-2xx JSON cached as persistent
  "auth disabled", a regression vs the self-healing old inline code — fixed
  in `27aba5be` with 503-then-success + invalid-shape regression tests).
- **Verified**: owner Preview smoke on the branch alias (single status +
  app-access in waterfall, no auth flash, sign-in gates); production
  re-measurement post-promotion — gate went from 2–3 sequential rounds to
  ONE app-access round-trip fired at t≈130ms; the stacked-slow-app-access
  blowout mode (3.9s gate, pre-C load 3) is structurally eliminated. 6,790
  tests green. **Cleanup COMPLETE**: temporary Entra preview callback
  removed — owner-run `az ad app update` 2026-08-04, post-restore
  `az ad app show` returned exactly the four permanent URIs [VERIFIED via
  owner-pasted output, S398].
- **Known remaining (out of scope, attributed)**: `user-profiles` +
  `user-preferences` still fetch twice — the second `session` response
  landing with the real profileId re-fires ProfileProvider's init effect
  (dependency `session?.user?.profileId`). Candidate for a future increment.

### Owner decision pending — next latency increment (pick ONE, tier-gated)
- **D. applicant-reviewers slot loop** (parallelize + skip no-op PATCH):
  ~1–2s on N=5 warm revisits. **D0** cheap precursor: attribute the ~2.9s
  N=0 fixed floor before sizing D.
- **E (new, from post-C data): ProfileProvider double-fetch** — see
  "Known remaining" above; tail cost [ASSUMED ~0.5–1s from the second
  user-profiles+user-preferences pair in the post-C waterfalls; not a
  gate-path measurement].
- **B. exclusion-parse cache**: helps only the ~8% substantive requests; also
  largely obsoleted for new data if the structured-intake plan ships.

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

1. **Blob-cache hazard watch (passive, open-ended, from 2026-08-04).**
   Evidence: `outputs/reviewer-find-warm-revisit-step0-findings.md`
   (gitignored working doc; durable summary below and in the wiki topic).
   Passive: watch for `[load-proposal] blob cache` MISS-rate anomalies or the
   documented delete-after-hit window (analyze fails `Failed to fetch uploaded
   file`, reload self-heals) in any owner report. No action unless signal.
   **The former "~90d observation window" is VOID as a gate** (owner,
   2026-08-04): reviewer search runs ~twice per year, so an organic-traffic
   window yields no data. Follow-on increments are decided on deliberate
   smokes, not elapsed time. See
   `.claude-memory/project-reviewer-find-usage-cadence-blocks-observation-windows.md`.

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

1. **Candidate B (exclusion-parse cache).** SUPERSEDED by the S398 dig: it is
   now option B in the decision-pending list above (helps ~8% of requests;
   never fired on 1002903; partly obsoleted by the structured-intake plan).
2. **~1.9s client mount delay before the Find panel fetches.** RESOLVED as a
   mystery by the S398 measurement: it is ~1.1–1.35s of RequireAuth
   render-race auth gating, now option C in the decision-pending list above.
   The S395-burn-zone caution stands: single-change, tier-gated if approved.

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
