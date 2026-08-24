# Session 458 Prompt: Observe Frozen Distribution and Gate First Live Use

## Session 457 Summary

Session 457 promoted frozen Pre-Site distribution to Production after an
authenticated Preview rehearsal. The release is deployed and signed-in
surrounding lifecycle reads pass, but no Production distribution was prepared or
sent. Full prepare/history/send proof remains an explicit durable-write boundary.

### What Was Completed

1. **The Tier 2 release preflight passed.**
   - `[VERIFIED via command]` `codex/frozen-pdf-distribution` was clean,
     synchronized, and exactly seven commits ahead of `origin/main` with no
     `main` divergence.
   - Every repository `check:*` gate and required self-test passed sequentially;
     memory health reported only two existing advisory oversize-routed leaves.
   - Migration 034 remained live, exact, empty, and absent from the authoritative
     Postgres mismatch bucket.
   - Last-known-good rollback deployment was recorded as
     `dpl_9xBymSNtd5cVwvsNrtccMdLrF5Xx`.

2. **Authenticated Preview rehearsal passed without weakening controls.**
   - The Entra app already contained the stable callback
     `https://wmkfresearchapps-preview.vercel.app/api/auth/callback/azure-ad`;
     no Azure configuration was changed.
   - The stable Preview alias was temporarily moved from recorded target
     `dpl_A8JPHtBc8ApPtYJ3kzxDYLjsffE9` to candidate
     `dpl_4AKs6sf5UcRMUn9f6Vy2AKkmDjuZ`.
   - Microsoft sign-in succeeded and all 12 applications loaded. Workbench
     production reads failed closed because Preview omits
     `DATAVERSE_ALLOW_PROD_READS`, matching the target interlock contract.
   - The alias was restored and re-inspected at its exact prior target.

3. **The feature reached Production.**
   - Branch and merge trees were byte-identical. Merge `76a93a41`
     (`merge: frozen pre-site distribution`) was pushed to `main`.
   - Vercel Production deployment `dpl_A8naatyxM3vcXaG4vgt79GcL5TpR` reached
     Ready and all branded Production aliases resolved to it.
   - No manual `vercel --prod` duplicate deployment was created.

4. **Signed-in Production read verification passed.**
   - `applications.wmkeck.org` loaded an authenticated dashboard with all 12
     apps, the Workbench dashboard, Request `1002379`, its Pre-Site and Site
     Visit lifecycle state, and guarded-reopen history.
   - Request `1002379` is currently Draft after guarded reopen. That state
     correctly kept the distribution panel from mounting; the history route was
     therefore not exercised.
   - No button that creates, freezes, hands off, prepares, or sends was invoked.
     Post-deploy readback found `pre_site_distribution_attempts` still at zero
     rows. No Production snapshot, Request Document row, Dynamics activity, or
     email was created.
   - A one-hour error-level Vercel scan returned no entries for the new
     deployment.

5. **Durable release state was reconciled.**
   - Atlas, API matrix, lifecycle/file/schema plans, service catalog, near-term
     plan, agent wiki, Preview-auth memory, and milestone log now distinguish
     Production deployment from full distribution-path proof.
   - `DEVELOPMENT_LOG.md` contains the required Production milestone entry.

6. **Review remained bounded.**
   - The feature retains its completed Claude Opus plan review and one code-review
     correction pass from Sessions 454–455.
   - Two bounded Opus release-plan calls hit their fixed turn ceilings without a
     verdict; no additional review loop was started. Do not claim an Opus verdict
     on the release procedure itself.

### Commits

- `76a93a41` — merge: frozen pre-site distribution
- `a7e21e5f` — docs: document Session 456 and create Session 457 prompt
- `8cae7c53` — chore(pre-site): record release preflight evidence
- `acad76c4` — fix(pre-site): reconcile settled snapshot metadata
- `0167a8b3` — fix(pre-site): harden frozen distribution contracts
- `8a240e77` — feat(workbench): add frozen pre-site distribution

## Next Items

### Verified Open

1. **Observe the Production release organically.**
   Evidence: deployment `dpl_A8naatyxM3vcXaG4vgt79GcL5TpR` is Ready and the
   signed-in read path passed. Watch ordinary Workbench use and Production error/
   operational-event signals before expanding proof.

2. **Run the first full distribution proof only on a specifically approved
   Review-stage request.**
   Evidence: the only audited request inspected this session is Draft, and
   prepare is a durable Postgres/SharePoint/Request Document write. Before acting,
   name the request, expected snapshot representations, recipient, cleanup owner,
   and whether the test stops after prepare/history or includes a real send.

### Owner Decision Needed

1. **Authorize a specific Production prepare/history proof.**
   This creates retained Word/PDF snapshot state and one ledger row even if no
   email is sent. Exact request and cleanup ownership are required.

2. **Separately authorize any Production email.**
   Before send, verify the literal Production
   `DYNAMICS_IMPERSONATION_ENABLED=true` value through an approved non-secret
   configuration path and name the staff-controlled recipient. Dynamics
   transport acceptance still does not prove inbox delivery.

### Verify Before Acting

1. **Rollback only for a material regression.**
   Evidence: pre-release last-known-good deployment is
   `dpl_9xBymSNtd5cVwvsNrtccMdLrF5Xx`. Re-inspect the current aliases and error
   evidence before `vercel rollback`; code rollback does not undo durable data.

2. **Do not reuse Request `1002379` for distribution merely because it is the
   known smoke record.**
   Evidence: it is an audited guarded-reopen Draft. A new Site Visit handoff is a
   separate business mutation requiring exact authorization.

### Standing Organic Observation

1. Continue real Dynamics Explorer and Stage II observation under
   `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`,
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`, and
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.
2. After 2026-09-02, re-probe the live environment and replacement deployment
   before deciding whether to retain or remove the Stage II rollout flag.

### Parked

1. Site Visit logistics and governed supporting-file dossier, pending live
   Dataverse fact mapping.
2. AkoyaGo publication projection, pending signed-in discovery.
3. Final Writeup copy transaction, until the earlier lifecycle slices close.
4. `NEXTAUTH_SECRET` rotation, until a coordinated session-invalidation window.

### Do Not Reopen Without a New Decision

1. Automatic email on Site Visit promotion; distribution remains explicit.
2. Identity-confidence/directory gating for known staff/consultant recipients.
3. Editing a preserved Review row in place; correction uses an audited successor.
4. Sending a preview after its source pointer/version changes.
5. Broad review loops without a new material code or contract change.
6. Treating Dynamics Pending Send as proof of inbox delivery.

## Operational Gotchas

1. Migration 034 is already live and empty; never use `setup-database.js` on the
   populated database.
2. Production deployment is proved; full distribution behavior is still
   source/test/sandbox-proved, not Production mutation-proved.
3. The stable Preview alias has a registered Entra callback and was restored to
   `dpl_A8JPHtBc8ApPtYJ3kzxDYLjsffE9`.
4. Preview production reads correctly fail closed without
   `DATAVERSE_ALLOW_PROD_READS=yes`; do not add that flag casually.
5. Production environment values were not exported.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/pre-site-visit/distribution-service.js` | Frozen source/snapshot, preview, recovery, and send coordinator |
| `lib/services/pre-site-visit/distribution-store.js` | Attempt ledger, send lease, and fenced receipts |
| `pages/api/workbench/pre-site-visit/distribution/prepare.js` | Authenticated prepare route |
| `pages/api/workbench/pre-site-visit/distribution/send.js` | Authenticated exact-send route |
| `pages/api/workbench/pre-site-visit/distribution/history.js` | Read-only history route |
| `docs/atlas/postgres-infra-tables.md` | Live ledger and release-proof state |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Canonical lifecycle/release contract |

## Testing

```bash
rtk npm run check:migrations-manifest
rtk npm run check:api-routes && rtk npm run check:api-routes:self-test
rtk npm run check:atlas && rtk npm run check:atlas:self-test
rtk npm run check:agent-wiki && rtk npm run check:agent-wiki:self-test
rtk npm run check:memory-drift:no-write
rtk npm run check:agent-invariants
```
