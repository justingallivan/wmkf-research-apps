# Session 561 Prompt: office Mac sync when back at work; ledger cleanup after that

## Session 560 Summary — 2026-10-01 (Claude, home Mac)

A short housekeeping session. The overnight email the owner received was the PD daily digest's "Sending soon unless you act" section listing the 1003220 reminder; that section is intentionally not receipted in `digest_fyi_at` (only sent-FYI is), so the empty field was expected. The first scheduled-email Part A/B reminder cycle was checked, the stale "migration 036 not applied / not deployed" claims across the docs were reconciled, and the app Neon `main` branch was protected. All 68 start-of-session gate runs (39 gates + self-tests) were green. The owner is on the home Mac until next week, so the office Mac sync and all local ledger cleanup are deferred.

### What Was Completed

1. **First Part A + Part B reminder cycle checked (10/01 08:00 UTC).** Vercel: the `/api/cron/grantee-deliverable-reminders` run returned 200 with no warn/error lines. The cron's summary counts live only in its HTTP response, not in logs. Production `scheduled_email_messages` (owner-run read-only script; the auto-mode classifier blocks agent Production reads): exactly one row, for the owner's 1003220 test deliverable, `scheduled`, send due 10/13, 1 To + 1 Cc. The **owner then stopped it** at `/scheduled-emails`; a re-read confirmed `stopped`, version 2. So Part B's send-time re-check has not yet run on a real send.
2. **Docs reconciled to the deployed scheduled-email state** (`59ab69817`, `1494a3ae7`). The code merged to `main` 2026-08-26 (`4a743d63a`). Fixed: the Atlas row and the `scheduled_email_messages` / `_vip_flags` / `_digest_runs` headings, `docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/SERVICE_AND_UTILITY_CATALOG.md`, and `docs/GRANTEE_PORTAL_SPEC.md`. Spec item 8 was rewritten from the retired per-PD 1–14 day review window to the VIP/digest model plus the Part B re-check.
3. **Two more stale spots** (`66fd4c51a`): the `EMAIL_AUTOMATION` comment in `shared/config/reviewerFinderPreferences.js` now describes `{ reviewAll }` (the contract in `shared/config/emailAutomation.js`), and the `scheduled_email_reviewer_vip_flags` heading now says deployed (merged `dc46fa183`, 2026-08-27).
4. **App Neon `main` protected** (owner, in the console; project `expert-reviewers-neon-db`). Neon docs checked: the Launch plan allows 2 protected branches *per project*; protection blocks branch delete/reset and project delete; it changes no passwords; child branches of a protected branch get fresh role passwords. The ledger project stays unprotected (the 09-30 dumps back it up). Recorded in `docs/CREDENTIALS_RUNBOOK.md` → "Protected `main` branch" (`e76fc60c4`).

### Commits
- `59ab69817` docs(atlas): scheduled_email_messages is deployed and live
- `1494a3ae7` docs: rewrite grantee reminder cadence to the shipped VIP/digest model
- `66fd4c51a` docs: correct stale email-automation comment and reviewer VIP flag status
- `e76fc60c4` docs(credentials): record protected app Neon main branch; merge `0f86cc214`
- Parallel Codex merges on `main`: PR #386 (roster projection), #387 (roster orchestration service), #388 (`a1b3daa4f`, shared review-document canonicalization). Codex owns the refactor-survey work on its own branches.

## Next Items

### Verified Open

1. **Office Mac: run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` first thing at the office** (owner there next week). Evidence: that Mac's `.env.local` still holds the dead `neondb_owner` password. Protecting Neon `main` changed no connection strings, so the brief is unchanged. Record the `--run-inspect` result (`managed-ledger/ledger_prod`) in the ledger evidence file.

### Owner Decision Needed

1. **D2: retire the home Mac's local ledger copies** (`wmkf-ledger-pg/ledger_prod`, `/ledger`). Owner deferred (S560) until the office Mac is set up. Destructive: list the DBs and confirm first.
2. **Home-Mac scratch DBs** `ledger_ci_s547`, `ledger_ci_s548`, `ledger_test`. Deferred with D2. List and confirm before dropping.

### Parked

1. Deeper recipes, admin form, slice 5a, late-2026 `expiresAt` fixtures, cast ledger reset path, AkoyaGO TEST Factory Reviewer search, Liaison follow-ups, the Dataverse "Integrity review complete" flag. Unchanged since S553.
2. Postgres in `lib/utils/tracked-secrets.js`: not tracked (runbook step 6). Re-open if the owner wants rotation-age alerts.
3. **First live Part B send:** the 1003220 test reminder was stopped, so the re-check will first run on whichever real reminder sends next. No action unless the owner wants another deliberate exercise.

### Verify Before Acting

1. **Factory test Requests 1003301–1003303 are NOT residue:** tracked runs in `managed-ledger/ledger_prod` (verified S559). Do not delete as cleanup.

### Do Not Reopen Without New Decision

1. 058 on the app DB (applied); Sensitive option A; re-screening approved integrity requests allowed; Part B decisions B-1/B-2/B-3 as built in #384; the 1003220 reminder stopped (owner, S560).
2. Neon protection: app `main` only; ledger unprotected (owner, S560).
3. Refactor survey items: Codex is executing them on its own branches; do not start them here.
4. The DOCX/VTT transcript incident (closed S558). S553 decisions (D1 Neon, D3 shared folder, Part A merged, 059 applied alone).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md` | Office Mac env sync + ledger check |
| `docs/CREDENTIALS_RUNBOOK.md` | App Postgres rotation, Sensitive decision, protected `main` |
| `docs/GRANTEE_PORTAL_SPEC.md` (item 8) | Reminder cadence as deployed (VIP/digest + Part B) |
| `docs/atlas/postgres-infra-tables.md` | `scheduled_email_*` tables state and contracts |
| `lib/services/cron/grantee-deliverable-reminders-service.js` | Row creation and approval posture |
| `lib/services/scheduled-email-service.js` | Send path, Part B re-check, digest |

## Testing

```bash
npx jest --testPathPatterns "scheduled-email|scheduled-emails|grantee-deliverable-reminders|integrity"
npm run check:factory-ledger -- --allow-unreachable
```

Production reads: the auto-mode classifier blocks agent reads of the Production app DB. Write a read-only script to the scratchpad that prints no addresses, bodies or URLs, and have the owner run it with `!`. Load packages via `createRequire('<repo>/package.json')` and env via `process.loadEnvFile` (`dotenv` is not installed).

Prior handoff (S559 detail): `0f86cc214:SESSION_PROMPT.md` and earlier in Git history.
