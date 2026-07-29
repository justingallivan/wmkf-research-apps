# Session 387 Prompt: Build the governed Initial Assessment pilot

## Session 386 Summary

Session 386 was an office-machine recovery session. No feature work was
attempted. The machine was brought from a three-week-stale, dependency-mangled
state to fully verified, one pre-existing red gate was fixed, and the
multi-machine handoff instructions that caused the mess were corrected so the
next returning machine does not repeat it.

### What Was Completed

1. **Diagnosed and repaired the office-machine setup failure**
   - `~/Code/WMKF_Apps` was 364 commits behind `origin/main` (local HEAD
     `7dc53760`, Session 351-era) but a clean ancestor, so a fast-forward was
     safe. Fast-forwarded to `964b8bce`; `.env.local` was untracked and survived
     untouched, so no restore was needed.
   - `package.json` / `package-lock.json` held uncommitted dependency
     **downgrades** (`exceljs` 4.4.0→3.4.0, `eslint-config-next` 16.2.12→0.2.4,
     3,338 lock-file lines deleted — 3,342 across both files, 4 of them in
     `package.json`) from 11 runs of `npm audit fix --force`. Backed up to the
     session scratchpad, then discarded.
   - Root cause [VERIFIED via isolated `npm audit --package-lock-only` on both
     lockfiles]: the stale Session-351 lockfile audits to **14 vulnerabilities**
     (1 critical, 8 high); the same lockfile at `origin/main` audits to **0**.
     364 commits of upstream updates had already fixed every finding. Syncing was
     the entire fix; `--force` was actively undoing it.
   - `npm ci` after sync: 1,013 packages, 0 vulnerabilities.

2. **Removed a redundant nested clone**
   - `wmkf-research-apps/` was a full second repo nested inside the checkout,
     created by `git clone <url>` with **no destination argument** run from
     inside `~/Code/WMKF_Apps` [VERIFIED via `~/.bash_history` lines 305-312].
   - Verified safe before deletion: tree hash identical to `origin/main`
     (`67d09862`), no uncommitted or untracked files, no stashes, no unpushed
     commits, only `main` tracking origin. Removed; 52 MB reclaimed. The
     CodeGraph daemon purged its entries automatically (1,644 files indexed, 0
     stale).

3. **Fixed red gate `check:status-enum-parity` (`d1fb6f15`)**
   - `REVIEW_STATUS_MAP`'s object literal moved to
     `shared/config/reviewerLifecycle.js:19` in `70956477` (review synthesis
     lifecycle, #96) so browser-safe lifecycle readers avoid the Dataverse
     service graph; `lib/dataverse/adapters/reviewer-suggestion.js:24-29` only
     re-exports it now. The gate still extracted the producer textually from the
     adapter, so `extractObjectKeys` returned `null`.
   - Not a real parity break: the 7 producer keys match `STATUS_PIPELINE` and
     `REVIEW_STATUS_BY_VALUE` exactly. The gate correctly refused to pass
     vacuously (its `validateCheck` treats empty extraction as failure, Codex
     S260).
   - This gate backs `.claude/hooks/enum-parity-commit-guard.js`, so **every
     commit was blocked** while it was red.

4. **Verified the machine end to end**
   - 56 of 57 `check:*` scripts green (32 main gates + 24 self-tests). Only
     `check:memory-drift` was skipped, deliberately, for the read-only
     `check:memory-drift:no-write`.
   - Tests 6,319/6,319 in 532 suites. Lint 0 errors (51 pre-existing warnings).
     Production build succeeds. Both per-machine symlinks verified.
   - `.env.local` has 55 keys and `DATAVERSE_TARGET_INTERLOCK="on"`. The 6 keys
     present in `.env.example` but absent are all safely optional — each gates a
     disabled feature (`BILL_ENABLED`, `REVIEWER_PAGE_EMAIL_TIER_ENABLED`),
     falls back to a var that IS set (`REVIEWER_PORTAL_BASE_URL`→`NEXTAUTH_URL`,
     `SCHOLARLY_POLITE_MAILTO`→`NOTIFICATION_EMAIL_FROM`), or skips gracefully
     (`VERCEL_API_TOKEN`/`VERCEL_PROJECT_ID` → cron returns `skipped: true`).

5. **Corrected the handoff instructions that caused this**
   - The Session 386 prompt told the office machine to fresh-clone into
     `~/Code/WMKF_Apps`. That path had held a checkout since 2026-05-27
     [VERIFIED via `stat -f %SB .git`], and git refuses a non-empty destination,
     so the instruction was impossible as written. It was also mis-ordered:
     `npm ci` before `/start` audits an unsynced tree, and `/start` is what
     syncs.
   - Recorded the rule in
     `.claude-memory/feedback-returning-machine-sync-before-install.md` and
     routed it from `MEMORY.md`. Cross-referenced
     `docs/security-audit/SECURITY_AUDIT_2026-06-11.md:247`, which warned about
     `audit fix --force` downgrades and named `exceljs` 7 weeks before the
     downgrade happened — the guidance existed but was unreachable from the
     startup path.

### Commits

- `d1fb6f15` — fix(gates): status-enum-parity read REVIEW_STATUS_MAP from its canonical file
- `2bf33bc1` — docs(memory): record returning-machine sync-before-install lesson
- `d4dd098a` — docs: reconcile the office-setup handoff items with what actually happened

## Next Items

### Verified Open

1. **Build the governed Initial Assessment pilot.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md` rows 1-2;
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`;
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   [VERIFIED 2026-07-29] Zero `.js`/`.mjs`/`.sql` files anywhere in the repo
   (checked the complement set too — `scripts/`, `tests/`, and migrations, not
   just `lib/`/`pages/`/`shared/`) match `initial[-_ ]?assessment`, so no
   implementation exists yet. Build the smallest
   complete producer → SharePoint artifact → Dataverse registry →
   Workbench/Editor Dashboard read path for the 2026-08-10 human pilot. Blocked
   in part by the owner decisions below, but the shared governed-artifact spine
   and the SharePoint/Dataverse plumbing do not depend on the template choice.

2. **Run the Q9 ordinary-user app-access smoke in the office.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md:47,245,428`;
   `.claude-memory/project-app-access-control.md`.
   [VERIFIED 2026-07-29] Still a required Stage 4 release gate; the plan records
   that no ordinary-user session was available to the prior run. Needs another
   person's ordinary staff account in Preview while the owner performs and
   reverses the bounded grant/revoke steps. A superuser account cannot substitute.

### Owner Decision Needed

1. **Pilot proposal, human testers, environment, and exact schedule.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   Gates the 2026-08-10 pilot; intake begins around 2026-08-18.

2. **First approved Initial Assessment prompt/template pair.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   The D26 structure is a starting point only. Preserve the decided
   applicant-title (`akoya_title`) and staff-authored Foundation Opportunity
   requirements.

3. **Artifact registry and SharePoint target-library controls.**
   Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.
   Finalize exact Dataverse schema plus SharePoint version, restore, recycle,
   retention, permission, and milestone-snapshot behavior.

4. **Later Site Visit operational details.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   Sender/reply-to and lead-PD copy behavior need staff coordination.
   Notification audience/window, large-file scanner, and transcript workflow
   remain open.

### Parked

1. General applicant intake while WMKF evaluates GOApply re-engineering. The
   narrow Site Visit Materials Upload does not reopen it.
2. Automated BILL onboarding; honorarium payment remains offline.
3. Retired-table script deletion/quarantine without a new owner-approved scope.
4. Public Git history rewriting or repository cleanup without separate explicit
   authorization and a fresh preflight.

### Verify Before Acting

1. **Re-probe live Dataverse/SharePoint state** before schema, migration, or
   production claims. The Initial Assessment flow remains planned, not built.
2. **Re-read the live governed prompt rows** before publishing or modifying any
   prompt.
3. `codex/local-main-preserved-20260728` is recovery-only historical provenance,
   NOT an integration candidate — its three commits sit on a stale pre-rollout
   tree. Still present on `origin`.
4. Three commits from this session carry the wrong session number in their
   **commit message text** ("Session 352"; the correct number is 386). The
   durable files were corrected; the messages were not, because public history
   rewriting is parked. Trust the files, not those three messages.

### Do Not Reopen Without New Decision

1. Do not use `wmkf_wmkfprojectdescription` as the Initial Assessment title; use
   the applicant-submitted `akoya_title`.
2. Do not backfill the D26 Initial Writeup placeholder.
3. Do not make review count a Pre-Site distribution gate.
4. Do not create a fourth Site Visit Writeup.
5. Do not mirror the editable Word body into a competing Dataverse memo.
6. Do not run `npm audit fix --force` in this repo, and do not instruct a
   returning machine to clone into an existing checkout path. Evidence:
   `.claude-memory/feedback-returning-machine-sync-before-install.md`.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical delivery sequence |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Lifecycle decisions and August pilot |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Governed artifact/storage contract |
| `lib/services/workbench/resolve-request-service.js` | Existing request metadata, including applicant title and institution |
| `lib/services/grantee-title-service.js` | Later Keck-title producer; NOT the Initial Assessment title source |
| `shared/config/reviewerLifecycle.js` | Canonical reviewer lifecycle option maps; the adapter only re-exports them |
| `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md` | Office ordinary-user smoke contract |
| `.claude-memory/feedback-returning-machine-sync-before-install.md` | Returning-machine setup order and `audit fix --force` prohibition |

## Testing

This session verified the machine rather than a feature. Reproduce with:

```bash
rtk npm ci                          # expect 0 vulnerabilities
rtk npm test                        # expect 532 suites / 6319 tests green
rtk npm run lint                    # expect 0 errors
rtk npm run build                   # expect success
rtk npm run check:status-enum-parity && rtk npm run check:status-enum-parity:self-test
```

`/start` runs the full `check:*` inventory. Enumerate it from `package.json`
rather than trusting a hard-coded list; there are currently 33 main gates and 24
self-tests, and each gate runs sequentially with its own self-test.
