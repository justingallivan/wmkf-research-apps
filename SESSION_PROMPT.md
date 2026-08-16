# Session 443 Prompt: Close Track A; Campaign May Proceed

## Session 442 Summary

Session 442 completed the remaining bounded security follow-ups and removed the parked applicant
intake pilot from the active queue. Workbench Stage 2 remains Production-live and verified under
controlled conditions; its passive Track A safety window is the only required engineering
carryover. The owner may begin the new campaign without waiting for Track A to close.

### What Was Completed

1. **Origin and cron authentication hardening shipped**
   - Production-mode allowed-origin validation now fails closed on missing/invalid configuration;
     Preview may derive only from platform `VERCEL_URL` when fixed `NEXTAUTH_URL` is intentionally
     absent.
   - Both cron verifier variants use the shared constant-time comparison while preserving their
     distinct development-bypass policies.
   - Main merge `96d89c32` deployed READY as `dpl_9aLVHCXupik2CwXDgVrNzcFXXkaC`; a signed-in
     same-origin empty PATCH reached body validation and returned the expected pre-write 400.

2. **Raw internal error responses cleaned and shipped**
   - All 28 audited unguarded literal 500/502 disclosures now return generic text while preserving
     response status/shape, structured service errors, development-only diagnostics, and operator
     logs/records/alerts.
   - Added the missing `summarize-v2` file-load log and a whole-API Babel AST regression guard with
     self-tests for ordinary/optional members, aliases, interpolation, and stringification.
   - Replaced three literal pricing-refresh NUL bytes with escaped `\u0000` source notation without
     changing runtime composite-key semantics.
   - Main merge `51fc8472` deployed READY as `dpl_ErcYWaLLe74zi55MAsL65wJB75vk`; the reconciled
     main head `2e562f75` subsequently deployed READY as `dpl_5nd2G3KqUqXyidnaQQKyBtLVU6uS`.

3. **Atlas drift reconciled**
   - A fresh read-only Dataverse `/$count` returned 793 `wmkf_appreviewersuggestion` rows at
     `2026-08-16T04:47:14Z`; the canonical Atlas page and both active summaries were reconciled.
   - The stale unit-test expectation remains one of the two documented main baseline failures; the
     canonical count is not to be rolled back to satisfy it.

4. **Applicant intake pilot explicitly parked**
   - The June 2026 Phase II pilot was cancelled while WMKF evaluates Connor's GOApply
     re-engineering. Existing `/apply` and `/api/intake/*` foundation code does not reactivate it.
   - Proxy/CSRF launch prerequisites are therefore not current backlog items.

5. **Session evidence bookkeeping attempted**
   - `report:claim-evidence-pilot -- --current` ran during `/stop`, but its local metadata state was
     unavailable. No canonical observation row was added because no eligible report could be
     established.

### Commits

- `1b6f71ce` — Harden origin and cron authentication checks
- `96d89c32` — Merge origin and cron authentication hardening
- `b9683d82` — Record auth hardening production promotion
- `87718c94` — Reconcile reviewer suggestion Atlas count
- `fb735651` — Keep parked intake work out of active backlog
- `820dd5af` — Harden API error responses
- `51fc8472` — Merge raw API error response cleanup
- `2e562f75` — Record raw error cleanup production promotion

## Next Items

### Verified Open

1. **Close the Track A passive safety window after 2026-08-18 00:53:40Z (2026-08-17
   17:53:40 PDT).**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` Track A and
   `docs/SECURITY_OPERATING_PLAN.md` Workbench Dependency Telemetry watch item.
   Perform the final read-only unfiltered export within the one-day retention window, flatten
   `.logs[]`, validate v1 fail-closed, deduplicate only by `eventId`, and document whether any stop
   condition fired. Classify the unrelated Graph `drive-item` 4xx activity without attributing it
   to Stage 2. Track A is a safety observation, not a campaign-launch blocker.

### Owner Decision Needed

1. **Optional Stage 1 browser-bundle guards.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` and
   `docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md`.
   Decide only if desired whether to add a `.next/static` marker-scan CI gate and a browser-bundle
   gate. Neither is required for the campaign or Track A closeout.

### Parked

1. **Phase II applicant-intake portal.**
   Evidence: main commit `fb735651` and the Session 442 owner decision.
   Re-open only if the owner explicitly reactivates the product after the GOApply evaluation; only
   then do proxy applicant-surface routing and intake CSRF become joint pre-launch prerequisites.

### Verify Before Acting

1. **Further Workbench performance optimization.**
   Evidence currently available: controlled Stage 2 after-baseline proves the read-count formula,
   but no organic-user latency claim is authorized and no safe >25-id fixture exists.
   Require Track A or later organic evidence before proposing cache invalidation or another
   optimization stage.

### Do Not Reopen Without New Decision

1. Authenticated Preview smoke coverage or Azure redirect configuration.
2. Reviewer-merge organization-open access, grantee recipient override, or hard-delete tombstones.
3. Decline-referrals person-read merging; no duplicate sibling read exists.
4. Deferred Data Plane invalidation without genuine latency evidence.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Track A closeout contract and stop conditions |
| `docs/audits/workbench-read-coalescing-stage2-production-after-baseline-2026-08-15.md` | Controlled Production after-baseline |
| `docs/SECURITY_OPERATING_PLAN.md` | Current Production security posture and watch items |
| `docs/audits/codex-origin-and-cron-auth-hardening-implementation-2026-08-15.md` | Auth hardening implementation record |
| `docs/audits/codex-raw-error-response-cleanup-implementation-2026-08-15.md` | Raw-error cleanup and promotion evidence |
| `tests/unit/api-error-response-hygiene.test.js` | Whole-API raw-error regression guard |

## Testing

Session 442 final security-cleanup evidence:

```bash
npx jest tests/unit tests/integration --runInBand --silent
# 8232/8234; only the two documented main baseline failures

npm run check:api-routes
npm run check:api-routes:self-test
npm run check:types
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
```

The focused raw-error suites, route/type/security/documentation gates, lint (0 errors), and the
webpack production build passed. Standard Turbopack local build verification was blocked by the
execution environment's local-worker port permission; both Vercel Production deployments reached
READY.
