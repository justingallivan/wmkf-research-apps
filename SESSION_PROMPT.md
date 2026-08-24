# Session 457 Prompt: Choose the Frozen Distribution Release Path

## Session 456 Summary

Session 456 completed every safe primary release step for frozen Pre-Site
distribution on `codex/frozen-pdf-distribution`. Migration 034 is live and
schema-read-back, the exact feature commit is Ready on a Vercel branch Preview,
and Dynamics metadata plus controlled sandbox transport proofs passed. The
remaining full-feature verification is blocked by an Azure redirect URI decision;
the feature is not deployed to Production and no Production distribution write
or email occurred.

### What Was Completed

1. **Migration 034 is live and exact.**
   - `[VERIFIED via canonical apply + live readback]` Migration
     `034_pre_site_distribution_attempts.sql` was applied at
     `2026-08-23T23:39:34.686Z` with `scripts/apply-migrations.js`.
   - `schema_migrations` contains 034; the table has 55 columns, eight named
     CHECK constraints plus its primary key, four indexes including the PK
     index, zero rows, and no pending manifest migration.
   - The canonical reconciliation probe now reports zero Postgres table
     mismatches and zero probe errors.

2. **The exact feature branch is deployed to Preview.**
   - Vercel Preview `dpl_Gbt5Dacch3GgDKDTSCpHAZKZACSJ` is Ready at commit
     `68eeec11774bd44762b654695759f58a10434b35` on
     `codex/frozen-pdf-distribution`.
   - The Preview environment has `DATAVERSE_TARGET_INTERLOCK=on`, targets the
     registered Production Dynamics hostname, and omits the impersonation and
     Production-read enablement flags. No environment value was changed.
   - Authenticated Preview testing is blocked by Azure `AADSTS50011`: the
     deployment callback URI is not registered for the Entra app. Production
     sign-in was independently confirmed with the existing browser session; the
     new feature is not on Production.

3. **Dynamics release contracts are live-probed.**
   - A new read-only probe,
     `scripts/probe-dynamics-email-distribution-contract.mjs`, fail-closes on
     target hostname and requires explicit Production-read confirmation.
   - Production and sandbox metadata agree: email subject max length 800,
     description max length 1,073,741,823, states Open/Completed/Canceled, and
     statuses Draft/Completed/Sent/Received/Canceled/Pending Send/Sending/Failed.
   - Both organizations report unresolved email recipients allowed.

4. **A controlled sandbox transport/readback passed.**
   - A raw `addressused` recipient was accepted; exact body and From/To data
     round-tripped; Dynamics accepted `SendEmail` and reported `Pending Send`.
   - Repeating `SendEmail` on the same activity returned another accepted 2xx
     without creating a replacement activity. This supports the runtime guard
     that treats Pending Send as transport-accepted; it does not prove inbox
     delivery.
   - A separate adapter-created draft proved exact subject/body/correlation/
     From/To round-trip and was deleted after readback. No Production Dynamics
     write was made.

5. **Durable state is reconciled.**
   - The API matrix, Atlas, Request Document model, lifecycle plan, service
     catalog, agent wiki, and near-term plan now distinguish: migration live and
     empty; branch Preview Ready; authenticated Preview callback-blocked; not
     Production-deployed.
   - Historical Session 455 text in `DEVELOPMENT_LOG.md` remains historical.
     No new milestone entry was required because no Production capability or
     cutover shipped.

6. **Review and verification remained bounded.**
   - The primary plan and implementation retain the completed Claude Opus plan
     review and one code-review correction pass from Session 455.
   - One bounded Opus review attempt for the new read-only probe completed but
     the host CLI returned no review text; output recovery was stopped rather
     than tail-chased. Do not claim that probe received Opus review.
   - Migration, API matrix, Atlas, wiki, fact, canonical-pointer, symbol,
     build-claim, docs-catalog, memory-drift, and script syntax checks passed,
     including required self-tests.

### Commits

- `8cae7c5` — chore(pre-site): record release preflight evidence
- `68eeec11` — docs: document Session 455 and create Session 456 prompt
- `acad76c4` — fix(pre-site): reconcile settled snapshot metadata
- `0167a8b3` — fix(pre-site): harden frozen distribution contracts
- `8a240e77` — feat(workbench): add frozen pre-site distribution

## Next Items

### Owner Decision Needed

1. **Choose the authenticated release-test path.**
   Evidence: the exact branch Preview is Ready, but Microsoft returns
   `AADSTS50011` for its deployment-specific callback.
   - Register an approved stable Preview callback/alias in the Entra app, or
   - explicitly authorize governed promotion through `main`/Production under
     `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.
   Do not silently change Azure registration or promote this Tier 2 runtime work.

2. **Separately authorize any Production distribution send.**
   Evidence: only metadata was read from Production; the only transport exercise
   was in sandbox. A Production prepare creates Postgres/SharePoint/Request
   Document state, and send additionally creates a Dynamics activity and email.

### Verified Open

1. **Run authenticated full-feature verification after the callback/release
   decision.**
   Evidence: source/tests pass, migration is live, and branch Preview is Ready;
   only authentication blocks the UI path. Verify compose, DOCX/PDF/both frozen
   preview, history, source-drift/reopen behavior, and exact receipt semantics.
   Treat prepare as a durable write, not a read-only smoke.

2. **Confirm the intended runtime flags before a non-sent feature exercise.**
   Evidence: `distribution-service.js` requires literal
   `DYNAMICS_IMPERSONATION_ENABLED=true` for every non-sent attempt, while the
   target interlock and DAL enforcement must remain on. Never add
   `DATAVERSE_ALLOW_PROD_READS` to an agent environment.

### Standing Organic Observation

1. Continue real Dynamics Explorer and Stage II observation under
   `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`,
   `docs/DYNAMICS_EXPLORER_PHASE_B_TELEMETRY_PLAN.md`, and
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Do not manufacture
   staff traffic or shared-roster evidence.
2. After 2026-09-02, re-probe the live environment and replacement deployment
   before deciding whether to retain or remove the Stage II rollout flag.

### Parked

1. Site Visit logistics and governed supporting-file dossier, pending live
   Dataverse fact mapping.
2. AkoyaGo publication projection, pending signed-in AkoyaGo, historical
   path/filename, Power Automate, and non-governed SharePoint discovery.
3. Final Writeup copy transaction, until the earlier lifecycle slices close.
4. `NEXTAUTH_SECRET` rotation and Sensitive conversion, until a coordinated
   session-invalidation window exists.

### Do Not Reopen Without a New Decision

1. Automatic email on Site Visit promotion; distribution remains explicit.
2. Identity-confidence/directory gating for known staff/consultant recipients.
3. Editing a preserved Review row in place; correction uses an audited successor.
4. Sending a preview after its source pointer/version changes.
5. Repeating broad plan/code review without a new material change or finding.
6. Treating Dynamics Pending Send as proof of inbox delivery.

## Operational Gotchas

1. Existing databases use `scripts/apply-migrations.js`; never run
   `scripts/setup-database.js` against this populated database.
2. Migration 034 is already live and empty. Do not carry forward “apply 034.”
3. Preview authentication—not build readiness—is the current blocker.
4. The sandbox test activity may remain Pending Send because sandbox outbound
   delivery is not guaranteed; its evidence is transport acceptance/readback.
5. Production environment values were not exported. Verify exact non-sensitive
   flags through the approved Vercel path before promotion.
6. Request `1002379` remains an audited guarded-reopen successor. Do not
   regenerate, distribute, or hand it off without exact durable-write approval.

## Key Files Reference

| File | Purpose |
|---|---|
| `scripts/probe-dynamics-email-distribution-contract.mjs` | Read-only email metadata/status/tenant-setting release probe |
| `lib/db/migrations/034_pre_site_distribution_attempts.sql` | Live existing-database distribution ledger migration |
| `lib/services/pre-site-visit/distribution-service.js` | Frozen source/snapshot, preview, Dynamics recovery, and send coordinator |
| `lib/services/pre-site-visit/distribution-store.js` | Attempt ledger, send lease, and fenced receipts |
| `lib/dataverse/adapters/email-activity.js` | Granular Dynamics email activity/attachment/status transport |
| `docs/atlas/postgres-infra-tables.md` | Live ledger ownership and readback state |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Canonical lifecycle/release contract |

## Testing

```bash
rtk node --check scripts/probe-dynamics-email-distribution-contract.mjs
rtk npm run check:migrations-manifest
rtk npm run check:api-routes && rtk npm run check:api-routes:self-test
rtk npm run check:atlas && rtk npm run check:atlas:self-test
rtk npm run check:agent-wiki && rtk npm run check:agent-wiki:self-test
rtk npm run check:memory-drift:no-write
rtk npm run check:agent-invariants
```
