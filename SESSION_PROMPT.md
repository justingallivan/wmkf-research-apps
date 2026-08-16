# Session 436 Prompt: Stage 1 Codex-Reviewed — Owner Merge Decision Next

## Session 435 Summary

Codex completed the independent review of Workbench Observability Stage 1 on
`codex/claude-workbench-observability-stage1` (base `31041461`). No runtime, security, or contract
blocker was found; merge is recommended. Two P3 cleanups and the owner-amended measurement program
landed in `60b5aa1`: the route characterization test now compares separate console-spy snapshots,
the UUID documentation reflects optional correlation, and the former passive 20-request/two-week
Stage 2 prerequisite is replaced by a passive 48-hour safety track plus a controlled GET-only
before/after baseline. The branch is pushed and synchronized; the worktree is clean.
**Not performed:** Stage 2 items, merge, deployment, production measurement, durable
persistence, production data access, Vercel CLI housekeeping.

### What Was Completed

1. **Stage 1 observability landed (behavior-preserving).**
   - New `lib/observability/request-correlation.js`: dedicated pre-auth ALS (independent of
     the DAL ALS), `withRequestCorrelation`/`getRequestCorrelation`/`mintCorrelationId`,
     closed-set classifiers, guarded `console.log(JSON.stringify(event))` emitter.
   - Instrumented seams: `lib/services/dynamics/http.js`, `lib/services/graph-service.js`
     (module-local helper), `lib/dataverse/client.js` (lazy server-only load). Response/error
     identity preserved; interlock denials untimed/unemitted; only telemetry failures
     swallowed; `lib/utils/service-error.js`, `dynamics-context.js`, `core/context.js`,
     `shared/components/**` untouched.
   - Correlation established at the first executable handler line (before `requireAppAccess`)
     in `pages/api/review-manager/reviewers.js`, `pages/api/reviewer-finder/my-candidates.js`,
     `pages/api/workbench/decline-referrals.js`.
2. **Adversarial review converged with zero open findings.**
   - 13 initial findings (none blocking) + 6 delta findings — all RESOLVED or
     RECORDED-by-agreement; full table in
     `docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md`.
   - Notable: Turbopack statically resolves variable-path requires, so browser-import safety
     rests on reachability (bundle-scan verified), not the require pattern; `classifyOutcome`
     unwraps `error.cause.code` for raw Node fetch errors; plan validator now accepts the
     omitted-`statusClass` `http_error` deviation.
3. **Codex independent review closed.**
   - Fresh review found no runtime/security blocker and independently passed the focused suites,
     production build, client-bundle marker scan, typecheck, lint, transport/route gates, and doc
     gates.
   - P3 test fix: normal and broken-emitter runs now snapshot distinct Jest spies before parity is
     asserted. P3 doc fix: every event has `eventId`; only correlated target-route events also have
     `correlationId`.
4. **Verification green through `60b5aa1`.**
   - Six observability suites 124/124; full unit+integration 8173/8175 — the only 2 failures
     are the known baselines (`reconcile-probe-entity-set-count`,
     `notification-trust-model-pushup`), reproduced identically on the pristine base
     `31041461` in the main checkout.
   - `check:dataverse-access-layer`(+self-test), `check:types`, `check:api-routes`(+self-test),
     lint, doc gates(+self-tests), `git diff --check`, and the production build all PASS.
5. **Durable docs reconciled (Mode A sweep over the changed facts).**
   - Plan: Stage 1 is implemented and independently reviewed; validator amendment,
     emission-scope fidelity notes, and owner-amended measurement program are current.
   - `docs/SECURITY_OPERATING_PLAN.md`: new Workbench Dependency Telemetry watch item.
   - `docs/SERVICE_AND_UTILITY_CATALOG.md`: `lib/observability/` section.
   - Implementation/adversarial-review record created (see Key Files).
   - No DEVELOPMENT_LOG milestone: the branch is unmerged; milestone lands at promotion.

### Commits

- `ea0c207e` — Implement Workbench Observability Stage 1 (module, 3 seams, 3 routes, tests)
- `bd986b68` — Apply Opus adversarial-review remediations and reconcile Stage 1 docs
- `7e384ec9` — Close Opus delta re-review findings
- `930bd082` — Record Stage 1 convergence and closeout
- `670ac6d9` — Session 435 prompt / Claude handoff
- `60b5aa1` — Close Codex P3 findings and amend the measurement program

## Next Items

### Verified Open

1. **Two pre-existing full-unit failures on `main`.**
   Evidence: reproduced this session on pristine `31041461` (main checkout, clean tree):
   `reconcile-probe-entity-set-count` (Atlas count drift 724 vs 790) and
   `notification-trust-model-pushup`. Unrelated to Stage 1.
2. **Security-operating/documentation backlog.**
   Evidence: carried from Sessions 430/433 — tracked-secret inventory drift and stale derived
   doc counts. (The formerly-proposed `check:trust-boundary-guid` / `check:status-enum-parity`
   backstops now exist as passing gates — verified via `package.json` and this session's
   `/start` gate sweep — so that sub-item is DONE.)

### Owner Decision Needed

1. **Stage 1 promotion (merge) and owner-amended measurement program.**
   Evidence: plan Tier 2; campaign window/release posture `[NEEDS OWNER]`; Codex review is the
   gate before merge. The first 48 hours are a passive app-wide volume/safety check. Because
   Reviewer Find runs about twice per year, Stage 2 is not gated on 20 organic requests per route:
   capture a deliberate signed-in GET-only baseline over representative existing requests, with
   no PATCH/DELETE/dismiss/merge/send action, then repeat the same fixtures after Stage 2. Organic
   latency remains optional evidence and must be labeled insufficient when sparse. At window
   start: verify log retention and the unfiltered JSON record shape and preflight against a known
   emitted event (plan workflow).
2. **`.next/static` marker-scan CI gate for the browser-import contract.**
   Evidence: Opus finding A-1 — the production build proves reachability today only as a
   point-in-time scan; a scan gate is a new gate surface deliberately not added in Stage 1.
3. **Stage 2 authorization.**
   Evidence: Stage 1 events supply the before-baseline; Stage 2 is source-certain, not
   latency-gated, separately authorized.
4. **Intake proxy routing + intake CSRF (carried).**
   Evidence: accepted security audit requires them together before an intake pilot.
5. **Carried decisions.** Verifier-deselect hardening, read-only production-probe list,
   hard-delete tombstone/denylist — owner-controlled.

### Parked

1. Full Workbench Data Plane invalidation/client-cache work — evidence-gated after Stages 1–2.
2. Raw-error disclosure cleanup, constant-time cron-secret comparison, `NEXTAUTH_URL`
   fail-closed hardening — separate security backlog.

### Verify Before Acting

1. **Reading Stage 1 measurement numbers.**
   Evidence: plan "Emission-scope fidelity notes" — Graph token-leg counts are
   under-attributed by design (shared `tokenPromise`), deadline timeouts surface as later
   successes, download legs classify `unknown`/`unknown`, and cause-wrapped undici timeouts
   through `dynamics/http.js` read `network_error` while the same failure through raw
   `client.js` reads `timeout`. Read the notes before quoting any window numbers.

### Do Not Reopen Without New Decision

1. Reviewer merge org-open access and staff-wide document reads — accepted by design.
2. Grantee recipient override and stateless invitation tokens — accepted risks.
3. Hard-delete/email-only reprovisioning without tombstone/denylist — accepted.
4. T1/T2 of the observability plan — closed history; no prospective work.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md` | Stage 1 invariants, all Opus findings/dispositions, verification, residuals |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Stage 1/2 contract, amended validator, fidelity notes |
| `lib/observability/request-correlation.js` | Correlation ALS + telemetry emitter (source header is the contract) |
| `lib/services/dynamics/http.js` / `lib/services/graph-service.js` / `lib/dataverse/client.js` | Instrumented egress seams |
| `docs/SECURITY_OPERATING_PLAN.md` | Workbench Dependency Telemetry watch item |

## Testing

```bash
# Stage 1 branch verification (all green through 60b5aa1)
npx jest tests/unit/request-correlation.test.js tests/unit/observability-event-contract.test.js \
  tests/unit/dynamics-http-observability.test.js tests/unit/graph-service-observability.test.js \
  tests/unit/dataverse-client-observability.test.js tests/unit/workbench-route-correlation.test.js
npm run check:types && npm run lint && npm run build
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
```
