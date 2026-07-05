# Session 331 Prompt: Pick the next campaign — legacy bypass strip or Route→Service Stage 0

## Session 330 Summary

Session 330 closed out the DAL campaign's security work end-to-end and stood up
two new pieces of durable infrastructure. Everything below is committed and
pushed (`fff391bb`…`4ef83c77` + close-out).

### What Was Completed

1. **S329 email-write High closed** — `createEmailActivity`/`addEmailAttachment`/
   `sendEmail` now call `assertTrustedDalContext` first (all 10 production call
   sites pre-verified inside trusted contexts); `grant-reporting/extract.js`
   `tryLogAiRun` wrapped in `withDalContext` (was silently dropping audit rows
   under dev/test enforcement); email + `withDynamicsContext` coverage added to
   `tests/unit/dal-enforcement.test.js`. Codex re-review: pass-with-findings;
   both findings (fetch-mock isolation, brittle census count) fixed. The Medium
   "ALS-presence-only trust" finding is ACCEPTED until the legacy strip
   (documented in the DAL plan stage log). `fff391bb`, `7bdebc76`.

2. **Stage 8 gate hardened to real law** — Codex adversarial review of
   `scripts/check-dataverse-access-layer.js` found 3 Highs (ordinary JS
   indirection produced zero census entries). Fix designed via 5-round Codex
   iteration to SATISFIED, Codex-built, Claude-reviewed: sanctioned-reference
   audit (`unattributable-use:*` on any recognized-binding use outside a
   whitelist), `modules/` scanned, 16 red fixture classes, live burn-down zero.
   `0d531098`.

3. **PROD `DATAVERSE_DAL_ENFORCEMENT` FLIPPED** — explicit `=on` in Vercel
   production env + redeploy (aliased `reviews.wmkeck.org`). Runtime logs clean
   post-flip; drain/health crons cycling 200s. Enforcement active in ALL
   environments. Docs reconciled across every restatement. `4ef83c77`.

4. **Route→Service consolidation plan authored and P0-APPROVED** —
   `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`, `status: active`, NOT executed.
   3 adversarial P0 rounds (round 1: 1 live-state error + 7 changes; round 3:
   SATISFIED, zero live-state errors). 49-route union, staged waves with named
   micro-stages (2s streaming pilot = `generate-emails.js`; 2b =
   `send-emails.js`), P1s/P1m secondary pilots, gate reuses the hardened
   scanner primitives. `9f40a23b`…`54b66f33`.

5. **Plan/review enforcement hook layer** — Codex-built from the S330 P0
   coverage-miss post-mortem, Claude-reviewed and tuned (codegraph counts as
   read evidence; source-read guard is delta-scoped). Four mechanisms now
   BLOCK with visible in-artifact escapes: assumption-count leakage
   (`[DERIVED-FROM:]`), plan-names-unread-sources (`[NOT-READ:]`),
   same-session doc staleness (`[RECHECKED after…]`/`[STALE-ACCEPTED:]`,
   Stop-blocking), untraced discovery delegation (`[DELEGATED-DISCOVERY:]`).
   Shared detectors + plain-node tests in `.claude/hooks/lib/document-guards.js`.
   Two live catches on day one. `cc004a95`, `9a633ddd` (+ owner-side
   `be83243e`, `05422a74` codex-rescue routing guards).

6. **Codex plugin job-tracking bugs researched and recorded** — lost/zombie
   jobs root-caused to plugin #432/#428/#412 + upstream console indexing;
   operating rules in `.claude-memory/reference-codex-plugin-job-tracking-bugs.md`
   (foreground-only rescue runs, no daemon queries mid-job, `--fresh` for
   writes, paste-ready prompts for owner console visibility). `db923c2e`.

### Commits
`fff391bb`, `7bdebc76`, `9f40a23b`, `0d531098`, `db923c2e`, `eb383fde`,
`157327b3`, `27a20134`, `54b66f33`, `cc004a95`, `be83243e`, `05422a74`,
`9a633ddd`, `4ef83c77`, plus this close-out.

## Next Items

### Verified Open

1. **Legacy `bypassDynamicsRestrictions` strip** (the DAL campaign's sole
   remaining item). Evidence: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
   open-items header `[VERIFIED 2026-07-04]`; census command there (81 files on
   2026-07-04 — recount at start). Owner decisions already made 2026-07-04:
   in-campaign, sequenced AFTER the prod flip (now done), ends with trust-model
   tightening so `assertTrustedDalContext` can distinguish DAL-established
   contexts. Good parallel-worktree batch job; touching the 49 Route→Service
   in-scope routes twice is wasteful — see Owner Decision 1 below.

2. **Route→Service consolidation Stage 0** (census gate + test inventory, no
   prod code). Evidence: plan `status: active`, P0 round 3 SATISFIED
   `[VERIFIED via docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md stage log]`.
   Pre-stage re-probe of all baseline counts is mandatory per the plan.

3. **`(node:4)` warning on `pages/api/cron/drain-submissions`** — error-level
   log line on an otherwise-200 cron, observed post-flip 2026-07-04 (predates
   nothing DAL — cron succeeds and also logs clean cycles). Evidence: vercel
   runtime logs, deployment `wmkfresearchapps-k4pzrfhkv`. Low priority; read
   the full warning text via `vercel logs` when convenient.

### Owner Decision Needed

1. **Which campaign runs next session — strip first or Route→Service Stage 0/1
   first?** They overlap: converting a route to a service shell replaces its
   bypass wrapper anyway (plan Decision 4), so strip-first does ~49 of its 81
   files twice. Recommendation on file: run Route→Service waves first, let them
   absorb the route-side strip for free, then a smaller mechanical strip pass
   (lib/ + scripts/ remainder) closes the DAL campaign and unlocks trust
   tightening.

### Parked

1. **Spec-audit design-docs recovery** (work computer only, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Verify Before Acting

1. **Session 328 carryover: thank-you cron proof + rehearsal cleanup; owner
   browser spot-check of the release flow.** Not re-verified in S329 or S330.
   Check `.claude-memory/` + a fresh probe before treating as open work.
   (Post-flip log window showed `drain-submissions`/`drain-reviewer-acceptances`/
   `health-check` cycling 200; `send-review-thankyous` did NOT appear in that
   window — its schedule/proof status is unverified this session.)
2. **Prod DAL enforcement watch.** Initial post-flip logs clean, but only
   ~30 min of traffic observed. Early next session: grep runtime logs for
   `no trusted Dataverse context` before starting new work on this surface.

### Do Not Reopen Without New Decision

1. **ALS-presence trust model** — accepted until the legacy strip completes
   (DAL plan stage log, 2026-07-04). Tightening early breaks legacy importers.
2. **Email methods stay in the gate's `non-entity-transport` exempt set** —
   intentional; they are runtime-guarded since `fff391bb`, and the exemption is
   census taxonomy, not a security hole (Codex-verified twice).
3. **Do not re-add CodeQL** (`180e9046`, `198fbd97`).
4. **Do not delete `lib/services/anthropic-admin.js`** (pricing cron imports).
5. **Client-side export remains the decision** until a Power Automate flow
   exists (`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` | DAL campaign audit trail; open-items header lists the strip as sole remainder. |
| `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` | Next campaign, P0-approved; Stage 0 is the entry point. |
| `scripts/check-dataverse-access-layer.js` | Law gate with sanctioned-reference audit — reuse its primitives for the new route gate. |
| `.claude/hooks/lib/document-guards.js` | Shared detectors for the enforcement hook layer (+ plain-node tests beside it). |
| `.claude-memory/reference-codex-plugin-job-tracking-bugs.md` | Codex delegation operating rules (foreground-only, no mid-job daemon queries, --fresh for writes). |
| `.claude-memory/feedback-plan-contracts-read-the-extremes.md` | Plan-authoring guards behind the new hooks. |

## Testing

```bash
# Gates for the surfaces touched this session
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
node .claude/hooks/lib/document-guards.test.js && node .claude/hooks/hook-enforcement.test.js
npx jest tests/unit/dal-enforcement.test.js

# Full suite (4188/4188 at close)
npm test

# Prod enforcement watch
vercel logs <latest-prod-deployment-url> | grep -i "trusted Dataverse"
```
