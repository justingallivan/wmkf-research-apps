# Session 559 Prompt: transcript upload incident closed

## Session 558 Summary — 2026-09-30 PT (Codex; DOCX/VTT Production acceptance)

**DONE:** the Site Visit transcript uploader fix is merged, deployed and accepted.
[VERIFIED via GitHub/Vercel release checks and owner report] The owner confirmed
both original DOCX and VTT uploads worked on request 1002903 after PR #379.
PDF was also confirmed working. No remaining implementation or acceptance item
is open for this incident.

### What Was Completed

1. **Diagnosed the transcript failures.** Initial screenshot/filename evidence
   resolved to request 1002860; the owner's later explicit probe target was
   1002903. Read-only probes established DOCX package mismatch and VTT empty-file
   failures. Deleted sources limit forensic attribution; that uncertainty is
   historical and does not reopen the successful acceptance test.
2. **Released two fixes.** PR #375 added strict source/stored DOCX attestation,
   stable candidate receipts and retry handling. PR #379 added the exact newly
   promoted custom-properties OPC links and bounded decoded Blob stream sizing.
   Actor/path/privacy, lease fences and exact cleanup receipts remain enforced.
3. **Reviewed and validated.** Claude Opus reviewed through verified Max OAuth
   outside the sandbox, with API-key source none. Its compressed-length blocker
   and small safeguards were fixed; closure approved. Follow-up validation:
   589 tests / 19 suites, canonical build and scoped gate/self-test checks passed.
4. **Production release and acceptance.** PR #379 merged at 23:17:05 UTC;
   deployment `dpl_D9bz5jCdvAYuf2iPqmUxseT3mcTC` reached Ready on branded domains.
   GitHub deployment `6772260367` confirms the exact merge SHA and success at
   23:17:46 UTC (4:17 PM Pacific). Basic read-only app smoke passed. The owner's
   “They both worked” confirms DOCX/VTT acceptance; no additional agent upload
   or registry probe was performed. No migration or flag change was needed.
5. **Saved the closeout on main.** Owner explicitly selected `main` for session
   docs. An isolated documentation branch preserves concurrent Factory and
   Claude checkouts; its PR lands this handoff on main. The milestone entry is
   “DOCX and VTT transcript upload incident resolved.” CLAUDE.md needs no change.

### Commits

- `d4a83fee1` — Fix DOCX transcript uploads after SharePoint property promotion.
- `5c41f26e8` — Address Opus review of DOCX transcript recovery.
- `2eaa07670` — PR #375 merge.
- `90ea3f0a5` — Fix transcript metadata promotion and private Blob stream sizing.
- `ebbbc1307` — PR #379 merge and owner-authorized Production release.
- Session closeout documentation commit: see the latest documentation PR/history.

## Next Items

### Verified Open

None for this transcript incident. The owner accepted both formats in Production.

**App Postgres password rotated (2026-10-01 ~02:25Z, owner + Claude, home Mac).** Trigger: Vercel "Needs Attention" badges on the readable `POSTGRES_URL` family, plus Claude accidentally printed the full `POSTGRES_URL` into the session transcript. The owner reset `neondb_owner` in Neon project `expert-reviewers-neon-db` (`falling-surf-05640504`). The integration re-synced all 16 Vercel variables itself, and the owner redeployed Production (Ready 02:28:57Z; `health_check_history` `healthy` at 02:30:51Z). The home Mac `.env.local` and the feature-request `.env.presentation-proof.local` were updated via `vercel env pull`, and all four URL variables connect. **Office Mac `.env.local` still holds the dead password; update it first thing next session.** Run `docs/plans/briefs/OFFICE_MAC_SYNC_BRIEF_2026-10-01.md`, which also runs the ledger `--run-inspect` below. Sensitive conversion: owner chose option A (leave readable) because of Preview acceptance; see `docs/CREDENTIALS_RUNBOOK.md` → "Rotating the app Postgres password". The `migration_drift` alert auto-resolved at 01:58:54Z.

**Factory ledger (added 2026-09-30 evening, Claude, home Mac):** the managed-ledger
load is done and is now the current copy. Evidence:
`docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md`.
Next session, from the **office Mac** (both Neon URLs are already in its
`.env.local` per the owner), run one read-only check:
```bash
npm run check:factory-ledger
node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=e33fa857-4b00-4c60-94da-77d4406d4027
```
Expect `managed-ledger/ledger_prod` with a matching schema check and Test Request 1003303 `ready`.
Record the result in the evidence file. Do not restore anything into the office
container; the brief's office step is superseded. D2 (retire local copies) stays
an owner decision.

### Verify Before Acting

Other workstreams are not this session's worklist. The prior accumulated mainline prompt
is retained in Git history at `9d0119d4d:SESSION_PROMPT.md`; the new concurrent
Fable handoff at `22e507cc9` is preserved below as a separate dated snapshot.
Those other workstream snapshots contain dated
Factory/scheduled-email and older carryovers, including superseded release
claims. Read the current owning branch, source/Atlas and owner decisions before
acting on any of them. The Factory checkout was clean at `b7abdac6a` when this
handoff began and was left untouched.

### Do Not Reopen Without New Evidence

1. DOCX/VTT upload acceptance on request 1002903 is complete. Evidence: owner
   report and PR #379. Do not ask for the deleted originals as unfinished work.
2. Rejected old staging rows cannot be reused. Future uploads select the source
   anew; no cleanup/deletion or repair is queued. Recheck current Production
   state before a future rollback; its release baseline is in the incident receipt.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/post-presentation-materials/material-service.js` | Finalize, source/stored attestation and candidate receipt behavior |
| `lib/services/test-requests/docx-package-attestation.js` | Strict DOCX source and render package comparison |
| `lib/services/portal-upload-staging.js` | Private stream read, cap, actual size/hash and lease fence |
| `docs/plans/evidence/post-presentation/transcript-package-and-blob-read-2026-09-30.md` | Current incident release/acceptance and bounded reconciliation |
| `docs/plans/evidence/post-presentation/docx-transcript-fix-2026-09-30.md` | Initial incident and PR #375 history |
| `DEVELOPMENT_LOG.md` | Production incident milestone |

## Testing and handoff limits

Runtime validation is recorded in the incident receipts; this closeout changes
only documentation and runs relevant documentation/invariant gates. The optional
claim-evidence pilot report returned unavailable local state; no advisory row
was fabricated. No memory-router changes or growth advisory occurred. Owner
acceptance is separate from the implementer's automated tests and the reviewer's
read-only source inspection. No agent-created Production upload or repair ran.

---

## Separate contemporaneous Fable handoff — dated snapshot, 2026-09-30

Preserved from `22e507cc9` to retain its owner decisions and next-session context.
Its unrelated carryovers were not revalidated by the transcript session and
are not this incident’s automatic worklist. Verify them against the current
owning source/Atlas and owner decisions before acting. The earlier accumulated
prompts remain available in Git history; only this new handoff is retained here.

# Session 554 Prompt: post-merge watch for the ledger registry and scheduled-email Part A

## Session 553 Summary — 2026-09-30 PT (Fable; office Postgres sync, managed Factory ledger, Part A shipped, Dependabot)

**Three things reached `main` and Production: the Test Request Factory ledger registry/guard/runner with the managed Neon ledger (PR #374), scheduled-email Part A engine hardening with migration 059 (PR #373), and five Dependabot fixes (PR #378).** Codex's B4 (#369) and DOCX transcript (#375) merged in parallel; Codex's own handoff for B4 is the section below this one.

### What Was Completed

1. **Office Mac Postgres sync (closed).** The rotated Neon app-database secrets were synced into this Mac's env files from the brief, verified `connected`, backups deleted. Trap recorded: Claude Code's Bash `grep` is embedded ugrep with `--ignore-files`, so recursive greps silently skip `.env*`; use `find` or `command grep`.
2. **Managed Factory ledger (owner decisions D1, D3).** Neon project `wmkf-factory-ledger` (Vercel Marketplace, us-east-1, pooled host) holds `ledger_prod` and `ledger`; `TEST_REQUEST_LEDGER_URL` / `TEST_REQUEST_SANDBOX_LEDGER_URL` live only in each Mac's `.env.local`. Snapshot brief: `docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md`. Plan: `docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md` (revision 7, MERGED).
3. **Ledger registry / guard / runner / fingerprint / gate — merged as PR #374 (`66dd0974b`).** `lib/db/ledger-registry.js`, `ledger-guard.js`, `ledger-schema.js`, `ledger-migrations.js`, `scripts/apply-ledger-migrations.js` (`npm run ledger:apply -- --url-env=NAME`), `scripts/check-factory-ledger.js` (`check:factory-ledger`, in `/start`). Review cycle: Codex adversarial rounds 1–4 (all NO-SHIP on new surfaces each time, all findings fixed), Opus rounds 1–3, Sonnet builder for rounds 1–3, Codex rescue for the round-4 fixes (`54b847e31`), Claude review. Owner stopped review after round 4. The merge commit `3956d8ad7` applied the rehearsed B4 resolution (slot-binding cast mode guards + schema-checks before the Dataverse client; fingerprint regenerated from 054+058 with `relpersistence`; `approvedAhead` emptied).
4. **058 adopted on both managed ledgers** by `npm run ledger:apply` from merged `main` (`managed-ledger/ledger_prod` and `managed-ledger/ledger`): 054 skipped, 058 adopted (shape already live from the B4 session's hand apply); rerun skips both; `check:factory-ledger` reports 2 inspected, 0 refused.
5. **Scheduled-email Part A — merged as PR #373 (`9d0119d4d`).** Migration 059 / block V58 (`recipient_generation`), send intent as no-resend predicate, unconfirmed marker with 202 `uncertain`, classified activity reads (404 vs 403), no edits after activity, lease-fenced cancel, reconciliation fairness, `shared/utils/scheduled-email-attention.js`, `scripts/probe-scheduled-email-orphan-drafts.js`, `tests/integration/scheduled-email-engine.pg.test.js` (21 tests, CI ledger job). **059 applied to shared Production before the merge by an owner-run one-off script** (tracker `applied_by` `claude-part-a-2026-09-30`); `apply-migrations.js` has no per-file filter and would also have applied 058. Production tracker: 054, 055, 056, 057, 059. **Merged on the owner's call without a dedicated implementation review** (CI green, live-Postgres suites green).
6. **Dependabot — PR #378 (`361fbcdfd`)**: next 16.3.5→16.3.8 (critical `next/og` RCE; not imported here), dompurify 3.4.13→3.4.16, brace-expansion shim upstream 5.0.9→5.0.12 (root AND `vendor/brace-expansion-compat` pins). `npm audit` 0; GitHub open alerts 0.
7. **Codex refactor survey** worktree `~/Code/WMKF_Apps-refactor` on `codex/refactor-survey` (CodeGraph indexed; prompt given). Preview worktree/branch `claude/factory-ledger-b4-preview` removed after merge.

### Commits (all on `main`)
- `66dd0974b` Merge PR #374 (ledger registry; ~40 branch commits) · `54b847e31` Codex round-4 fixes · `3956d8ad7` merge of main/B4 into the ledger branch
- `8324eefa8`, `a641fd3e6` ledger plan: merged; 058 adopted
- `361fbcdfd` Merge PR #378 (Dependabot) · `883aec528` work-queue triage line
- `9d0119d4d` Merge PR #373 (Part A) · `de9829225` merge of main into Part A · `83c4c6ec6` Part A plan + migration memory
- Memory: `.claude-memory/feedback-operational-state-must-be-reachable-from-every-workstation.md` (new); `project-migration-numbers-claimed-off-main.md` (Production tracker state)

## Next Items

### Verified Open

1. **Watch Part A in Production for one cron cycle.** PARTLY DONE 2026-09-30 evening: `scheduled_email_messages` holds 0 rows, so the first Part A cycle (grantee-deliverable-reminders cron, 08:00 UTC 10/01) has nothing to send; orphan-draft probe moot (no generation>0 rows). Remaining: glance at that cron's 10/01 run log for errors. Evidence: merged without an implementation review (S553 owner call); `lib/utils/migration-drift.js` will now see 058 in the manifest but not in Production's tracker (`migration_drift_behind`-style logging — check what it actually raises). Read the scheduled-email cron logs and the DB alert rows once; run `node scripts/probe-scheduled-email-orphan-drafts.js` read-only.
2. **Part B (Liaison re-addressing)** of `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`: **MERGED 2026-10-01 as PR #384** (`3b5002d95`, Production Ready). Codex adversarial review: round 1 found one medium (send-now warning cleared on version change), fixed in `655dbc701`; round 2 approved. A browser rehearsal (Claude in Chrome, local dev against a Neon branch, request 1003220) showed the 409 warning, the real Liaison Cc and the hold. **Owner cleanup:** delete Neon branch `partb-ui-test` and `.env.partb-test.local`. The Invited deliverable on 1003220 stays by owner choice: Production's 08:00 UTC cron will create a real reminder for it (due about 2026-10-13); stop it from `/scheduled-emails` if unwanted.
3. **Integrity findings 6 and 9** (PR #366 description). 6: **MERGED** as PR #382 (`186052034`). Either SerpApi empty signal confirms an empty strict search, tested against two live zero-result responses recorded 2026-10-01 with owner authorization. 9: **MERGED** as PR #383 (`f00e2259c`; Production deployment Ready, 03:01Z 2026-10-01): 2 fewer SQL reads per tab load; a disposition no longer re-reads Dataverse. Owner decision 2026-10-01: re-screening an approved request (it returns to needs-review) is **allowed**.
4. ~~**Ledger Phase 1 operational-data restore into Neon**~~ **DONE 2026-09-30 evening** (data-only load; see the Factory ledger note at the top). Only the office-Mac `--run-inspect` remains.

### Owner Decision Needed

1. **D2: retire the local `ledger_prod`** once the Neon restore is confirmed (`docs/plans/TEST_REQUEST_LEDGER_PORTABILITY_PLAN_2026-09-30.md`).
2. ~~**Does 058 also run against the shared app database?**~~ **DECIDED and DONE 2026-10-01 (owner: option 1).** 058 applied to Production by the owner's `npm run apply:migrations` (1 applied, 57 skipped) after a scratch rehearsal on the early-054 shape; tracker 58 = manifest. The active `migration_drift` alert (23:03Z 9/30; one ops email) auto-resolved at 01:58:54Z on 10/01. Original question: Production's app DB holds an early-applied 054 copy; `project-migration-numbers-claimed-off-main.md` says B4's 058 was written to repair it, while the ledger rule P6 says the app DB is never the ledger. Not applied in S553. B4/Codex decision.

### Parked

1. Deeper recipes, admin form, slice 5a, late-2026 `expiresAt` fixtures, cast ledger reset path, AkoyaGO TEST Factory Reviewer search, Liaison follow-ups, the Dataverse "Integrity review complete" flag. Unchanged.

### Verify Before Acting

1. ~~**Production 054 shape**~~ READ 2026-09-30: early shape, `test_request_runs` + `test_request_run_resources` + the receipt function only (all empty). (Original: read-only query of `test_request_*` tables and `pg_get_functiondef('test_request_receipt_ok')`) — still unread; prerequisite for decision 2 above.
2. ~~**`migration_drift_ahead` for 055**~~ CHECKED 2026-09-30: 055 tracked and in the manifest; the two 9/30 `migration_drift_ahead` warnings auto-resolved.
3. **Residue**: Test Requests 1003301–1003303; scratch DBs `ledger_ci_s547`, `ledger_ci_s548`; local Docker `ledger_prod` was created and dropped in S553 (transition proof). List and confirm before deleting.
4. ~~**Vercel skipped build of `61dafcb81`**~~ DIAGNOSED 2026-09-30 evening: GitHub logged the `main` PushEvent (22:16:05Z) but Vercel created no deployment record at all (not cancelled/ignored; `vercel.json` has no ignore step). One-off: of 66 `main` push heads in GitHub's event window (9/27–9/30) it is the only one without a production deployment; other undeployed `main` commits since 9/16 are non-head commits of multi-commit pushes. Its code went live via `9f408590e` at 22:27Z. Root cause (dropped GitHub-App delivery) is not visible from the CLI; no action needed beyond the existing verify-deploy-is-the-merge-build habit.
5. ~~`docs/CREDENTIALS_RUNBOOK.md` Postgres rotation procedure~~ ADDED 2026-10-01 (the S553 sync followed a Downloads brief instead).
6. **Codex refactor survey** — read-only survey in `~/Code/WMKF_Apps-refactor`; whatever it proposes is a plan to review, not a worklist.

### Do Not Reopen Without New Decision

1. S553: D1 (Neon via Vercel Marketplace), D3 (shared folder, unencrypted); the four Codex ledger rounds and their fixes; "no more review" after round 4; Part A merged without implementation review; 059 applied alone.
2. S552/S551 decisions listed in the prompts below.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/db/ledger-registry.js` | Managed/local ledger hosts, URL classification, shared-DB fence (`SHARED_DATABASE_URL_VARS`), identity check |
| `lib/db/ledger-guard.js` | `requireLedgerUrl(target)` + `ledgerSchemaCheck` used by every ledger CLI mode |
| `lib/db/ledger-migrations.js` | BEFORE/THROUGH prefix classification (apply / adopt / refuse), tracked-prefix verification |
| `scripts/apply-ledger-migrations.js` | `npm run ledger:apply -- --url-env=NAME [--dry-run] [--migrations-dir=]` |
| `scripts/check-factory-ledger.js` | `check:factory-ledger` gate; `--write-expected` regenerates the fingerprint from a scratch DB |
| `lib/services/scheduled-email-store.js` / `-service.js` | Part A engine (send intent, unconfirmed marker, generation keys) |
| `docs/plans/briefs/FACTORY_LEDGER_SNAPSHOT_BRIEF_2026-09-30.md` | Home→office ledger snapshot / Neon restore procedure |

## Testing

```bash
npm run check:factory-ledger -- --allow-unreachable          # both Neon ledgers, no values printed
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger npx jest --runInBand \
  tests/integration/factory-ledger-fingerprint.pg.test.js tests/integration/scheduled-email-engine.pg.test.js
npx jest tests/unit/ledger-registry.test.js tests/unit/ledger-schema.test.js tests/unit/ledger-guard.test.js \
  tests/unit/apply-ledger-migrations.test.js tests/unit/scheduled-email
```

---
