# Session 553 Prompt: build Part A of the scheduled-email plan (engine hardening, migration 059)

## Session 552 Summary — 2026-09-29/30 PT (Opus; Integrity Workbench tab released, migration numbering settled)

### What Was Completed

1. **Migration numbering settled.** An owner-run read-only production query found `055_post_presentation_materials.sql` applied on 2026-09-26 from the then-unmerged `codex/feature-request` (it merged later in PR #365).
   - Allocation: 055 post-presentation, 056–057 Integrity, **058 B4 (block V57), 059 scheduled-email Part A (block V58)**.
   - The B4 plan, the Part A plan, the Atlas and memory `project-migration-numbers-claimed-off-main` are updated (`79b603f17`).
   - **Production's 054 is an earlier version:** it was applied from `codex/feature-request` at `af65a24bd` (2026-09-24), before `main`'s cast-table edits. Its tracker row means `apply-migrations.js` will never update it, so B4's 058 must carry the earlier-054 repair.
2. **Integrity Screener Workbench tab: reviewed, fixed, released.**
   - `claude/integrity-workbench-tab` (Codex's branch with `main` merged in) became PR #366.
   - Round 1, a Claude code review: 10 findings. Claude fixed 1–5, 7, 8 and 10 (`f69fe2a62`, `8a53d4b91`, `9d21aa8ea`, `b38b81b94`).
   - Round 2, a Codex adversarial review (gpt-5.6-sol): needs-attention, 3 high. Codex fixed them (`5e74cc2cf`, `cdae782fc`, `bd3b00a5e`). Claude reviewed and fixed one UI gap (`79fb0a1c1`).
   - Added the live-Postgres test `tests/integration/integrity-screening-reviews.pg.test.js` to the CI ledger job (`a7bbc50d8`).
   - CI lint had failed on every push because of the repo's only `.cjs` file. The probe is renamed to `.js` (`8d662cf6c`).
   - **Migrations 056–057 were applied by the owner on 2026-09-30** (`applied_by owner-s552-pr366`). A read-only probe confirmed the tracker rows, column, indexes and constraints.
   - PR #366 merged as `fdaec0b1f`, all 13 checks green. The Production deploy `dpl_EbiwNNbuRgPGaAswWNGK7DsYyn7p` was confirmed as the merge build.
3. **PR #367** (`4d482d958`): the standalone screener's dismiss route is scoped to the caller's own screenings. It was stacked on #366, and all 13 checks were green. Production now serves `dpl_GapR1GuDceTFBzdoDJpuSvfFVA1H`.
4. **Production smoke through Chrome** (read-only), on `applications.wmkeck.org`:
   - The standalone history list, detail and own-dismissal list returned 200. A foreign screening id returned 404.
   - The Workbench Integrity tab on Request 1002852 returned 200 and listed the PI and 2 Co-PIs. No screen was run.
5. **Owner decisions:**
   - No restriction on who may re-screen an approved request.
   - Findings 6 and 9 wait until this session.
   - The dismiss ownership issue is not a concern the owner shares; the fix shipped anyway because it was small.

### Commits (all on `main`)
- `79b603f17` (numbering docs); PR #366 merge `fdaec0b1f`; PR #367 merge `4d482d958`; this handoff.

## Next Items

### Verified Open

1. **Build Part A** of `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` (r5, A1–A7 and *Tests*) as **migration 059 / setup-database block V58**.
   - Tier 2: its own branch, live-Postgres crash tests, and an implementation review before merge.
   - Recheck `lib/db/migrations/` first. It ends at 057, and 058 is reserved for B4.
2. **Integrity findings 6 and 9** (deferred by the owner to this session; PR #366 description):
   - Finding 6: strict SerpApi empty-result detection depends on exact vendor strings. Get a real zero-result response before changing it.
   - Finding 9: repeated Dataverse and SQL reads in `lib/services/workbench/integrity-service.js`. Performance only.

### Owner Action Pending

1. **Cleanup: DONE (owner-run, end of S552).** Removed the `integrity-workbench-tab`, `integrity-dismiss-ownership` and `liaison-from-institution` worktrees; pruned the five dead `/private/tmp/wmkf-*` worktree records; deleted `claude/integrity-workbench-tab`, `claude/integrity-dismiss-ownership`, `codex/integrity-workbench-tab` and `claude/liaison-from-institution` locally and on `origin`.
2. **Office Mac `POSTGRES_URL` sync** (from S551; not rechecked).

### Parked

1. Deeper recipes, the admin form, slice 5a, the seven late-2026 `expiresAt` fixtures, the cast ledger reset path, the AkoyaGO TEST · Factory Reviewer search, and the Liaison follow-ups. Unchanged.
2. The Dataverse "Integrity review complete" flag (`wmkf_integrityreviewcomplete`). Not built; its design needs invalidation and retry rules (`docs/CURRENT_WORK_QUEUE.md`).

### Verify Before Acting

1. **Dependabot: 3 new alerts on `main` (2 high, 1 moderate)**, reported by GitHub on the S552 cleanup push. Not triaged. Check `gh api repos/justingallivan/wmkf-research-apps/dependabot/alerts` and `npm audit --omit=dev` before any bump.
2. **Production 054 shape.** Before B4's 058, have the owner run a read-only query of Production's `test_request_*` tables and `pg_get_functiondef('test_request_receipt_ok')`.
3. **`migration_drift_ahead` alert.** It should have fired for 055 from 09-26 until #365 deployed. Whether it did is unchecked (`lib/utils/migration-drift.js`).
4. **Residue** (list and confirm before deleting any of it):
   - Test Requests 1003301, 1003302 and 1003303.
   - Scratch databases `ledger_ci_s547` and `ledger_ci_s548`. S552's test used a temporary schema in `ledger_ci_s548` and dropped it.
5. **Why Vercel skipped the production build of `61dafcb81`:** still not diagnosed.
6. `docs/CREDENTIALS_RUNBOOK.md` has no Postgres rotation procedure. Adding one was offered in S551.

### Do Not Reopen Without New Decision

1. S552: the migration allocation above; no re-screen restriction; findings 6 and 9 deferred to S553.
2. S551 decisions A-1, A-2, B-1, B-2, B-3, the r4 simplification, send-now under B, and the closing of plan review.
3. Earlier decisions listed in the prompts below.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` | Part A/B plan r5 (Part A = migration 059) |
| `lib/services/workbench/integrity-service.js` | Workbench integrity: people, run deadline, review append |
| `lib/services/integrity-service.js` | Screening engine: strict mode, SERP, Haiku, legacy history |
| `tests/integration/integrity-screening-reviews.pg.test.js` | Live-Postgres proof for 056–057 |
| `.claude-memory/project-migration-numbers-claimed-off-main.md` | How to pick a migration number safely |

## Testing

```bash
npx jest tests/unit/integrity tests/unit/workbench-integrity tests/unit/scheduled-email
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/<scratch-db> npx jest tests/integration --testPathPattern pg.test
```

---

## Prior Session 552 Prompt: build Part A of the scheduled-email plan (engine hardening)

## Session 551 Summary — 2026-09-29 PT (Opus; queued-reminder sizing, re-address plan r1–r5)

### What Was Completed

1. **Sized the queued-reminder problem.** An owner-run, read-only production probe (session scratch `probe-queued-reminder-liaison-drift.js`, not committed) found **0** `grantee_abstract_reminder` rows in any status. The owner confirmed the probe read the production Postgres host, and said no grantee materials requests are outstanding. Recorded in the plan's *Measurement (S551)*.
2. **Rewrote the plan** `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`, now **revision 5, ready to build**. The owner closed plan review after three Codex adversarial rounds (gpt-5.6-sol). Part A hardens the engine for every program; Part B re-addresses on a Liaison change.
   - Part A adds one new column, `recipient_generation`.
   - Main pieces: `send_requested_at` as the no-resend rule; a dedicated reconciliation claim that never sends; unconfirmed, missing and forbidden states shown under Needs attention; no edits once the activity exists; lease-fenced PD-handoff reset (including expired `sending` rows) and source cancel; separate ordinary and 25-row reconciliation queries; a per-PD 100-row digest cap.
3. **Owner decisions, all settled (S551):**
   - A-1: unconfirmed is an error code on `failed`, behind one helper.
   - A-2: a 7-day late-acceptance check on stopped rows that had a send requested.
   - B-1: an approval never survives a recipient change.
   - B-2: the activity-without-send-intent gap is accepted, and detected.
   - B-3: approval is re-checked at send time, tightening only.
   - Send-now under B: the PD pressing send is the approval for a posture-only tightening; a recipient change still goes back for approval.
   - The r4 simplification: no backoff, counters, rotation or extra columns.
4. **PR #360 (B4)** was merged upstream as `507bf14ab` during the session. It was reviewed by Opus in Codex's worktree, not by this session.

### Commits (all on `main`, pushed)
- `ed04b6c17` measurement; `5a6aa0869`, `f5140cc75`, `0d69d8e73` r1 and decisions A-1, A-2, B-1, B-2; `c3f4efe57` line-number base; `62080921d` r2; `d031cef1b` r3; `27f557be9` r4 simplification; `420a9231a` B-3; `dd394d8fe` r5; `2fcc102b8` ready to build; plus this handoff.

## Next Items

### Verified Open

1. **Build Part A** of the scheduled-email plan (r5, *Part A* A1–A7 and *Tests*).
   - Tier 2: a migration on the shared Postgres plus email-engine changes. Use its own branch, live-Postgres crash tests (the `.pg.test.js` pattern in the CI ledger job), and an implementation review before merge.
   - Part B comes after it, on its own branch.
   - The plan's line numbers are as of `ed04b6c17`; the scheduled-email files have not changed since [VERIFIED via `git diff --name-only 8fc003931 507bf14ab`, which did not touch them].

### Migration numbering (settled S552)

1. **055** is `codex/feature-request`'s `055_post_presentation_materials.sql`. It is **already applied to shared Production** (2026-09-26 06:54Z, `codex-feature-request-2026-09-26`, alongside 054) but exists only on that unmerged branch. Treat the file as frozen: it must land on `main` byte-identical [VERIFIED via an owner-run read-only `schema_migrations` query, S552].
2. **056–057** stay with the Integrity Screener Workbench tab; production shows them unapplied (no `integrity_screening_reviews`, no `integrity_screenings.request_id`). No renumbering needed.
3. **058** (block V57) = Test Request Factory slice B4; **059** (V58) = scheduled-email Part A. Plans and Atlas updated.
4. The Integrity branch now has `main` merged in, on `claude/integrity-workbench-tab` (latest merge `0b3e56011`, which includes `main` at `d8cfd9eda` / PR #364; local only, worktree `.claude/worktrees/integrity-workbench-tab`). `codex/integrity-workbench-tab` is untouched at `b1086302b`. All gates pass, apart from the two per-worktree symlink gates (`:ci` passes), and 17,225 unit tests pass. Not yet run: the e2e spec, and a `.pg.test.js` for 057's constraints (none exists). Next: push the branch, then a non-author implementation review.
5. Preview's database was not read.
6. **Production has an earlier 054, not `main`'s.** The last committed 054 on `codex/feature-request` before the 06:54Z apply is `af65a24bd` (2026-09-24). `main`'s 054 differs by +166/−14 across 15 later commits, including the Factory cast tables. Production's tracker says 054 is applied, so `apply-migrations.js` will never update it [VERIFIED via `git log --until` and `git diff`; ASSUMED the apply used committed branch state, not uncommitted edits; Production's actual table shape was not read]. This answers S550's question: B4's 058 **does** need the earlier-054 repair logic for shared Production. Next step, owner-run and read-only: read Production's `test_request_*` tables and `pg_get_functiondef('test_request_receipt_ok')`.
7. Leads, not checked: whether Production's `migration_drift_ahead` alert has been firing for 055 since 09-26 (`lib/utils/migration-drift.js`); and the process fact that 054 and 055 reached shared Production via `apply-migrations.js` from a Codex worktree before either merged.

### Parked

1. Deeper recipes, the admin form, slice 5a, the seven late-2026 `expiresAt` fixtures, and the cast ledger reset path. Unchanged.
2. AkoyaGO lookup search does not find TEST · Factory Reviewer. Unchanged.
3. Liaison follow-ups (not requested): an automatic recipients reload on a 409 `liaison_changed`; "Liaison not verified" on open materials collections; `{{liaisonFullName}}` refusals. Unchanged.

### Verify Before Acting

1. **`POSTGRES_URL` rotation (S551): home Mac DONE, office Mac OPEN.** The owner pasted the production connection string, with its password, into the S551 chat.
   - The owner rotated the `neondb_owner` password via Vercel's Neon integration; Vercel updated the Postgres variables.
   - The home Mac's two real env files are synced: `WMKF_Apps/.env.local`, which five worktree `.env.local` symlinks share, and the feature-request worktree's `.env.presentation-proof.local`. A `select 1` check connected, and the backups were deleted.
   - Production was redeployed as `wmkfresearchapps-irht4mpyn` (aliased to `reviews.wmkeck.org`, Ready).
   - **Open:** the office Mac, using the owner's brief `~/Downloads/office-mac-postgres-sync-brief.md` (dry run, then `--apply` on approval). The first post-redeploy cron run was not checked for auth errors.
   - `docs/CREDENTIALS_RUNBOOK.md` has no Postgres rotation procedure; adding one was offered, not done.
2. **Why Vercel skipped the production build of `61dafcb81`:** still not diagnosed.
3. **Residue** (list and confirm before deleting any of it):
   - Test Requests 1003301, 1003302 and 1003303.
   - Scratch databases `ledger_ci_s547` and `ledger_ci_s548`.
   - Worktree `.claude/worktrees/liaison-from-institution` (its branch is merged).
   - `../WMKF_Apps-codex-b4`, now on `codex/b4-slot-readiness` (`523fbc071`, live Codex work).
   - Five prunable `/private/tmp/wmkf-*` worktrees.

### Do Not Reopen Without New Decision

1. S551 decisions A-1, A-2, B-1, B-2, B-3, the r4 simplification, send-now under B, and the closing of plan review.
2. S549–S550 decisions listed in the prior prompts below.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` | Engine hardening and re-address plan r5 (ready to build) |
| `lib/services/scheduled-email-service.js` | Send, reconcile and digest engine (Part A target) |
| `lib/services/scheduled-email-store.js` | Ledger SQL: claims, fences, due and digest queries |
| `lib/services/cron/grantee-deliverable-reminders-service.js` | Daily cron: create/handoff, digests, delivery, finalize |

## Testing

```bash
npx jest tests/unit/scheduled-email tests/unit/grantee-deliverable-reminders
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/<scratch-db> npx jest tests/integration --testPathPattern pg.test
```

---

## Prior Session 551 Prompt: size the queued-reminder problem, then revise the re-address plan

## Session 550 Summary — 2026-09-29 PT (Opus; Research Liaison switch built, reviewed, released; security bump)

### What Was Completed

1. **B4 plan revision reviewed (read-only, round 3; S550)** at `209877256` on `codex/factory-reviewer-b4`.
   - The spot-checked file:line citations matched source. The `CREDENTIALS_RUNBOOK.md` and Atlas edits are correct fact fixes.
   - The owner confirmed owner decisions 9–10 (switch-off stops all binds; either switch off pauses all acceptance jobs).
   - Findings handed to Codex, which was still working:
     - Probe section 13 marks any flow that mentions Requests INCOMPLETE, with no way for the owner to classify it, so it would block the slot PATCH forever.
     - Preview switch values are unverified. Under decision 9, a B4 runtime push to Preview stops every reviewer bind there unless both switches are set first.
     - The 055 "repair earlier-054" logic may be unnecessary. An owner-authorized `schema_migrations` read would settle it.
   - Codex has since pushed `bd0c5739a`, `664d924a9` and `bde50dcd2`, and opened **PR #360**. S550 has not read these.
2. **Research Liaison switch: built, reviewed, released.**
   - Plan `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md` r7; see its *Build record*.
   - Helper `lib/services/contacts/request-liaison.js`, plus readers 1–7 and the docs reconcile.
   - Tests: every guard was mutation-checked. New live-Postgres test `tests/integration/site-visit-materials-claim.pg.test.js`, added to the CI ledger job.
   - A read-only sandbox probe verified that selected blank lookups return `null`.
   - Codex adversarial implementation review (gpt-5.6-sol): needs-attention, one high and one medium, both fixed in `9d8947dcf`.
   - PR #361 merged as `61dafcb81`; all 12 CI checks green.
3. **Release:** Vercel made **no production deployment for `61dafcb81`**. The next merge, `9f408590e`, deployed to Production at 22:27Z and carries it [VERIFIED via `vercel ls --prod`; ancestry].
   - Owner production check: on 997125 (UCLA) the Awardee tab Cc showed the institution Liaison (Jamie Lynn), not the Request copy.
   - The candidate list came from an owner-run read-only probe (session scratch).
4. **Security:** PR #362 (`9f408590e`), a lockfile-only bump: undici 6.29.0 and 7.30.0, ip-address 10.7.2.
   - Cleared Dependabot alerts #88–#102 (published 2026-09-29; our code did not introduce them).
   - `npm audit --omit=dev`: 0.

### Commits
- `main`: PR #361 merge `61dafcb81` (branch commits `14d0332c0`…`319bb3b47`); PR #362 merge `9f408590e` (`6e383975e`); `8861f9bec` (release record); this handoff.

## Next Items

### Verified Open

1. **Queued-reminder re-addressing** (`docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md`, draft r0, on `main`). This is the one remaining gap in rule 2 now that the switch is live. The plan lists six unresolved round-3 requirements, so revise before any Codex review.
   - **First step (owner choice pending): size the problem.** Count queued, unsent `grantee_abstract_reminder` rows in `scheduled_email_messages` whose stored Cc differs from the current institution Liaison. This is a production Postgres plus Dataverse read, so the owner runs it; S550 proposed it but did not write the script.
   - If the count is small: stop those rows, have staff send those reminders by hand, and split the engine hardening (no re-send after `send_requested_at`, a version-fenced PD-handoff rebuild) into its own plan, since it affects every program.
   - Staff can edit a queued row's subject and body, or stop it, but not its recipients [VERIFIED via `pages/api/scheduled-emails/[id].js`, `lib/services/scheduled-email-store.js` `updateScheduledEmailDraft`].
2. **B4 PR #360** (`codex/factory-reviewer-b4`, head `bde50dcd2`). Read what changed since `209877256`, including whether the S550 round-3 findings above were addressed. Review it as a non-author before any merge. It is plan plus probe only, no runtime code.

### Owner Decision Needed

1. **Re-address plan:** size first (recommended), or write revision 1 now.
2. **Scheduled-email engine hardening:** when to take it up (a duplicate-send hazard after recorded send intent exists for every program).
3. **Integrity Screener Workbench tab** (`codex/integrity-workbench-tab` in `../WMKF_Apps-codex`; migrations 056–057 need renumbering). Unchanged.

### Parked

1. Deeper recipes, the admin form, slice 5a, the seven late-2026 `expiresAt` fixtures, and the cast ledger reset path. Unchanged.
2. AkoyaGO lookup search does not find TEST · Factory Reviewer. Unchanged.
3. **Liaison follow-ups the owner may want** (not requested):
   - An automatic recipients reload on a 409 `liaison_changed` (staff reload the page today).
   - Open materials collections show "Liaison not verified" until refreshed.
   - The seed materials templates use `{{liaisonFullName}}`, so a Research Request with no institution Liaison refuses materials email (0 upcoming per the measurement).

### Verify Before Acting

1. **Why Vercel skipped the production build of `61dafcb81`:** not diagnosed. Check the Vercel project's Git/production settings if it recurs.
2. **Residue** (list and confirm before deleting any of it):
   - Test Requests 1003301, 1003302 and 1003303.
   - Scratch databases `ledger_ci_s547` and `ledger_ci_s548`. S550's Postgres test used a temp schema in `ledger_ci_s548` and dropped it.
   - Worktrees `.claude/worktrees/liaison-from-institution` (branch now merged) and `../WMKF_Apps-codex-b4` (live, Codex).
   - Five prunable `/private/tmp/wmkf-*` worktrees and the older ones.
3. **Two gates red only inside `.claude/worktrees/liaison-from-institution`:** `check:agent-invariants` and `check:agent-wiki` fail on the per-machine `.agents/skills` and memory symlinks the worktree lacks. The main checkout and the `:ci` variants are green.

### Do Not Reopen Without New Decision

1. S549–S550 owner decisions: the liaison answers 1–9; the Santa Monica College case; the split; B4 option A and owner decisions 9–10.
2. Earlier decisions listed in the prompts below.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/contacts/request-liaison.js` | Liaison of record helper (Research: institution Primary Contact) |
| `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md` | Liaison plan r7 + Build record (released) |
| `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` | Queued-reminder re-address plan r0 (next) |
| `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (B4 branch / PR #360) | B4 revision |

## Testing

```bash
npx jest tests/unit/request-liaison.test.js tests/unit/grantee-send-invite-workbench-service.test.js tests/unit/site-visit-materials-reminder-sweep.test.js tests/unit/dynamics-explorer-contact-liaison.test.js
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/<scratch-db> npx jest tests/integration/site-visit-materials-claim.pg.test.js
```

---

## Prior Session 550 Prompt: build the Research Liaison switch; review Codex's B4 revision

## Session 549 Summary — 2026-09-29 PT (Opus; first cast-bound clone, PR #357 merged, two plans through Codex review)

### What Was Completed

1. **First cast-bound production clone** (owner-run from `claude/factory-cast` at `f47703167`) [VERIFIED: owner-run output]:
   - Run `e33fa857`, Request **1003303**, reached `ready` at 16:38:58Z, and the one-hour `--run-recheck` passed (`ok`, `not_refreshed`).
   - The PI and Liaison show on the Awardee tab (To and Cc), with the TEST badge.
   - `--bind-reviewer` created suggestion `0d1a990d`.
   - The owner set the Foundation's Organization Leader to WMKF ORG LEADER, and also set Potential Reviewer 1 on 1003303 by hand.
2. **The cast reviewer does not work in the app** (cast plan *Facts*, *Order* 5–6):
   - The Find tab reads the Request's `wmkf_potentialreviewer1..5` slots, not suggestion rows.
   - With the slot set, ingest is refused by `assertPersonBindable` (synthetic fence).
   - The S548 "visibility" claim is marked STALE.
   - Owner decision 8 (option A): admit a synthetic person on test Requests only.
   - Slice B4 planned; Codex round 1 no-ship (four high, one medium). Revision handed to Codex on `codex/factory-reviewer-b4`.
3. **PR #357 merged** (`75d58e331`), without B4. All 12 CI checks were green. The production deploy of the merge build was confirmed Ready.
4. **Read-only production probes, owner-authorized** (session scratch scripts, not committed):
   - Potential Reviewer slots: not audited, no slot-triggered automation.
   - Liaison coverage: 108 active Research awards; 84 have a Request-copy Liaison contact different from the institution's Primary Contact; only 1 institution (Santa Monica College, 996068) has none. The owner accepts that case.
   - Email comparison: the recipient actually changes on **27 active awards / 35 upcoming Requests**.
5. **Liaison decision** (owner with the platform owner): the Research Liaison of record is the applicant institution's Primary Contact.
   - Plan `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md`, revision 7, on `claude/liaison-from-institution`.
   - Six Codex rounds, then a Codex review-and-fix pass; verdict **ready to build**.
   - Owner answers 5–9 are recorded in the plan (relabel export, Explorer via institution, one editable Cc with server check, measure first, split).
6. **Split** (owner): re-addressing queued grantee reminders, plus the scheduled-email engine hardening it needs, moved to `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` (draft r0, unreviewed; carries rounds 2–3 as open requirements).

### Commits
- `main`: `fa42b274b`, `4ccfc6ac4` (cast plan), PR #357 merge `75d58e331`, this handoff.
- `claude/liaison-from-institution` (pushed, not merged): `9a28a4e82` … `fbe64a69b`; Codex's `3700653a4`.
- `codex/factory-reviewer-b4` (pushed): brief `8dc5c3d40`, `221fc7896`; Codex's `175675b9e`, `92d175f14` (unreviewed).

## Next Items

### Verified Open

1. **Build the Research Liaison switch** on `claude/liaison-from-institution`, in `.claude/worktrees/liaison-from-institution`, per plan revision 7 and its test matrix (Tier 2). Then run an implementation code review before any merge.
   Evidence: plan Status line; Codex task report (ready to build).
2. **Review Codex's B4 plan revision** on `codex/factory-reviewer-b4` (`../WMKF_Apps-codex-b4`), read-only, as a reviewer who is not the author. It touched 5 files, including `docs/CREDENTIALS_RUNBOOK.md` and `docs/atlas/postgres-test-request-runs.md`, beyond the brief's plan-plus-probe scope; check those edits.
   Evidence: `git diff --stat 221fc7896 origin/codex/factory-reviewer-b4`.

### Owner Decision Needed

1. **B4 open questions** will come from Codex's revision: email contract ("allowlisted recipients" vs recipient binding), and whether manual add stays refused.
2. **Scheduled-email engine plan:** when to take it up. It covers a duplicate-send hazard after recorded send intent that exists for every program today.
3. **Integrity Screener Workbench tab** (`codex/integrity-workbench-tab` in `../WMKF_Apps-codex`; migrations 056–057 need renumbering). Unchanged.

### Parked

1. Deeper recipes, admin form, slice 5a; the seven late-2026 `expiresAt` fixtures; cast ledger reset path. Unchanged.
2. AkoyaGO lookup search does not find TEST · Factory Reviewer by name or email (browse works); cause unknown (index or the `·`). Ask the platform owner if it matters.

### Verify Before Acting

1. **Residue:**
   - Test Requests 1003301, 1003302 and **1003303** (Potential Reviewer 1 set by hand; suggestion `0d1a990d`).
   - Scratch databases `ledger_ci_s547` and `ledger_ci_s548`.
   - Worktrees `.claude/worktrees/liaison-from-institution` and `../WMKF_Apps-codex-b4`, plus older ones.
   
   List and confirm before deleting any of them.
2. **Session probes are gone with the scratchpad.** Their results are recorded in the liaison plan (*Measurement*) and cast plan (*Order* 5). Re-create from the plan text if a re-run is needed.

### Do Not Reopen Without New Decision

1. S549 owner decisions: option A for synthetic reviewers (cast decision 8); liaison answers 1–9; the Santa Monica College case accepted; the split.
2. Earlier decisions listed in the Session 549 prompt below.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md` (branch) | Build plan r7: helper, six readers, export and Explorer, tests |
| `docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` (branch) | Engine plan r0 for queued-reminder re-addressing |
| `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` | Cast plan: *Order* 5 clone record, 6 B4 and its round-1 findings |
| `docs/plans/FACTORY_REVIEWER_B4_CODEX_BRIEF_2026-09-29.md` (B4 branch) | Codex brief for the B4 revision |

## Testing

```bash
npx jest "tests/unit/(.*test-request|production-|rehearse-test-request|email-source|migration-054).*"
```

---

## Prior Session 549 Prompt: first cast-bound production clone, then merge the cast (PR #357)

## Session 548 Summary — 2026-09-28 PT (Opus; probe hardening, wave30 live, meeting-date fix, synthetic cast slices A + B built, reviewed and created in production)

### What Was Completed

1. **Probe section 12 hardened** (on `main`, `3dcf61bb0` → `155dc80d6`):
   - An unreadable cloud-flow definition or unreadable count prints `INCOMPLETE` and sets exit 1.
   - Flows are matched on their triggers and record actions.
   - Create steps registered for every entity are found.
   - `--cast=<dir>` writes a dated, id-free JSON receipt.
   - Mailing-list counts, list type (static or dynamic), `akoya_mailinglistmember`, and create-workflow summaries.

   Owner-run twice in production (`COMPLETE`); receipts are in `~/factory-receipts`.
2. **wave30 in production** [VERIFIED: owner-run output]:
   - Applied under a same-day `DATAVERSE_PROD_WRITE_ACK`, which the interlock requires for any local production write; probe section 1 shows PRESENT.
   - `SYNTHETIC_REVIEWER_ISOLATION=on` in Vercel Production and redeployed; Review Manager and My Candidates loaded normally.
   - Credentials runbook entry added (`e20162400`, `6d0d17e3f`); docs reconciled (`cdaa23454`).
3. **Workbench Board Meeting date fix** (PR #356, merged `9380f3605`): the DateOnly `wmkf_meetingdate` is now rendered in UTC. The owner confirmed 1003302 shows Dec 11.
4. **Open question 1 answered.**
   - Business Central is not used (the platform owner).
   - No contact-create automation adds a mailing-list membership.
   - The one dynamic list, "Test 2", has 0 members and has never been used.
5. **Cast slices A + B built** on `claude/factory-cast` (draft **PR #357**, 23 commits from `4316b19ec` to `f47703167`, **not merged**, Tier 2):
   - **Spine:** 054 in place gains `test_request_cast_members` and `test_request_cast_bindings`. New receipt keys: `primaryContactId` (null allowed), `liaisonContactId`, `piContactId`, `researchLeaderContactId`. Fences: cast create, the one parent-attach PATCH, the suggestion binding, and per-lookup contact binds on the Request create.
   - **Parallel tracks:** A, the cast runner; B1 + B2, create-body binding and the Foundation transition allowance; B3, the suggestion binder. The CLI adds `--create-cast [--confirm]` and `--bind-reviewer=<runId>`; a production `--reserve` reads the cast, and `--run-recheck` reads the run's own journaled Liaison.
   - **One Codex adversarial round** (gpt-5.6-sol high) returned needs-attention with two high and three medium findings; all five were fixed (`a45251e21`, `fba5b87f9`).
6. **Owner decisions S548**, recorded in the cast plan: addresses supplied at run time with default names; `--bind-reviewer` as its own mode; binding mandatory on every production reserve; 1003302 stays unbound; Find-tab enrichment of the cast reviewer accepted; **(6)** the PI and Liaison are Foundation children; **(7)** WMKF ORG LEADER and WMKF RESEARCH LEADER added as cast contacts. Decisions 6 and 7 are post-review changes and were not re-reviewed.
7. **Cast in production (5 members, all verified; ledger `ledger_prod`):**
   - PI `6ccbcbd1-079f-44ec-a9c2-9b74148a92be`, Liaison `e068fd4e-065e-4ba1-8b97-1e6c0f5507e1`, reviewer person `e5003660-35f1-41e1-a1c4-aa2e4ec6e591`, Org Leader `da554f3e-9df4-4bc4-bd1d-b7e2c54875b4`, Research Leader `bd7ae3bb-52aa-4d84-a6be-14a565f67849`.
   - Contacts are children of the Foundation.
   - The owner's Audit History reads are clean.
   - The owner set the Foundation's Primary Contact to TEST · Factory Liaison.
8. **Contact-role findings** [VERIFIED via workflow definitions and metadata; cast plan *Facts*]:
   - AkoyaGO status drafts address **organization** fields. Invite: To the Organization Leader, Cc the Request's Research Leader. Not Invited: To the organization's Primary Contact, Cc the PI. Ineligible: To the Request's Liaison.
   - The Liaison and Organization Leader flow **up** only (Request → organization).
   - **Nothing copies an organization's Primary Contact down to its Requests.** The owner confirmed this empirically on 1003220.

### Commits
- On `main`: `3dcf61bb0`, `e20162400`, `6d0d17e3f`, `cdaa23454`, `de2482147`, `ce2731611`, `155dc80d6`, `7f55ec80d`, `3e77fe858`; PR #356 merge `9380f3605`; this handoff.
- On `claude/factory-cast` (PR #357): `4316b19ec` through `f47703167`.

## Next Items

### Verified Open

1. **Owner: set the Foundation's Organization Leader to WMKF ORG LEADER** in AkoyaGO, replacing Allison Keller (a real person).
   Evidence: cast plan owner decision 7; `f47703167`.
2. **First cast-bound production clone.** Run from `claude/factory-cast`: `--reserve` (it reads all five cast members) and `--advance` under the usual verify; then `--bind-reviewer=<runId>`; then the owner's Workbench checks. Expected first-time outcomes, none of them failures:
   - The Foundation's Primary Contact should read unchanged, since it is already the cast Liaison.
   - The payment-contact workflows now see a bound Liaison.
   - A draft email regarding the clone would stop verify, correctly (`expectedRegardingEmails: 0`).
   Evidence: cast plan *Order* 4 build record.
3. **Merge PR #357** after the first clone succeeds (Tier 2, deliberate promotion). CI was green at `b31f9fdb5`; re-check at the final head.
4. **Liaison sync gap (outside the Factory):** a Liaison changed on an organization never reaches its existing Requests, and this app emails the Request's copy (`recipients-service.js`). Tell the platform owner, and decide between a process change, a down-sync workflow, or app-side handling.
   Evidence: cast plan *Facts* (contact roles), 1003220 check.

### Owner Decision Needed

1. **Integrity Screener Workbench tab** (`origin/codex/integrity-workbench-tab` at `b1086302b`, unmerged; migrations 056–057 need renumbering; the latest on-disk migration is 054).
2. **Liaison sync gap:** which fix, if any (item 4 above).

### Parked

1. Deeper recipes, admin form, slice 5a — unchanged from the MVP cut.
2. Seven late-2026 `expiresAt` test fixtures (the earliest is 2026-10-08) — see `docs/CURRENT_WORK_QUEUE.md` *Audit follow-ups*.
3. Cast ledger has no reset path: a member or binding left `needs_attention` needs its row cleared by hand (Track A recommendation, deferred).

### Verify Before Acting

1. **054 edits need explicit ALTERs on existing ledgers.** `CREATE TABLE IF NOT EXISTS` does not update a changed CHECK constraint. S548 ran `ALTER TABLE test_request_cast_members DROP/ADD CONSTRAINT test_request_cast_members_role_check` on `ledger_prod` and `ledger`; re-applying 054 with `psql -f` updates only the receipt function and new tables.
2. **`--run-recheck` on run `7293496e` (1003302)** now fails on the Primary Contact change. That's expected: the owner made the change, and the run's baseline predates journaling.
3. **Residue:**
   - Test Requests 1003301 (deactivate now) and 1003302.
   - Scratch databases `ledger_ci_s547` and `ledger_ci_s548`.
   - This session's merged agent worktrees and branches (`worktree-agent-aac2d9d2ff10034ad`, `-a6f2ec1b747e97f24`, `-a7037be3ec38dad64`) under `.claude/worktrees/`.
   - Older `.claude/worktrees` and `/private/tmp` worktrees from earlier sessions.

   List and confirm before deleting any of them.
4. **Production reads this session:** owner-requested one-offs (1003220 and 1002852 contacts, form placement, Research Leader counts, workflow recipients, automation that could sync the Liaison) were run from scratch scripts under the session scratchpad. Only the probe changes are in the repo.

### Do Not Reopen Without New Decision

1. MVP cut and deferrals; the program director is the cloning admin; the allowlist replaces D-R4/6d (owner, S546).
2. `Pending` accepted at create; all rollup companions freed; wave30 in production (owner, S547).
3. S548 owner decisions 1–7 in the cast plan, including a mandatory cast binding, Foundation-parented cast contacts, and accepted Find-tab enrichment of the cast reviewer.
4. Open question 1 (Business Central and mailing lists) is closed.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (on the branch) | Cast plan: contact-role facts, decisions 1–7, *Order* 4 build record, Codex round, production record |
| `lib/services/test-requests/cast-runner.js` / `cast-binding-runner.js` | Cast create, reuse, recovery and parent attach; suggestion binding |
| `lib/services/test-requests/production-write-fence.js` | All production fences, including the cast ones |
| `lib/services/test-requests/foundation-transition.js` | Transition contract: journaled Primary Contact, Liaison and cast-contact exclusion |
| `scripts/rehearse-test-request-sandbox.mjs` | CLI: `--create-cast`, `--bind-reviewer`, `--reserve` with the cast |
| `scripts/probe-test-request-factory-production-readiness.js` | Owner-run probe; section 12 hardened |

## Testing

```bash
npx jest "tests/unit/(.*test-request|production-|rehearse-test-request|email-source|migration-054).*"
docker exec wmkf-ledger-pg psql -U postgres -qc "DROP DATABASE IF EXISTS ledger_ci_new" -c "CREATE DATABASE ledger_ci_new"
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger_ci_new TEST_REQUEST_LEDGER_REQUIRE=1 npx jest --runInBand "tests/integration/.*\.pg\.test\.js"
```

---

## Prior Session 548 Prompt: Factory synthetic cast (after the Business Central answer), probe hardening, wave30 in production

## Session 547 Summary — 2026-09-28 PT (Opus; MVP item 5 complete; status setter built, merged and characterized in production)

### What Was Completed

1. **MVP item 5 complete.** Verify now checks the Foundation account against a digest-only pre-create baseline journaled at `fence_source` (transition contract: protected projection, Tax Status/BMF 509, GoVerify stamps in the run window, Request count unchanged or +1, all 15 rollups' `_date` free and `_state` Calculated, GuideStar digest, Contacts), plus a read-only `--run-recheck` (PR #352, #354). First production run (Request 1003301, run `25b392a0`) stopped at verify on two explained causes: the create plug-in rewrites Request Status to `Pending`, and non-Request rollups' `_date` companions moved. Second run (Request **1003302**, run `7293496e`) reached `ready` (`not_refreshed`) and passed the one-hour recheck [VERIFIED: owner-run output, 21:11Z].
2. **Status setter (slice C) built, reviewed, merged (PR #355, `466b23fb9`).** `--target=production --set-status=<runId> --field=phase1|phase2 --option="<label>" [--rerun]` and `--status-recheck`. Transition table from the workflow definitions, payment/tracking-producing edges only from listed states, `If-Match` fence, ≥ 90 s quiet completion, replay guard, ledger table `test_request_status_changes` (054 in place). **Characterized in production:** 1003302 Phase II → Pending Committee Review set Request Status `Phase II Pending` (the business rules run on API updates), 0 emails/tracking/payments; owner's Audit History shows only those two fields; 1003302 visible in Workbench with the TEST badge.
3. **Probes (owner-run, read-only):** sections 10 (Foundation unaudited columns), 11 (status fields, options, update-triggered workflows, exported definitions), 12 (cast readiness: contact/person/suggestion create automation, lookups, Request Status rules).
4. **Plans:** `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` (revision 2 after one Codex round); production plan records both runs, the platform owner's answers and the status-field findings.
5. **Owner decisions:** accept `Pending` at create (now moved by the status setter); free all rollup companions; Liaison copy onto the Foundation's Primary Contact accepted (overwrites the 9/19 value); wave30 in production; owner-created synthetic addresses on the allowlist; test Requests are deactivated, not deleted (platform owner).
6. **Codex config:** reviews run `--model gpt-5.6-sol` with `model_reasoning_effort = "high"` in `~/.codex/config.toml` (owner, S547; memory `feedback-codex-model-gpt56-sol`).

### Commits
All on `main` (merged PRs #352, #354, #355 and direct Tier 0 commits), from `dc571513d` through `73507229e`, and this handoff.

## Next Items

### Verified Open

1. **Probe section 12 hardening** (cast plan *Order* 2): fail as incomplete on a missing or unreadable activated flow definition, list Create steps registered for all entities, write a sanitized dated receipt.
   Evidence: cast plan *Probe results → Limits*; Codex plan-review round 1 (medium).
2. **wave30 in production** (cast plan *Order* 3; owner-run): apply `wave30-synthetic-reviewer-marker`, set `SYNTHETIC_REVIEWER_ISOLATION=on`, redeploy, confirm.
   Evidence: cast plan owner decision 2; probe section 1 (wave30 absent).
3. **Board Meeting date shows one day early in Workbench** (Dec 10 vs the Request's 12/11/2026 meeting date on 1003302): likely a date-only value rendered through UTC in the Workbench header [ASSUMED; not investigated]. Check whether it affects every Request.
   Evidence: owner screenshot, 2026-09-28.

### Owner Decision Needed

1. **Platform owner: what `AkoyaGo.Sync_BusinessCentral` does on contact create**, and whether a new contact joins a mailing list. Blocks cast slices A + B (synthetic PI, Liaison, suggested reviewer).
   Evidence: cast plan *Open questions* 1; probe section 12.
2. **Integrity Screener Workbench tab** (`origin/codex/integrity-workbench-tab` at `b1086302b`, unmerged; migrations 056–057 unapplied, recheck numbering; latest on-disk migration is 054).

### Parked

1. Deeper recipes, admin form, slice 5a — unchanged from the MVP cut.
2. Seven late-2026 `expiresAt` test fixtures (earliest 2026-10-08) — `docs/CURRENT_WORK_QUEUE.md` *Audit follow-ups*.

### Verify Before Acting

1. **Production test residue:** 1003301 (run `25b392a0`, `needs_attention`) and 1003302 (run `7293496e`, `ready`, Phase II Pending Committee Review) in `ledger_prod`. Deactivate (not delete) in AkoyaGO when finished; 1003301 can go now.
2. **Local ledger databases** in `wmkf-ledger-pg`: `ledger` (sandbox runs, keep), `ledger_prod` (production runs), `ledger_ci_s547` (throwaway scratch from this session's PG suite run; safe to drop). 054 is edited in place: re-apply it with `psql -f` to `ledger_prod` after any 054 change.
3. The create POST can exceed the client's 30 s timeout in production (first run); the resume path recovered it. If it recurs, consider a longer create timeout.

### Do Not Reopen Without New Decision

1. MVP cut and deferrals; program director = cloning admin; allowlist replaces D-R4/6d (owner, S546).
2. `Pending` accepted at create; all rollup companions freed; Liaison copy onto the Foundation accepted; wave30 in production (owner, S547).
3. GoVerify not bypassed in production; stub `wmkf_ai_run` stays.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` | Cast + status setter plan, probe results, decisions, order |
| `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` | Production plan: both runs, platform-owner answers, status-field reactions |
| `lib/services/test-requests/foundation-transition.js` | Foundation transition contract |
| `lib/services/test-requests/status-transitions.js` / `status-change-runner.js` | Status setter rules and runner |
| `lib/services/test-requests/production-write-fence.js` | Basic-run fence and `fenceStatusChangeClient` |
| `scripts/probe-test-request-factory-production-readiness.js` | Owner-run probe, sections 1–12 |
| `scripts/rehearse-test-request-sandbox.mjs` | CLI: `--reserve`, `--advance`, `--run-recheck`, `--set-status`, `--status-recheck` |

## Testing

```bash
npx jest "tests/unit/(.*test-request|production-|docx-package|presite|pre-rp|source-bundle|seed-synthetic|migration-054).*"
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/<fresh scratch db> TEST_REQUEST_LEDGER_REQUIRE=1 npx jest --runInBand "tests/integration/.*\.pg\.test\.js"
```

---

## Prior Session 547 Prompt: Factory MVP item 5 — verify transition contract, then the first production basic run

## Session 546 Summary — 2026-09-27/28 PT (Opus; owner cut item 7 to an MVP; slices 1, 2, 4 built, reviewed, merged; production enabled)

### What Was Completed

1. **Scope reset (owner).** The original ask (Codex session log, 2026-09-19): "It is very hard for me to create requests from scratch for testing. Could you design a system that could create a new request based on an existing one?" After eight days without a usable result, the owner accepted an **MVP build list** (production plan *MVP build list*): a production `basic` clone that lands before reviewer invite, nothing else until used. New memory `feedback-anchor-multisession-features-to-the-original-ask`.
2. **Owner decisions** (production plan *Owner decisions*): Q2 shared Postgres for the form phase; program director = the cloning admin; test-Request email recipient allowlist (`@wmkeck.org` + admin-edited list), superseding D-R4/6d; `correct_meeting_date` never writes in production; Foundation rollup columns join the transition contract (open question 7); post-cap Codex gap (first-write exception) accepted, deferred to recipe 5; slice-4 dispatch-gap residual risk accepted; one Codex review per slice, owner decides.
3. **Probes (owner-run):** production has no meeting-date business rule; app user cannot read audit (403); `CalculatedFieldsAsync` and rollups fire on any Request column; Foundation has eight Request-aggregating rollups. Wiki: `docs/agent-wiki/topics/dataverse-dynamics.md`.
4. **Slice 1** (PR #349, `9ba8692a2`): `--target=production`, lease-time target check, production create body adds Phase II Pending + active Research grant program + PD (`--director`, re-checked at fence and create), body re-hash at create, production refusals.
5. **Slice 2** (PR #350, `fe71c846f`): `production-write-fence.js` (closed POST shapes, destination-only Graph writes, source refused, deny-by-default) and live source-revision checks.
6. **Slice 4** (PR #351, `3738af3f0`): email allowlist at create and dispatch (dispatch re-reads the activity's own parties, only for test requests); editor at Admin → Test Requests.
7. **Production enablement:** wave29 applied (owner-run) and `TEST_REQUEST_ISOLATION=on` (Config) with redeploy `abv0745vo` Ready [VERIFIED `vercel ls --prod`, probe section 1].
8. **Unrelated fix:** `reviewer-roster-endpoint.test.js` expiry fixture aged out on 2026-09-28 UTC (`5ced59d3b`); seven similar fixtures logged in `docs/CURRENT_WORK_QUEUE.md` *Audit follow-ups*.

### Commits
All on `main` (merged PRs #349, #350, #351 and direct Tier 0 commits): `5c96e1713`…`464021dd3` (probes, decisions, plan), `5ced59d3b`, `12a54ea10`, and this handoff.

## Next Items

### Verified Open

1. **MVP item 5, part 1 — verify transition contract (build).** `verifyClone` (`lib/services/test-requests/basic-clone-steps.js`) still compares the whole Foundation snapshot (`compareSnapshots`, `foundationBaselineDigest` over `versionnumber`), so a production run would fail on the accepted GoVerify refresh and rollup moves. Replace, for the production target only, with open question 4's projection contract plus open question 7's rollup rule; `verifyClone` also fails on any regarding email, and a Draft email is expected (P5 expected-outcome note) — decide how verify names/tolerates it (owner decides on the first run). One Codex review.
   Evidence: production plan open questions 4, 7 and *MVP build list* item 5.
2. **MVP item 5, part 2 — first production run (owner runs every command).** `--target=production --reserve --recipe=basic --director=<sign-in>` then `--advance`, with `DATAVERSE_PROD_WRITE_ACK` inline; a fresh bundle export (≤ 6 h); local ledger container (Q2 CLI phase). Then the trimmed P5: snapshot/compare, one check about an hour after, owner's Audit History read. Then invite a synthetic reviewer on the clone to an allowlisted inbox.
   Evidence: plan P5 (trimmed) and *MVP build list*.

### Owner Decision Needed

1. **Integrity Screener Workbench tab** (`origin/codex/integrity-workbench-tab` at `b1086302b`, unmerged; migrations 056–057 unapplied, recheck numbering): review when the owner wants it.

### Parked

1. Slice 5a (`claude/factory-recipe5a`), deeper recipes (IA, reviews, Pre-Site, 5, 3), admin form (P7), P3 actor, readiness endpoint, dependency-builder parameterization, 24 h watch — deferred by the MVP cut; resume only on owner request.
2. Uploaded-review live pass, GoVerify bypass intermittent failure (sandbox-only), live-ledger flake — unchanged.
3. Seven late-2026 `expiresAt` test fixtures (earliest 2026-10-08) — `docs/CURRENT_WORK_QUEUE.md` *Audit follow-ups*.

### Verify Before Acting

1. **Isolation is live in production.** If staff report "could not be confirmed as an ordinary request" on a Request email, check marker reads first; rollback is removing `TEST_REQUEST_ISOLATION` and redeploying.
2. Sandbox residue (Requests 1000341–1000348) and local-ledger runs unchanged.

### Do Not Reopen Without New Decision

1. The MVP cut and its deferrals (owner, S546).
2. Program director = cloning admin; the email allowlist replaces D-R4/6d (owner, S546).
3. Accepted residual risks: slice-4 dispatch gap; Codex's round-2 vendor-create dissent; post-cap first-write gap (deferred to recipe 5).
4. GoVerify not bypassed in production; stub `wmkf_ai_run` stays.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` | Owner decisions, MVP build list, open questions 4/5/7 |
| `lib/services/test-requests/basic-clone-steps.js` | Targets, production create fields, `verifyClone` (item 5 target) |
| `lib/services/test-requests/production-write-fence.js` | Production write fence |
| `lib/services/test-requests/email-allowlist.js` | Recipient allowlist; enforced in `lib/services/dynamics/email.js` |
| `scripts/rehearse-test-request-sandbox.mjs` | CLI (`--target=production`, `--director`) |
| `scripts/probe-test-request-factory-production-readiness.js` | Owner-run probe (sections 1–9, `--meeting-date`, `--history`) |

## Testing

```bash
npx jest "tests/unit/(.*test-request|production-|docx-package|presite|pre-rp|source-bundle|seed-synthetic).*"
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-test-request-factory-production-readiness.js --director=jgallivan@wmkeck.org   # owner-run
```

---

## Prior Session 546 Prompt: Factory item 7 — owner accepts the production plan, then build P1–P4; review the Integrity branch

## Session 545 Summary — 2026-09-27 PT (Opus; recipe 5a built and parked, sandbox proofs stopped, production enablement planned and reviewed)

### What Was Completed

1. **Slice 5a built, then parked** on `claude/factory-recipe5a` (`3b86d7df4`, pushed, not merged, not reviewed). It builds `seed_abstract` and `render_pre_rp_brief` with complete sandbox dependencies, and `verify_presite` now advances when not last. It adds no `final_writeup` step order, and it edits migration 054 in place (two steps, three reason codes, a receipt key). The focused glob passed 57 suites / 1,656 tests (orchestrator re-run). It found that the Pre-RP brief needs a program director, which the clone does not copy.
2. **Owner decision: sandbox live proofs stop after recipe 4.** Item 7 (production enablement) comes next; recipes 5 and 3 are finished as production runs. Recorded in the design doc (*Slice 5a built, then PARKED*; *Item 7 owner decisions* Q1–Q5).
3. **Production enablement plan written and reviewed:** `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md`. It went through contract-reconcile (named changes applied), then Codex plan review with `gpt-5.6-sol`: round 1 four highs, round 2 three highs, round 3 two highs. Every finding was revised except one, recorded as a dissent beside the owner decision. The loop closed at the cap.
4. **Owner-run probe `scripts/probe-test-request-factory-production-readiness.js`** (GET-only; `--detail`, `--export-xaml`, `--history`) established:
   - production lacks the marker columns;
   - the production app user `53e97fb3-…` has **no System Administrator** role;
   - production create automation (8 workflows, 4 flows, 4 AkoyaGo plug-ins) differs from the sandbox's;
   - the **sandbox org has background processing disabled** (agent-wiki Dataverse note).
5. **The Foundation account's audit history** (owner-read) shows that a Foundation-applicant create triggers the GoVerify refresh (`akoya_goverifytrigger`, `akoya_dexempt`, `akoya_taxstatus`, `wmkf_bmf509`), plus a primary-contact copy by an update workflow. Nothing else changed.
6. **Owner decision: the evidence meets the design's "vendor create logic shown safe" rule** for a first production `basic` run under P5 (plan P0b).

### Commits (all on `main` unless noted)
- `3b86d7df4` slice 5a (branch `claude/factory-recipe5a`) · `aca4c07a0` decisions + draft plan · `5f4f439be` probe + sandbox census · `bdf4e54f4` wiki · `4acbf7448` production P0 · `efc399d33` automation characterized · `10e0c535e` contract-reconcile · `53d977686` / `47d213f36` / `ed25310de` Codex rounds 1–3 · `bada8e03a`, `4b9ec0220`, `52cbbfe94`, `870513946` P0b evidence and the evidence-bar decision.

## Next Items

### Owner Decision Needed

1. **Accept the production plan as reviewed**, or first run the default post-cap Codex check of the round-3 closures (S543 practice).
   Evidence: plan Status line; `ed25310de`.
2. **Confirm that staff set `wmkf_meetingdate` in AkoyaGO on real Requests.** It is the basic run's one post-create update; plan open question 5 marks it `[ASSUMED]`.
3. **Q2, the ledger database for the form phase.** Recorded as the local container for the CLI and the shared Postgres for the form; owner undecided.
4. **6d (reviewer email exception)**: not started.

### Verified Open (after acceptance)

1. **Build item 7 P1–P4** as slices with the S543/S544 process: target parameterization (Factory-built dependency seams, GoVerify bypass unreachable in production, stub AI run kept); the P2 exact-identity write fence at the three seams; P3 `REQUIRED` actor with the production app user plus the writer-gate edit; the P4 readiness endpoint. Then the P5 first `basic` run, with the owner running every production command.
   Evidence: plan phases P1–P5.
2. **Integrity Screener Workbench tab: review the Codex branch** `origin/codex/integrity-workbench-tab` at `b1086302b`, not merged. Migrations 056–057 are unapplied; recheck numbering.

### Parked

1. **Slice 5a** (`claude/factory-recipe5a`): its steps are the starting point for production recipe 5. Re-open trigger: the recipe-5 slice after P5. Plan P6 decides whether its 054 edits land before 054's first shared apply or become 055.
2. **Uploaded-review live pass**, **GoVerify bypass intermittent failure** (sandbox-only now), **live-ledger flake**: unchanged from S544.

### Verify Before Acting

1. Sandbox residue from Requests 1000341–1000348 and local ledger runs (unchanged). The local ledger's 054 lacks 5a's steps; re-apply it before any 5a step runs.
2. **Production schema:** wave29 and wave30 are absent in production [VERIFIED P0 2026-09-27]. The production order is apply, set the switches, redeploy, confirm the readiness endpoint, then run.

### Do Not Reopen Without New Decision

1. Sandbox live proofs stop after recipe 4 (owner, S545).
2. GoVerify is not bypassed in production; its Foundation-account refresh is accepted (Q3; plan open question 4 transition contract).
3. The stub `wmkf_ai_run` stays, in production too (`assertOwnedStubAiRun`).
4. The evidence meets the vendor-create rule for a first basic run (owner, S545). Codex's dissent is recorded and not reopened.
5. Program director: in production it is copied by GUID; the sandbox reserve-flag idea is moot.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` | Item 7 plan, evidence, decisions, open questions |
| `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Parent design; *Item 7 owner decisions*; 5a parking record |
| `scripts/probe-test-request-factory-production-readiness.js` | Owner-run production probe (`--detail`, `--export-xaml=<dir>`, `--history[=N]`) |
| `lib/services/test-requests/basic-clone-steps.js` | `CREATE_FIELDS`, `foundationBaselineDigest`, GoVerify bypass |
| `lib/services/test-requests/run-runner.js` | Step bodies; `stepFenceSource`; `assertOwnedStubAiRun` |

## Testing

```bash
npx jest "tests/unit/(.*test-request|docx-package|presite|pre-rp|source-bundle|seed-synthetic).*"
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-test-request-factory-production-readiness.js --director=<sign-in> [--detail] [--history=10]   # owner-run only
```

---

## Prior Session 545 Prompt: Factory recipe 5 (Pre-RP brief, site-visit start, Final Writeup), then recipe 3; review the Integrity branch

## Session 544 Summary — 2026-09-26/27 PT (Opus; reviewer-address defaults, recipes 3–5 plan, recipe 4 built and live-proven)

### What Was Completed

1. **Reviewer addresses are never minted** (PR #343, `9b6fea389`): a local-only `TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS` base inbox is plus-tagged per source reviewer when no `--reviewer-address` flag is given (flag wins). Live-checked on sandbox Request 1000346.
2. **Recipes 3–5 planned**: owner decisions P1–P6 and invariant classes I1–I10 (design doc *Recipes 3–5 plan*), two Codex plan reviews. Order: 4 → 5 → 3. Recipe 4 copies 1003222's Pre-Site draft verbatim over a stub `wmkf_ai_run`; the sandbox app user is the Final Writeup actor; the abstract is seeded in recipe 5; consultant feedback dropped; materials collection is production-phase only.
3. **Recipe 4 (`pre_site_visit`) built in three slices, each reviewed**: 4a (PR #344), 4b (PR #345: the four Pre-Site steps, sandbox deps, ledger dimension), 4c (PR #346: PI and Co-PI names from bundle v4, `TEST · ` prefixed in the sandbox loader; owner accepted that copied draft prose keeps the source names verbatim).
4. **GoVerify bypass diagnostics** (PR #347, `d0c0b90d1`): the deactivation error now reaches the manual-recheck reason, ledger failure text and sidecar; the existing test had passed on a TypeError (mocked `patch`, code calls `patchWithOptions`). Runs `a1dd008d…`/`99c92d35…` failed the bypass for an unknown cause; it did not recur.
5. **Recipe 4 live-proven** (PR #348, `f678b1d60`): run `a410efe2…` → sandbox Request 1000348 reached `ready`. The Pre-Site v6 template carries another library's SharePoint customXml, which SharePoint rewrites in place on upload (item1 schema, item3 properties, itemProps1). `validateSharePointRewrite` accepts that for the render baseline only; Codex round 1 needs-attention (narrowed: observed roots only, itemProps paired with its schema item, bytes counted; failure detail sanitized and bounded), round 2 approve.
6. **Integrity Screener Workbench tab handed to Codex** (owner request; branch `codex/integrity-workbench-tab`), logged in main's docs (`6c4546afc`).

### Commits (all on `main` via merged PRs)
- PR #343 (reviewer default address) · #344 (4a) · #345 (4b) · #346 (4c) · #347 `d0c0b90d1` (bypass diagnostics) · #348 `f678b1d60` (promotion re-promotion rule, first `ready` run).

## Next Items

### Verified Open

1. **Recipe 5 — Pre-RP brief, site-visit start, Final Writeup (next build).** Plan and owner decisions: design doc *Recipes 3–5 plan* (P3 sandbox app user as Final Writeup actor, P4 abstract seeded here). Build as slices with the S543/S544 process: invariant table and orchestrator mutation checks before any review, Codex capped at three rounds per slice, weigh findings as safety vs fidelity (`feedback-factory-safe-not-full-fidelity`).
   Evidence: design doc; `RECIPE_STEP_ORDER` in `lib/services/test-requests/run-runner.js` has no recipe-5 entry yet.
2. **Recipe 3 — site-visit materials (files only in the sandbox)**, after recipe 5.
3. **Integrity Screener Workbench tab — review the Codex branch.** `origin/codex/integrity-workbench-tab` at `b1086302b`, not merged [VERIFIED `git merge-base`, 2026-09-27]. Next: Claude's read-only review → owner merge/release decision → the open Dataverse flag design. Migrations 056–057 unapplied; recheck numbering first.
   Evidence: the branch's `docs/plans/INTEGRITY_WORKBENCH_TAB_BUILD_BRIEF_2026-09-26.md` (read with `git show`).
4. **Item 7** (admin form, resume/retire, first shared apply of migration 054 and wave30 to production, production release). Carried requirement: deterministic reservation identity per actor + idempotency key.

### Owner Decision Needed

1. **6d (reviewer email exception)**: own slice, own plan review; not started.

### Parked

1. **Uploaded-review branch live pass** — re-open on the first clone of a source Request with an uploaded review (owner: no hand uploads to force it).
2. **GoVerify bypass intermittent failure** (runs `a1dd008d…`, `99c92d35…`): the PATCH never committed (workflow `modifiedon` unchanged). Re-open trigger: the next occurrence, whose sidecar will now name the error.
3. **Live-ledger suite flake** (unchanged from S543): re-open on a recurrence with a captured test name.

### Verify Before Acting

1. **Sandbox residue**: Requests 1000341–1000348 (IA rows, synthetic reviewers, suggestions, answers; the 1000347/1000348 stub AI runs and Pre-Site rows). Local ledger runs: `a410efe2…` ready; `126881bc…` (PI refusal, pre-4c), `a1dd008d…`, `99c92d35…` (bypass unverified) parked needs_attention [VERIFIED ledger query 2026-09-27]. First candidates for item 7's retire path; nothing to clean now.
2. **Scratch database `ledger_test`** was created in `wmkf-ledger-pg` for the integration suites (`TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger_test`); never point those suites at `ledger`, which holds the real runs.

### Do Not Reopen Without New Decision

1. Recipe 4 draft names copied verbatim (owner accepted limit, 4c review).
2. Share-click Postgres issue on the clone is not a prerequisite (owner: esoteric).
3. Stub `wmkf_ai_run` stays (owner: safe, not full fidelity).
4. Migration 054 edited in place until item 7; wave30 production apply is item 7's.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Design, recipes 3–5 plan, every slice/review/live record |
| `lib/services/test-requests/run-runner.js` | Recipe step order and step bodies (4b: `seed_presite_ai_run` … `verify_presite`) |
| `lib/services/test-requests/presite-sandbox-deps.js` | Sandbox-bound Pre-Site deps, `TEST · ` personnel synthesis |
| `lib/services/test-requests/docx-package-attestation.js` | Promotion attestor incl. `validateSharePointRewrite` (render only) |
| `lib/services/test-requests/basic-clone-steps.js` | `createRequestWithGoverifyBypass` (now keeps `deactivationError`) |
| `scripts/rehearse-test-request-sandbox.mjs`, `scripts/export-test-request-source-bundle.mjs` | Reserve/advance/inspect; bundle export (`--with-pre-site`, owner runs prod exports) |

## Testing

```bash
npx jest "tests/unit/(.*test-request|docx-package|presite|source-bundle|seed-synthetic).*"
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger_test npx jest tests/integration/test-request-run-runner   # scratch DB, not `ledger`
```

Live runs: run the rehearsal CLI from a checkout of the code under test, with the allow-rule prefix (`project-sandbox-rehearsal-bypass-allow-rule`); `--bypass-goverify` on the advance that reaches `create_request`.

---

## Prior Session 544 Prompt: Factory item 6 recipes 3–5 (plan one paragraph, one Codex plan review), then item 7

## Session 543 Summary — 2026-09-25/26 PT (Fable; slices 6c-i and 6c-ii built, reviewed, merged, live-proven)

### What Was Completed

1. **Slice 6c-i merged (PR #337, `39f641bac`)**: reviews recipe token, ledger reviewer assignments (migration 054 edited in place, unapplied everywhere), operation-scoped marker-write opt-out with WHATWG-canonical target checks on both guards.
2. **Slice 6c-ii built, reviewed, merged (PR #341, `f54f5d5cf`)**: bundle v3 exporter (`--with-reviewers`, `--source-marker-column`), synthetic-person isolation behind `SYNTHETIC_REVIEWER_ISOLATION=on`, the seeder (`seed_reviewers`, `copy_review_file`, `seed_review_answers`), `docx-package-attestation.js`, `verify_reviews`. Review history: Opus per stage, Fable invariant checks and mutations before each Opus round (new process, memory `feedback-orchestrator-checks-builds-before-review`), three Codex adversarial rounds (nine findings, all closed), then an owner-directed Codex review of the Fable-authored closures (four rounds: customXml shapes characterized from the live promoted IA files read back from the sandbox, comments/PIs/DOCTYPE refused, every normalized part under a byte ceiling and a shape, a closed customXml graph, the person row re-asserted on every resume, BOM-aware XML decoding) ending in **approve, no material findings**.
3. **Live proof (PR #342, `df733dbc6`)**: owner applied wave30 to the sandbox; sandbox Request 1000343 reached `ready` through all eighteen steps of the `reviews` recipe from production Request 1003222 (D-R5 read scope; its three reviewers are the owner's throwaway inboxes, passed through as the `--reviewer-address` flags). Two live-only facts fixed: Dataverse derives a potential reviewer's primary name from first/last on create AND update (the `TEST · ` prefix now lives in `wmkf_firstname`; `isSyntheticNameDerived` checks the derived name; agent-wiki fact corrected), and `wmkf_externaltokenrevoked` defaults to `false` so only `true` is a live value there. Gitleaks config allow-lists the ledger digest lines in the Factory's run-inspection evidence files.
4. **UI worktree (Opus, parallel)**: PRs #338/#339 merged; see the Session 543-UI block below (its open items stand).

### Commits (all on `main` via merged PRs)
- `39f641bac` PR #337 (6c-i) · `f54f5d5cf` PR #341 (6c-ii) · `df733dbc6` PR #342 (live-proof fixes, evidence, wiki correction, Gitleaks allowlist).

## Next Items

### Verified Open

1. **Item 6, recipes 3–5 — PLANNED 2026-09-26 (S544); build next, in the order recipe 4 (Pre-Site) → 5 (Pre-RP brief, site-visit start, Final Writeup) → 3 (site-visit materials, files only in the sandbox).** Plan, owner decisions P1–P6, invariant classes I1–I10, contract-reconcile pass and two Codex plan reviews (the second at the owner's request; provenance kept by owner decision): design doc *Recipes 3–5 plan*. Start with its read-only Step 0 schema probe in the sandbox.
   Evidence: design doc *Recipes 3–5 plan*.
   Process for the slices: the S543 process (invariant table + mutations checked by the orchestrator before any Opus round; Codex capped at three rounds per slice). Weigh review findings as safety versus fidelity (memory `feedback-factory-safe-not-full-fidelity`).
2. **Item 7** (admin form, resume/retire, first shared apply of migration 054 and of wave30 to production, production release). Requirement carried: deterministic reservation identity per actor + idempotency key so retries reach the ledger's assignment comparison.
   Evidence: design doc slice 6c-i record (Codex round 1 declined finding 1).
3. **Integrity Screener Workbench tab + PD approval — Codex branch, awaiting review and release (handed over 2026-09-27).**
   `codex/integrity-workbench-tab` at `b1086302b`: built, not merged or deployed. Migrations 056–057 are unapplied; recheck numbering against `codex/feature-request`'s 055 before release.
   - **Next, in order:**
     1. Claude's read-only review of the branch.
     2. The owner's merge and release decision.
     3. The open Dataverse flag design: **Integrity review complete** means a complete screen plus PD approval for the current roster. The design needs invalidation for replacement screens, holds and roster changes (including edits outside our apps), plus durable sync retries. Sandbox metadata is still unchecked.
   - **Deferred:** the board-readiness gate, until the staff recommendation/readiness workflow exists.
   Evidence: the branch's `docs/plans/INTEGRITY_WORKBENCH_TAB_BUILD_BRIEF_2026-09-26.md` and `docs/plans/INTEGRITY_DATAVERSE_FLAG_INVESTIGATION_2026-09-26.md` (read with `git show origin/codex/integrity-workbench-tab:<path>`); queue entry in `docs/CURRENT_WORK_QUEUE.md` (Owner-requested product follow-ups).

### Owner Decision Needed

1. **DECIDED 2026-09-26 (S544) — reviewer addresses are never minted.** The owner supplies a default base inbox in the local-only `TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS`; a reviewer with no `--reviewer-address` flag and no synthetic bundle address gets the base plus-tagged per source reviewer (`defaultReviewerAddressFor`). Merged (PR #343, `9b6fea389`) and live-checked: sandbox Request 1000346 `ready`, reuse confirmed (`docs/plans/evidence/test-request-factory/default-reviewer-address-live-check-2026-09-26.md`). New residue: 1000346 and three plus-tagged persons; local-ledger runs `ddc0b4f9…` (prepared) and `be486c6d…`/`fe84d2fb…` (needs_attention, advanced without `--bypass-goverify`).
   Evidence: design doc 6c-ii record, closing note; `scripts/rehearse-test-request-sandbox.mjs` `resolveReviewerAssignments`.
2. **6d (reviewer email exception)**: own slice, own plan review; not started.

### Parked

1. **Uploaded-review branch live pass** (`copy_review_file`, DOCX attestation, `Reviewer_Uploads` census). Unit-proven; 1003222's reviews were form submissions. Re-open trigger: the first clone of a source Request with an uploaded review. Owner direction 2026-09-26: nobody uploads anything by hand to force it.
   Evidence: `docs/plans/evidence/test-request-factory/reviews-recipe-live-proof-2026-09-26.md`.
2. **Live-ledger suite flake**: `tests/integration/test-request-run-ledger.pg.test.js` failed once in two of ~20 local runs when both live suites shared one container in parallel workers; 10/10 green in a capture loop, test name never captured; CI runs both files in one invocation. Re-open trigger: a recurrence with a captured test name.

### Verify Before Acting

1. **Sandbox residue from the proofs**: Requests 1000341–1000343 with their Initial Assessments, three marker-true synthetic persons (addresses = the owner's throwaway inboxes), suggestions and 22 answer rows. Nothing to clean now; if item 7's retire path is built, these are its first candidates.
   Preflight: `--run-inspect` on runs `f8aae6aa…` and `83c5da2e…` in the local ledger container `wmkf-ledger-pg` (`TEST_REQUEST_LEDGER_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger`).

### Do Not Reopen Without New Decision

1. Migration 054 edited in place until item 7 (owner, 2026-09-24). Wave30 applied to the sandbox only (owner, 2026-09-26); production apply is item 7's.
2. `SYNTHETIC_REVIEWER_ISOLATION` unset = off; order in any environment is wave30 → switch → seeder.
3. Codex per-slice cap of three adversarial rounds; Fable closes the loop after the cap and the owner accepts the self-reviewed closures (accepted for 6b and 6c-ii) — but an owner-directed Codex pass over Fable-authored closures found seven more real findings in 6c-ii, so offer that pass by default at the end of a slice.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Design, decisions D-R1–D-R6, every stage and review record |
| `lib/services/test-requests/run-runner.js` | Recipes, steps, `verify_reviews`, person-ownership invariant |
| `lib/services/reviewer-engagement/seed-synthetic-review.js` | Synthetic projection (`TEST · ` in first name), completion write, allowlists |
| `lib/services/test-requests/docx-package-attestation.js` | One promotion attestor: shapes, ceilings, closed customXml graph |
| `lib/services/test-requests/review-file-copy.js` | Review-file policy (10 reviewers × 5 files under the 100-file census) |
| `scripts/rehearse-test-request-sandbox.mjs`, `scripts/export-test-request-source-bundle.mjs` | Reserve / advance / inspect; bundle export with reviewers |
| `lib/dataverse/schema/wave30-synthetic-reviewer-marker/` | The marker column wave (sandbox-applied) |
| `docs/plans/evidence/test-request-factory/reviews-recipe-live-proof-2026-09-26.md` | Live proof record, stops, residue |

## Testing

```bash
npx jest "tests/unit/(.*test-request|docx-package|seed-synthetic|source-bundle|reviews-sandbox|graph-).*"
TEST_REQUEST_LEDGER_TEST_URL=postgres://postgres:ledger@127.0.0.1:5433/ledger TEST_REQUEST_LEDGER_REQUIRE=1 npx jest "tests/integration/.*\.pg\.test\.js"   # container wmkf-ledger-pg (Colima)
```

---

# Session 543-UI Prompt: owner check of the Research Presentation Materials card (worktree `claude/ui-work`)

> **Where things live.** This handoff is on branch `claude/ui-work` in the worktree
> `/Users/gallivan/Code/WMKF_Apps-ui`. **The Test Request Factory work (synthetic reviewers, 6c-ii)
> is merged to `main` as of 2026-09-26 (PRs #341, #342); the main checkout is back on `main`.**
> Its handoff is the "Session 544 Prompt" above. Do not switch this worktree to
> `main` or pull `main` into it. Keep the Factory-owned files untouched: `lib/services/test-requests/`,
> `lib/services/reviewer-engagement/`, the potential-reviewer and reviewer-suggestion adapters,
> `reviewer-merge.js`, the two test-request scripts, migration 054, and the Factory design doc.

## Session 543-UI Summary — 2026-09-25 PT (Opus; parallel UI worktree)

[VERIFIED via commits on `claude/ui-work`, full Jest run, and gates run in this worktree]

### What Was Completed

1. **Research Presentation Materials card** on the Workbench Staff Deliberations tab
   (`shared/components/workbench/ResearchPresentationMaterialsCard.js`). It is always shown: once the
   brief is shared it sits between the Briefing page link card and Email history (owner request after
   the local check; `PreSiteDistributionPanel` `beforeHistory` slot); before that it follows the writeup cards. Its status line reads: Presentation not scheduled /
   Presentation scheduled · materials not requested / requested / ready. A closed collection reads
   "materials request closed"; a failed read reads "could not be loaded". Rows for Slides and
   Participant bios link to every file in the request's `Site Visit - Slides` /
   `Site Visit - Participant Bios` folders, or say "Not received yet".
2. **Interim folder read.** `GET /api/workbench/site-visit/material-files` (`reviewers`) calls
   `lib/services/site-visit-materials/folder-files-service.js`. The owner needs files that staff put in
   those folders by hand through AkoyaGo (Request 1002903) to show while the upload portal is in
   testing; those files have no `wmkf_requestdocument` row. Contract and retirement trigger:
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.13. Security matrix row, `CANONICAL_COUNTS`
   (route files 227, requireAppAccess endpoints 141), and a service catalog entry were added.
3. **`useSiteVisitContext`** now settles a failed logistics read as `{ unavailable: true }` instead of
   staying `null`. A recipient-directory failure alone keeps the visit.
4. **Owner answers this session:** there is no "awaiting confirmation" status (all received but
   unconfirmed reads "requested"); there are no counters for the folder fallback; the one-line
   fact-consistency fix in the Factory doc is left to the Factory session.
5. **Verification:** full Jest suite 1,104 suites / 16,553 tests passed; new suites for the service
   (5 tests), the card (13), and hook directory-failure cases; one mutation killed (directory
   coupling). Every gate is green; `check:fact-consistency` went red on the new route count until the
   Factory session added the historical marker (`e7480e7bf`). The owner then checked the card in local dev
   (production reads) on Request 1002903.

### Commits (`claude/ui-work`, pushed)
- `3c8e06915` — Add Research Presentation Materials card to Staff Deliberations
- `4e79ba433` — Keep the Site Visit when only the recipient directory fails
- `5acff7af4` — Place the Research Presentation Materials card above Email history
- `98cc433ad` — merge of PR #338 (production `dpl_HCSqQTQartDj6QujF8j5RC3LFFzk`)
- `b7e52f3ac` / `5f2d9a05d` — release docs and milestone entry; merge of PR #339

## Next Items (UI worktree)

### Verified Open

1. **DONE — owner check on Request 1002903** (local dev, 2026-09-25): both rows linked the files; the
   card was then moved above Email history at the owner's request. For another request: if a row
   reads "Not received yet" despite files in AkoyaGo, the folder name or location differs from
   `Site Visit - Slides` / `Site Visit - Participant Bios` under the active `akoya_request` folder.
   Check that before changing code.
2. **DONE — promotion.** PR #338 merged `98cc433ad`; production `dpl_HCSqQTQartDj6QujF8j5RC3LFFzk` was
   verified as the merge build. The release docs merged via PR #339 (`5f2d9a05d`).
3. **DONE — `check:fact-consistency`.** The Factory session marked the Stage 1d record historical
   (`e7480e7bf`); the gate and its self-test pass on `main` (route files 227).

### Owner Decision Needed

1. Whether to move the header's "Materials: N of 3 received · due …" line into the new card. It stays
   in the header for now (not confirmed), so once a collection exists the two partly repeat each other.
2. Placement relative to Codex's post-visit "Research presentation follow-up" section (Codex plan
   `docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md` §4.2, Slice 5, on
   `codex/feature-request`). The two should be placed together.

### Verify Before Acting

1. **Merge overlap with Codex Slice 5.** Codex will wire `useSiteVisitContext` and add a section to
   `StaffDeliberationsTab.js`, and already edits `lib/services/site-visit/logistics-service.js` and
   `pages/api/workbench/site-visit/logistics.js` (this branch does not). This branch changed
   the hook's failure settle (`{ unavailable: true }`, directory decoupled), mounted the card in the
   tab, and added a `beforeHistory` slot to `PreSiteDistributionPanel.js`. Whoever merges second reconciles those two files.
2. **Residual risk (§16.13):** the Workbench materials summary is fail-open `null`, so a failed summary
   read shows "materials not requested" for a scheduled presentation.
3. **Agent wiki:** the write hook flagged `docs/agent-wiki/topics/security-auth.md` for the new route. It
   was deliberately not updated (interim read-only route; `check:agent-wiki` green). Revisit if the
   route outlives this cycle.

## Key Files Reference (UI worktree)

| File | Purpose |
|---|---|
| `shared/components/workbench/ResearchPresentationMaterialsCard.js` | Card, status mapping, file rows |
| `lib/services/site-visit-materials/folder-files-service.js` | Interim folder listing |
| `pages/api/workbench/site-visit/material-files.js` | Thin route shell |
| `shared/components/workbench/useSiteVisitContext.js` | Site Visit read with `unavailable` settle |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.13 | Contract, residual risk, retirement trigger |

## Stop-time notes (UI worktree)

- Claim-evidence pilot: no eligible edit recorded for this session; no observation row.
- Milestone: `DEVELOPMENT_LOG.md` entry added after the PR #338 production deploy.
- `CLAUDE.md`: no change (the route is catalogued in the matrix and service catalog).

---

## Prior prompt (main checkout's Session 543 prompt, unchanged)

# Session 543 Prompt: Factory follow-ups, item 6 next recipe, and the two Codex-led threads

## Owner brief: where the Test Request Factory stands (written 2026-09-24 PT, end of Session 542)

**What it is for.** A way to manufacture realistic, disposable test Requests so staff workflows (Workbench, Meeting Tracker, reviewer portal, presentation materials, and later the whole cycle) can be exercised without touching a real applicant. The design lives in `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`; its build order is seven items.

**What is built and proven (items 1–6a, and the first recipe of item 6).** A read-only production export of a source Request bundle (Request 1003222); a sandbox clone of that bundle with copied files (the Basic recipe); a durable Postgres run ledger with journal-before-dispatch resource receipts and a bounded, resumable runner driven from one CLI (`--reserve`, `--advance`, `--run-inspect`); a recipe dimension; and the first later-stage recipe, `initial_assessment`, which seeds a synthetic Initial Assessment and its Board snapshot through the unmodified production lineage functions and verifies the result against real Dataverse and Graph. Live proof: sandbox Request 1000342 reached `ready` on 2026-09-24.

**What shipped today.** PR #336 merged to `main` (`b63803951`) and deployed (`dpl_F3XxWLs9Kcg8feoXVgzbkmcpHdfJ`, owning `applications.wmkeck.org`). It ships runner, CLI, recipe, ledger code and the fresh-install mirror. Migration 054 is on `main` but **unapplied**; nothing applies on deploy. Nothing in production data changed.

**What remains.** Item 6's other recipes, one at a time: synthetic reviewers and reviews, site-visit materials and transcripts, Pre-Site seed and render, Pre-RP brief / site-visit start / Final Writeup. Then item 7: the admin creation form, resume/retire operations, the first shared apply of migration 054, and the production release. Each recipe is its own slice with the same cadence (Sonnet builds, Opus reviews, Codex adversarial, Fable final, live proof, owner acceptance).

**Decisions you made today that now bind the design.** Recompute the synthetic fixture's hash in verify (independent anchor); no lease renewal, but a 900 s lease for the IA recipe; attest the whole DOCX package against the fresh render with only SharePoint's property-promotion mutations normalized (in place of a raw byte digest, which SharePoint makes impossible); Fable's self-review accepted for the post-cap code; 6b accepted; merged.

## Session 542 Summary — 2026-09-24 PT (Fable; Codex adversarial rounds 1–3; owner decisions; live proof; promotion)

[VERIFIED via commits on `main`, PR #336 checks, Vercel deployment inspection, sandbox run receipts under `docs/plans/evidence/test-request-factory/`] Slice 6b closed end to end and promoted. Codex on the presentation branch was set up separately and moved on its own (`ebaca0094`).

### What Was Completed

1. **Stage C Opus round 3 (tests only)** closed by Fable: isolating tests for the twin-read eTag arm, versionId arm, both hash arms; validator-shaped verify fixture; Fable final review of Stage C.
2. **Codex adversarial rounds 1–3** (`gpt-5.6-sol`), eight findings, all closed on the branch: Ready-row recovery journals the full receipt and proves ownership by claim-token digest on every resolved row and the post-create reread (F1, F5, F7); null path read stops instead of re-uploading (F2); verify anchors row hashes/versions to the step receipts, mandatory (F3); fresh-render hash anchor (owner); 900 s IA lease (owner, F4); package attestation (F6, reshaped live); fresh-install receipt mirror (F8). 28 mutations killed across the day.
3. **Live proof.** Run 1 stopped at `create_request`: the GoVerify deactivation PATCH outran the 15 s bypass bound (server committed ~8 s in); no Request created; the sandbox workflow was re-activated by a one-off PATCH from a scratchpad probe (activation 9.0 s) and the bound raised to 60 s. Run 2: sandbox Request 1000342 through all eleven steps; the first verify attempt exposed SharePoint property promotion (customXml items/props/rels, core.xml, custom.xml, content types, document rels, trash entries; every `word/` part byte-identical), replaced the raw digest with `lib/services/test-requests/docx-package-attestation.js`, re-advanced to `ready`.
4. **Promotion.** PR #336; one CI fix round (email-guard fixture against PR #335's mandatory recipients; hostname checks for eleven CodeQL substring warnings); merged `b63803951`; production deployment verified as the build of `main`'s head.
5. **Codex presentation branch** set up on `codex/feature-request` (worktree under `~/.codex/worktrees/feature-request`) with a Chrome recovery-pass brief; Codex has since pushed `ebaca0094`. PR #332 (personal reviewer reminders) untouched, still open.
6. **Memory:** `project-sharepoint-property-promotion-rewrites-docx.md` (router line under Dataverse/Dynamics).

### Commits (main)
- `b63803951` — merge of PR #336 (branch commits `aa87c3c1d` … `4c5539ee7`)
- `18a2c94e6` — SharePoint property-promotion memory
- `d26382155` — merge and deployment recorded in the design doc

## Next Items

### Verified Open

1. **Item 6, next recipe: synthetic reviewers and reviews.** Evidence: design doc build order line "IA → synthetic reviewers and reviews → …"; owner decisions 3–4 (synthetic reviewers seeded 1:1, real staff-controlled throwaway inboxes). Plan-first with `/contract-reconcile`, then the slice cadence. Unplanned; nothing built.
2. **Small Factory follow-ups found by the live proof** (any one can be a first task): the seed step's final resource outcome is `dispatched` while every sibling is `verified` (`ia-recipe-live-proof-run-inspect-2026-09-24.json`); the GoVerify stop's run reason collapses to `unknown_error` although the resource error is `goverify_deactivation_uncertain`; "manually recheck the workflow" has no CLI affordance (a read-plus-restore mode or a runbook line).
3. **Codex-led threads.** PR #332 was `CONFLICTING` with `main` at session start and is Codex's to resolve; the presentation branch's Slice 0 Chrome pass is in progress under Codex (`ebaca0094`). Read their handoffs before touching either.

### Owner Decision Needed

1. Whether the three older deployment-hash Entra callbacks (`g0buiqhuh`, `7doz4qxsn`, `15rny26o5`) should also go (carried).
2. Carried: Preview CSRF origin allowlist (option b) still goes through `/contract-reconcile`.

### Parked

1. Migration 054's first shared apply: at item 7 (freezes the file). Evidence: design doc item 7 and the `main` merge record.

### Verify Before Acting

1. **Sandbox residue:** Request 1000342 with its Initial Assessment and Board snapshot files; two inactive GoVerify activation children (one predates this session); the workflow itself is active. Cleanup is data-mining scope only (`project-test-residue-cleanup-is-for-data-mining.md`), not a task.
2. **Worktrees:** `/Users/gallivan/Code/WMKF_Apps-factory` still checked out on the merged branch `codex/test-request-preview-integration` (park or remove; nothing unpushed). The Codex-app worktree for that branch under `~/.codex/worktrees` was removed this session. Local ledger container `wmkf-ledger-pg` holds runs `81800b62…` (needs_attention) and `f8aae6aa…` (ready).
3. **Production reads need the owner's shell.** The auto-mode classifier blocks `DATAVERSE_ALLOW_PROD_READS=yes` exports even when authorized; the owner ran today's export with the `!` prefix. A machine-local allow rule for the exact export command would remove that step.

### Do Not Reopen Without New Decision

1. 6b design decisions (Stage A–C paragraphs) plus today's: fresh-render hash anchor; no lease renewal with a 900 s IA lease; package attestation normalizing only SharePoint property promotion (customXml items recognized by root element only; a tenant change fails closed); `bytesSha256` journaled as evidence only; 054 edited in place, no forward migration.
2. Earlier: 6a design, sandbox parity deviations, no-text invariant, dispatch-marker rule, synthetic IA fixtures only.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Design, build order, every stage and review record |
| `docs/plans/evidence/test-request-factory/ia-recipe-live-proof-2026-09-24.md` | Live proof narrative, receipts, residue |
| `lib/services/test-requests/run-runner.js` | Runner and all recipe steps |
| `lib/services/test-requests/docx-package-attestation.js` | SharePoint-normalized package attestation |
| `lib/services/test-requests/run-ledger.js`, `lib/db/migrations/054_test_request_runs.sql` | Ledger and its unapplied migration |
| `scripts/rehearse-test-request-sandbox.mjs`, `scripts/export-test-request-source-bundle.mjs` | CLI and production bundle export |

## Stop-time notes

- Claim-evidence pilot: no eligible edit recorded for this session; no observation row.
- Milestone: `DEVELOPMENT_LOG.md` entry added (Test Request Factory promoted to production).
- `CLAUDE.md`: no change (no new app, endpoint, schema apply, or convention; scripts are catalogued elsewhere).

## Prior Session 542 Prompt: Finish slice 6b review (Opus round 2, Fable final, Codex), then the live IA proof

## Session 539 Summary — 2026-09-24 PT (Fable orchestrating; Sonnet builds, Opus reviews, Codex adversarial and rescue; ran concurrently with Sessions 540–541 on other branches)

[VERIFIED via merged PRs, Vercel production deployment, pushed Factory-branch commits, Opus review hand-backs, focused and full Jest runs, gates] Three PRs merged and deployed to production; the two stale Entra redirect URIs removed; slice 6a accepted; slice 6b Stages A and B built, Opus-approved, Fable-reviewed and recorded; Stage C built, through Opus round 1 with its fixes committed, and Opus round 2 returned **needs-changes, tests only** (code correct; two isolating tests missing) just as the session stopped. No Codex review of 6b yet, no live sandbox run, no production write. The Factory branch `codex/test-request-preview-integration` is at `bb625e842` (pushed).

### What Was Completed

1. **Merged and deployed to production**: PR #329 (`1a0530546`, personal email defaults inventory, docs), PR #330 (`185c9f35f`, grantee invite subject default + up to 10 Cc), PR #331 (`e5db13750`, sandbox schema parity). #331 first got a Codex adversarial round (two findings), a Codex-rescue fix reviewed by Claude with mutation checks (`7e360ffd7`: the two parity waves are now mechanically refused for `--target=prod --execute`; name-only global option-set reuse recorded as a documented limitation), and green CI. Production deployment created after the merge and confirmed Ready on `applications.wmkeck.org`.
2. **Entra cleanup** (owner-authorized tenant write): removed the two redirect URIs for the retired `git-codex-pau-5b4bef` / `git-codex-wor-464bcd` aliases from "WMK: SSO Authentication"; seven remain, including three older deployment-hash callbacks that were outside the directive. Work-queue entry reconciled (`fb50dca63` on main).
3. **Slice 6a accepted** by the owner; recorded on the Factory branch (`906db4227`). Main merged into the Factory branch (`406420be7`).
4. **Slice 6b Stage A** (plan items 1–2): `2bf5904a9`, `10e0a5e4f`, `4919e2d37`, `e74225c94`, record `b2afbe919`. Opus round 1 needs-changes (P1 raw read shape, P2 positional deps arg, P2 test gaps), round 2 approve. Fable added a GUID guard on the sandbox `getRequest`.
5. **Slice 6b Stage B** (items 3–5): `646a1707e` … `09db93e30`, `06e34859b`, record `1499b0fdb`. Opus round 1 needs-changes (four P1: institution empty, SharePoint site/drive unbound, create re-dispatched after a marker, adapter recovery reading the production DAL plus shared `operational_events` residue; two P2), round 2 approve. Fable kept the access-layer gate unchanged, retained the create error cause, pinned the journaled-drive check.
6. **Slice 6b Stage C** (items 6–7): `936b5e008` … `57935a658`, round-2 fixes `46f4a9457`, `e96c7d6c6`, `91b02249b`, interim record `bb625e842`. Opus round 1 needs-changes (P1 census count always off by two on a real manifest; P1 CLI `--advance` never entered a trusted DAL context; P2 eight untested stop rules; P3s); all fixed with mutations killed. **Opus round 2 verdict (arrived at stop): needs-changes, tests only** — the eTag arm of the twin snapshot-metadata read lost its isolating test (V3 now survives because a later check catches the same eTag change), and each arm of the snapshot bytes-versus-row-hash check survives when disabled alone (V11a row hash, V11b source hash); P3: the verify fixture manifest is not fully validator-shaped (no `target`, `plannedFiles`, `expiresAt`, Graph ids, `exactlyOneCreate`). Opus confirmed the `+2` census cannot be satisfied by two wrong files (stable-id matching) and the script-scoped bypass cannot leak into `--reserve` / `--run-inspect`.
7. **Owner decisions this session**: bring-findings-first rule lifted for the 6b loops (agents fix inside the loop; disputed or design-changing findings come to the owner); three rounds per loop before Fable takes over; three stages; live proof authorized (production re-export of the 1003222 bundle and one sandbox create, Fable runs it).

### Commits (main)
- `fb50dca63` — record removal of the two stale Codex-alias Entra redirect URIs
- `1a0530546`, `185c9f35f`, `e5db13750` — merges of PRs #329, #330, #331

## Next Items

### Verified Open

1. **Close Opus round 2 on Stage C (tests only, round 3 of 3)**: add an isolating test for the eTag arm of the twin snapshot-metadata read (give every later read the same eTag so only that arm can fire, or assert the specific message), one test with `wmkf_contenthash` corrupted and `wmkf_sourcecontenthash` intact (and optionally the mirror), and optionally build the verify fixture with `buildCloneManifest` or assert `validateCloneManifest(..., { allowExpired: true })` on it. Re-run Opus's V3 / V11a / V11b mutations and confirm killed. Small enough for Fable to do directly rather than a Sonnet round. Then Fable final review of `1499b0fdb..HEAD` and update the Stage C paragraph in `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` from "pending" to the outcome.
   Evidence: Opus round-2 hand-back (recorded in the summary above); `git log 1499b0fdb..bb625e842` in `/Users/gallivan/Code/WMKF_Apps-factory`.
2. **Codex adversarial review of the whole slice 6b** (`b2afbe919^..HEAD` on the Factory branch; `--model gpt-5.6-sol`, run from the Factory worktree with `--base` scoping). Fable adjudicates; iterate until Codex is satisfied (cap 3, then Fable takes over). Author/reviewer rule: Sonnet/Claude-authored → Codex reviews; any Codex-rescue fix → Claude reviews.
3. **Live proof** (owner-authorized this session; re-confirm at start): re-export the 1003222 bundle (`DATAVERSE_ALLOW_PROD_READS=yes node --env-file=.env.local scripts/export-test-request-source-bundle.mjs --source-request-number=1003222 --out=<path outside the repo>`; six-hour window), `--reserve --recipe=initial_assessment`, then `--advance` through `ready` (the per-machine allow rule in `project-sandbox-rehearsal-bypass-allow-rule.md` covers `--bypass-goverify`). One new sandbox Request; evidence under `docs/plans/evidence/test-request-factory/`. Two things only the live run can verify: `requestDocumentSelect()`'s env-flag optional columns against the sandbox schema, and real Graph behavior. Then owner acceptance of 6b.
4. Remaining item 6 recipes (synthetic reviewers, site-visit materials, Pre-Site, Pre-RP/Final Writeup) and item 7 — separate slices, unplanned.

### Owner Decision Needed

1. Whether the three older deployment-hash Entra callbacks (`g0buiqhuh`, `7doz4qxsn`, `15rny26o5`) should also go. Evidence: `az ad app show` this session; not part of the directive, so left.
2. Carried: migration 054's first shared apply (needed at item 7; freezes the file). Preview CSRF origin allowlist (option b) still goes through `/contract-reconcile`; the runbook half landed in PR #327.

### Verify Before Acting

1. The Factory branch is 4+ commits behind main again (Sessions 540–541 landed PR #335 and docs on main). Merge main deliberately before the Codex round or the live run.
2. Worktrees: `/Users/gallivan/Code/WMKF_Apps-factory` (Factory, clean at `bb625e842`); `WMKF_Apps-codex` and `WMKF_Apps-presentation` belong to other sessions; `WMKF_Apps-parity-review` was removed. Local ledger container `wmkf-ledger-pg` is running (Colima).
3. Stage C's two live-path fixes (census `+2`, `enterDynamicsBypassForScript` in `runAdvance`) were unit-pinned but never exercised live; treat the first live `--advance` into `seed_initial_assessment` as the real test of the CLI wiring.

### Do Not Reopen Without New Decision

1. 6b design decisions recorded in the three Stage paragraphs: positional `dependencies` argument; `SANDBOX_REHEARSAL` actor policy substituted at the sandbox transport; a stopped run leaves its row Generating; resource planned on the first snapshot create; shared `registryPatchAttemptedAt`; census depth 3; `restoreFileVersion` not forwarded.
2. Earlier: 6a design, sandbox parity deviations, no-text invariant, dispatch-marker rule, no lease renewal, in-place edits to unapplied 054, synthetic IA fixtures only.

## Key Files Reference

- Design doc (item 6 plan, Stage A/B/C records): `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (Factory branch)
- IA steps: `lib/services/test-requests/run-runner.js` (`stepSeedInitialAssessment`, `stepSeedInitialAssessmentSnapshot`, `stepVerifyInitialAssessment`), `lib/services/test-requests/ia-sandbox-deps.js`, `lib/services/test-requests/fixtures/initial-assessment-synthetic.js`
- Production-path seams: `lib/services/initial-assessment/artifact-lineage.js`, `artifact-reader.js`, `lib/services/dynamics/changeset.js`, `lib/services/dynamics/write-core.js`, `lib/dataverse/adapters/request-document.js`, `lib/services/request-document-actor-service.js`
- CLI: `scripts/rehearse-test-request-sandbox.mjs`
- Tests: `tests/unit/test-request-run-runner-{seed-initial-assessment,seed-initial-assessment-snapshot,verify-initial-assessment}.test.js`, `tests/unit/ia-sandbox-deps.test.js`, `tests/unit/initial-assessment-lineage-dependencies.test.js`, `tests/integration/test-request-run-runner.pg.test.js`

## Stop-time notes

- Claim-evidence pilot: no eligible plan/design edit for this session key; no observation row.
- Memory: added `feedback-fixtures-return-raw-transport-shape.md` (router line under Test teeth). Sessions 540–541 wrote their own handoffs above this one's predecessor; this session's number stays 539.
- Milestone: `DEVELOPMENT_LOG.md` entry not required (PRs #329–#331 are incremental; 6b is unmerged and unproven live).
- `CLAUDE.md`: no change needed.

## Prior Session 541 Prompt: Check active workstreams after the Site Visit contact fix release

## Session 540 Summary — 2026-09-24 PT (Codex Site Visit bug fix)

[VERIFIED via PR #335, merge `407ca908d`, Vercel deployment `dpl_F9nTp3Rd5fkUUtsWHvRwdE6pN4KG`, staff Preview screenshots, and the owner's signed-in Production confirmation] Request 1003222 exposed a materials email preview blocked by a blank Request Primary Contact even though the applicant Account had an Org Primary Contact. The fix is merged and live. The owner confirmed the Production Meeting Tracker opens. No email was sent during rehearsal or release verification; the request's materials are all received, so its reminder path cannot currently be exercised without changing data.

### What Was Completed

1. **Required materials recipients.** The Request Project Leader remains the PI. When Request Primary Contact is blank, the liaison resolves from the applicant Account's Org Primary Contact; both roles need usable email addresses. Manual preview reads current contacts without writing, and Send revalidates the reviewed envelope before refreshing the collection snapshot. The automatic sweep keeps its saved-contact policy and is unscheduled by the prior owner decision. A shared PI/liaison email receives one copy.
2. **Site Visit calendar attendees.** A new visit prefills distinct applicant contacts. A saved visit preserves its recorded attendees and offers missing contacts as explicit Add suggestions. These contact reads are scoped to the Meeting Tracker visit GET; Workbench logistics keeps its previous response shape.
3. **Review and release.** Two ordinary OAuth Claude Opus reviews completed. Staff Preview rehearsal on Request 1003222 rendered an invitation to Franklin Cat, resolved the liaison name, enabled Send, and showed Franklin as an Add suggestion while the existing attendee remained unchanged. PR #335 merged; Production deployed Ready. The owner later confirmed the signed-in Production Meeting Tracker opens. The release note and PR body record the evidence and limits.
4. **Preview cleanup.** The temporary stable Preview alias was restored to its prior deployment; the four branch-scoped rehearsal Config values were removed. No Preview Send, Add, or Save was used.

### Commits

- `be089e398`, `a4d42798f`, `353f66e8a`, `7b009f4e6`, `46fe89607` — recipient fix, attendee suggestions, review corrections, and GET scoping
- `407ca908d` — merge PR #335 to `main`
- `f9cf1e8c2`, `34e63c682`, `6051f0d23` — production release record and staff smoke confirmation

## Next Items

### Verified Open

1. **No remaining implementation item for this bug fix.** Evidence: PR #335 is merged; the Production deployment checked before this handoff was Ready on `applications.wmkeck.org`; staff confirmed the page opens. A production email transport rehearsal was outside the agreed inspection-only test.

### Owner Decision Needed

1. **None for this release.**

### Parked

1. **Live reminder-send proof on an incomplete collection.** Request 1003222 now has all required files, so its “nothing to remind about” guard applies. Use a naturally eligible or separately authorized test request if this proof is later needed; do not delete received files just to recreate the earlier state.

### Verify Before Acting

1. **Other workstreams have independent owners and moving branches.** PR #332 was open at head `b6c9dd079` at this handoff; the Factory branch `codex/test-request-preview-integration` was at `1499b0fdb`. Read their current handoffs, PR state, and worktree status before touching them. The prior Session 539 list is historical, not an automatic worklist.
2. **The IRS BMF parser test is shipped, but a fresh live IRS import remains unproven.** The previous handoff records the operational limit; a dry run writes staging. Verify the target and authorization before any import.

### Do Not Reopen Without New Evidence

1. **The Site Visit contact fallback and attendee suggestion fix is shipped.** PR #335 and `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.12 carry its contract. A future report should be diagnosed from its current contact and document state rather than assuming Request 1003222 still has a missing file.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/site-visit/applicant-contacts.js` | Server-owned PI and liaison resolution |
| `lib/services/site-visit-materials/collection-service.js` | Manual materials preview and send contact checks |
| `lib/services/site-visit/logistics-service.js` | Applicant attendee suggestions for Meeting Tracker |
| `shared/components/meeting-tracker/SiteVisitEditor.js` | New-visit prefill and saved-visit Add suggestions |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.12 | Release contract and staff rehearsal record |

## Testing and Stop-time Notes

- Focused Site Visit suites passed 115 tests; relevant gates/self-tests, lint, types, and build passed before merge. PR #335 CI passed. After the release-note commits, the `main` Tests and E2E workflows passed on `34e63c682`; local doc gates passed on the final note. The latest deployment verified before this handoff commit, `dpl_F9nTp3Rd5fkUUtsWHvRwdE6pN4KG`, was Ready and owned `applications.wmkeck.org`.
- `report:claim-evidence-pilot -- --current` returned “local state could not be read”; no observation row was added.
- `CLAUDE.md` needs no change: no new app, endpoint, schema, script, configuration, or convention was introduced. No `DEVELOPMENT_LOG.md` milestone entry is required: this corrected the existing Site Visit materials and Meeting Tracker workflows already recorded in the milestone log; it was not a separate cutover or declared incident.

## Prior Session 540 Prompt: Continue active workstreams after the IRS BMF test closeout

# Session 540 Prompt: Continue active workstreams after the IRS BMF test closeout

## Session 539 Summary — 2026-09-24 PT (Codex independent queue slice; concurrent sessions continued)

[VERIFIED via PRs #333/#334, `main` merge commits `374a2e51e`/`542da4d1e`, GitHub checks, and local gates] A bounded IRS BMF importer regression test and its canonical work-queue correction merged to `main`. The test uses a local CSV fixture; this session ran no live IRS download or database import. The other active Factory and personal-email worktrees were not edited. `main` auto-deploys; Production deployment/readiness for these two merges was not independently checked.

### What Was Completed

1. **IRS BMF parser regression coverage.** PR #333 merged `374a2e51e` (source commit `b09d395b2`). `tests/unit/irs-bmf-import-parser.test.js` calls the existing CSV-to-Postgres COPY stream helper and covers a BOM, quoted commas/newlines, escaping, EIN normalization, and malformed-row skips. The helper is exported for this direct test; import behavior was not otherwise changed. The focused test, lint, types, and GitHub checks passed.
2. **Queue fact correction.** PR #334 merged `542da4d1e` (source commit `fbd1ce64e`). `docs/CURRENT_WORK_QUEUE.md` now records that the parser test exists while a fresh live IRS-file re-run remains unverified. The doc-currency, fact-consistency, doc-symbol-refs, and docs-catalog gates passed; the paired self-tests passed.
3. **Concurrent-work status checked read-only at handoff.** PRs #329, #330, and #331 are merged. Factory slice 6a is owner-accepted [VERIFIED via `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` on `codex/test-request-preview-integration`]; slice 6b has new branch commits and belongs to that workstream. PR #332 remains open on `codex/personal-email-reviewer-reminders` [VERIFIED via GitHub]. These are other sessions' work.

### Commits

- `b09d395b2` — Test IRS BMF CSV stream import with parser fixture
- `374a2e51e` — Merge PR #333
- `fbd1ce64e` — Update IRS BMF test status in work queue
- `542da4d1e` — Merge PR #334

## Next Items

### Verified Open

1. **Factory slice 6b is in progress in its own worktree.** Evidence: Factory design doc's slice 6a acceptance record and branch commits `2bf5904a9`/`10e0a5e4f` at this handoff. The active Factory session owns the next build and review; check its newer handoff before acting.
2. **Personal reviewer-reminder defaults remain under review.** Evidence: PR #332 is open at head `ac8f9bc05` and the owner’s Codex worktree is on that branch. Leave its files to that owner; recheck PR state before any follow-up.

### Owner Decision Needed

1. **No new owner decision from this IRS BMF test slice.** The other workstreams retain their own decision gates and handoffs.

### Verify Before Acting

1. **Live IRS-file import remains unproven by this test.** The fixture covers parsing and COPY text, not a fresh IRS download, Postgres staging, or atomic swap. Establish the intended target and authorization before running an import or dry run; `refresh()` writes staging even when `dryRun` is true.
2. **Production deployment for PRs #333/#334 was not independently checked.** Both merged to auto-deploying `main`; verify Vercel Ready state if operational evidence is needed.
3. **Concurrent branch state changes quickly.** Check the Factory branch, PR #332, worktree ownership, and `git status` before taking any of their tasks. Historical Session 538 next items naming PRs #329–#331 as open are superseded by the merged PR states above.

### Do Not Reopen Without New Evidence

1. **The missing IRS importer unit test is closed.** PR #333 supplies it and PR #334 corrected the current queue claim. A live IRS-file run is a separate operational proof, not a missing parser-test fix.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/irs-bmf-service.js` | CSV parser and COPY-stream importer |
| `tests/unit/irs-bmf-import-parser.test.js` | Fixture-driven parser regression test |
| `docs/CURRENT_WORK_QUEUE.md` | Current queue status and remaining live-file caveat |

## Testing and Stop-time Notes

- Focused IRS test, ESLint on touched source/test, TypeScript check, and PR #333 GitHub checks passed.
- PR #334 GitHub checks and doc-currency, fact-consistency, doc-symbol-refs, docs-catalog gates passed; relevant self-tests passed sequentially.
- `report:claim-evidence-pilot -- --current` was attempted both inside and outside the sandbox; it returned “local state could not be read.” No observation row was added because eligibility could not be determined.
- `CLAUDE.md` needs no change: no app, endpoint, schema, script, configuration, or convention changed. No DEVELOPMENT_LOG milestone entry is required: this session shipped test coverage and documentation, not a new Production capability or cutover.

## Prior Session 539 Prompt: Build IA recipe slice 6b (after owner accepts 6a)

# Session 539 Prompt: Build IA recipe slice 6b (after owner accepts 6a)

## Session 538 Summary — 2026-09-24 PT (Claude root; Sonnet build agent, Codex review/rescue; owner drives a separate Codex session)

[VERIFIED via pushed commits, PR list, 544 focused tests including live suites against a local throwaway PostgreSQL 16, gates, mutation checks, and Codex adversarial reviews] The owner accepted Factory build-order item 5. The sandbox was brought to production `wmkf_` schema parity from this repository (PR #331, open), which unblocked item 6. The Initial Assessment recipe plan was approved by Codex after five rounds, and slice 6a was built and approved by Codex (round 3); owner acceptance of 6a is pending. The owner handed the personal-email-defaults work to their own Codex session (PRs #329, #330 open). Nothing was deployed; no production write occurred. Production reads were definitions-only (table/column/choice metadata), owner-authorized.

### What Was Completed

1. **Red gate fixed on `main`**: `check:doc-symbol-refs` (`f1178bfda`).
2. **Item 5 accepted by the owner**; recorded on the Factory branch (`4a52f3127`).
3. **Sandbox schema parity (PR #331, branch `claude/sandbox-schema-parity`, 8 commits)**: waves `wave0-prod-parity-foundation` and `wave29-prod-parity-tail` generated from production metadata; `schema-apply.js` gained global option sets, multiselect and file columns with metadata-lag retries; `apply-dataverse-schema.js --new-first`; `scripts/compare-sandbox-schema-parity.js` and `scripts/apply-sandbox-choice-parity.js`; record `docs/plans/SANDBOX_SCHEMA_PARITY_2026-09-24.md`. Every wave applied to the sandbox, 54 choice values inserted. Result: every production `wmkf_` table, column and choice value exists in the sandbox except the rollup helpers; 0 type differences over 1,023 shared columns. Owner decisions: leave the 3 label differences and 112 sandbox-only values; land by PR.
4. **Factory docs**: item 6 blocker marked resolved (`4a52f3127`); IA recipe plan (`9de3114b7` … `4fb87095b`, Codex plan rounds 1–4 needs-attention, round 5 approve).
5. **Slice 6a built** (`86c8549dc`, `a13b7b885`, `178d56d00`, `38c2a34f6`, record `4dd526dca`): recipe `initial_assessment`, recipe bound into plan digest and pre-lease check, per-recipe step order, `foundation_baseline` resource (digest at insert, one per run, repeated verify compares), IA folder/filename grammar in JS and SQL, legacy `--execute` refuses non-basic manifests, pre-existing red `check:secret-scan` on the Factory branch fixed. Codex 6a rounds: 1 and 2 needs-attention (all fixed; round 2's fix built by Codex rescue, reviewed by Claude), 3 approve.
6. **Codex worktree** `/Users/gallivan/Code/WMKF_Apps-codex` set up for the owner's personal-email work; brief `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_CODEX_BRIEF_2026-09-24.md` (on that branch). Temporary production-read allow rule removed from `.claude/settings.local.json`.

## Next Items

### Owner Decision Needed

1. **Accept slice 6a** (Factory branch, record paragraph "Slice 6a built" in `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`).
2. **Review/merge PR #331** (sandbox schema parity; changes schema tooling that can also target production, additively).
3. **Owner's Codex PRs #329 (inventory) and #330 (grantee invite subject)**: the owner drives these in Codex; review/merge on their say.
4. Carried: migration 054 first shared apply needs explicit authorization (freezes the file). Old Preview aliases / Entra callbacks retire-or-keep (destructive; grep callers first).

### Verified Open

1. **Slice 6b, IA step bodies** (after 6a acceptance). Plan: the approved paragraph "Build-order item 6, Initial Assessment recipe — plan" in the Factory design doc (items 1–7 of slice 6b): default-preserving dependency seams on `commitReadyLineage` / `resolveCanonicalInitialAssessment` / `executeChangeset`; one sandbox-host-bound service (`ia-sandbox-deps.js`, register the seam in `scripts/check-request-document-writers.js`); synthetic fixture; journal-before-dispatch wrappers around every mutating dependency including the board snapshot's; persist `wmkf_contenthash` before upload; terminal verifier repeats Basic safety checks, compares against the `foundation_baseline`, hashes the snapshot bytes. Then Claude review, Codex adversarial review, and one live sandbox run (re-export the 1003222 bundle immediately before — production read, authorized for this task; one new sandbox Request, up to two creates authorized).
2. Remaining item 6 recipes after IA (synthetic reviewers, site-visit materials, Pre-Site, Pre-RP/Final Writeup) and item 7.

### Verify Before Acting

1. Local ledger: Docker runs through Colima (`colima start`); container `wmkf-ledger-pg` was recreated this session (memory `project-local-docker-is-colima.md`). Drop the three ledger objects before live suites when 054 changes; run suites `--runInBand`.
2. Factory worktree `/Users/gallivan/Code/WMKF_Apps-factory` is at the branch head (`4dd526dca`); the branch is 132 ahead / 3 behind `main` (main's later commits are docs/memory only).
3. Owner rule this session: bring every review finding to the owner before fixing it (memory `feedback-reviewer-differs-from-author.md`); reviewer must differ from author.
4. `/Users/gallivan/Code/WMKF_Apps-codex` belongs to the owner's Codex session; `/Users/gallivan/Code/WMKF_Apps-investigate` may belong to another session. Do not touch either.

### Do Not Reopen Without New Decision

1. IA recipe plan (Codex-approved round 5) and slice 6a design: keep `basic` token, baseline-at-insert, one baseline per run, legacy `--execute` basic-only.
2. Sandbox parity deviations (rollup/formula columns plain, Akoya vendor tables excluded, sandbox-only values and labels kept).
3. Earlier: no-text invariant, dispatch-marker rule, no lease renewal, in-place edits to unapplied 054; synthetic IA fixtures only.

## Key Files Reference

- Factory design doc: `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (Factory branch)
- Ledger/runner: `lib/services/test-requests/run-ledger.js`, `run-runner.js`, `basic-clone-steps.js`, `lib/db/migrations/054_test_request_runs.sql`, `scripts/setup-database.js`, `scripts/rehearse-test-request-sandbox.mjs`
- IA services for 6b: `lib/services/initial-assessment/{artifact-service,artifact-lineage,artifact-reader,controls-service}.js`, `lib/services/dynamics/changeset.js`
- Sandbox parity: `docs/plans/SANDBOX_SCHEMA_PARITY_2026-09-24.md`, `lib/dataverse/schema-apply.js`, `scripts/apply-dataverse-schema.js` (PR #331)

## Stop-time notes

- Claim-evidence pilot: report showed no eligible plan/design edit for this session key; no observation row.
- Memory: added `feedback-reviewer-differs-from-author.md`, `project-local-docker-is-colima.md`; router updated (7,320 bytes, gate green).
- Milestone: none required (nothing shipped to production; PR #331 and 6a are unmerged).

## Prior Session 538 Prompt: Accept build-order item 5; unblock item 6 with a sandbox solution import

## Session 537 Summary — 2026-09-23/24 PT (Fable orchestrating; Sonnet builds, Opus reviews, Codex adversarial)

[VERIFIED via pushed Factory-branch commits, 472 focused unit tests, 24 live tests against a throwaway local PostgreSQL 16 container, gates, mutation checks, fifteen Codex adversarial rounds, and two owner-authorized live sandbox creates] Build-order item 4 (sandbox Basic clone from the production source bundle with journaled file copy) was proven live and **accepted by the owner**; build-order item 5 (durable run ledger, slice 5a, and bounded resumable runner + CLI, slice 5b) was built, proven live as sandbox Request 1000341, and **approved by Codex in round fifteen with no findings**; it awaits owner acceptance. Build-order item 6 is **blocked** on a sandbox schema gap (owner action). All product work is on `codex/test-request-preview-integration` (now `2f591a67c`, 120 ahead / 0 behind `origin/main` after merging main at `29d3b1418`). Nothing was deployed; no production write occurred; production reads were limited to the authorized Request 1003222 bundle. `main` received only the memory commits `85f51a17b`, `f0582b646` and this handoff.

### What Was Completed

1. **Item 4 closed** (`8a82db600` … `3c8caf0d1`): `lib/services/test-requests/bundle-file-copy.js` (journal-before-write, item id journaled inside the PUT via the new additive `onItemCreated` hook in `lib/services/graph/writes.js` and `GraphService.uploadFile`, exact-item recovery, end-of-run re-verification by stable id) and the v4 bundle manifest in `scripts/rehearse-test-request-sandbox.mjs`. Live proof Request 1000340 (owner-run), receipt at `docs/plans/evidence/test-request-factory/bundle-clone-receipt-2026-09-24.json`.
2. **Item 5a ledger** (`4f004e854` … `9ac9ccb3f`, then `804b1100a`, `094757de5`, `347552b1e`, `db3afe72a`, `6cffa26fb`): migration `lib/db/migrations/054_test_request_runs.sql` (+ `scripts/setup-database.js` V55 mirror, manifest entry), `lib/services/test-requests/run-ledger.js` and `run-ledger-db.js`, Atlas page `docs/atlas/postgres-test-request-runs.md`. Invariant reached through the Codex rounds: **no caller-typed or upstream text can persist in any column**, enforced in JavaScript (per-key receipt grammars, finite reason/step/kind/outcome sets, hashed idempotency keys, digested `cli:` actors, derived label, exact Graph id shapes, credential markers rejected anywhere in a value) and in PostgreSQL (CHECKs on every text column plus the IMMUTABLE function `test_request_receipt_ok(jsonb)` on the three receipt columns; identical regex text in both files, pinned by unit parity and live tests). Readbacks merge rather than replace. Lease model: version + lease token + generation + `locked_until`, every mutating WHERE re-checks; `markNeedsAttention` records `last_error` in the same fenced UPDATE. Required CI job `ledger-postgres` (PostgreSQL 16 service) runs both live suites.
3. **Item 5b runner + CLI** (`13a04712a`, hardened in `347552b1e`, `db3afe72a`, `f2ba2d772`): `lib/services/test-requests/basic-clone-steps.js` (step bodies extracted from `--execute`), `lib/services/test-requests/run-runner.js` (`advanceRun`, exactly one step per call, journal before dispatch, dispatch-marker rule: an attempted POST/location POST/upload with no readable result stops the run, never re-dispatches), and CLI modes `--reserve` / `--advance [--steps=N] [--bypass-goverify]` / `--run-inspect` gated on `TEST_REQUEST_LEDGER_URL` (refuses unset, neon.tech, or any shared `POSTGRES_URL*`/`DATABASE_URL`). Opus review found and fixed twelve defects with nine live-ledger tests and four mutation checks; root added the stale-bundle stop, wider URL guard, location system label, CI wiring, and a plain report for a finished run. **Live proof:** run `3f83c1e2` → sandbox Request 1000341, two copied documents, `ready`, across four separate CLI invocations; evidence `docs/plans/evidence/test-request-factory/ledger-run-1000341-2026-09-24.json`.
4. **Codex adversarial rounds 1–15** on the ledger/runner, each recorded in `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (item 5 paragraphs). Round fifteen: approve, no material findings.
5. **Item 6 reconnaissance and blocker** (`d935ece9f`): a read-only sandbox metadata probe shows the sandbox has no `wmkf_requestdocument` entity, no `wmkf_currentinitialassessment` / `wmkf_ai_fieldprimer` request columns, and none of the review, AI-run or other application-added entities (`docs/plans/evidence/test-request-factory/sandbox-schema-gap-2026-09-24.md`). The IA recipe's write path, identity, path/filename, hash, lineage commit and gate implications are recorded in the design doc for when the schema lands.
6. **Per-machine allow rule** verified: the `.claude/settings.local.json` rule in memory `project-sandbox-rehearsal-bypass-allow-rule.md` cleared the classifier for reserve/advance/bypass; re-add it on another machine.

## Next Items

### Owner Decision Needed

1. **Accept build-order item 5** (ledger + runner + CLI) on the Factory branch. Evidence: design doc item 5 paragraphs, Codex round fifteen approve, live Request 1000341, CI job `ledger-postgres`. Migration 054 is applied to no shared database; its first shared apply needs your authorization (and freezes the file; later changes go in new numbered migrations).
2. **Import the application solution into the sandbox** so later-stage recipes (item 6: IA → synthetic reviewers → materials → Pre-Site → Pre-RP/Final Writeup) can be proven live. Exact gap list: `docs/plans/evidence/test-request-factory/sandbox-schema-gap-2026-09-24.md`. Nothing in this repo can do this.
3. **Sandbox create budget:** four permanent sandbox Requests exist from the Factory (1000338, 1000339, 1000340, 1000341); this session used one of the five you authorized for the autonomous run.
4. Carried: old Preview aliases / Entra callbacks retire-or-keep (`docs/CURRENT_WORK_QUEUE.md`; destructive, grep callers first).

### Verified Open (after the decisions above)

1. **Item 6, IA recipe** once the sandbox schema exists: follow the recorded decomposition (recipe token, steps `seed_initial_assessment` / `seed_initial_assessment_snapshot`, resource kind `dataverse_request_document`, receipt keys for generation key and claim id, IA folder/filename grammar families, new reason codes) — every one of those is an enum/grammar edit in `run-ledger.js` **and** the matching SQL list in migration 054 + `setup-database.js` (the SQL lists were generated from the JS exports; keep them in step, the unit test pins both). Synthetic fixtures only (owner decision: no production reads beyond 1003222). Sandbox CLI steps write through the sandbox client under the ledger journal; the production form (item 7) must route through `requestDocumentAdapter` with a registered seam in `scripts/check-request-document-writers.js`; never write the immutable origin fields.
2. **Item 7** (Admin creation form, resume/retire operations, production release) — hard stops: production marker schema apply then `TEST_REQUEST_ISOLATION=on`; merging the Factory branch to main.
3. Known runner limits recorded in the design doc (not defects): same-key `--reserve` retry after a lost reserve response is a 409 (recover via `--run-inspect`); a GoVerify refusal has no operator-clear action (restore by hand, start a new run); superseded `planned`/`dispatched` rows remain after recoveries; `observe` is one 60-second call inside the 300-second lease.

### Verify Before Acting

1. Local throwaway ledger: docker container `wmkf-ledger-pg` (`postgres://postgres:ledger@127.0.0.1:5433/ledger`) was stopped at session end; start it (or any local PostgreSQL 16) and export `TEST_REQUEST_LEDGER_TEST_URL` to run the live suites. When migration 054 changes, drop `test_request_run_resources`, `test_request_runs` and `test_request_receipt_ok(jsonb)` first — the suites fail loudly on a stale schema by design.
2. The 1003222 bundle in this session's scratchpad expires six hours after its 03:58Z export; re-export (owner-authorized production read) before any new clone.
3. Codex must run with `--model gpt-5.6-sol` from the Factory worktree; runs take 5–10 minutes; the companion's `--base HEAD~N` scopes the diff.
4. A Sonnet reconnaissance agent and an Opus review agent from this session are finished; the investigation worktree `/Users/gallivan/Code/WMKF_Apps-investigate` may still belong to another session; do not touch it.

### Do Not Reopen Without New Decision

1. Items 4 and 5 review history: fifteen Codex rounds are recorded; do not re-litigate the no-text invariant, the dispatch-marker rule, the no-lease-renewal decision, or in-place edits to unapplied migration 054.
2. IA recipe uses synthetic fixtures only; no reviewer throwaway inboxes for now (owner, Session 537).
3. Stage 1d, the exporter, and item 4 are accepted; existing requests are never changed by the Factory.

## Key Files Reference

- Design doc (build order, item 5 paragraphs, item 6 blocker): `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (Factory branch)
- Ledger: `lib/db/migrations/054_test_request_runs.sql`, `lib/services/test-requests/run-ledger.js`, `run-ledger-db.js`, `docs/atlas/postgres-test-request-runs.md`
- Runner/CLI: `lib/services/test-requests/run-runner.js`, `basic-clone-steps.js`, `bundle-file-copy.js`, `scripts/rehearse-test-request-sandbox.mjs`
- Tests: `tests/unit/test-request-run-ledger*.test.js`, `tests/unit/migration-054-test-request-runs.test.js`, `tests/unit/test-request-run-runner.test.js`, `tests/unit/test-request-basic-clone-steps.test.js`, `tests/integration/test-request-run-ledger.pg.test.js`, `tests/integration/test-request-run-runner.pg.test.js`; CI job `ledger-postgres` in `.github/workflows/test.yml`
- Evidence: `docs/plans/evidence/test-request-factory/` (bundle clone receipt 1000340, ledger run 1000341, sandbox schema gap)

## Stop-time notes

- Claim-evidence pilot report: no eligible plan/design edit recorded for this session key; no observation row added.
- Memory: `project-sandbox-rehearsal-bypass-allow-rule.md` updated (rule verified). No router change.

## Prior Session 537 Prompt: Sandbox Basic clone from the source bundle

## Session 536 Summary — 2026-09-23 PT (Claude root; Codex rescue builds, Claude reviews)

[VERIFIED via pushed branch commits, full Jest runs, gates, mutation checks, Codex adversarial reviews and owner-authorized production reads] Test Request Factory Stage 1d was fixed and **accepted by the owner**; the read-only production source-bundle exporter (build-order item 4, first half) was built, hardened through three Codex review rounds, run live on Request 1003222, and **accepted by the owner**. No commit landed on `main` this session except this handoff; all product work is on `codex/test-request-preview-integration` (now `57d823b14`, 26 commits this session, 19 behind / 89 ahead of main). Nothing was deployed and no production write occurred.

### What Was Completed

1. **Stage 1d accepted** (Factory branch). Six root-review defects fixed (`f06b5d3a8`, `7c8edcf45`, `6f2d56c48`, `008612629`), two Codex re-review findings fixed (`ee9901c59` default cycle from ordinary requests only; `c0cbf0dad` export-preview waterfall step), three more fixed by Codex rescue and reviewed (`6a293fe12` export token binds isolation policy; `744bde88d` Explorer page-local CSV hidden while isolation is on; `53260f1af` no default cycle for all-test programs). Owner decisions: single-request Word/PDF artifacts (incl. Grant Reporting) stay available for test requests; spend alarm counts all spend, dashboard shows test spend as one line; accept without a fourth review round.
2. **Source-bundle exporter accepted** (Factory branch). `scripts/export-test-request-source-bundle.mjs` + `lib/services/test-requests/source-bundle.js` (bundle v2: production host + registered `akoyago-shared` site enforced, drive/item/site identity, strict SharePoint discovery, post-hash membership fence, root-only archive folder misses with library re-confirmation). Commits `414af81d9`, `ebd6796e4`, `433609a38`, `17085332a`, `4b8ebec7b`, `aba21a5a9`, `57d823b14` (+ doc commits). Live runs on 1003222 (owner authorized prod Dataverse reads this session): GUID `e43ae6ea-698f-f111-8076-6045bd018a07`, revision `W/"98622844"`, December 2026 / 2026-12-11, no purpose text, two recognized documents (`ProposalNarrative_1003222.pdf`, `Proposal_1003222.pdf`); no Phase I or bibliography file matched the recognized names.
3. **Presentation Slice 0 decisions** (`codex/feature-request`, `6b9f1fd15`, `1fe8777d5`): Chrome and Edge accepted; macOS/iPadOS Safari deferred to a Production run on a Factory-created test request; browser-independent recovery rows move to one agent-run Chrome pass.
4. **Investigation worktree** created for a parallel Claude session: `/Users/gallivan/Code/WMKF_Apps-investigate`, branch `claude/investigation` (no upstream). Another Claude session may be working there; do not touch it.

## Next Items

### Verified Open

1. **Sandbox Basic clone from the bundle, with create-only file copy** (build-order item 4, second half).
   Evidence: Factory branch design doc `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` (source-bundle paragraph and build order item 4), `lib/services/test-requests/source-bundle.js` header (consumer obligations), `scripts/rehearse-test-request-sandbox.mjs`.
   Teach the rehearsal to read a v2 bundle instead of a sandbox source Request; each file copy is journaled in the receipt before the write, create-only with conflict refusal, re-resolves the drive on the registered site and re-verifies eTag + SHA-256, and recovers an ambiguous outcome by exact item. Re-export the bundle first (the Session 536 file lives in that session's scratchpad): `DATAVERSE_ALLOW_PROD_READS=yes node --env-file=/Users/gallivan/Code/WMKF_Apps/.env.local scripts/export-test-request-source-bundle.mjs --source-request-number=1003222 --out=<new absolute path outside the repo>` — needs fresh owner authorization for the production read. Codex adversarial review before acceptance.
2. **After item 1:** durable run ledger/runner, later-stage recipes, Admin form (design build order items 5–7).

### Owner Decision Needed

1. **Old Preview aliases / Entra callbacks** (`git-codex-pau-5b4bef`, `git-codex-wor-464bcd`): retire or keep. Evidence: `docs/CURRENT_WORK_QUEUE.md`. Retirement is destructive — grep live callers first.
2. **1003222 has only two recognized documents.** If Phase I PDFs were expected, their names differ from the factory's recognized filenames; decide whether that is acceptable for the first clone or pick another source.

### Verify Before Acting

1. Production marker schema apply and `TEST_REQUEST_ISOLATION=on` each need explicit owner authorization; the switch stays off until the apply succeeds.
2. The Factory branch is 19 commits behind main; merge main deliberately before integration.
3. Codex rescue's sandbox cannot write the Factory worktree's git metadata (`index.lock: Operation not permitted`) — expect to commit its changes yourself after review. Codex must run with `--model gpt-5.6-sol`; the default `gpt-6-sol` fails on ChatGPT auth.
4. Two early presentation fragment-probe upload sessions have unknown state; do not infer cleanup.

### Do Not Reopen Without New Decision

1. Stage 1d and the source-bundle exporter are accepted (owner, Session 536); no fourth review round.
2. Existing requests are never changed by the Factory; test requests visible with TEST badge; reports/exports/cycle totals exclude them; single-request actions stay available.
3. Safari Slice 0 runs in Production on a Factory test request; no further Edge runs.

## Key Files Reference

| File | Purpose |
|------|---------|
| Factory branch `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Stage 1d fix record, source-bundle contract, build order |
| Factory branch `lib/services/test-requests/source-bundle.js` | Bundle v2 build/read/export orchestration |
| Factory branch `scripts/export-test-request-source-bundle.mjs` | Read-only production exporter CLI |
| Factory branch `scripts/rehearse-test-request-sandbox.mjs` | Sandbox clone rehearsal to extend next |
| Factory worktree | `/Users/gallivan/.codex/worktrees/test-request-preview-integration/WMKF_Apps` |

## Stop-time notes

No DEVELOPMENT_LOG milestone: nothing shipped to production; Stage 1d and the exporter are branch-local. Claim-evidence pilot: no eligible plan/design edit recorded for this session key, so no observation row.

## Prior Session 536 Prompt: Fix six Stage 1d defects; decide presentation Slice 0

## Session 535 Summary — 2026-09-23 PT (Claude root; Codex builds/reviews)

[VERIFIED via local Git, pushed branches, full Jest runs, gates and Codex adversarial reviews] Claude took over the Test Request Factory build and completed Stage 1 isolation slices 1a–1c; Stage 1d is built but has six open defects. Two Codex PRs were refreshed, merged and deployed. The presentation-media proof branch was handed from Codex to Claude.

### What Was Completed

1. **Test Request Factory Stage 1 (branch `codex/test-request-preview-integration`, worktree `/Users/gallivan/Code/WMKF_Apps-factory`, pushed at `48e75a8be`).**
   - 1a marker read contract and always-on marker write guard: accepted.
   - 1b email / Contact / payment hard blocks: accepted after two correction rounds plus Codex-rescue fixes (`dd7181e39`, `9a0a740ab`, `94d9a3ada`).
   - 1c scheduled jobs: every cron route classified in `tests/unit/test-request-scheduled-job-census.test.js`; guarded jobs skip test requests before claims/mints/provider calls/writes/sends; accepted (`00166d5e1`, `2e01698e3`, `a69545697`). Owner decisions: AI review panels run on test requests; cycle dossiers exclude them.
   - 1d visibility (TEST badge, report/export/total exclusion) built by Codex rescue (`4c0a9e86f`, `ca0e0142a`, `4b0c53246`); root review and Codex adversarial review found six defects, recorded in `9d040a7a3` / `48e75a8be`. Owner decision: admin usage dashboard excludes test spend from totals but shows it as one separate line; the spend-check alarm must count all spend.
   - Everything read-side is gated by `TEST_REQUEST_ISOLATION` (literal `on`); production still lacks the marker columns.
2. **PR #326 (safe download filenames + Pre-RP census) and PR #327 (Preview alias CSRF runbook)** refreshed, verified and merged; #326 deployed to Production (`3cf98bea7`, served by `dpl_EvZzX5pEFncDbircBUsmsexUQeCp`); #327 merged (`98f2ab371`). A signed-in filename-header spot check was not run.
3. **Presentation-media proof (`codex/feature-request`, new worktree `/Users/gallivan/Code/WMKF_Apps-presentation`)** handed to Claude at `44b5b798f`; branch and shared Preview alias target (`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`) re-verified. Chrome passed; Windows Edge partial; macOS/iPadOS Safari and live reload/expiry/long-seek/2 GB runs not run.
4. Main doc commits pushed early in the session (`250e9ebeb`, `9e4f43b2e`, `76b0ff87e`, `d2720d781`).

## Next Items

### Verified Open

1. **Fix six Stage 1d defects, then rerun Codex adversarial review from base `a69545697`.**
   Evidence: "Stage 1d root review" paragraph in the branch's `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`; branch `SESSION_PROMPT.md` item 0.
   (1) spend-check alarm must count all spend; admin dashboard shows test spend as one line; (2) Dynamics Explorer Search must not throw on an unclassified hit; (3) Workbench cycle discovery must include test requests; (4) `aggregateMeetingDateCycles` emits a second entity-level FetchXML filter (invalid); (5) Grant Reporting exclusion trusts an optional unbound `requestGuid` — classify whether it is a single-request action first; (6) spend classification reads one request at a time and silently drops unreadable spend.
2. **After Stage 1:** source-bundle export from production Request 1003222 (read-only, owner-authorized scope), sandbox Basic clone, run ledger/runner, later-stage recipes, Admin form.

### Owner Decision Needed

1. **Presentation Slice 0:** continue or park. Continuing needs a newly approved disposable request + SharePoint target; owner runs macOS/iPadOS Safari by hand. Evidence: `codex/feature-request` plan `docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md` and its `SESSION_PROMPT.md` entry.
2. **Stage 1d single-request artifacts:** whether single-request Word/PDF artifacts count as "reports" (Codex kept them available). Evidence: branch design doc Stage 1d open question.
3. **Old Preview aliases / Entra callbacks** (`git-codex-pau-5b4bef`, `git-codex-wor-464bcd`): retire or keep. Evidence: `docs/CURRENT_WORK_QUEUE.md`.

### Verify Before Acting

1. Production marker schema apply and `TEST_REQUEST_ISOLATION=on` each need explicit owner authorization; the switch stays off until the apply succeeds.
2. Two early presentation fragment-probe upload sessions have unknown state (URLs not retained); do not infer cleanup.
3. The Factory branch is 18+ commits behind main; merge main deliberately before any integration.

### Do Not Reopen Without New Decision

1. Existing requests are never changed by the Factory; `No`/false and null markers are equivalent; test requests visible with TEST badge; reports/exports/cycle totals exclude them.
2. Codex model stays `gpt-5.6-sol` (gpt-6-sol refused on ChatGPT auth).

## Key Files Reference

| File | Purpose |
|------|---------|
| Factory branch `docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Stage 1 decisions, 1a–1d records, open defects |
| Factory branch `lib/services/test-requests/{isolation,request-test-state,spend-isolation}.js` | Isolation policy, per-run lookup, spend filter |
| Factory branch `tests/unit/test-request-{scheduled-job,visibility,email-sender}-census.test.js` | Mechanized census tests |
| Presentation branch `docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md` | Slice 0 matrix and live-run rules |

## Stop-time notes

No DEVELOPMENT_LOG milestone: PR #326 is a contained header-hardening release; Factory and presentation work remain branch-local. Claim-evidence pilot: no eligible plan/design edit recorded for this session key, so no observation row.

## Prior Session 535 Prompt: Sandbox Basic clone reviewed; select live source

## Session 534 Summary — 2026-09-22/23 PT

[VERIFIED via local Git, source, focused tests, relevant gates, and three read-only Claude Opus review rounds] The isolated `codex/test-request-preview-integration` branch now has a sandbox-only Basic clone operator. It resolves exactly one Grant Request by number, defaults fiscal year and meeting date from that source, copies only purpose and requested amount, and prepares a private source-bound v3 manifest. Execute fences the source before its single Request POST, creates the marked Request under the app-suite Dataverse application user, provisions the exact SharePoint folder/location, and verifies content, ownership, location, and absence of payment/email effects. Receipt milestones support exact-ID recovery without blind retry. Opus found no remaining P1/P2 defect after three bounded rounds.

This work was **source-built and tested offline only**. The operator created no new Dataverse Request or Graph folder, and no production capability was promoted. The combined fresh create, meeting-date correction, and folder run remains unproven. The previous Session 533 instruction to supply both cycle values to `--prepare` is historical: the new v3 operator reads them from the selected source unless one is missing or explicitly overridden. Request 1000339 is a retained synthetic rehearsal record, not the default clone source.

### Commits

- `654e01ac8` — Add source-bound sandbox Request clone operator
- `3b6903ba0` — Persist sandbox clone write intents
- `0e3296296` — Harden sandbox clone receipt recovery
- `a7def6a3` — Fail closed on uncertain GoVerify deactivation

[VERIFIED via successful `git push` and branch status] The owner explicitly authorized publishing to the existing public GitHub origin after automatic approval had rejected Luna's earlier attempt. All four commits are now pushed on `codex/test-request-preview-integration` at `a7def6a31`. The worktree `/Users/gallivan/.codex/worktrees/test-request-preview-integration/WMKF_Apps` is clean and synchronized with origin. The public destination was verified with `gh repo view`; no alternate export path was used.

### Next Items

**Verified open:** Select an actual sandbox Grant Request number before a bounded live Basic clone. Run read-only `--prepare`, inspect the private manifest and source cycle, then decide whether to run `--execute` with an unused receipt path. Recheck the registered sandbox target, GoVerify state, and source revision. The operator never retries an ambiguous create; use `--inspect` and the preallocated GUID. If deactivation was attempted without a verified inactive readback, the receipt marks `restoreVerified:false` and requires manual workflow verification before proceeding. Stage 1 isolation, production automation suppression, duplicate-location policy, file-copy limits, and a document-bearing source remain for the full product; this CLI slice does not enable production creation.

**Owner input needed for a live sandbox run:** Select an actual Grant Request source number. Publication is done; no PR, merge, or production promotion was requested or performed.

**Verify before acting:** The Admin Preview deployment is from an older branch commit and is still read-only. The new CLI's combined live create/correction/folder path has not been exercised. A client-side timeout or signal cancellation does not prove Dataverse canceled server-side work; exact-ID inspection is required after an ambiguous outcome.

### Key Files and Testing

Feature worktree: `scripts/rehearse-test-request-sandbox.mjs`, `lib/services/test-requests/sandbox-clone.js`, `lib/services/test-requests/rehearsal-receipt.js`, `lib/services/test-requests/bypass-signal-fence.js`, and `lib/dataverse/client.js`; the branch design and Stage 0 contract carry the detailed boundary. Luna's final safety run passed 69 focused tests; root independently passed 57 focused tests plus the final 25-test delta, and Atlas and Dataverse access-layer gates with self-tests. Doc-currency and fact-consistency gates with self-tests passed. Opus round 3 accepted with no remaining P1/P2 finding. No `DEVELOPMENT_LOG.md` milestone entry is required because no production capability shipped. The optional claim-evidence pilot report could not read local state; no observation was inferred.

## Prior Session 534 Prompt: Continue Test Request Factory from source-cycle policy

## Session 533 Summary — 2026-09-23 PT

[VERIFIED via branch source, focused tests, gates, build, Git and remote ref] The
owner clarified that new Test Requests should use the current cycle so they
remain visible. The Basic clone now defaults fiscal year and meeting date from
the server-resolved source Request. The form asks for either missing value and
allows an explicit edit; unchanged values are omitted from POST so the server
re-reads the source rather than trusting a browser echo. Missing or invalid
values block the compiler. Commit `efeef1234` is pushed on
`codex/test-request-preview-integration`; the worktree is clean.

The separate sandbox rehearsal script no longer defaults to artificial
`December 2099` / `2099-12-01`. Preparing a new manifest requires an explicit
fiscal year and meeting date. The historical 2099 receipts remain evidence of
the earlier bounded experiment, not a product date requirement. The preview
remains read-only; no new Request was created or production capability deployed
in this session.

### Commits

- `efeef1234` — Use source cycle for Test Request previews (integration branch)

### Next Items

**Verified open:** Continue the Basic clone from the
[branch design](https://github.com/justingallivan/wmkf-research-apps/blob/efeef1234a2b71b61d60b7d8d29262b8cb6eb48a/docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md)
and [Stage 0 contract](https://github.com/justingallivan/wmkf-research-apps/blob/efeef1234a2b71b61d60b7d8d29262b8cb6eb48a/docs/plans/TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md).
The app-owned sandbox folder/location path is proven. Stage 1 synthetic
isolation, production automation suppression, duplicate-location policy,
execution file limits, and a document-bearing source remain before production
creation/copy can be enabled. The sandbox meeting-date correction is proven on
one retained Request; a combined fresh create-plus-correction run has not been
performed. Do not reopen the date-default choice or ask the owner to create
folders manually.

**Owner decision needed:** None for date selection. Ask for a source Request
only when an actual creation run is ready and a source has not already been
selected.

**Verify before acting:** The branch Admin Preview deployed earlier still runs
an older commit; do not describe `efeef1234` as live. Recheck target, source
cycle, and platform state before any fresh create. This main-branch handoff is
documentation only; runtime code remains on the integration branch.

### Key Files and Testing

The branch changed `lib/services/test-requests/preview.js`,
`pages/api/admin/test-requests/preview.js`,
`shared/components/admin/TestRequestPreviewSection.js`, and
`scripts/rehearse-test-request-sandbox.mjs`, with focused tests and the two
factory plan documents. Four focused suites passed (47 tests), scoped ESLint,
the production build, API-route and route-service gates with self-tests,
doc-currency and fact-consistency gates with self-tests, and docs catalog.
The claim-evidence pilot report could not read its local state; no observation
was inferred. No DEVELOPMENT_LOG milestone is required: this corrects branch
policy and has not shipped a production capability.

## Prior Session 533 Prompt: Test Request app-owned folder and location proven in sandbox

## Session 532 Test Request update — 2026-09-22/23 PT

[VERIFIED via sandbox Dataverse and Graph writes/readbacks, 60-second observation,
Git, focused tests and document gates] The owner directed us to create the
synthetic Request folder and Dataverse location ourselves. On the isolated
`codex/test-request-preview-integration` branch, commit `d99b4043b` adds that
path to the bounded sandbox rehearsal script and is pushed. The branch remains
separate from `main`; its deployed Admin preview remains read-only, and no
production schema, Request, document, or runtime code was changed.

The fresh marked sandbox Request **1000339** (`63dab4af-178f-4bbc-b24d-3ccbaf74cbfc`)
and its `sharepointdocumentlocation` (`76e1d537-b0ad-4fa8-98d0-008dab6106e8`)
were created and owned by `# WMK: Research Review App Suite`. Graph created the
exact `akoya_request/1000339_63DAB4AF178F4BBCB24D3CCBAF74CBFC` folder; the
Dataverse location binds to that Request and the one verified `akoya_request`
parent. The folder read back empty. No payment, regarding email, or Foundation
account/Contact change appeared in the 60-second window. GoVerify was
restored immediately after the Request POST. The raw receipt's sole failed
assertion expected `akoya_submissionaccepted=null`; live Boolean metadata
proved `DefaultValue=false` and the stored value was false, so source now checks
false. No extra Request was created to retest that assertion. Both rehearsal
Requests 1000338 and 1000339 exhibited the meeting-date rewrite at create
(`2099-12-01` requested, `2024-12-13` stored).

Evidence and current contract: [branch receipt](https://github.com/justingallivan/wmkf-research-apps/blob/d99b4043b5cba48f633c32950830ade8bf18837a/docs/plans/evidence/test-request-factory/app-owned-location-rehearsal-2026-09-23.json),
[Stage 0 contract](https://github.com/justingallivan/wmkf-research-apps/blob/d99b4043b5cba48f633c32950830ade8bf18837a/docs/plans/TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md).
The branch's script syntax and lint, 72 focused tests, doc-currency and
fact-consistency gates and their self-tests, docs catalog, and diff check passed.

**2026-09-23 follow-up [VERIFIED via read-only sandbox/production workflow metadata and one guarded sandbox PATCH]:** Active sandbox business rule `WMKF_Set Meeting Date` has server-side XAML assigning `2024-12-13` for fiscal years containing `December` and `2024-06-07` for `June`. No workflow with that exact name was visible in Production. One ETag-guarded PATCH of `wmkf_meetingdate` on retained marked Request 1000339 returned 204 and read back `2099-12-01`; a later inspection found that date retained, one location, and no payment or regarding-email rows. The marker and app owner remained intact. The sandbox rehearsal script now corrects and verifies the date once after create, reconciles an ambiguous response by readback, and never retries the PATCH blindly. This is branch commit `523d705bd`, pushed with [sanitized evidence](https://github.com/justingallivan/wmkf-research-apps/blob/523d705bdaa8469fe4ff85e31a4c788c4d39b30a/docs/plans/evidence/test-request-factory/meeting-date-rule-and-patch-2026-09-23.json). The combined create-plus-correction path has not created a third Request.

**Next:** Use the proven app-owned folder/location path for the eventual
executor. Implement Stage 1 synthetic isolation before any production creation.
The sandbox meeting-date correction is now proven separately; verify the combined
path on a future bounded run. Production also needs a policy for a
possible vendor-created duplicate location; the production-only
`AkoyaGo.AsyncEntityCreated` step is still a candidate, not a proven
provisioner. The exact AkoyaGO automatic provisioner is no longer a prerequisite
for sandbox fixture creation. File-copy policy and a document-bearing source
remain later Basic-clone work. Do not repeat the broad Connor questions or
ask the owner to hand-create folders.

## Prior Session 532 Prompt: Request Document missing-actor warning noise fixed and released

## Session 531 Summary

[VERIFIED via Git, PR #325 CI, `vercel inspect`, read-only Postgres query]
The owner asked about an admin-panel warning, "A Request Document business
action completed without a verified staff actor" (×2, 9/19 7:59–8:08 PM PT).
A read-only query of `operational_events` showed that events 832 and 833 were
`site-visit-materials-upload`, reason `missing`, from an applicant uploading via
the materials contributor link. Every `request_document_actor_not_captured`
event on record came from that path or from consultant feedback attachments.
None came from a real staff identity gap, and five had already been dismissed
by hand. Event 834 is the same shape, tagged `preview`.

### What Was Completed

1. **Applicant uploads stop warning.** New
   `REQUEST_DOCUMENT_ACTOR_POLICY.EXTERNAL_CONTRIBUTOR` in
   `lib/services/request-document-actor-service.js`: no systemuser read, no
   bind, resolution reason `external-contributor`. `isActorNotCaptured()` gates
   both event sites in `lib/dataverse/adapters/request-document.js` `create()`
   (normal and lost-response recovery). `contributor-service.js` uses it, and
   the writer gate pins it.
2. **Consultant feedback attachments attribute the staff uploader.** Correction
   made mid-session: these are staff uploads, not consultant uploads. Owner
   chose "record the staff actor". The finalize route passes
   `access.session?.user?.dynamicsSystemuserId` through
   `finalizeAttachmentUpload` to the registry create, still under
   `ALLOW_UNATTRIBUTED`. The warning now means a genuinely unlinked staff
   identity.
3. **Census probe** (`scripts/probe-request-document-explicit-actor-census.js`).
   External-contributor rows are classified first, and any staff actor/time on
   one is a violation. `consultant-feedback-attachment` events are allowed only
   when both the row and the event name producer `consultant-feedback`.
   Self-test fixtures cover each guard independently (mutation-checked).
4. **Release.** Codex adversarial review (`gpt-5.6-sol`) took three rounds. Two
   census findings were fixed; round 3 approved. PR #325 CI was all green. The
   owner merged it as main `da401efa7`; production deployment
   `dpl_ASNEuUWoqqg2ns7jbtEW92dnF5uZ` is Ready. Docs updated: actor plan,
   applicant materials plan, service catalog.
5. **Housekeeping.** `3cc311830` removed the impeccable plugin enablement from
   `.claude/settings.json` (owner-intentional edit).

### Commits
- `3cc311830` — remove impeccable plugin enablement from project settings
- `c101ae7d1` — external-contributor policy; consultant session actor
- `12e1be098` — docs for the external-contributor policy
- `c0a022efb`, `fa5671f4e` — census contract enforcement + discriminating fixtures (Codex rounds 1–2)
- `da401efa7` — merge PR #325

## Next Items

### Preserved branch workstreams — 2026-09-22 coordination update

[VERIFIED via Git and GitHub] Two clean, pushed Codex branches remain separate
from `main`, with no open pull requests. Their implementation and branch-specific
handoffs are not part of the current `main` checkout:

1. **Presentation-media transport proof:** `codex/feature-request` at
   `703b8e76c`. The [branch closeout](https://github.com/justingallivan/wmkf-research-apps/blob/703b8e76c31c26468cb2a76856f2d0d10ba61762/docs/plans/CODEX_WORKSTREAM_CLOSEOUT_2026-09-22.md)
   records a successful Chrome proof and the remaining browser, reload, expiry,
   and large-file checks. The Preview harness is not a production feature.
   **Parked by owner decision this session** while Test Request prerequisites
   receive read-only investigation.
2. **Test Request read-only Admin preview:**
   `codex/test-request-preview-integration` at `b2c8e4088`. Its
   [branch handoff](https://github.com/justingallivan/wmkf-research-apps/blob/b2c8e4088fc0256b4478897a2a3cfd2933d6e919/SESSION_PROMPT.md)
   records the signed-in sandbox Preview smoke and the later offline owner
   contract change. Create/copy remains blocked by the execution file policy,
   Stage 1 isolation, a document-bearing sandbox fixture, and unresolved
   platform provisioning/automation behavior. The owner chose a software-only
   ownership compiler change next; no additional sandbox create, schema
   operation, document copy, or production integration was performed.

Preserve both branches and worktrees. Review and integrate each independently
from a fresh `main` baseline only after its release scope is decided. Recheck
the shared Preview alias and branch-scoped configuration before any change;
the branch handoffs' external-state observations were not re-probed in this
coordination update.

### Test Request read-only blocker investigation — 2026-09-22 PT

[VERIFIED via the checked-in sandbox create manifest and
`scripts/probe-test-request-sandbox-owner.js` GET at 2026-09-23 01:21 UTC]
The one successful sandbox POST for retained Request 1000338 omitted both
`ownerid` and `owneridtype`. The current row still matches the test marker/run;
its owner is a `systemuser`, equals `createdby` and `owninguser`, and that user
has the authenticated application's ID. This proves the sandbox supplied an
application-user owner for that exact create. This readback alone did not
establish a Production default. The owner policy is now decided below, but the
branch's pure compiler reported both fields as unresolved at that time. The
later branch change is recorded below.

[VERIFIED via `scripts/probe-request-owner.js --request=1002852` production GET at
2026-09-23 01:26 UTC] Existing Request 1002852 is owned and was created by
`# BCO akoyaGO Integration`, a Dataverse application user. Its `ownerid`,
`createdby`, and `owninguser` all point to that same user; `owningteam` is
empty. That is a different application identity from the one used by this
repo's authenticated probe. This single Request supports application-user
ownership as an existing pattern, but does not establish the owner policy for
every Request or the intended owner for future synthetic records.

[VERIFIED via `scripts/probe-request-owner.js --request=1003259` production GET at
2026-09-23 01:31 UTC] Request 1003259 is owned and was created by
`# WMK: Research Review App Suite`, the authenticated application user used
by this repo. `ownerid`, `createdby`, and `owninguser` agree; `owningteam` is
empty. Dataverse `createdby` names the writing principal, not necessarily the
human who initiated the action through the app.

[OWNER DECISION, 2026-09-22 PT] Request 1002852 is a real GOApply portal
application, while 1003259 is an honorarium Request made by this app suite.
After reviewing the recommendation, the owner settled that the app suite
should be both creator and owner of future Test Requests. [DECIDED; COMPILER
IMPLEMENTED, EXECUTOR NOT BUILT]
Have the app suite create without staff impersonation; omit `createdby`,
`ownerid`, and `owneridtype` from the POST, and require readback that creator
and owner are the expected app user. Keep the initiating staff actor in the
factory run ledger rather than substituting a staff record owner. The current
branch preview remains read-only, and production staff visibility under this
ownership still needs verification before enablement.

[VERIFIED via `codex/test-request-preview-integration` commit `cf886221b`,
source and focused tests] The pure compiler now accepts `ownerid` and
`owneridtype` as the two documented Dataverse-managed system-required fields,
never places them or `createdby` in the proposed POST body, and still blocks
unrelated unknown system-required fields. The preview service remains read-only
and strips executable payloads while file-policy approval is absent. Three
focused suites passed (65 tests), as did scoped lint, types, and the relevant
document/DAL gates. This change is pushed only on the feature branch; the
external Preview still runs its older deployment and has not been re-smoked.

[VERIFIED via the 2026-09-21 sandbox rehearsal receipt; current setting not
re-probed] Connor answered the original broad platform questions on 2026-09-21;
do not ask them again. The documented SharePoint model already identifies the
`akoya_request` library, Dynamics location relationship, and request folder
pattern. Production Request 1002788 is an existing Connor-created test fixture
for read-only reference, not a fresh factory destination. Background processing
was disabled and Request async workflows were canceled for the marked sandbox
Request 1000338. The actual new-request location provisioner/trigger and the
meeting-date rewrite remain unidentified. [Microsoft's administration-mode
guide](https://learn.microsoft.com/en-us/power-platform/admin/admin-mode)
says disabled background operations stop Dataverse asynchronous workflows and
Dataverse-triggered flows, while some other processes may still run. Obtain
platform-owner isolation and provisioner evidence before changing that setting or
attempting another create. No platform setting or business record was changed
by this read-only investigation.

[VERIFIED via read-only Dataverse/Graph GETs and a refreshed complete plugin-step
census, 2026-09-23 UTC] Request 1000338 now has one resolved `akoya_request`
document location and an empty physical folder. The location was created about
20 hours after the Request under Justin Gallivan's staff user; the original
attempt-window absence remains accurate. Production reference Request 1002788's
location appeared about 82 seconds after its Request under the GOApply
integration user. An enabled production `AkoyaGo.AsyncEntityCreated` Request
Create registration is absent from sandbox. The exact provisioner remains
unknown; restoring sandbox background processing alone is not a proven parity
fix. Request 1000338's meeting date remains `2024-12-13`. The branch's
[sanitized receipt](https://github.com/justingallivan/wmkf-research-apps/blob/b2c8e4088fc0256b4478897a2a3cfd2933d6e919/docs/plans/evidence/test-request-factory/location-followup-2026-09-23.json)
records the bounded checks. No remote write or setting change was made.

### Verified Open

1. **First natural production proof of PR #325.**
   Evidence: `dpl_ASNEuUWoqqg2ns7jbtEW92dnF5uZ` Ready; no upload since release.
   On the next real applicant materials upload, confirm no new
   `request_document_actor_not_captured` event. On the next staff consultant
   attachment, confirm `_wmkf_initiatedby_value` is set. Don't manufacture
   records.
2. **Census still treats Pre-RP brief fallback events as violations.**
   Evidence: `ALLOWED_UNATTRIBUTED_ORIGIN_STAGES` lacks
   `pre-rp-brief-generation` (a pre-existing gap). This matters only when the
   manual census is rerun. Add it with its producer before the next census run.

### Owner Action

- Dismiss events 832/833 (production) and 834 (preview) in the admin panel.

### Owner Decision Needed

- Suite-wide personal email defaults (carried from S529): unchanged, see
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.

### Verify Before Acting

- For the Test Request workstream above, verify current source and sandbox
  behavior before resolving a blocker; its branch handoff is historical
  evidence, not a live-state probe for this session.
- Older unrelated carryovers (cache telemetry, reviewer follow-ups) were not
  re-probed this session or last; use their plans and live checks.

### Do Not Reopen Without New Decision

- Consultant attachments record the staff actor (owner decision 2026-09-22);
  applicant uploads use `EXTERNAL_CONTRIBUTOR` with no event.
- S531 closures still stand: the scope of the institution-name heuristic, the
  Pre-RP expertise sentence, and snapshot versioning complete.

## Gotchas

- The auto-mode classifier blocked `gh pr merge` even after the owner said
  "merge". The owner ran it via `! gh pr merge ...`. Expect the same unless a
  permission rule is added.
- The Codex sandbox cannot run Jest (EPERM on the haste map); run suites locally.
- Local `.env.local` `POSTGRES_URL` reaches the shared `operational_events`
  table (production and preview rows, `environment` column).

## Key Files

- `scripts/probe-test-request-sandbox-owner.js` — pinned sandbox ownership
  readback for the retained Test Request fixture
- `scripts/probe-request-owner.js` — read-only Production ownership and
  creator readback for a specified Request number
- `lib/services/request-document-actor-service.js` — policies, `isActorNotCaptured`
- `lib/dataverse/adapters/request-document.js` — `create()` event sites
- `lib/services/site-visit-materials/contributor-service.js` — applicant upload create
- `lib/services/consultant-feedback-attachment-service.js`, `pages/api/workbench/consultant-feedback/finalize.js` — staff actor wiring
- `scripts/probe-request-document-explicit-actor-census.js` — census classifier

## Testing

```bash
npx jest request-document consultant-feedback site-visit-materials   # 308 pass
node scripts/probe-request-document-explicit-actor-census.js --self-test
npm run check:request-document-writers && npm run check:request-document-writers:self-test
```

## Stop-time notes

No milestone entry: a noise-reduction fix to an existing observability event,
with no new capability or architecture. Claim-evidence pilot: no eligible
plan/design edit was recorded, so no observation row was added. No memory
changes.

## Historical handoffs — not current instructions

All text below is historical context. Session 532 guidance above is authoritative;
older completion, cleanup and authorization statements apply to their named runs.

## Prior Session 531 Prompt: Pre-Site / Pre-RP brief fixes released, snapshot versioning complete

## Session 530 Summary

[VERIFIED via Git, CI on main, `vercel inspect`, signed-in owner check] Three
production releases fixed the reviewer paragraph in the Pre-Site Visit briefing
and the Pre-Research Presentation (Pre-RP) Brief, diagnosed on request 1002852.
Workflow: root planned, Sonnet built from scratchpad briefs, root reviewed,
Codex (`gpt-5.6-sol`, adversarial-review, twelve rounds total) reviewed each
release before the owner said "merge".

1. **Applicant-recommended reviewer expertise** (PR #321 → main `54346b00b`,
   deployment `dpl_B8H5CQ6efCEvrhBEFciGYUwRnMWs`). "Enrich recommended" now
   writes OpenAlex author research topics to `wmkf_keywords` (fill-if-empty,
   ETag-conditional PATCH with one re-read retry) for candidates with no claimed
   expertise. `composeRefereeSection` emits `referee_expertise_missing`; the
   Pre-Site artifact model and the Reviews tab surface it as a warning.
2. **Byline affiliations reduced to institution names** (same PR + PR #322 →
   main `1a2a3331a`, deployment `dpl_7jSwz134V1BXuzvduLpj3CrLwbF7`).
   `institutionNameOf` / `looksLikeByline` in
   `shared/utils/review-writeup-paragraphs.js`: two institutions joined with
   "and"; a confirmed `mainInstitution` is reduced only when byline-shaped; the
   accept-form Main-institution prefill seeds the reduced name; Pre-RP card shows
   "Word draft · generated <date>". Owner decision: the heuristic stopped after
   Codex round 6; remaining misses are corrected by staff in the Reviewer Finder
   candidate edit modal.
3. **Pre-RP Brief expertise sentence + snapshot versioning** (PR #323 → main
   `90b6c6838`, deployment `dpl_Dj2Hjo2xMrpJnKu9yY2tCfFnZXv2`, Ready 2026-09-22
   03:58Z; six CI workflows green; 307 on applications/grantees/reviews/
   submissions). Referee Comments paragraph gains the expertise sentence
   (`renderVersion` '5', reversing the 2026-09-16 plan's two-sentence rule).
   Fingerprint fields widened (+lastName/keywords/areaOfExpertise) behind
   snapshot `schemaVersion`: readers accept 1 and 2, legacy rows verify and
   drift-compare under their own version, a reclaimed generation row renders
   from its verified stored snapshot (409 `pre_rp_brief_snapshot_invalid`
   otherwise). Phase 1 wrote v1 snapshots.
4. **Pre-RP snapshot versioning phase 2** (PR #324 → main `0f2f22c46`,
   deployment `dpl_A6qv3LPwa1UNBsJdrft8bqiEB3bg`, Ready 2026-09-22 04:58Z; 307
   on the four hosts; CI: Tests, E2E, Security, Dependency, Secret Scanning
   green, CodeQL still running at handoff). Writer flipped to
   `snapshotSchemaVersion: 2`; new briefs fingerprint over the 11-field list so
   expertise-only changes register as drift. Rows written by phase 1 stay v1
   until regenerated and do not flag expertise-only drift. Two fresh Agent
   adversarial reviews (receipts for the 2026-09-16 plan) approved; the first
   caught three stale phase-1 comments and forward-dated "2026-09-22" wording,
   fixed in the amended commit.

Owner completed the manual side: corrected Herwig Schüler's Main institution and
expertise, regenerated, and confirmed the draft briefing looks good.

### Commits (all on main)
- `df313efd8`, `4365e02f5` — expertise fill + diagnostic, Codex fixes
- `2937cdfa4`, `15128a2b5`, `54346b00b` — institution-name reduction, Codex rounds 2–3
- `8ad57295a`, `0bdcc4ce6`, `fdbf8ca6f`, `1a2a3331a` — mainInstitution gating, structural tier rules, card date
- `fc9a5ca48`, `3568e7e72`, `21410bf8e`, `90b6c6838` — Pre-RP expertise sentence, snapshot versioning phase 1, reclaimed-row provenance
- `72f951b73` — Session 530 handoff (first pass)
- `0f2f22c46` — snapshot versioning phase 2 (writer v2)

## Next Items

### Verified Open

- None carried from this session. Both feature branches
  (`feat/pre-rp-brief-expertise`, `feat/pre-rp-snapshot-v2`) are merged and
  deleted locally and on origin (`git ls-remote --heads origin 'feat/pre-rp-*'`
  returns nothing).

### Owner Decision Needed

- Suite-wide personal email defaults (carried from S529): unchanged, see
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.

### Verify Before Acting

- Older carryovers (Connor/Test Request Factory, cache telemetry, reviewer
  follow-ups) were not re-probed this session; use their plans and live checks.

### Do Not Reopen Without New Decision

- Institution-name heuristic scope: owner closed further rounds 2026-09-21
  (Codex round 6). Trailing unlisted city stays verbatim by design.
- Pre-RP brief carries the expertise sentence (owner decision 2026-09-21).
- Snapshot versioning is complete (writer v2, readers v1+v2). Do not re-widen
  `REVIEW_FINGERPRINT_FIELDS` without bumping the version and its field list.

## Gotchas

- Codex runs in a separate checkout (`WMKF_Apps-codex`, branch
  `codex/parallel-session`) plus other worktrees; pass `--base main` and a
  committed diff, and don't read its branch state as this checkout's.
- `codex-companion.mjs --help` starts a review; never pass it.
- Mutation checks: commit or stash the fix before `git checkout <prev> -- file`;
  `git checkout HEAD -- file` otherwise drops it (bit S530, caught by Codex).
- `shared/utils/review-writeup-paragraphs.js` is Jest-only (extensionless
  imports); probe with a throwaway Jest test, delete before commit.

## Key Files

- `shared/utils/review-writeup-paragraphs.js` — composer, `institutionNameOf`, `looksLikeByline`, diagnostics
- `lib/services/pre-rp-brief/docx-renderer.js` — fingerprint field lists, versioned `briefInputFingerprint`
- `lib/services/pre-rp-brief/artifact-service.js` — `storedBriefEnvelopeForRender`, reclaimed-row render
- `lib/services/pre-site-visit/distribution/context.js` — `assertBriefInputsReady` under stored version
- `lib/services/workbench/enrich-recommended-service.js` — `expertiseKeywordsFor`
- `lib/dataverse/adapters/researcher.js` — `upsertByPotentialReviewer` ETag retry

## Testing

```bash
npx jest 'pre-rp|pre-site-visit|distribution|review-writeup|reviews-tab|external-review|enrich-recommended'
# full gate set: 67 PASS expected, gates sequential with their self-tests
```

## Stop-time notes

No milestone entry: four incremental releases to existing brief capabilities, no
new architecture or cutover. Claim-evidence pilot report: zero advisory events
and no eligible plan-doc edit recorded, so no observation row added. Memory:
one mechanics line added to
`feedback-mutation-test-with-the-discriminating-fixture.md`; router unchanged.

## Historical handoffs — not current instructions

All text below is historical context. Session 531 guidance above is authoritative;
older completion, cleanup and authorization statements apply to their named runs.

## Prior Session 530 Prompt: Meeting Tracker released; session housekeeping complete

## Session 529 Summary

[VERIFIED via Git, tests, Vercel and signed-in browser] Luna built, Sol reviewed,
root adjudicated, and the owner approved these production releases:

- Agenda-send refusal feedback and D1/D9 response handling: merges `301d4d141`
  and `8623c2f7b`. Both are DONE, not background tasks or pending work.
- Materials email personalization: merge `834b83d83`; personal defaults,
  editable invitation/reminder previews, PI/liaison/coordinator naming and
  owner-approved shared Admin copy. Release receipt is in its plan.
- Materials status pills and filters: runtime `00fd729da`, main promotion
  `d3d93da39`, production verified on `applications.wmkeck.org/meeting-tracker`.
  Details stay beneath pills; Request materials and Review materials lead to
  existing visit controls. Unknown reads stay distinct from not requested.
- Final release checks: 1,053 suites / 15,549 tests / one snapshot passed;
  type/docs gates and reminder-hold gate/self-test passed. Sol and Opus reviews
  accepted; signed-in Preview and Production read checks passed. No email or
  business-data write was performed during those checks.

### Housekeeping

[VERIFIED via CLI] The shared Preview alias was restored to its original target
`dpl_ARYTuEzrTbT3U7vt1ZUKyiGgmt6C`; the three Meeting Tracker branch-scoped
settings were removed. Its three temporary Preview deployments were retired.
The clean `/private/tmp/wmkf-meeting-materials-status` worktree was removed and
its port-3131 rehearsal server stopped. Git history is retained. Other worktrees,
older preview environments, and Azure callbacks were left alone.

## Next Items

### Owner decision needed

- Suite-wide personal email defaults remain a separately scoped to-do, not part
  of the completed tracker release. Evidence: `docs/CURRENT_WORK_QUEUE.md`
  Personal email defaults entry and `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.
  Choose a next app/surface before extending the existing mechanism.

### Verify before acting

- Older carryovers below (Connor/Test Request Factory, cache telemetry,
  client-request-layer Preview cleanup, reviewer follow-ups) were not re-probed
  during this closeout. Use their authoritative plans and live checks before
  making them a worklist. Do not delete another task's preview or worktree.

### Do not reopen without new evidence

- D1/D9, agenda refusal feedback, materials personalization, and status pills
  are released. There is no pending D1 agent task.
- Check files and Ready were covered by synthetic UI/unit tests; neither
  occurred in the live nine-row assigned scope. Do not claim live review/ready
  mutations were exercised. The real Preview was not a no-write sandbox.

## Key Files

- `docs/plans/AGENDA_D1_RELEASE_2026-09-20.md`
- `docs/plans/MATERIALS_EMAIL_PERSONALIZATION_PLAN_2026-09-20.md`
- `docs/plans/MEETING_TRACKER_MATERIALS_STATUS_PLAN_2026-09-21.md`
- `shared/components/meeting-tracker/MaterialsStatusPill.js`
- `shared/utils/site-visit-materials-status.js`

## Stop-time notes

Milestone entry added for the Meeting Tracker materials workflow release.
Claim-evidence pilot report could not read local state; no observation inferred.
Root instruction files and memory router were unchanged. This documentation-only
handoff push may trigger another Vercel build of the same runtime code.

## Historical handoffs — not current instructions

All text below is historical context. Session 530 guidance above is authoritative;
older completion, cleanup and authorization statements apply to their named runs.

## Prior Session 529 Prompt: Client Request Layer merged and deployed; preview cleanup + D1 remainder

## Session 528 Summary

[VERIFIED via source, per-stage fresh Opus reviews, Gate G logs, owner browser
click-throughs, `vercel env ls`/`vercel inspect`, Git] Session 528 (an
overnight-into-afternoon orchestration: Fable orchestrating, Sonnet building,
Opus reviewing fresh per stage, Codex adversarial on the plan) planned and
built the **Client Request Layer** refactor end to end on
`feature/client-request-layer` (~286 commits since `origin/main` `e269756ac`):
`shared/utils/api-request.js` (`requestJson` / `requestEnvelope`) now carries
every client JSON `fetch` in `shared/components/**` and `pages/**`
(non-api); the 26 remaining raw `fetch(` sites are the §2.6 allowlist (21 SSE
streams, 3 blob downloads, 2 beacons), each annotated, and an ESLint
`no-restricted-syntax` ratchet (`eslint.config.mjs`, T6 fixture test) keeps
it that way. Plan status is `complete`. **Nothing is merged to `main`; the
branch carries Tier 2 work (Stages 4 and 5b), so merge is an explicit owner
decision.** **Update 16:20 PT: the owner said "merge"; merge commit
`23901d5da` is on `main` and deployed as `dpl_7PMh3nf1w5fiUNst2pmAQZdUvtUR`
(Gate G rerun green on the merged head; DEVELOPMENT_LOG entry written). GitHub `Tests` went red on `main` for one CI-only race in `workbench-request-number-lookup.test.js`; test-only fix `b65a392be`, all five workflows green on it — see the execution log "Post-merge CI red".**

### What Was Completed

1. **Plan + adversarial review** — `docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md`
   (Codex 3 cycles on gpt-5.6-sol; owner decisions 1–6 recorded), execution log
   `docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md` (census, per-stage
   logs, fresh-review receipts, acceptances, rehearsal records).
2. **Stages 0–6 built and accepted** (Stage 0 `e65b03a0`, 1 `c3a84a41`, 2
   `3472bcbc`, 3 `a1aaec80`, 4 code `d82f24df4`, 5 accepted at `976458f9a`+
   `135f11d9e`, 6 accepted at `9f64a364a`). Gate G at `c9dd84e2e`: every
   `check:*` gate + self-test green, lint 0 errors, types clean, **1042 suites /
   15430 tests**, build compiled.
3. **Tier 2 rehearsals recorded** — Stage 4: owner click-through on localhost
   (release, closeout passed; due date test-covered). Stage 5b: scheduled-emails
   and test-email passed on the preview; token pages and pre-site/Reviews-tab
   previews recorded test-covered (owner decision) because the preview's
   `EXTERNAL_LINK_SECRET` differs from production's and the workbench manage
   controls are hidden on preview. See memory
   `project-preview-rehearsal-venue-limits`.
4. **Defects found and fixed along the way** — StrictMode cleanup-only
   `mountedRef` guard hung dialogs in dev (`1ce5587c9`, three components,
   StrictMode pin); release dialogs' `write_failed` copy now names the cause
   and a recovery ladder via a server `failure` code (owner-approved sentences;
   `896796ed`, `ba3741db`, `250e7b9c`, `a41d3716`); `terminal-transition.js`
   no longer forwards raw upstream error text; pre-site reissue per-code
   fallbacks (`4462f05d`); D1/D10 admin and Stage 4 batches (accepted).
5. **Preview environment for the branch** (owner-authorized): alias
   `wmkfresearchapps-preview.vercel.app` → `wmkfresearchapps-6l5suly2f`;
   branch-scoped preview env `NEXTAUTH_URL`, `DATAVERSE_ALLOW_PROD_READS=yes`,
   `DELIBERATION_BRIEFING_SCHEMA_READY=on`. Rollback commands in the execution
   log ("Stage 4 rehearsal setup").
6. **Production rollback record** (refreshed 2026-09-20 15:30 PT):
   `dpl_oSuLQGHdubsaN5pma7D7wXGvqPki` (`wmkfresearchapps-ocl7vs3ux`, aliases
   `reviews.wmkeck.org`, `grantees.wmkeck.org`; `origin/main` `e269756ac`).

### Commits
- ~286 on `feature/client-request-layer`; see `git log --oneline e269756ac..origin/feature/client-request-layer`
  and the per-stage commit lists in the execution log. Docs-only banner commit on `main` for this handoff.

## Next Items

### Owner Decision Needed

1. ~~Merge~~ **DONE 2026-09-20 16:20 PT** — `23901d5da` on `main`, production
   `dpl_7PMh3nf1w5fiUNst2pmAQZdUvtUR` Ready on both aliases; public briefing
   page smoked. Rollback = redeploy `wmkfresearchapps-kwgubwobw`. Optional
   owner smoke: release dialog on a ZZTEST request in production.
2. **Preview env cleanup** after merge or abandonment: `vercel alias rm
   wmkfresearchapps-preview.vercel.app`; `vercel env rm <NEXTAUTH_URL |
   DATAVERSE_ALLOW_PROD_READS | DELIBERATION_BRIEFING_SCHEMA_READY> preview
   feature/client-request-layer`. Owner call (the flags grant prod reads).
3. **`ReviewerManagePanel.js:884` alert path** still shows the literal
   `write_failed` status word (Stage 6 review finding 3); the `failure` code is
   on the same row. Route it through the same cause/recovery copy, or record the
   asymmetry as deliberate.
4. **Agenda-send refusal fix — released 2026-09-20.** [VERIFIED via Git,
   Vercel API and signed-in read-only smoke] Merge `301d4d141`, deployment
   `dpl_HoTApcaJCeMFaJEZFHeHWwdfSJZy`; competing sends now show "Not sent."
   Release evidence: `docs/plans/AGENDA_D1_RELEASE_2026-09-20.md`.

### Verified Open

1. **D1 remainder + D9 — released 2026-09-20 after the agenda fix.**
   [VERIFIED via Git, Vercel API and signed-in read-only smoke] Merge
   `8623c2f7b`, deployment `dpl_9rNyDMfuEMHPHo6ndSNh3di9d9eQ`.
   Luna built, Sol reviewed, root accepted. Detailed release, CI and rollback
   evidence: `docs/plans/AGENDA_D1_RELEASE_2026-09-20.md`.

2. **O4 observation** (execution log ~:707): ~16 sites keep the
   `parseError` rethrow idiom (old bare-`.json()` behavior) while others took
   D3's fallback text. Owner may want one policy; today both are within the bar.
3. **Five-code `failure` vocabulary duplicated** in two services and two modals
   (Stage 6 review finding 4). Add a shared constant + parity check if a sixth
   code ever appears; not needed today.
4. **SSE consolidation** — named sibling plan in plan §1; two parsers exist
   (`shared/utils/sse-stream.js`, `shared/components/reviewers/sse.js`).

### Parked

1. Session 527/528-prompt items (Executor cache telemetry cross-document read,
   Test Request Factory) — untouched this session; see the historical Session
   528 prompt below for their evidence and state.

### Verify Before Acting

0. `feature/client-request-layer` is merged; delete the remote branch only
   after confirming `git branch -r --merged origin/main` lists it.
1. Any "delete `readJsonBody`" impulse: it is exported with no live caller by
   design (plan: keep exports); its tests pin it. Verify callers before removal.
2. The preview alias points at build `6l5suly2f` (branch head `a41d37162`),
   not the final branch head; the git-integration build for later pushes was
   not re-aliased. Re-alias before any further preview click-through.

### Do Not Reopen Without New Decision

1. D3 (fallback text, never raw parse text, on non-2xx unparseable) — accepted.
2. Steps 3–6 and 9 of the 5b rehearsal recorded test-covered; production link
   secret was deliberately NOT copied into the preview.
3. Release-dialog `write_failed` sentences — owner-approved verbatim
   2026-09-20 ("approve").
4. Deviation (6) — closed (pre-site fallbacks; agenda-send claim corrected).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/utils/api-request.js` | The helper: `requestJson`, `requestEnvelope`, `readJsonBody`, `deriveErrorMessage`, `ApiRequestError` |
| `eslint.config.mjs` | Closeout ratchet block (`no-restricted-syntax` on raw `fetch(`) |
| `tests/unit/eslint-no-raw-fetch-ratchet.test.js` | T6 fixture proving the rule's scope and site-level exemption |
| `docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md` | Plan (status complete), §2.6 allowlist (26 sites), D-ledger |
| `docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md` | Per-stage logs, review receipts, rehearsals, rollback record |
| `docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md` | D1 cold-start handoff and remaining sites |
| `.claude-memory/project-preview-rehearsal-venue-limits.md` | What preview vs localhost can exercise; StrictMode guard hazard |

## Testing

```bash
npx jest tests/unit/api-request.test.js tests/unit/eslint-no-raw-fetch-ratchet.test.js tests/unit/client-request-stage1-adapters.test.js
npm run lint            # 0 errors expected; raw fetch outside the allowlist is an error
npx jest --silent       # 1042 suites / 15430 tests at c9dd84e2e
```

## Stop-time notes

Claim-evidence pilot: current-session report shows zero advisory events and
no eligible plan/design edit recorded, so no observation row was added. No
DEVELOPMENT_LOG entry: the refactor is complete on the branch but not merged
or deployed; write the milestone entry when the owner merges. Session docs
were committed on the feature branch and mirrored as a docs-only commit on
`main` (per `feedback-feature-branch-handoff-lands-on-main`), written from a
temporary worktree so the owner's running dev server on the branch checkout
was not disturbed.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 529 guidance above
controls current next steps.

## Prior Session 528 Prompt: Executor cache telemetry read; post-fix cross-document read still pending

## Session 527 Summary

[VERIFIED via owner-run production Dataverse reads, source, gates, Git, GitHub CI,
and the Vercel API] Session 527 ran in the worktree `worktree-claude-s525` while
Codex finished the Graph release on `main`. It took handoff item 1 (prove realized
cache reads for the S524 Executor prefix fix) as far as production traffic allows:
built a read-only run-row telemetry probe, had the owner run it three times, and
reconciled the durable docs against what the rows actually show. Sonnet wrote the
probe; interpretation, corrections, and docs were the orchestrator's.

### What Was Completed

1. **Read-only `wmkf_ai_run` cache-telemetry probe**
   - `scripts/probe-ai-run-cache-reads.js`: lists recent Executor run rows with
     `--prompt <name>`, `--request <num>`, `--since <ISO>`, `--limit N`; parses
     `cache_create`/`cache_read`/`cacheHit`/latency out of `wmkf_ai_notes`; prints
     the prompt name per row. Owner-run (reads whichever Dataverse `.env.local`
     points at). The `_wmkf_ai_prompt_value` lookup filter is now
     [VERIFIED via live query 2026-09-20].
   - Gates run sequentially after each change: dataverse-access-layer,
     dynamics-context-boundary, trust-boundary-guid, odata-escape, secret-scan,
     scaffolding-tokens (+ self-tests), all green.

2. **What production telemetry showed (rows since 2026-09-16)**
   - `phase-i.summary`, the prompt S524 planned to test with, has had no runs
     since 2026-04-25. The original test plan was moot.
   - The Executor prompts that batch within the TTL are `cycle-dossier.entry`
     (Opus 5; 3 documents in 28 s on 09-17, 2 in 4 s on 09-16; marked prefix
     610–618 tokens) and `review-synthesis.generate` (Sonnet 5; documents 4 min
     apart on 09-18; 1841–2258 tokens). Pre-fix rows show every document writing
     its own entry and none reading: the R4 write-no-read pattern, observed.
   - `cache_create` on a fresh run is the measured marked-block size for the live
     prompt row, which supersedes the chars/4 seed estimates. Review panel: seat v2
     552, chair v3 801, both on Opus 5, so the panel DOES cache its system block.
     The audit doc's "panel caches nothing" claim is withdrawn. The seat resolved to
     Opus 5 in the 09-17 row although source defaults it to Fable 5.1
     (`shared/config/baseConfig.js` `review-panel.seat.claude`); override config
     not read.
   - The fix landed on `main` at 2026-09-19 19:48Z. The only post-fix row is one
     `initial-assessment.generate` document (prefix 645 vs 677 pre-fix on the same
     row/version, consistent with the nonce line gone). **The post-fix
     cross-document read is not yet observed.**

3. **Durable reconciliation**
   - `docs/PROMPT_CACHING_AUDIT.md` §0 R4 (telemetry table, withdrawn panel claim,
     closing check), §3 R4 qualifier, §4 verification (script invocation),
     frontmatter. `.claude-memory/project-cache-hit-rate-review.md`, agent-wiki
     `prompt-executor.md` (telemetry bullet). Docs catalog regenerated.
   - `scripts/audit-system-prompt-sizes.js` could not run as documented: the bare
     `node scripts/...` form fails on the app's extensionless imports (S524's
     "re-verified" was a mocked-rows check). Added `npm run audit:prompt-sizes`
     (uses `scripts/lib/use-extensionless.mjs`) and fixed the docblock. It has
     still not been run end-to-end; it is owner-run (production prompt rows).
   - Handoff correction: Executor cache telemetry lives in Dataverse
     `wmkf_ai_run` notes (`aiRunAdapter.create` in `execute-prompt.js`
     `writeRunRow`), not Postgres.

4. **Release**
   - Branch rebased onto Codex's Graph closeout (`d9cf70b5`; no file overlap),
     then `main` fast-forwarded `d9cf70b5` → `7c729379` with owner approval and
     pushed from the worktree. Vercel production `dpl_6Z3Fv3mYxpkSYiQCjqmUQrbsQvbd`
     READY at `7c729379` (docs + scripts only, no runtime change). All five CI
     workflows passed. Rollback: `dpl_ExUrFDvxPXPfSrzYzhJVL7ieeQWJ` (`a24a02d5`).
   - Per-machine worktree setup: `.agents/skills` symlink, `node_modules` symlink,
     memory symlinks at both the harness slug (`--claude-worktrees-`) and the
     `check-agent-invariants` slug (`-.claude-worktrees-`); the two disagree on the
     dot, so a worktree needs both. `check:agent-invariants` was the only red at
     `/start` and cleared once the symlink existed.

### Commits
- `c6280aa1` - chore(scripts): add read-only wmkf_ai_run cache-telemetry probe
- `ea72f07a` - chore(scripts): show prompt name per run in the cache-telemetry probe
- `7c729379` - docs: record production cache telemetry for the Executor prefix fix

## Next Items

### Verified Open

1. **Observe the post-fix cross-document cache read (item 1 closing step).**
   Evidence: `docs/PROMPT_CACHING_AUDIT.md` §0 R4 telemetry table; only one
   post-fix row as of 2026-09-20 03:14Z. Owner-run:
   `node scripts/probe-ai-run-cache-reads.js --since 2026-09-19T19:48:00Z --limit 25`.
   Expect later documents of a `cycle-dossier.entry` or `review-synthesis.generate`
   batch to show `cache_read` ≈ the first document's `cache_create`. If they still
   show create-only, read that prompt row's system template in Dataverse for
   interpolated variables (S524's grep covered bundled seeds only). No deliberate
   test needed unless the owner wants it closed before the next natural batch.
2. **Await Connor's platform-owner evidence for the Test Request Factory** (carried
   from Session 526, unchanged). Evidence:
   `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md`. Production
   enablement stays blocked; no clone route, schema apply, creation, or send.
3. **Preview CSRF origin check rejects alias-hosted POSTs** (carried from S523,
   unchanged). Evidence: `lib/utils/auth.js` `validateOrigin`;
   `docs/CURRENT_WORK_QUEUE.md` entry. Prefer the runbook step first.

### Owner Decision Needed

1. **Review-panel user-turn cache breakpoint, premise corrected.** The system
   block already caches on Opus 5 (seat 552, chair 801). The only open lever is
   the unmarked user turn holding the proposal + question set; it pays only if
   the same proposal is re-sent within the TTL (seat retries, chair rerun). Read
   panel run-row cadence with the probe (`--prompt review-panel.seat`,
   `--prompt review-panel.chair`) before deciding; if gaps exceed 5 minutes the
   lever is `ttl: '1h'`, not a breakpoint.
2. **R5 items** (`composeScorePrompt` batch loop, `process-phase-i-writeup` static
   block, ~10 single-shot callers with a random nonce at byte 0). Still gated on
   the `api_usage_log` hit-rate query per app; unchanged.
3. **Test Request Factory enablement boundary** (carried from Session 526).
   Decide only after Connor's evidence and the bounded rehearsal results.
4. **Reviewer search functional follow-ups** (carried;
   `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`).

### Parked

1. Dynamics Explorer history caching (carried; re-open only if the Explorer moves
   off Haiku). Impeccable 11px exception (carried). Memory router diet debt
   (router unchanged this session; `check:memory-router` reports 7054 bytes, under
   the 8 KiB trigger).

### Verify Before Acting

1. **`npm run audit:prompt-sizes` has never completed end-to-end.** The invocation
   is fixed but unproven past the first prompt module; it reads production prompt
   rows and spends `count_tokens` calls, so the owner runs it. For Executor rows
   prefer the measured `cache_create` from the probe.
2. **Remove two stale Entra callbacks for retired Codex branch aliases** (carried;
   owner-run tenant write). Destructive: list and confirm the exact redirect URIs
   before touching anything.
3. **Refresh production deployment and rollback facts before another release
   action** (carried from Session 526). Current: `dpl_6Z3Fv3mYxpkSYiQCjqmUQrbsQvbd`
   at `7c729379`; runtime evidence is sampled, not continuous.
4. **Worktree gate runs:** the harness memory slug and the gate's slug differ for
   dotted paths (`.claude/worktrees/...`); if `check:agent-invariants` is red in a
   worktree, create the symlink at both slugs before assuming a repo problem.

### Do Not Reopen Without New Decision

1. Do not re-add the nonce list to the Executor preamble; do not add a cache marker
   without a verified floor and repeat-within-TTL use (carried).
2. Do not reopen the completed GraphService decomposition or promote Test Request
   Factory capability from `codex/test-request-design` without Connor's evidence
   and release approval (carried from Session 526).
3. The "review panel caches nothing" claim is withdrawn on measured data; do not
   restore it from the older seed estimates.

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/probe-ai-run-cache-reads.js` | Owner-run read-only run-row cache telemetry (prompt/request/since filters) |
| `docs/PROMPT_CACHING_AUDIT.md` | §0 R4 telemetry table, closing check, withdrawn panel claim |
| `.claude-memory/project-cache-hit-rate-review.md` | Cache remaining-work pointer with the measured prefixes |
| `docs/agent-wiki/topics/prompt-executor.md` | Executor hazards incl. where cache telemetry lives |
| `scripts/audit-system-prompt-sizes.js` + `npm run audit:prompt-sizes` | Bundled-app prefix-size audit (loader-required invocation) |
| `lib/services/execute-prompt.js` | `composeMessages` (nonce-free preamble), `callProvider` (system-only marker), `writeRunRow` / `buildSuccessNotes` (notes format) |
| `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` | Test Request Factory blockers (Codex, Session 526) |

## Testing

```bash
# Owner-run (production Dataverse read): post-fix cross-document read check
node scripts/probe-ai-run-cache-reads.js --since 2026-09-19T19:48:00Z --limit 25
# Owner-run: bundled-app prefix sizes (count_tokens + production prompt rows)
npm run audit:prompt-sizes
# Gates touched this session (sequential; each with its self-test)
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:odata-escape && npm run check:odata-escape:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:docs-catalog
```

## Stop-time notes

Claim-evidence pilot: the current-session report shows zero recorded advisory
events and no eligible plan/design edit, so no observation row was added. No
milestone entry: telemetry read and docs reconciliation, not a new capability or
cutover. Session docs were written on `worktree-claude-s525` and land on `main`
by fast-forward.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 528 guidance above
controls current next steps. The Session 527 prompt body (Codex's Session 526
Graph release summary) follows unchanged, then older handoffs.

## Prior Session 527 Prompt: Production Graph release complete; Test Request Factory handoff pending

## Session 526 Summary

[VERIFIED via `/private/tmp/graph-production-release-receipt.json`, production smoke, CI results, and bounded runtime logs]
The GraphService release was promoted to `main` at `a24a02d588be728ade199069e7b953dbafdce96e` and deployed as `dpl_ExUrFDvxPXPfSrzYzhJVL7ieeQWJ`. All four custom domains are listed on the verified release. Authenticated staff, contributor, and proposal-download smoke checks passed. A bounded sample of 100 sanitized runtime records contained zero errors or 5xx responses. All five CI workflows passed. Rollback deployment: `dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS`.

### What Was Completed

1. **GraphService production release**
   - `main` was fast-forwarded and pushed with owner approval.
   - Secret Scanning, Dependency Scan, Security Scan, E2E (Playwright), and Tests all completed successfully.
   - Production smoke covered the authenticated staff page, expected contributor checklist/receipt, and proposal download HTTP 200.
   - Runtime evidence is bounded, not exhaustive monitoring: `/private/tmp/graph-production-runtime-sanitized.jsonl`.

2. **Test Request Factory handoff preparation**
   - The separate design/implementation branch is `codex/test-request-design` in `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps`.
   - Current factory status remains **production enablement blocked**. Offline policy/isolation work is accepted; no clone route, schema apply, live request creation, deployment, or email send is enabled.
   - Connor was emailed; response is pending. Handoff details are in `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md`.

3. **Concurrent worktree boundary**
   - Claude's active clean worktree is `worktree-claude-s525` at `aed0337d`. Do not touch it from this session.

## Next Items

### Verified Open

1. **Await Connor's platform-owner response for Test Request Factory suppression and provisioning.**
   Evidence: `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` and the Stage 0 contract in the test-request-design worktree.
   Required evidence covers create/update automation suppression, narrative/package/status consumers, SharePoint location provisioning, numbering/defaults, and isolated fixture readback.

### Owner Decision Needed

1. **Test Request Factory enablement boundary.**
   Evidence: `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` and `TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md` in the separate branch.
   Decide only after Connor supplies named owner/config evidence and the required bounded rehearsal results; unknown suppression or folder provisioning keeps production disabled.

### Verify Before Acting

1. **Refresh production deployment and rollback facts before another release action.**
   Evidence: `/private/tmp/graph-production-release-receipt.json` is the current bounded receipt; runtime log review is sampled, not continuous monitoring.

### Do Not Reopen Without New Decision

1. Do not reopen the completed GraphService decomposition or promote Test Request Factory capability from `codex/test-request-design` without the explicit platform-owner evidence and release approval above.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/CONNOR_TEST_REQUEST_FACTORY_HANDOFF_2026-09-19.md` | Connor's required platform-owner evidence and factory blockers |
| `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps/docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` | Separate factory design and stage boundary |
| `/Users/gallivan/.codex/worktrees/test-request-design/WMKF_Apps/docs/plans/TEST_REQUEST_FACTORY_PLATFORM_CONTRACT_2026-09-19.md` | Stage 0 metadata, automation, provisioning and suppression evidence |
| `/private/tmp/graph-production-release-receipt.json` | Production release, smoke, CI and rollback receipt |
| `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md` | Historical Graph stage evidence and release boundary |

## Testing

- Production receipt: authenticated staff/contributor/download smoke passed; 100 sampled sanitized runtime records had zero errors/5xx.
- CI: Secret Scanning, Dependency Scan, Security Scan, E2E (Playwright), and Tests passed.
- No additional live calls or writes are authorized by this handoff.

## Historical handoffs — not current instructions

The following prior Session 525 prompt and older summaries are retained evidence.
Their deployment claims and authorizations belong to those named releases;
current Graph migration status and next actions are above.

## Prior Session 525 Prompt: Prompt-cache prefix fix shipped; panel breakpoint and R5 wait on telemetry

## Session 524 Summary

[VERIFIED via source, scoped Jest, gates, Codex adversarial review, Git, and Vercel
API] A read-only prompt-caching review (delta against the July 2026 audit in
`docs/PROMPT_CACHING_AUDIT.md`) found the audit's open item R4 was overstated, fixed
the one-line cause on a Tier 1 branch, reconciled the durable restatements, and
promoted the branch to production as a fast-forward of `main`.

### What Was Completed

1. **Executor cache prefix is now byte-identical across documents (R4 closed)**
   - `composeMessages` in `lib/services/execute-prompt.js` prepended
     `buildUntrustedContentPreamble(untrustedNonces)` to the `cache_control`-marked
     system block, so every document put a unique nonce line at byte 0 and the
     marker was a cache write with no read. It now calls the preamble with no
     nonce list (the helper documents the line as optional; sentinels carry the
     nonce on open and close; the Dynamics Explorer has shipped nonce-free since
     A7 Part 3). No schema split was needed: no prompt definition places an
     untrusted variable in a system template (disconfirming greps recorded in the
     audit doc §0 R4).
   - Pinned by `tests/unit/execute-prompt-payload-boundary.test.js` (nonce-free
     system assertion + "two different documents share a byte-identical marked
     system block"); mutation-tested by restoring the nonce list (2 tests red).
   - `/contract-reconcile` (Mode B) confirmed both `assertSystemIncludes` callers
     are unaffected: peer-review asserts its own route-built preamble nonces and
     declares no untrusted variable; pre-site-visit asserts static sentences.
   - Codex adversarial review (OAuth, `--base main`): no A7 regression; one medium
     finding (audit script still read the removed `FLOOR`), fixed and re-verified
     with mocked rows.

2. **Durable reconciliation**
   - `docs/PROMPT_CACHING_AUDIT.md` §0/§3 R4 rewritten (DONE; historical framing
     kept and labelled), per-tier floors recorded (Opus 5 / Fable 5.1 512; Opus 4.8 /
     Sonnet 5 1024; Haiku 4.5 4096), `last_verified` 2026-09-19.
   - `.claude-memory/project-cache-hit-rate-review.md`, agent-wiki
     `prompt-executor.md` (new "preamble is nonce-free by design" bullet),
     `scripts/audit-system-prompt-sizes.js` (per-tier `FLOORS`, `verdict(n, tier)`),
     docs catalog regenerated.

3. **Release**
   - `main` fast-forwarded `62454b07` → `b54d11b5`; Vercel production deployment
     `dpl_VruCcbXfwdB96Fxmh7H6rjdYUjpB` READY at commit `b54d11b5` (verified via
     `vercel api`). Rollback: `wmkfresearchapps-g8484ufro` (`62454b07`) or revert
     `486ba38b`.
   - Gates: full `/start` run 35 gates + 32 self-tests green before work; affected
     gates re-run green after each edit. Scoped Jest 46 suites / 774 tests. Full
     `npm test` NOT run (Tier 1; scoped suites + gates).

### Commits
- `486ba38b` - fix(executor): keep the nonce list out of the cached system prefix
- `b54d11b5` - fix(scripts): finish per-tier floors in the prompt-size audit report

## Next Items

### Verified Open

1. Prove realized cache reads for the Executor fix.
   Evidence: `lib/services/execute-prompt.js` `callProvider` marks only the system
   block; the Executor does not write `api_usage_log` (comment at the LLMClient
   construction site), so cache tokens appear only in the `wmkf_ai_run` notes
   string (`cache_read=`). Of the seeded system templates only `phase-i-dynamics`
   (~1.5k tok incl. preamble, Sonnet 5 floor 1024) and
   `pre-site-visit-proposal-core` (~1.4k) clear their floor; both are chars/4
   estimates [ASSUMED until `scripts/audit-system-prompt-sizes.js` is run].
   Next: after a Phase I batch (two documents through the same prompt row within
   5 minutes), read the second run row's notes; expect `cache_read>0`. Owner reads
   production Postgres; do not self-authorize.
2. Preview CSRF origin check rejects alias-hosted POSTs (carried from S523,
   unchanged). Evidence: `lib/utils/auth.js validateOrigin`; logged in
   `docs/CURRENT_WORK_QUEUE.md`. Prefer the runbook step first.
3. Remove two stale Entra callbacks for retired Codex branch aliases (carried,
   owner-run tenant write).

### Owner Decision Needed

1. Review-panel user-turn cache breakpoint.
   Evidence: `shared/config/prompts/review-panel-seat.js` system ~360 tok
   (< Fable 5.1 floor 512) and chair ~510 (borderline at Opus 5 512); proposal
   narrative + question set sit in the unmarked user turn
   (`execute-prompt.js` `callProvider` `messages: [{ role: 'user', content: body }]`).
   The panel caches nothing today. A second breakpoint on the user block pays only
   if the same proposal is re-sent within the TTL (seat retries up to 5, chair
   rerun); otherwise it is a 1.25× write on the most expensive tokens in the
   system. Decide after reading `wmkf_ai_run` timestamps for panel runs
   (cadence [ASSUMED unknown]); if gaps exceed 5 minutes the lever is `ttl: '1h'`.
2. R5 items (`composeScorePrompt` batch loop, `process-phase-i-writeup` static
   block) and the ~10 single-shot callers with a random nonce at byte 0
   (`process.js`, `process-phase-i.js`, `summarize-service.js`, reviewer
   analyze/score, `integrity-service.js`, `multi-llm-service.js`). Gate on the
   `api_usage_log` hit-rate query per app (30-day window, grouped by app/model)
   before any marker is added. `process.js`/`process-phase-i.js` call twice per
   document with separate nonces, so nothing is shared today — verify, don't
   assume a win.
3. Reviewer search functional follow-ups (carried; `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`).

### Parked

1. Dynamics Explorer history caching. Evidence:
   `lib/services/dynamics-explorer/chat-session.js` `compactMessages` rewrites
   earlier rounds each turn, so no message-level marker can hit; system+tools
   (~11k tok) cache on Haiku 4.5. Re-open only if the Explorer moves off Haiku.
2. Impeccable 11px exception (carried). Memory router diet debt (carried; router
   unchanged this session).

### Verify Before Acting

1. Peer-review route still puts a nonce-bearing preamble at byte 0 of its system
   prompt via `{{a7_preamble}}` (`pages/api/process-peer-reviews.js`). Out of this
   session's scope; a cacheable variant would need the route to pass a nonce-free
   preamble AND switch `assertSystemIncludes` from nonces to preamble text. Only
   worth it if peer-review summaries repeat within the TTL.
2. S523 carryovers unchanged: Graph drive-item 4xx events on Workbench Proposal tab
   in Preview; transient Explorer 503 after redeploy; Explorer disconnect path not
   live-proven post-extraction.

### Do Not Reopen Without New Decision

1. Do not re-add the nonce list to the Executor preamble "for explicitness"
   (wiki `prompt-executor.md`; audit doc §0 R4). Do not add a cache marker to any
   site without a verified floor for the concrete model and repeat-within-TTL use
   (`project-cache-hit-rate-review` memory).
2. Explorer extraction complete through S9; Workbench cache/code-splitting trials
   rejected by measured gates; no routine paid Explorer smokes (carried from S523).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/execute-prompt.js` | `composeMessages` (nonce-free preamble), `applyVariableBoundaries` (stable per-document nonce), `callProvider` (system-only marker) |
| `lib/utils/ai-payload-boundary.js` | `wrapUntrustedContent`, `deriveStableNonce`, `buildUntrustedContentPreamble` |
| `tests/unit/execute-prompt-payload-boundary.test.js` | Pins nonce-free system + cross-document prefix equality |
| `docs/PROMPT_CACHING_AUDIT.md` | July audit + R4 closure record, per-tier floors, remaining data-gated items |
| `scripts/audit-system-prompt-sizes.js` | Per-tier prefix-size audit (needs `.env.local` CLAUDE_API_KEY; `count_tokens`) |
| `docs/agent-wiki/topics/prompt-executor.md` | Executor hazards incl. the nonce-free preamble rule |

## Testing

```bash
npx jest tests/unit/execute-prompt --silent
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
node scripts/audit-system-prompt-sizes.js   # measures real prefix sizes per tier
```

## Stop-time notes

Claim-evidence pilot: report shows zero recorded advisory events for this session
key, so no observation row was added. No milestone entry: a cost fix, not a new
capability or cutover. This handoff push triggers a documentation-only production
deployment.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 525 guidance above
controls current next steps. The Session 524 prompt body (Session 523 summary)
follows unchanged.

## Session 523 Summary

[VERIFIED via source, tests, gates, Git, Vercel CLI, Preview and production
signed-in browser checks] Two Tier 1 refactors were built on separate branches,
integrated on a throwaway integration branch, verified together, validated on a
Preview deployment, and promoted to production as one fast-forward of `main`.

### What Was Completed

1. **Dynamics Explorer chat-service extraction (Claude, S0–S9)**
   - `pages/api/dynamics-explorer/chat.js` 2,983 → 197 lines; logic moved verbatim
     into 17 modules under `lib/services/dynamics-explorer/` (`chat-session.js`,
     `tool-executor.js`, `model-call.js`, `explorer-store.js`, `tools/*`, …).
   - S0 characterization suite (18 tests) and SSE census snapshot pinned behaviour;
     the snapshot never changed after S0. Restriction-guard suite (17 tests).
   - Three gate exemptions for `pages/api/dynamics-explorer/` retired
     (route-service-boundary, dataverse-access-layer, odata-escape) with red
     fixtures proven by mutation. Registries repointed; J27-026 register row moved.
   - Orchestration: Sonnet built and scouted, Opus reviewed each stage (two rounds
     max), root fixed small findings itself. Codex adversarial review of the plan
     used OAuth only. Receipt: `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_EXECUTION_2026-09-19.md`.

2. **Workbench responsiveness (Codex, local-first S0–S3)**
   - Request list rows retained during refresh; independent request sections load
     before context; Reviews tab retains children during refresh. No API, service,
     schema, dependency or auth change. Cache experiment omitted; code splitting
     trial rejected below its 5% gate. Receipt:
     `docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md`.

3. **Integration and promotion (Claude owned; Codex read-only)**
   - `integration/2026-09-19`: merges `4c3ce24d` (Explorer), `35610f64`
     (Workbench), `71a1ae4f` (memory frontmatter). No conflicts; changed-file sets
     did not overlap. Combined tree: 38 gates + 29 self-tests green, Jest 976
     suites / 14,358 tests, lint 0 errors, types, canonical Turbopack build, 9/9
     route-mocked browser journeys.
   - Preview validation on the alias with branch-scoped `DATAVERSE_ALLOW_PROD_READS`
     and `NEXTAUTH_URL`: Explorer query, parallel two-tool round, UI list + Excel
     export (209 rows) all `completed`; Workbench list/request/Overview/Proposal/
     Reviews rendered live data. One transient 503 on the first invocation after a
     redeploy, not reproducible. Disconnect test inconclusive (answer finished
     before the abort landed); wiring is byte-identical and pinned by S0 tests.
   - Production: `main` fast-forwarded `7c18b622` → `3f4a1068`, deployed as
     `dpl_2zkcS5GMKaadkjJNdzujZTj5mLda` (`wmkfresearchapps-g8484ufro`). Read-only
     production check passed (sign-in, Workbench list and request 1002852, Explorer
     query completed in 3 rounds). Rollback: `dpl_6paPmnhgjdZ6bu23b57Q5A7XpGXK`
     (`7c18b622`); revert `4c3ce24d` or `35610f64` individually.
   - Cleanup done: alias removed, branch-scoped env vars removed, integration
     worktree and local branch removed, `origin/integration/2026-09-19` deleted,
     Explorer worktree and branch removed. Seven `smoke-*` telemetry rows remain in
     production Postgres as retained residue.

### Commits
- `52059e6b`…`bdb2bd00` - Explorer extraction plan and its review revisions.
- `4c3ce24d` - Merge `claude/explorer-chat-extraction` (39 stage commits, `ca56aa36`).
- `35610f64` - Merge `codex/workbench-responsiveness` (8 commits, `9f0d1b55`).
- `3f4a1068` - Merge `main` (memory) into integration; the promoted commit.
- `4ed2dbea` - Queue: Preview CSRF alias-origin follow-up.
- `ba060914` - Release record appended to the Explorer execution receipt.

## Next Items

### Verified Open

1. Preview CSRF origin check rejects alias-hosted POSTs.
   Evidence: `lib/utils/auth.js validateOrigin` derives the Preview origin from
   `VERCEL_URL`; observed 403 on the Explorer chat POST via the alias, cleared by a
   branch-scoped `NEXTAUTH_URL`. Logged in `docs/CURRENT_WORK_QUEUE.md` (Audit
   follow-ups). Prefer documenting the runbook step first; widening the allowlist
   goes through `/contract-reconcile`. Pre-existing, not a regression.
2. Remove two stale Entra callbacks for retired Codex branch aliases.
   Evidence: `az ad app show` redirect URIs on 2026-09-19 list
   `…git-codex-pau-5b4bef…` and `…git-codex-wor-464bcd…`. Owner-run tenant write.

### Owner Decision Needed

1. Reviewer search functional follow-ups (carried from Session 523; unchanged).
   Evidence: `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`. Choose one scope.

### Parked

1. Impeccable 11px exception scoped to CandidateCard and IdentityComparisonPanel
   (carried; `.impeccable/config.json`). Re-open on a readability review.
2. Memory router diet debt (router at 7,054 bytes / 67 lines after this session's
   one added pointer; gate green). Re-open when the router gate advises.

### Verify Before Acting

1. Graph drive-item 4xx dependency events on the Workbench Proposal tab in Preview
   (three, page still rendered every document). Unclassified against production;
   check fresh logs before treating as new.
2. The transient Explorer 503 (first invocation after redeploy `e6b2sn5dd`). Not
   reproduced across four subsequent requests; re-check only if it recurs in
   production logs.
3. Explorer disconnect path on a long-running request has not been live-proven
   post-extraction; S0 tests 4b–4g pin it. Only test live if a report suggests
   telemetry outcomes are wrong.

### Do Not Reopen Without New Decision

1. The Explorer extraction is complete through S9; do not re-add route-dir gate
   exemptions or re-export helpers from the route shell.
2. Workbench cache experiment (S4) and code-splitting trial (S5) were omitted or
   rejected by measured gates; do not resurrect without a new measurement.
3. Do not rerun paid Explorer smokes or Preview promotions as routine verification.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md` | Staged plan, §3.2 module map, §11 review log |
| `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_EXECUTION_2026-09-19.md` | Per-stage receipts, final acceptance, release record |
| `docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md` | Codex execution and review receipt |
| `lib/services/dynamics-explorer/chat-session.js` | `runExplorerChat` agentic loop behind the callback contract |
| `lib/services/dynamics-explorer/tool-executor.js` | `executeTool` dispatcher |
| `pages/api/dynamics-explorer/chat.js` | 197-line route shell (auth, SSE, lifecycle, telemetry) |
| `docs/CURRENT_WORK_QUEUE.md` | Preview CSRF alias follow-up |
| `.claude-memory/feedback-one-session-runs-gates-per-worktree.md` | Gate concurrency and stage-gate-list lessons |

## Testing

```bash
npx jest tests/unit/dynamics-explorer-chat-characterization.test.js tests/unit/dynamics-explorer-restriction-guard.test.js --silent
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:odata-escape && npm run check:odata-escape:self-test
npm test -- --runInBand --silent
```

## Stop-time notes

Claim-evidence pilot: one universal-shape advisory (session key `966249cee7dcca4a`)
on the Explorer plan document; classified in
`docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`. Milestone entry added to
`DEVELOPMENT_LOG.md`. Lesson memory committed: only one session runs gates per
worktree; per-stage gate lists must include every gate that scans moved paths.
This handoff push may trigger a documentation-only production deployment.

## Session 522 Summary

[VERIFIED via source, tests, Git, Vercel and signed-in browser checks] Completed
ReviewerSearchSection decomposition, Stages 0–10, into 19 focused modules behind
the same public facade. Stage 0 fixed stale async-state/lock/export hazards;
subsequent stages preserved behavior. No backend route, schema or dependency change.
Luna built, fresh Sol reviewed, root accepted; root took over bounded corrections.
Claude Opus planning review used OAuth only. The owner's fresh Claude review found
no material regression; three unused imports were then removed.

### Release and verification

- Runtime release `e332ad84` pushed to main; production deployment
  `dpl_F8DFjHtMGGJgPohZ1naM9YDZiXac` READY. Documentation release `8da7f595`
  also reached production, `dpl_CNmuQKa9UgcUiFvdXo3dbKqgYTCA` READY.
- Final local gates: 71 commands, 971 suites / 14,272 tests and canonical build
  passed. All five remote workflows passed for runtime release e332ad84.
- Thirteen mocked browser scenarios matched the post-Stage-0 monolith. Live smoke
  proved Microsoft sign-in and a populated Workbench request list after retry.
  Initial Dataverse 30-second timeouts also affected unrelated cron routes; cause
  is unproven, dashboard recovered without a code/config change or rollback.
- No live reviewer save/search/email rehearsal ran. The full live workflow remains
  untested; do not convert the read-only dashboard smoke into that claim.
- Rollback target: `dpl_EwRv2sCRMoTC5n7CwYpyyJxRLNyo` / baseline `b400c97d`.
  Full evidence and rollback instructions are in the execution receipt.

### Key commits

- `8609d6ff`: revised plan; `a5bdc539`: bounded lifecycle fixes.
- `307aa914` through `e6b74792`: presentation, workflow hooks and controller stages.
- `1fde149c`: boundary tests; `6c3ec888`: verified stage closure.
- `30bca34a` / `e332ad84`: dead-import and whitespace cleanup.
- `8da7f595`: release receipt; `59184b39`: scoped Impeccable exception.
- `d4d0e0e9`: functional follow-up queue and separate design notes.

## Next Items

### Verified Open — choose a separate scope before implementation

Read `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md` for evidence and
prerequisite tests. It records uncertain-save reconciliation, incomplete
same-context exclusion rollback, uncancelled stale streams, and proposal-key-only
reset semantics. Priority is proposed, not owner authorization to implement all.

### Owner Decision Needed

Choose one functional follow-up. For proposal-key-only reset, first decide the
intended document identity contract. Do not combine fixes with a redesign.

### Parked — separate Impeccable notes

Five original 11px notes remain unchanged. `.impeccable/config.json` contains an
11px exception scoped to CandidateCard and IdentityComparisonPanel, with rationale.
The follow-up document's D1 section records the locations, future readability
review and exception-removal criteria. Typography scan passed. This is not a
project-wide approval for 11px text.

### Verify Before Acting

- If Dataverse timeouts recur, examine fresh logs; no root cause or durable fix
  was established. Do not assume the refactor caused them.
- Prior-session carryovers below were not revalidated; they are historical routing
  aids, not an automatic worklist. In particular, retained rehearsal records must
  be re-read before any separately authorized modification or cleanup.
- Memory router measured 7005 bytes / 67 lines / 52 direct leaf references after
  adding this queue pointer. Gates passed; existing router-diet debt remains
  separate work and must not be silently dropped.

### Do Not Reopen Without New Decision

No decomposition stage remains unfinished. Do not remove legacy behavior or alter
save/recovery contracts merely because the modules are now easier to edit. Do not
rerun live provider, promotion or email operations as routine verification.

## Key Files Reference

- Plan: `docs/plans/REVIEWER_SEARCH_WORKSPACE_DECOMPOSITION_PLAN_2026-09-18.md`
- Evidence: `docs/plans/REVIEWER_SEARCH_WORKSPACE_EXECUTION_2026-09-18.md`
- Follow-ups: `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md`
- Facade: `shared/components/reviewers/ReviewerSearchSection.js`
- Extracted owners: `shared/components/reviewers/search/`

## Stop-time notes

The claim-evidence pilot report could not read local state; no observation row was
inferred. No root-instruction change was needed. The development milestone is
“Reviewer search workspace decomposition promoted (Session 522)”. This handoff and
the pending follow-up/exception commits are synced by the stop workflow; its
main-branch push may trigger a documentation/config-only Vercel deployment.

## Historical handoffs — not current instructions

Everything below preserves prior-session evidence. The Session 523 guidance above
controls current next steps; historical completion and authorization statements
are scoped to their named releases.

## Session 521 Summary

**[VERIFIED via GitHub PR/deployment records and signed-in production checks.]**
All migration stages (0–8) and review hardening shipped through PR #315, merge
`8d3ad3a7`, production deployment `6535352663`. The documentation follow-up shipped
through PR #316, merge `74066c53`, deployment `6535429238` (success
2026-09-19T00:57:35Z). Its runtime tree is unchanged from PR #315.
CI passed 958 suites / 14,195 tests, canonical build and required checks.
Post-deploy reads confirmed IA Ready/Draft with version 1.0, Final leadership
state, and five signed-out redirects. The final documentation deployment was
also reloaded successfully in the signed-in production Workbench.

The owner confirmed receipt of the approved test email. Final and leadership
exact retries passed in the controlled rehearsal. Wrong-app access and
review-bundle rebuild remain mock-only by explicit owner decision; unrun fault
cases are not claimed as live passes. No further smoke or data cleanup is queued.
Test rows remain retained evidence; do not delete or retire them without approval.
Both local rehearsal servers are stopped. Claude's shared checkout was untouched.

### Commits and durable records

- `aff3049d`: integrate the deployed IA budget fix with the refactor.
- `c17e2a0f`: Final/leadership rehearsal and exact-retry receipt.
- `8d3ad3a7`: PR #315 production release.
- `839f4218` / `74066c53`: release documentation and PR #316 merge.
- Execution and smoke receipts: `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md`
  and `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_SMOKE_TESTS_2026-09-18.md`.
- Milestone already recorded in `DEVELOPMENT_LOG.md`: “Governed document lifecycle
  decomposition promoted (Session 521)”; no duplicate milestone is needed.
- Rollback reference: commit `7a335e27`, deployment `6534771071`; rolling code back
  does not reverse retained rehearsal data.
- Stop-time claim-evidence report could not read local state; no observation was inferred.

The summaries below are historical evidence. Current next-session guidance is
under **Next Items**; historical restrictions and fixture snapshots do not override it.

## Prior Session 519 Summary

Session 519 was short. It started on `main` in sync with origin, ran every `check:*` gate
(one red: `check:j27-register`, see below), explained the open applicant-materials
reminder-cron question to the owner, and then recorded the owner's decision to retire that
cron. No code behaviour changed.

### What Was Completed

1. **Applicant-materials reminder cron retired (owner decision 2026-09-17), commit `28d719d9`.**
   The staff member who monitors whether materials arrive will do that follow-up manually,
   so `/api/cron/site-visit-materials-reminders` will not be scheduled. The route and
   `lib/services/site-visit-materials/reminder-sweep.js` stay in the tree, callable with
   `CRON_SECRET`, absent from `vercel.json`. Reconciled restatements: plan
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` (§16.6 item 1 decided, M5 follow-up closed,
   Slice 3 list), the route header comment, `docs/atlas/postgres-infra-tables.md`, the
   closed-work archive line, and memory leaf `project-ops-meeting-2026-09-16-agenda`
   (now `status: closed`, all six items decided; its router line removed because closed
   leaves route only via the archive). Gates run on the touched surfaces: memory-router,
   api-routes, atlas, doc-currency, fact-consistency, canonical-pointers, doc-symbol-refs,
   build-claim-freshness, harness-framing, agent-wiki, reviewer-reminder-hold, types; the
   cron route unit test passes (3/3).
2. **Start-of-session gate sweep.** Every other `check:*` gate and self-test green,
   `check:types` green, `check:memory-health` at the expected 7 advisory flags, and the
   memory router did NOT print the 8 KiB audit notice (the S518 diet held).

### Commits (main)
- `28d719d9` - docs: retire the applicant-materials reminder cron (owner decision 2026-09-17)

## Session 520 Summary

1. **J27 register citation repair.** The four rows in
   `docs/J27_TRANSITION_REGISTER.md` (J27-053 line 97, J27-057 line 101, J27-062 line 111,
   J27-064 line 113) now bind to exact excerpts in
   `.claude-memory/project-reviewer-apps-redesign-history.md` (lines 369, 303, 319, and
   329 respectively). J27-062 retains its separate `project-grant-phasing-evolution.md`
   plan fragment; J27-064 retains the current owner decision in the register disposition
   while using the historical allowlist-removal sentence as its source excerpt. The gate
   and self-test pass: 61 ok, 0 stale, 6 unverifiable, 11 closed. The six unverifiable
   rows (J27-034, -061, -067, -075, -076, -077) are advisory and pre-existing.

2. **Governed document lifecycle refactor — local execution authorized 2026-09-18.** The owner requested
   a staged plan, with fresh-context assumption reviews, for the largest defensible
   remaining refactor. The plan is
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_DECOMPOSITION_PLAN_2026-09-17.md`.
   It covers four document service coordinators, preserves separate state machines
   and public facades, and specifies prerequisite tests, ordered symbol/file moves,
   stage gates, review receipts and rollback. Planning was committed as `02c41a08`.
   The owner subsequently authorized local execution: Luna implements and builds,
   Sol reviews, and the orchestrator performs final acceptance, taking over stalled
   correction loops. Branch: `codex/document-lifecycle-decomposition`. Stage 0
   accepted in `7a2ed504`: 955 suites / 14,075 tests, lint/types/canonical build and
   required gates passed; Sol approved and root verified the real-route tests.
   Stage 1 accepted in `8a7060b9` after prerequisite commit `c58237c4`: neutral
   hash leaf, ten consumer imports, unchanged public hash API; 955 suites / 14,076
   tests and all required checks passed. Stage 2 accepted in `e4c10355` after test
   prerequisite `de875d68`: IA model/read modules; fresh Sol review and root checks
   passed, 955 suites / 14,078 tests plus all required checks. Stage 3 accepted in
   `2f7668b6` after test prerequisite `fbede538`: IA lineage/upload-recovery modules;
   fresh Sol review and root checks passed with the same full test count and all
   required checks. Stage 4 accepted in `569ab797`: Pre-Site model/defaults/read/
   lineage/recovery, with populated/historical fixtures verified on both old and new
   code; fresh Sol and root approval, 955 suites / 14,085 tests and required checks.
   Stage 5a accepted in `d673afc6`: distribution model/composition/defaults/context,
   unchanged public facade and writer; fresh Sol and root approval, 957 suites /
   14,100 tests and required checks. Calendar-send prerequisites passed on old/new code.
   Stage 5b accepted in `555a7bda`: retained snapshot module and atomic writer-registry
   move; fresh Sol/root approval, 957 suites / 14,101 tests and required checks.
   Stage 6 accepted in `c76703eb`: prepare/send/history/email recovery separated,
   unchanged facade exports and sequencing; fresh Sol/root approval, 957 suites /
   14,113 tests and required checks. Stage 7 accepted in `a9d4b0e8`: Final model/
   defaults/state/claims separated, both commands and five public names preserved;
   fresh Sol/root approval, 957 suites / 14,121 tests and required checks. Stage 8
   accepted in `588fd382` (boundary prerequisites) and `7ed52a45` (closure): AST
   import/cycle/export/writer enforcement, source headers and ownership docs; fresh
   Sol/root approval, 958 suites / 14,151 tests and required checks. All stages 0–8
   are complete locally; no migration stage remains to build. Receipts:
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_EXECUTION_2026-09-18.md`. PR #315 is merged as `8d3ad3a7670220f09ebd7828bfd7ea14d2ac3942`; production deployment `6535352663` succeeded at 2026-09-19T00:48:45Z. See the plan's release receipt and evidence limits before acting.

3. **Post-review hardening (2026-09-18).** Claude reviewed `5f069b32` as READY
   with three low findings. Removed four unused imports, corrected the facade/leaf
   export receipt wording, and extended boundary mutation tests for cross-domain
   imports, adapter aliases, optional/call/apply writes and hash-consumer ownership.
   [VERIFIED via local commands] Core smoke: 18 suites / 478 tests; auth routes:
   9 suites / 64 tests; full Jest: 958 suites / 14,174 tests. Lint/types pass.
   Operator smoke stages, fixtures, evidence and stop criteria are in
   `docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_SMOKE_TESTS_2026-09-18.md`.
   Fresh Sol acceptance and root final review passed after one bounded correction
   round. A subsequent source-mode read-only smoke on ZZTEST-03 passed signed-in
   IA/version/Pre-Site/history/Final reads and signed-out redirects; S1 is partial.
   The subsequent read-only S1 subset and incomplete S2 rehearsal are recorded separately; bounded service reconciliation completed the restore metadata. The later guarded Pre-Site reopen and return-to-Review succeeded; the exact retry/stale/fault matrix remains unrun, while S3 passed separately and S4 was NOT RUN at that earlier run. No fresh canonical build for the earlier hardening import/test/docs follow-up; prior build evidence remains historical. The current restore fix has 4 suites / 42 tests plus a successful canonical build recorded in the execution receipt. PR #315 has been merged and deployed; no schema or migration change was included.

   A separately owner-authorized controlled rehearsal on ZZTEST-03 was stopped after two IA failures. Generation returned HTTP 500 `claude_output_truncated` (run `7d8b647c-abb3-f111-aaac-000d3a361c1f`) and created one Failed row `ea6e4768-abb3-f111-aaac-6045bd04539e`; request state, 24 pre-existing Dataverse Request Document rows and 13 distribution attempts were unchanged; the SharePoint restore effect is recorded separately. Restore selected version 1.0 from current 2.0; Graph produced stable current 3.0 with historical 1.0/2.0 retained and equal governed hashes, but the API returned `initial_assessment_restore_bytes_mismatch` before registry metadata persistence. Readback is `/tmp/wmkf-restore-readback.json`; raw package differences were limited to custom XML/properties/trash parts. No PSV, distribution prepare/send, email, Final or leadership action ran. The initial browser restore failure is historical. A bounded PATCH-only service recovery then returned `restored:false`, `reconciled:true` with one registry update and zero Graph restores; independent readback confirmed the existing IA row at version 3.0, preserved history and the same governed hash. The recovery process exited 0. This is not a global database audit, and the browser restore was not rerun; S2 remains incomplete and S3–S4 were NOT RUN at that earlier run.

   Production follow-up attributed to the Claude handoff: PR #314 merge `0b240f0a` deployed the IA thinking-budget fix, and the signed-in production rerun on request 1003222 reported PASS at 23:38Z. Run `7770d508-bab3-f111-aaac-7ced8d3c3a59` ended `end_turn` with 1,065 output tokens, `thinkingTokens=0`, and `maxTokens=12000`; Ready row `7d00fffd-b9b3-f111-aaac-000d3a361c1f` became the current IA pointer, superseding `a6876ad6-3b94-f111-8075-70a8a59cded0`, and the exact retry reused the row without a new run. Root independently verified the sanitized pointer/reconciliation readbacks: 28 Request Document rows, one new Ready row, only the prior IA lifecycle/modified fields changed among 27 prior rows, current PSV `205da1cd-b7b3-f111-aaac-6045bd04539e` unchanged in Review, Final null, and all 14 attempts unchanged. Provider tokens, stop reason and exact retry remain Claude-attributed evidence; the isolated candidate now integrates prompt v2 and has passed local validation; it has not been live-rerun.

   Follow-up smoke continuation on isolated candidate `f45581ed`: the 269-route build passed; Board snapshot returned row `dc7558c4-b2b3-f111-aaac-7ced8d3c3a59` for IA artifact `a6876ad6-3b94-f111-8075-70a8a59cded0` at v3.0 with governed hash `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk` and distinct item `01G4GVMS5XTETQIS3JPNEIXAKRDZPRBY35`. The earlier pre-override distribution prepare returned 503 `distribution_briefing_required`, and the earlier guarded reopen returned 503 because `GUARDED_REOPEN_SCHEMA_READY` was unset; those readbacks were unchanged.

   On accepted code `cbad8a8d`, migration 038 was verified already applied; process-only briefing readiness, `DELIBERATION_BRIEFING_PUBLIC_BASE_URL`, and impersonation configuration enabled the approved S3 rehearsal while local `NEXTAUTH_URL=http://localhost:3000` remained the staff-auth origin. Prepare passed, the first send failed closed before claim, and the same preview then returned `Sent for delivery`; Dynamics later reached status 3 with `senton` (initial status 6), the user confirmed inbox receipt on 2026-09-18; this does not infer that the user clicked the public briefing link. Request and 26 Request Document rows were unchanged; 13 prior attempts remained unchanged and total attempts became 14. S3 approved happy-path email smoke passed and inbox receipt was user-confirmed. The later PSV reopen and return-to-Review happy path passed; the exact retry/stale/fault matrix remains unrun. No AI regeneration ran. S4 Final and leadership happy paths subsequently passed on the same PSV fixture; the remaining fault matrix and wrong-app account case remain unrun/mock-only.

   S4 controlled production smoke from local candidate `aff3049d` on the approved ZZTEST-03 request passed after the PSV successor was in Review. Final row `473c9160-c0b3-f111-aaac-000d3a361c1f` was created on the same SharePoint item, group review started at `2026-09-19T00:23:51Z`, leadership at `2026-09-19T00:24:37Z`, and both transitions used the session-derived actor `29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`. Exact start and leadership retries returned HTTP 200 with `reused:true` and equal DTOs. Independent reconciliation showed 28→29 Request Document rows, only the prior source lifecycle/modified fields changed plus the four expected Final leadership fields, and all 14 distribution attempts unchanged; no AI, email or SharePoint upload/copy calls were observed in the bounded dependency capture, and no schema action ran. Three Dataverse writes first rejected impersonation and then succeeded through the supported service-principal fallback; this does not claim native CreatedBy impersonation. Sanitized evidence is in `/tmp/wmkf-final-smoke-{before,group,leadership,reconciliation,graph-before,graph-after,unauth,inventory,dependency-summary}.json` and the HTTP/proxy captures. The UI showed leadership after reload, and five signed-out route checks returned 307. Final fault cases and the wrong-app account case remain unrun/mock-only.

Current fixture: IA `7d00fffd` remains unchanged; PSV `205da1cd` is now Final; current Final `473c9160` is in leadership review. Both rehearsal servers are stopped. The owner chose mock-only coverage for wrong-app access and review-bundle rebuild. Sol accepted the sanitized S4 evidence and root completed final review.

## Next Items

**Refactor release boundary:** all stages were committed on
`codex/document-lifecycle-decomposition` and promoted through PR #315. UI behavior
is intended to remain unchanged; no schema or migration change was included. The
production milestone is recorded for deployment `6535352663`. The optional
claim-evidence report could not read its local state; no observation was inferred.
The unrelated carryovers below retain their prior evidence and need fresh checks
before any live work; this release did not re-probe those unrelated carryovers.


### Verified Open

None for the released document refactor. Deployment and the agreed smoke scope
are complete; no additional implementation or release is queued.

### Unrelated carryovers — verify before scheduling

These prior-session items were not revalidated during this release and are not
an automatic worklist.

1. **Memory deep-audit remainder.** Evidence: `docs/audits/memory-routine-audit-2026-09-17.md`
   "Unknowns". Shrink `project-site-visit-materials-planning-handoff` (7.6 KB; its line 42
   "Open (plan §12)" list still names "reminder cadence", now decided). The other four
   oversize-routed leaves are accepted. `check:memory-health` is advisory and prints 7 flags:
   5 oversize-routed plus 2 accepted shadow-atlas false positives.

### Prior owner-decision carryovers — verify before acting

1. **Whether to delete the unscheduled reminder-cron code.** Evidence: commit `28d719d9`
   kept `pages/api/cron/site-visit-materials-reminders.js`, `reminder-sweep.js`, and
   `tests/unit/site-visit-materials-reminders-cron.test.js`; the owner was told this is a
   separate decision and did not ask for removal. If asked: destructive carryover, so grep
   live callers first, and expect edits to `docs/API_ROUTE_SECURITY_MATRIX.md` (line 169),
   the Atlas, plan §16.3, and `check:api-routes`.
2. **Plan §11 "Open for owner" (PR #312):** unconvertible review fails Share closed vs a
   placeholder page; Unicode reviewer names need `@pdf-lib/fontkit` + a bundled TTF;
   separator-page content; the three bundle bounds as code literals (memory
   `feedback-mutable-parameters-not-in-code`). Unchanged from S517.
3. **Plan §10.4 residual (PR #311)** and **plan §12 accepted residual (Codex round 3)**:
   unchanged from S517.
4. **Managed private-repository migration gates** (unchanged from S514). Evidence:
   `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md`.
5. **Memory-drift report refresh.** `check:memory-drift` evaluates a committed report it
   flags as stale; `npm run refresh:memory-drift` is an authorized live refresh
   (production reads) and was not run.

### Parked

1. Plan §8 (vi) panel defaults-seed case and the To-field caret splice (plan §12 note 1);
   plan §8 remaining items; plan §12 note 3 (Administration "Guarded reopen attempts"
   shows Pre-Site only). Unchanged from S517.
2. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).
3. Router diet landing point (6.9 KiB / 51 leaves after S519 removed one line) is above
   the §10 target (~6 KiB / ~45); going further needs a norms hub page, a design choice.

### Verify Before Acting

1. ZZTEST-03 retained evidence: last verified IA `7d00fffd`, PSV `205da1cd`
   in Final, and current Final `473c9160` in leadership. Earlier failed and superseded
   IA rows and the older Board snapshot remain. Re-read authoritative state before
   any future writes; cleanup requires a new owner decision.
2. The #311/#312 conflict resolution (`dcc9c796`) and the fixture fix (`8f8cfc1b`) are
   test-verified but were never Codex-reviewed.
3. Worktree `../WMKF_Apps-codex` was left clean on `codex/parked` at `6ed14ae9` by S518;
   S519 did not touch it. Confirm before delegating to Codex.

### Do Not Reopen Without New Decision

0. **Wrong-app access and review-bundle rebuild live fixtures** are mock-only by
   the owner's explicit choice. Do not solicit a third review or another staff
   account as unfinished work for this release.

1. **Applicant-materials reminder cron is retired** (owner, 2026-09-17). Staff monitor
   arrivals manually. Do not add `/api/cron/site-visit-materials-reminders` to
   `vercel.json`. Recorded in plan §16.6 item 1 and the closed memory leaf.
2. **Cycle Dossier drain cadence is `*/5 * * * *`** (owner, 2026-09-16). Recorded in
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`. Do not reopen Vercel Workflow or alternatives.
3. Ops-meeting items 2–6 (plan §16.6). Item 3's guard exists since S507 `90641978`.
4. Owner decisions B1–B14 in the Pre-RP Brief plan; Word snapshot identity is the
   governed content hash; confirmed sends render only **Sent for delivery.**

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/J27_TRANSITION_REGISTER.md` | Lines 97, 101, 111, 113 carry the repaired J27 citations |
| `.claude-memory/project-reviewer-apps-redesign-history.md` | Authoritative historical excerpts for J27-053, -057, -062, and -064 |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6 | Reminder-cron retirement decision, item 1 |
| `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` | Closed ops-meeting record, all items decided |
| `pages/api/cron/site-visit-materials-reminders.js` | Built, unscheduled, header records the retirement |
| `vercel.json` | Crons; the reminder route is intentionally absent |
| `docs/audits/memory-routine-audit-2026-09-17.md` | S518 audit note with the remaining unknowns |

## Testing

```bash
npm run check:j27-register           # 61 ok / 0 stale / 6 unverifiable / 11 closed
npm test -- --runInBand --silent
npm run lint
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:memory-health          # advisory; expect 7 flags (5 oversize-routed, 2 accepted shadow-atlas)
```

Session 519: all `check:*` gates green at start except `check:j27-register` (pre-existing,
caused by the S518 leaf split); touched-surface gates green at the one commit.
`report:claim-evidence-pilot -- --current` recorded no eligible plan/design edit; no
observation row added.
