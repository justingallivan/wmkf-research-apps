# Session 438 Prompt: Build Workbench Read Coalescing Stage 2

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
the operating target. Track A remains open through 2026-08-18 00:53:40Z. The owner separately
authorized Stage 2 after reviewing the controlled baseline; Track A continues concurrently and is
not a calendar gate unless a named stop condition fires.

## Authorized Work

### Stage 2 build

Claude Fable owns orchestration of the authorized Stage 2 read-coalescing build in a fresh Tier-2
worktree on `codex/claude-workbench-read-coalescing-stage2`, based on this post-decision `main`.
Fable must use Sonnet subagents for implementation on disjoint file surfaces and Opus subagents for
independent adversarial review. Before edits, run `/start` and `/contract-reconcile` Mode B, record a
testable invariant table, and perform the complement/fall-through check. No builder may run git
stash/reset/checkout or otherwise alter another builder's work.

The runtime scope is limited to the three same-row-set merges named in
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`: one in
`lib/services/review-manager/reviewers-service.js`, and separate active and removed merges in
`lib/services/reviewer-finder/my-candidates-service.js`. The decline-referrals service is a
characterization-only non-goal. Preserve chunking, empty-set behavior, projections, response
shapes, fail-soft review-history behavior, DAL/interlock/auth behavior, and all mutation paths.
Do not add a cache, shared helper, migration, route, flag, durable write, or production probe.

Fable must converge through Sonnet remediation plus Opus delta re-review, run the plan's focused
tests and gates (including call-count formula fixtures and a synthetic greater-than-25-id case),
push only the feature branch, leave the worktree clean, and hand the result to Codex for independent
read-only review. Do not merge, deploy, or run Production after-baseline traffic.

## Concurrent Watch

### In Progress

1. **Track A passive operational safety.** Export complete unfiltered slices before the one-day
   retention boundary, flatten/validate `.logs[]`, deduplicate by `eventId`, and measure telemetry
   events/day, malformed events, query truncation, unexpected classifications/outcomes, and visible
   log cost. Stop/re-scope at ~50,000 telemetry events/day or any platform throttling/truncation.

## Other Owner Decisions

1. **Browser-bundle marker scan gate.** Point-in-time production build/static scan is green; an
   automated `.next/static` marker gate remains an optional new CI surface.
2. **Intake proxy routing + intake CSRF.** Still a joint pre-launch requirement in its own
   workstream.
3. **Carried security choices.** Hard-delete tombstone/denylist, verifier-deselect hardening,
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

1. Deferred Data Plane implementation; Stage 2 is now authorized separately.
2. Reviewer merge org-open access and staff-wide document reads — accepted by design.
3. Grantee recipient override and stateless invitation tokens — accepted risks.
4. Hard-delete/email-only reprovisioning without tombstone/denylist — accepted.
