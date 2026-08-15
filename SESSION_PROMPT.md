# Session 434 Prompt: Workbench Observability Stage 1 Authorized — Claude Fable Build Next

## Session 433 Summary

Session 433 completed and promoted the Tier-2 disabled-account revocation
hardening. The reviewed branch was merged to `main` as `486fd490`, pushed to
origin, and production deployment was triggered. The merged tree passed the
93-test focused revocation set, the 157-route security gate + self-test,
`check:types`, and a clean-cache production build.

A signed-in production smoke with an already-linked staff account reached
`POST /api/auth/link-profile` and returned the expected fail-closed
`403 { error: 'Account is already linked' }` before any transaction or write.
The fixture-dependent create-new and existing-profile transaction branches were
not mutated in production; their coverage remains the 20-test route suite plus
the recorded Codex/Opus adversarial reviews.

The clean, synchronized, fully merged
`WMKF_Apps-claude-revocation-hardening` worktree and its local/remote branch
were removed after ancestry verification. Justin then authorized setup and
implementation of Workbench observability Stage 1 in a fresh Tier-2 worktree.
Stage 2 remains separately authorized only after a measured Stage 1 baseline.

### What Was Completed

1. **Disabled-account revocation hardening is production-promoted.**
   - Disabled or missing staff profiles fail closed at sign-in, JWT/session,
     bare-auth routes, profile-aware helpers, and both link-profile branches.
   - Link-profile identity transfer is transactionally ordered; create-new
     finalizes the durable temporary row in place; archive reports zero-row
     failure truthfully.
   - Hard-delete/email-only reprovisioning remains an accepted owner risk; no
     tombstone/denylist was added.
2. **Independent review converged.**
   - Claude Fable used Sonnet builders and three Opus review passes.
   - Codex found and fixed the rowless-identity concurrency class.
   - Claude's final Opus re-review found no unresolved blocking or
     high-confidence findings.
3. **Production-safe smoke completed.**
   - Existing linked-account guard returned the expected 403.
   - No production identity row was created, claimed, deleted, or disabled by
     the smoke.
4. **Stage 1 setup authorized.**
   - Branch: `codex/claude-workbench-observability-stage1`
   - Worktree: `/Users/gallivan/Code/WMKF_Apps-claude-workbench-observability-stage1`
   - Base: post-closeout `origin/main`
   - Scope: Stage 1 only; no Stage 2 read merge, deployment, or production
     measurement without a later owner decision.

### Commits

- `486fd490` — Merge reviewed disabled-account revocation hardening
- `92f7729b` — Reconcile completed revocation re-review status
- Full implementation/review provenance remains in
  `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md`.

## Next Items

### Verified Open

1. **Implement Workbench observability Stage 1 in the fresh worktree.**
   Evidence: owner authorization in Session 433; accepted plan
   `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` Stage 1.
   Claude Fable orchestrates Sonnet builders and independent Opus adversarial
   reviewers. Keep all work on the feature branch; do not merge or deploy.
2. **Two pre-existing full-unit failures on `main`.**
   Evidence: `reconcile-probe-entity-set-count` and
   `notification-trust-model-pushup` reproduce on pristine `d32e2d56`.
   They are unrelated to revocation hardening or Stage 1.
3. **Security-operating/documentation backlog.**
   Evidence: carried from Session 430/433 — Security Operating Plan drift,
   proposed `check:trust-boundary-guid` / `check:status-enum-parity`
   backstops, tracked-secret inventory drift, and stale derived doc counts.

### Owner Decision Needed

1. **Stage 1 promotion and measurement window.**
   Evidence: the plan classifies Stage 1 as Tier 2 and marks campaign
   window/release posture `[NEEDS OWNER]`; assume the restrictive posture.
   Codex performs an independent read-only review before any merge.
2. **Stage 2 authorization.**
   Evidence: Stage 1 events and a before baseline are prerequisites. Stage 2 is
   separately authorized after the baseline; it is not latency-gated.
3. **Intake proxy routing + intake CSRF.**
   Evidence: the accepted security audit requires them together before an
   intake pilot; widening applicant routing alone makes the latent gap live.
4. **Measurement-window operations.**
   Evidence: confirm log retention and the unfiltered record shape at window
   start; use the plan's fail-closed export workflow.
5. **Carried decisions.**
   Verifier-deselect hardening, the read-only production-probe list, and any
   decision to add a hard-delete tombstone/denylist remain owner-controlled.

### Parked

1. Full Workbench Data Plane invalidation/client-cache work remains
   evidence-gated after Stages 1–2.
2. Raw-error disclosure cleanup, constant-time cron-secret comparison, and
   `NEXTAUTH_URL` fail-closed hardening remain separate security backlog.

### Do Not Reopen Without New Decision

1. Reviewer merge org-open access and staff-wide document reads are accepted
   by design.
2. Grantee recipient override and stateless invitation tokens are accepted
   risks.
3. Hard-delete/email-only reprovisioning is accepted without a
   tombstone/denylist.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Accepted Stage 1/2 contract and measurement workflow |
| `docs/audits/claude-workbench-observability-plan-response-2026-08-15.md` | Adversarial plan-review record |
| `docs/audits/claude-revocation-hardening-implementation-2026-08-15.md` | Shipped revocation invariants, reviews, and residuals |
| `lib/services/dynamics/http.js` | Stage 1 Dataverse transport seam |
| `lib/services/graph-service.js` | Stage 1 Graph/Azure AD transport seam |
| `lib/dataverse/client.js` | Stage 1 second Dataverse client seam |
| `pages/api/auth/link-profile.js` | Shipped transactional identity-link contract |

## Testing

```bash
# Stage 1 branch — exact targeted tests are derived from the accepted plan
npm run check:types
npm run lint
npm run build
npm run check:api-routes
npm run check:api-routes:self-test
```
