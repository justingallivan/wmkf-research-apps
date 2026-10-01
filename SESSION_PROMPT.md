# Session 560 Prompt: office Mac sync first, then the first Part A/B reminder cycle

## Session 559 Summary — 2026-09-30 evening PT / 2026-10-01 UTC (Claude, home Mac)

Seven things shipped or closed. The scheduled-email Part B Liaison/posture re-check merged and is live (PR #384). Both Factory ledgers now live in the managed Neon ledger. Migration 058 was applied to the Production app DB, which cleared the drift alert. The app Postgres password was rotated. Integrity findings 6 and 9 merged (PRs #382, #383). The missing Vercel deployment was diagnosed. A Postgres rotation procedure now exists.

### What Was Completed

1. **Factory ledger → managed Neon.** Full `pg_dump -Fc` backups of the home-Mac `wmkf-ledger-pg/ledger_prod` and `/ledger` went to `~/Documents/Temp` (SHA-256 recorded). Both were then loaded data-only, single-transaction, into `managed-ledger/ledger_prod` and `managed-ledger/ledger`. Counts match; `check:factory-ledger` is green; `--target=production --run-inspect=e33fa857…` (Test Request 1003303, `ready`) read from `managed-ledger/ledger_prod`. Hazard found and cleared: pg_dump's empty `search_path` stuck on the pooled backend. The brief's `--clean` + hand-058 method was marked superseded. Evidence: `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md`.
2. **Migration 058 on the Production app DB** (owner chose option 1). Production's early-054 shape was read first (only `test_request_runs` + `test_request_run_resources`, empty). 058 was rehearsed on a scratch copy of that shape; then the owner ran `npm run apply:migrations` (1 applied, 57 skipped). Tracker is 58 = manifest. The active `migration_drift` alert (one ops email) auto-resolved at 01:58:54Z. `test_request_run_reviewer_assignments` / `test_request_status_changes` are still absent there (harmless; CLI never uses the app DB).
3. **Scheduled-email Part A pre-cycle watch:** `scheduled_email_messages` held 0 rows, so the 10/01 08:00 UTC cycle had nothing queued except whatever the cron creates (see Verified Open 2). The 055 "ahead" check is clean.
4. **App Postgres rotated** (`neondb_owner`, project `expert-reviewers-neon-db` / `falling-surf-05640504`), triggered by Vercel "Needs Attention" badges plus an accidental full-URL print by Claude. The Neon integration re-synced all 16 Vercel variables; the owner redeployed. The home `.env.local` and the feature-request `.env.presentation-proof.local` were synced via `vercel env pull`. Sensitive conversion: **owner chose A (leave readable)** because Preview acceptance uses the shared DB. Runbook: `docs/CREDENTIALS_RUNBOOK.md` → "Rotating the app Postgres password". Memory: `feedback-postgres-url-handling-hazards`.
5. **Integrity:** PR #382 (`186052034`, finding 6) accepts either SerpApi empty signal, tested against two owner-authorized live zero-result responses. PR #383 (`f00e2259c`, finding 9) drops repeated Dataverse/SQL reads. Owner decision: re-screening an approved request is allowed. Both are deployed.
6. **Scheduled-email Part B: PR #384 (`3b5002d95`, Production Ready).** Codex adversarial round 1 found one medium (the send-now warning cleared on a version change), fixed in `655dbc701`; round 2 approved. Browser rehearsal (Claude in Chrome): local dev against a Neon branch, request 1003220, a seeded stale Cc. It showed the 409 "Recipients changed…", the real Liaison Cc, "Waiting for your approval", and the row held with no activity or send intent. The Neon test branch auto-expires about 2026-10-08; `.env.partb-test.local` was deleted by the owner.
7. **Vercel `61dafcb81`:** GitHub logged the push, but Vercel created no deployment record. It was the only one of 66 `main` push heads in the window; the code went live via `9f408590e`. Nothing to fix.

### Commits (all on `main`)
- `6f5028dff` ledger snapshot evidence · `d0ffc601c` office run-inspect note · `2c59a0c31` 058 + Part A watch docs · `2784331df` Vercel diagnosis
- `3d5523ec9`, `9d1020190` Postgres rotation procedure + decision · `5bde11910` office sync brief
- `186052034` (PR #382), `f00e2259c` (PR #383), `3b5002d95` (PR #384; fix `655dbc701`), with handoff updates `7b7a001c5`, `577d6d130`, `02a25dc2b`, `03d4a3136`, `becda2071`, `3cee03ae5`
- Parallel Codex merges seen on `main`: `a07c3ddf3` (PR #385, Explorer call-config tests), `d1800e404` (refactor survey doc)

## Next Items

### Verified Open

1. **Office Mac: run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` before anything else.** Evidence: that Mac's `.env.local` still holds the dead `neondb_owner` password. The brief syncs it via `vercel env pull`, verifies the 4 URL variables, then runs `check:factory-ledger` and `--run-inspect=e33fa857-4b00-4c60-94da-77d4406d4027` against `managed-ledger/ledger_prod`. Record the inspect result in the ledger evidence file.
2. **Check the first Part A + Part B cron cycle (10/01 08:00 UTC, `grantee-deliverable-reminders`).** Evidence: Part A and B are both live; the owner's new Invited deliverable `2316e650…` on request 1003220 should produce one Production `scheduled_email_messages` row. Read the cron summary (look for `readdressed`/`readdressHeld`/`postureTightened`/`savedActivityNotReaddressed` and `sendFailed`) and that row, read-only.

### Owner Decision Needed

1. **The 1003220 reminder** (due about 2026-10-13, to owner-controlled addresses): let it send as a real Part B exercise, or Stop it at `/scheduled-emails`.
2. **D2: retire the local ledger copies** (`wmkf-ledger-pg/ledger_prod`, `/ledger` on the home Mac). Only after Verified Open 1 passes. Destructive: list the DBs and confirm first.
3. **Local scratch DBs** `ledger_ci_s547`, `ledger_ci_s548`, `ledger_test` in the home-Mac container (verified present 10/01). List and confirm before dropping.
4. **Optional:** protect both Neon `main` branches (Launch plan allows 2; prevents delete/reset; reset the password before protecting).

### Parked

1. Deeper recipes, admin form, slice 5a, late-2026 `expiresAt` fixtures, cast ledger reset path, AkoyaGO TEST Factory Reviewer search, Liaison follow-ups, the Dataverse "Integrity review complete" flag. Unchanged since S553.
2. Postgres in `lib/utils/tracked-secrets.js`: not tracked today (runbook step 6 says so). Re-open if the owner wants rotation-age alerts.

### Verify Before Acting

1. **Codex refactor survey** `docs/plans/REFACTOR_CANDIDATES_SURVEY_2026-09-30.md` (merged `d1800e404`). It is a set of proposals, not a worklist; review it with the owner.
2. **Stale Atlas lines** (pre-existing): `docs/APPLICATION_STATE_ATLAS.md:215` and the `scheduled_email_messages` heading in `docs/atlas/postgres-infra-tables.md` still say "migration 036 … not applied / code not deployed". This is a doc fix; confirm the deploy history first.
3. **Factory test Requests 1003301–1003303 are NOT residue:** all three are tracked runs in `managed-ledger/ledger_prod` (1003301 `needs_attention`, 1003302/1003303 `ready`; verified 10/01). Do not delete them as cleanup.

### Do Not Reopen Without New Decision

1. 058 on the app DB (option 1, applied); Sensitive option A (Preview acceptance); re-screening approved integrity requests is allowed; Part B design decisions B-1/B-2/B-3 as built in #384.
2. The DOCX/VTT transcript incident (closed S558). S553 decisions (D1 Neon, D3 shared folder, Part A merged, 059 applied alone).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/scheduled-email-service.js` | `readCurrentRecipients`, `reconcileRecipientsBeforeSend`, the Part B hook in `deliverScheduledEmail` |
| `lib/services/scheduled-email-store.js` | `reconcileScheduledEmailRecipients` (the lease/version-fenced transition) |
| `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` | Office Mac env sync + ledger check |
| `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md` | Ledger dump digests, Neon load, pooler hazard |
| `docs/CREDENTIALS_RUNBOOK.md` | App Postgres rotation procedure and the Sensitive decision |
| `lib/services/integrity-service.js` / `lib/services/workbench/integrity-service.js` | Findings 6 and 9 |

## Testing

```bash
npx jest --testPathPatterns "scheduled-email|scheduled-emails|grantee-deliverable-reminders|integrity"
# live Postgres (scratch DB on the local container, never a shared URL):
docker exec wmkf-ledger-pg createdb -U postgres scratch_x && \
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/scratch_x TEST_REQUEST_LEDGER_REQUIRE=1 \
  npx jest tests/integration/scheduled-email-engine.pg.test.js tests/integration/integrity-screening-reviews.pg.test.js; \
docker exec wmkf-ledger-pg dropdb -U postgres scratch_x
npm run check:factory-ledger -- --allow-unreachable
```

Prior accumulated handoffs (including the S553 Fable snapshot) are in Git history at `3cee03ae5:SESSION_PROMPT.md`.
