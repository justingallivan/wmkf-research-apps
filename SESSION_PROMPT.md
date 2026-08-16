# Session 437 Prompt: Stage 1 Production Safety Window Open

## Session 436 Summary

Workbench Observability Stage 1 was deliberately promoted after Codex review. `main` now contains
merge commit `30ed5fe0`; Vercel deployment `dpl_AEHShYKKSb4WxeuxkUZgMRbLp3kB` reached READY in
Production at 2026-08-16 00:53:40Z, and the authenticated custom application domain was verified to
resolve to that exact deployment. Six focused observability suites passed on merged main
(124/124) before push.

A signed-in, production-safe smoke used only existing-request navigation and GET/read surfaces.
No PATCH, DELETE, dismiss, merge, send, status change, or other mutation was performed. Workbench
dashboard, detail, Find, and Track views loaded; the three target routes emitted 39 correlated
dependency events across small/typical, empty-id-set, and active+removed+decline fixture strata.
All 39 target events reported success, and the `wmkf_potentialreviewerses` counts matched the
pre-Stage-2 chunk-aware formula for the available strata. No >25-id fixture was available, so none
was manufactured.

The window-start Production preflight found a plan-only extraction defect: `vercel logs --json`
returns one request record whose complete console output is under `.logs[]`; top-level `.message`
duplicates only one child. In a bounded complete slice, top-level extraction found 14 events while
`.logs[]` contained 116. The plan now flattens `.logs[]`, validates discriminator-bearing messages
fail-closed, retains only safe metadata plus the PII-safe event, and deletes the transient
unfiltered RAW file. Across bounded preflight/baseline slices, 293 unique events passed the full v1
validator after overlap-safe `eventId` deduplication.

Live Vercel probes verified Pro, no Observability Plus, and no Log Drain. Current base-Pro runtime
log retention is one day, so Track A's 48 hours require exports at least daily; 12-hour slices are
the operating target. Track A remains open through 2026-08-18 00:53:40Z. Stage 2 remains
unauthorized.

## Next Items

### In Progress

1. **Track A passive operational safety.** Export complete unfiltered slices before the one-day
   retention boundary, flatten/validate `.logs[]`, deduplicate by `eventId`, and measure telemetry
   events/day, malformed events, query truncation, unexpected classifications/outcomes, and visible
   log cost. Stop/re-scope at ~50,000 telemetry events/day or any platform throttling/truncation.

### Owner Decision Needed

1. **Stage 2 authorization — not yet.** Decide only after Track A closes and this before-baseline
   is reviewed. If authorized, use a fresh Tier-2 branch/worktree from then-current `main` and
   repeat the same safe fixture strata after implementation.
2. **Browser-bundle marker scan gate.** Point-in-time production build/static scan is green; an
   automated `.next/static` marker gate remains an optional new CI surface.
3. **Intake proxy routing + intake CSRF.** Still a joint pre-launch requirement in its own
   workstream.
4. **Carried security choices.** Hard-delete tombstone/denylist, verifier-deselect hardening,
   tracked-secret inventory cleanup, and raw-error disclosure cleanup remain separately scoped.

### Verify Before Acting

1. **Log extraction:** never use top-level `.message` as the telemetry source. Use the plan's
   `.logs[]` validator and fail closed on shape/contract drift.
2. **Measurement interpretation:** Graph token-promise joining, deadline timeout re-attribution,
   download-leg classification, and the Dynamics/client timeout asymmetry remain named fidelity
   limitations in the plan.
3. **Controlled versus organic evidence:** the baseline is deliberate GET-only traffic. Do not
   describe its latency as organic staff experience; report organic samples below 20 requests per
   route as insufficient.

## Key Files

| File | Purpose |
|---|---|
| `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md` | Production promotion, log-shape finding, safe fixture counts, Track A status |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Corrected export workflow and Stage 1/2 contracts |
| `docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md` | Implementation and adversarial-review record plus promotion addendum |
| `docs/SECURITY_OPERATING_PLAN.md` | Live Workbench dependency telemetry watch item |
| `lib/observability/request-correlation.js` | Production telemetry contract |

## Do Not Reopen Without New Decision

1. Stage 2 or Deferred Data Plane implementation.
2. Reviewer merge org-open access and staff-wide document reads — accepted by design.
3. Grantee recipient override and stateless invitation tokens — accepted risks.
4. Hard-delete/email-only reprovisioning without tombstone/denylist — accepted.
