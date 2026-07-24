# Session 371 Prompt: Probe durable reviewer dispatch evidence

## Session 370 Summary

The reviewer terminal-status slice was reworked to the smallest safe boundary,
adversarially reviewed, merged, deployed, and smoke-tested. Post-accept
`withdrew` and `released` are now live without review-received/completed stamps;
deadline evidence and completed-review payability remain separate features.

### What Was Completed

1. **Terminal-status rework and release**
   - Removed the discarded due-date/HMAC repair design from the active slice.
   - Added the dedicated terminal route/service, ETag-guarded status plus token
     revocation, adapter irreversibility, receipt-writer race guards, terminal
     consumer exclusions, and status-map parity enforcement.
   - Provisioned and verified production picklist values
     `withdrew=100000005` and `released=100000006`.
   - Merged PR #78, then fixed the real acceptance shape where
     `wmkf_accepted=true` coexists with persisted `wmkf_reviewstatus=null`.
   - Merged PR #79 to production at `fd610837`.

2. **Production verification**
   - Vercel deployment `dpl_AH9N4YHnR9jZEu5A9cF1R7EkDdBJ` reached Ready with
     exact Git SHA `fd610837165906ff53a0cd422c57e2b840c7ae43`.
   - A controlled invite to `03aero.works@icloud.com` on test request `1002788`
     reproduced accepted + null status in production.
   - The same ETag-guarded terminal service transitioned that exact row to
     `Withdrew`; Dataverse readback showed status `100000005`, token revoked,
     accepted preserved, and no received/completed timestamp. Workbench rendered
     `Withdrew` and `Revoked`.
   - Browser automation could not resolve the native confirmation dialog, so the
     signed-in production POST seam was not directly observed. Route integration
     tests passed; do not create another synthetic smoke solely for this unless
     the owner explicitly asks. A future real staff terminal action can close
     that last route-level observation.

3. **Smoke cleanup and housekeeping**
   - Deleted the synthetic suggestion and potential-reviewer rows and verified
     both return 404.
   - Verified the acceptance job completed with zero attempts/errors.
   - The app identity lacked Contact DeleteAccess; Justin deactivated the marker
     Contact, verified `Inactive`. The address cannot be reused by the smoke
     helper.
   - Cleared local smoke state, removed the temporary test, closed smoke browser
     tabs, deleted the merged repair branch locally/remotely, and returned the
     shared checkout to `main`.

### Commits

- `0cf8ba1a` — Merge PR #78: terminal-status rework
- `0fa3ac91` — Fix accepted/null-status terminal transition
- `fd610837` — Merge PR #79 to production

## Next Items

### Verified Open

1. **Run the read-only dispatch-evidence probe**
   Evidence: `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` and
   `.claude-memory/project-reviewer-reliability-data.md`.
   Determine whether the existing Dynamics email activity can durably expose or
   carry reviewer suggestion identity, engagement generation, communicated due
   date, ordered sent state, and send timestamp. Do not add schema until an
   owner-reviewed design exists.

2. **Continue the reviewer campaign evidence window**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`.
   Keep the legacy resolver authoritative and record W2 shadow disagreements,
   identity outcomes, staff corrections, invitations, and review completion.

### Owner Decision Needed

1. **Completed-review payability disposition**
   Evidence: `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`.
   This annotates genuinely completed reviews and must remain independent of
   terminal engagement status.

2. **Optional reviewer UX selection**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`.
   Choose only from observed staff friction; no candidate is authorized merely
   because it appears in the queue.

### Parked

1. Applicant intake product build remains parked during the GOApply evaluation.
2. Automated BILL onboarding remains tabled; payment is offline/manual.
3. Destructive reviewer cleanup remains gated by promotion and a full campaign.

### Verify Before Acting

1. **Test-request campaign dates**
   Evidence currently available: the production invitation preview for request
   `1002788` showed respond-by and review-due dates out of chronological order.
   Re-read current campaign configuration and timeline defaults before treating
   this as a product defect; do not edit a dedicated test request silently.

2. **Unrelated reconciliation-report drift**
   Evidence currently available: `docs/RECONCILIATION_REPORT.json` was modified
   before this work and intentionally excluded from the release/session commits.
   Re-run the reconciliation probe and resolve current Atlas counts before
   staging it; do not commit the dated generated output blindly.

### Do Not Reopen Without New Decision

1. The discarded HMAC materials-repair receipt and mutable first/last due-date
   fields remain rejected.
2. Terminal status, deadline evidence, payability, and pre-accept reset remain
   separate features.
3. Do not repeat the synthetic terminal-status smoke solely to exercise the
   browser confirmation; prefer observation of the next real staff action.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical priority sequence |
| `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` | Shipped terminal contract and deferred dispatch design |
| `.claude-memory/project-reviewer-reliability-data.md` | Durable owner goal and feature boundaries |
| `lib/services/review-manager/terminal-transition-service.js` | Terminal predicate and ETag-guarded write |
| `lib/services/review-receipt-guard.js` | Shared terminal/race guard |
| `pages/api/review-manager/terminal-transition.js` | Authenticated terminal route |
| `scripts/extend-reviewstatus-picklist-terminal.mjs` | Production picklist provisioning |

## Testing

```bash
rtk npm test -- --runInBand tests/unit/terminal-transition-service.test.js tests/integration/terminal-transition-route.test.js
rtk npm run check:status-enum-parity
rtk npm run test:status-enum-parity
rtk npm run check:api-routes
rtk npm run check:docs
rtk npm run build
```
