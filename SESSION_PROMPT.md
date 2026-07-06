# Session 335 Prompt: Notification site-33 CLOSED — next up, service-decomposition refactors

## Session 334 Summary

Drove the site-33 notification trust-model push-up (`docs/NOTIFICATION_TRUST_MODEL_PLAN.md`) from
`status: draft, needs re-review` all the way to **fully executed and closed** across three stages, each
under its own fresh-context Codex adversarial review. The through-line lesson: the plan's original
caller census was built with literal `grep` and had **three silent blind spots** — a binary-flagged file,
a `.call` local alias, and a dynamic `import()` — that hid 3 real callers. Re-closed the census at **23**
verified three independent ways (`grep -a` union, whole-repo sweep, CodeGraph caller query).

### What Was Completed

1. **Startup red gate fixed** — `check:memory-router` was red (`feedback-dont-tune-against-hook-source.md`
   missing a `status:` key). Added `status: active` (`3aa3ac9`).

2. **Census re-closed at 23 + plan cleaned** (`02d3cd9`) — Codex's Stage 0 STOP-on-drift caught
   `pages/api/cron/pricing-refresh.js` (a binary-flagged file grep silently dropped). Verified NEVER-REACHES,
   so Stage 1 scope was unchanged. Recorded the grep-blind-spots lesson in memory (`7d77121`, folded into
   `feedback-symbol-consumer-fanout.md`).

3. **Stage 1 — 9 single-hop push-ups** (`23cff83`): `withDalContext` added at #9,14,15,16,17,18,19,20,21
   + a 14-test characterization suite (`tests/unit/notification-trust-model-pushup.test.js`). Reviewed;
   also mutation-proved the tests discriminate, and recorded the scope-widen at the two monitor sites
   (`0a179ef`).

4. **Stage 2 — multi-hop #10/#11** (`ff1da81` scope, `1b69d4f` code): traced both fan-outs (CodeGraph +
   `grep -a`); collapsed to **1 new wrap** (`onboard-reviewer.js:81`) + coverage — everything else already
   covered by existing route/cron wraps. Reviewed.

5. **Stage 3 — removed the shared net** (`5fa8522` + `a1f13af` test upgrades, `5d685c7` removal): upgraded
   **all 10 already-covered characterization tests to handler-driven** (each mutation-proven — neutralize
   the handler wrap → guard goes red), then removed `withDalContext('notification-email', ...)` from
   `sendAdminEmail`. It now assumes an ambient trusted context; `createAndSendEmail`'s
   `assertTrustedDalContext` is the sole fail-closed backstop (proven by the real-`DynamicsService`
   no-context negative control). Realigned 2 pre-existing tests that pinned the old self-establish contract.
   Fresh-context Codex review: **SATISFIED, no findings**.

Three fresh-context Codex reviews across the arc: the two on shipped code returned only P2 doc-consistency
items (fixed in `0a10400`, `9d3c926`); the final removal review found nothing. Full suite **428/4770 green**.

### Commits
- `3aa3ac9` fix: memory-router gate (status:active)
- `02d3cd9` docs: clean plan + re-close census at 23 (three-way verified)
- `23cff83` feat(dal): Stage 1 push-ups (9 sites) · `5bdf121` docs · `0a179ef` docs (scope-widen + mutation-proof)
- `7d77121` memory: caller-census grep blind spots → grep -a + CodeGraph
- `ff1da81` docs: trace + scope Stage 2 · `1b69d4f` feat(dal): Stage 2 push-ups (#10/#11) · `96d12c0` docs
- `a1f13af` docs+test: S1/S2 review verdict + grantee handler-guard POC · `5fa8522` test: 5 Form-A conversions · `0a10400` docs: reconcile after S3-review P2
- `5d685c7` feat(dal): remove shared notification-email wrapper — site 33 closed · `9d3c926` docs: mark Stage 3 done

## Next Items

### Verified Open

1. **Service-decomposition refactors (carried S331-332, not started).**
   Evidence: `git wc -l` this session — `lib/services/discovery-service.js` (2,348 lines) and
   `lib/services/contact-enrichment-service.js` (1,776 lines), both still oversized;
   `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` closing notes. Decompose each; also the flat `lib/services`
   domain-fold (needs a CodeGraph pass first). Same plan→trace→execute→fresh-review cadence that worked
   for site-33 — and use `grep -a` + CodeGraph for any caller census, not literal grep (this session's
   lesson: `feedback-symbol-consumer-fanout.md`).

### Backlog (small, owner-priority when convenient)

1. **`pages/api/app-access.js` swallows service errors** (P3, pre-existing).
   Evidence: still returns `res.json({ success: true })` on the grant path (`:91`) and `res.json({ success: true })`
   at `:25` regardless of a service `{ error }`. NOTE: line numbers shifted from the old `:88/:105` — re-locate
   before fixing. Fix = route returns an error status when the service reports one.
2. **1b-15 atlas-gate ↔ `check-coverage-self-test.js` race** over the shared `lib/services/atlas_selftest_tmp`
   dir — documented wart; a real fix needs a dedicated fixture path. Not re-verified this session.
3. **pg `sslmode=verify-full`** — `(node:4)` cron stderr warning wants an explicit `sslmode=verify-full`
   in the connection string before pg v9. One-line env change + redeploy. Not re-verified this session.

### Parked

1. **Spec-audit design-docs recovery** (work computer only, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Do Not Reopen Without New Decision

1. **Notification site-33 (`NOTIFICATION_TRUST_MODEL_PLAN.md`): CLOSED.** All three stages executed and
   independently reviewed; the shared `notification-email` wrapper is removed; census closed at 23.
   Evidence: plan Execution-status line + Stage Log (2026-07-05 entries); commit `5d685c7`. The code comment
   at `notification-service.js:171` warns against re-adding an internal wrap — heed it.
2. **`docs/BYPASS_STRIP_PLAN.md` Stages 0-4: CLOSED** (site 33 was its one deferred exception, now also closed).
3. **Chunk-loop gate + security-gate walk consolidation: DECLINED** (S332).
4. **Do not re-add CodeQL** (`180e9046`, `198fbd97`).
5. **Do not delete `lib/services/anthropic-admin.js`** (pricing cron imports).
6. **Client-side export remains the decision** until a Power Automate flow exists
   (`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/NOTIFICATION_TRUST_MODEL_PLAN.md` | CLOSED site-33 record — full Stage Log + all three Codex review rounds. |
| `tests/unit/notification-trust-model-pushup.test.js` | 25-test handler-driven characterization suite (10 already-covered guards + negative control). |
| `lib/services/notification-service.js` | `sendAdminEmail` now assumes ambient DAL context (`:171` comment). |
| `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` | Closed campaign record; source of the refactor-candidate backlog. |
| `.claude-memory/feedback-symbol-consumer-fanout.md` | Caller-census grep blind spots (binary / `.call` / dynamic-import) → use `grep -a` + CodeGraph. |
| `.claude-memory/reference-codex-detached-exec-protocol.md` | How to run detached read-only Codex reviews (used 3× this session, no failures). |

## Testing

```bash
# Site-33 suite (10 handler-driven guards + negative control)
npx jest tests/unit/notification-trust-model-pushup.test.js

# Boundary gates touched this arc
npm run check:dynamics-context-boundary && npm run check:dynamics-context-boundary:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test

# Full suite (was 428 suites / 4770 tests green end of S334)
npm test
```
