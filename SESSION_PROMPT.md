# Session 333 Prompt: Execute the bypass-strip campaign (plan reviewed, execution-ready)

## Sessions 331–332 Summary

One continuous overnight-plus-morning run. Everything below is committed and
pushed (`493bd748`…`903867c9`).

### What Was Completed

1. **Route→Service consolidation campaign CLOSED (Stages 0–7)** — all 49
   in-census routes are thin shells over 51 service files in 11 domain dirs;
   `check:route-service-boundary` promoted ratchet→permanent LAW; suite
   4188→4670 across the campaign. Five fresh-context Codex stage reviews, all
   findings resolved same-session. Full record:
   `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` Stage Log.

2. **Latent prod defect found & fixed mid-campaign** — intake drain's Dataverse
   writes ran with NO trusted DAL context since the S330 enforcement flip
   (masked by wholesale mocks + idle-tick 200s). Fixed per DAL Stage 7 doctrine
   (`withDalContext` around each state handler); regression test drives the
   REAL context machinery (`tests/unit/drain-submissions-dal-context.test.js`).

3. **MORNING FLAG RESOLVED (S332)** — owner-approved read-only prod audit:
   `submission_jobs` is EMPTY (zero rows ever; `intake_drafts`/`intake_audit`
   also 0; schema fully migrated at 23). `POSTGRES_URL` is one value across
   all Vercel envs, so this IS prod. The defect never stranded a submission —
   nothing to requeue. Drain cron healthy (2-min ticks, all 200s; the
   error-level `(node:4)` lines are just the pg sslmode stderr warning).

4. **Refactor exercise 1 — OData escape consolidation CLOSED** — 12 sites onto
   `odata.escape`; 2 guarded swaps (typeof throws), D1
   `encodeURIComponent(odata.escape())`, D2 `odata.eqGuid`. Closing Codex
   review PASS-WITH-FINDINGS (1 P3 wording caveat, no regression).
   `docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md`.

5. **Refactor exercise 2 — array-chunk consolidation CLOSED** — new
   `lib/utils/chunk.js` (fail-closed TypeError/RangeError); 17 mechanical
   swaps / 12 files; 4 index-using sites left with citing comments. Plan
   review caught a P0 census miss (non-`i` counter). Code review round 1 NOT
   SATISFIED (2 findings, fixed: catalog self-containment + deferred-promise
   round-separation pin) → round 2 SATISFIED. `docs/CHUNK_CONSOLIDATION_PLAN.md`.

6. **Refactor exercise 3 — gate-script scaffold consolidation CLOSED** —
   `scripts/lib/selftest-fixture.js` (explicit disposers; every cleanup call
   point preserved 1:1 per a 19-row Cleanup-Timing Table; 18 self-tests
   adopted, 1b-15 coverage/atlas-race EXCLUDED) + `scripts/lib/walk-files.js`
   (`walkTree`, adopted by the 6 byte-identical markdown gates). Acceptance
   bar: byte-identical gate census+verdict via an fs-preload trace shim — met
   with two fully-attributed exceptions (the new files themselves). Closing
   review SATISFIED, no findings. Executor made a correct autonomous STOP on a
   pre-existing red gate (my own doc drift; fixed as precursor `c054a26e`).
   `docs/GATE_SCRIPT_CONSOLIDATION_PLAN.md`.

7. **Owner decisions recorded (S332, all three Stage Logs)** — odata
   escape-law gate APPROVED and BUILT (`scripts/check-odata-escape.js` +
   self-test, registered in package.json/CI/gates-reference//start; 565 files
   green); chunk-loop gate DECLINED (cosmetic class); security-gate walk
   consolidation DECLINED (census-drift risk). Guarded-swap typeof throws and
   D2 eqGuid acknowledged, no action.

8. **Bypass-strip campaign plan DRAFTED + adversarial review FOLDED** —
   `docs/BYPASS_STRIP_PLAN.md` (`status: draft`, execution-ready). Census of
   record: **52 functional bypass scopes / 40 files** (50 literal calls — 32
   pages / 18 lib — plus 2 default-parameter aliases in the alert services the
   review's P0 caught; third-alias sweep proves no others). Labels are NOT
   inert (`checkRestriction` reads `ctx.requestId`) — every swap byte-preserves
   them. Review round 1 NOT SATISFIED (1 P0, 2 P1, 1 P2) — all folded:
   functional-scope split, three-shape Stage 3 law (import boundary +
   empty-restrictions `withDynamicsContext` fail-closed + script-only helper
   outside scripts/) with a ten-fixture self-test set, per-cluster negative
   controls, corrected script-helper count (59/58).

### Suite / gates at close
418 suites / 4714 tests, all gates green (incl. the new `check:odata-escape`).

## Next Items

### Verified Open

1. **`docs/BYPASS_STRIP_PLAN.md` — EXECUTED, Stages 0-4 (S333, 2026-07-05).**
   Stages 0-3 (characterization, mechanical strip, import-boundary law) landed
   and passed one Codex adversarial review round (1 P1, folded same-session).
   Owner then directed executing Stage 4 (trust-model tightening) too: 4
   nested-redundant wrappers removed (sites 40, 47, 49, 50) and 6 entry-seam
   wrappers pushed up to their real callers (sites 34, 35, 44, 45, 46, 48) —
   site 33 (`notification-service.js`) deliberately left as-is (its DAL-touching
   branch sits inside a 21-caller shared utility; safely auditing the full
   fan-out was judged out of scope). Full Stage Log in the plan doc. **Open:**
   a second fresh-context review round covering the Stage 4 diff specifically
   has not yet run.

2. **Research-first refactor candidates (after the strip)** — oversized
   `discovery-service.js` (2,347 lines) / `contact-enrichment-service.js`
   (1,776 lines) decomposition; flat `lib/services` domain-fold (needs a
   CodeGraph pass first). Same plan→review→execute cadence.

### Backlog (small, owner-priority when convenient)

1. **`pages/api/app-access.js` swallows service errors** (`:88`/`:105` return
   success even when the service returns `{ error }`) — pre-existing, surfaced
   by exercise-1's closing review (P3). Fix = route returns an error status.
2. **1b-15 `check-coverage-self-test.js` ↔ atlas gate race** over the shared
   `lib/services/atlas_selftest_tmp` dir — documented wart, excluded from the
   fixture-helper adoption; a real fix needs a dedicated fixture path.
3. **pg `sslmode=verify-full`** — the `(node:4)` cron stderr warning asks for
   an explicit `sslmode=verify-full` in the connection string before pg v9.
   One-line env change + redeploy; behavior today is already verify-full.

### Parked

1. **Spec-audit design-docs recovery** (work computer only, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Do Not Reopen Without New Decision

1. **Chunk-loop gate + security-gate walk consolidation: DECLINED** (S332,
   recorded in the CHUNK/GATE_SCRIPT Stage Logs).
2. **ALS-presence trust model** — bypass strip (Stages 0-4) is complete
   (S333); site 33 (`notification-service.js`) is the one deliberate
   exception, left un-pushed-up (see item 1 above). Do not reopen without a
   new decision to audit `notify()`'s full 21-caller fan-out.
3. **Do not re-add CodeQL** (`180e9046`, `198fbd97`).
4. **Do not delete `lib/services/anthropic-admin.js`** (pricing cron imports).
5. **Client-side export remains the decision** until a Power Automate flow
   exists (`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/BYPASS_STRIP_PLAN.md` | Executed campaign (Stages 0-4, S333); Stage Log has full record; second fresh-context review of Stage 4 still pending. |
| `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` | Closed campaign record + drain-defect post-mortem. |
| `docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md` / `CHUNK_CONSOLIDATION_PLAN.md` / `GATE_SCRIPT_CONSOLIDATION_PLAN.md` | The three closed refactor exercises (plans double as summaries). |
| `scripts/lib/selftest-fixture.js` + `scripts/lib/walk-files.js` | New canonical helpers — REQUIRED for new self-tests/gate walks. |
| `lib/utils/chunk.js` | Canonical array-chunk helper (import as `chunked`). |
| `scripts/check-odata-escape.js` | New escape-law gate (in the /start list). |
| `.claude-memory/reference-codex-detached-exec-protocol.md` | How to run Codex reviews without hangs/pair-kills (hard-won this session). |

## Testing

```bash
# New gate + the two law gates most touched this session
npm run check:odata-escape && npm run check:odata-escape:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test

# Full suite (418/4714 at close)
npm test
```
