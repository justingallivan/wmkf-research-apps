# Session 517 Prompt: Decide the three Pre-RP Brief PR merges, then apply 053 and smoke

> **Update 2026-09-17 morning:** all three PRs are merged in order (#310 `0eba7358`, #311 `248233c7`,
> #312 `7f776e36`), migration 053 is applied and read back exact, and the production deployment for
> `7f776e36` reached Ready. The sibling conflict between #311 and #312 was resolved in `dcc9c796`
> (17 suites / 439 tests green) and a CI-only fixture timeout in `review-bundle-service.test.js`
> was fixed in `8f8cfc1b`. Remaining: the ZZTEST Production smoke (Verified Open 3) and the owner
> decisions below.

## Session 516 Summary

Session 516 finished the Pre-Research Presentation Brief build loop and shipped it to
Production (PR #307, then hotfix #308 and CI repair #309), applied migration 052, and then
ran an owner-directed overnight orchestration of eleven follow-ups in three steps, each
taken through Codex adversarial review (gpt-5.6-sol) until approve or an explicit
disposition. Sonnet builders worked in worktrees against enumerated acceptance briefs;
the orchestrator built Step A directly and fixed builder gaps itself.

### What Was Completed

1. **Pre-RP Brief shipped** (`f1cf8fe3` merge of PR #307; `9ab5fe71` PR #308 select
   hotfix; `de349928` PR #309 CI repair). Migration 052 applied by the owner and read back
   (`docs/atlas/postgres-infra-tables.md` line ~197). The owner exercised generate and
   share in Production during the session (the select hotfix came from that); the full
   ZZTEST smoke list below is not recorded as complete.
2. **Step A — PR #310 `claude/pre-rp-brief-followups` @ `bef9cbb9`** (base `main`).
   Items 2–10: Pre-Site replay-guard parity (older FAILED/expired rows refused, fail-closed
   on unreadable dates), observed-pointer activation fences on both artifact services
   (`brief_pointer_changed` / `pre_site_visit_pointer_changed`), own-claim-only upload
   cleanup, `renderVersion: '2'` bound into the generation key, tri-state
   `receivedReviewCount` with fingerprint re-hash and a distinct malformed-snapshot Share
   reason, actor-name resolution for drift acknowledgements, Final Writeup prerequisite copy
   keyed on `code`, beyond-deliberations banner wording, migration-052 legacy all-NULL test,
   panel `applyFormPatch` + explicit `autoOwnedRef` seed ownership, `PI: ` / `PD: ` prefixes
   in the brief. Codex: 4 rounds, rounds 1–3 findings all fixed, round 4 approve (plan §7).
3. **Step B — PR #311 `claude/pre-rp-brief-guarded-regen` @ `46641760`** (base #310).
   Superuser-only regeneration of a brief already sent to the Board, mirroring the Pre-Site
   guarded reopen: route `pages/api/workbench/pre-rp-brief/reopen.js`, service
   `lib/services/pre-rp-brief/reopen-service.js`, audit tuple on the successor row, server
   mutual exclusion (`brief_regeneration_in_progress` while a lease-active GENERATING row
   exists), tab/panel gating. Codex: 5 rounds, rounds 1–4 fixed, round 5 approve (plan §10).
   Residual: a sub-second send/claim window recorded in plan §10.4.
4. **Step C — PR #312 `claude/pre-rp-brief-review-bundle` @ `73279502`** (base #310).
   One PDF of every received review assembled at Share (pdf-lib, separator pages,
   fail-closed on any missing/unconvertible part, 25 reviews / 100 MB source / 50 MB
   output bounds), retained as a `review-bundle` snapshot, pinned by migration
   `053_pre_site_distribution_review_bundle.sql` (mirrored in `setup-database.js`
   `v54Statements`), served on the briefing page ("Download all reviews (PDF)") and via the
   email placeholder `wmkf-briefing-link://review-bundle`, with an on-demand attributed
   rebuild guarded by a CAS on the set fingerprint. Codex: 3 rounds; rounds 1–2 fixed
   (fingerprint completeness, WinAnsi, bounds, roster pointers, CAS recheck); round 3's
   linearizability demand dispositioned as the stated last-observed-snapshot contract,
   the same contract the inline reviews already use (plan §11).
5. **Verification at each PR head:** full jest (A 949 suites / 13,908; B 951 / 13,956;
   C 951 / 13,984), lint, and the full `/start` gate list green (`gates.log` in the
   session scratchpad; all PASS). Two full-run single-suite failures were chased:
   `reviewer-suggestion-bulk-update-importers` (contention flake, green on rerun) and
   `reviewer-engagement-census` (real; the new caller was recorded).

### Commits (main)
- `f1cf8fe3` - Merge PR #307 (Pre-RP Brief slices 1–6)
- `9ab5fe71` - Merge PR #308 (select base lookups, not formatted names)
- `de349928` - Merge PR #309 (two CI Jest suites left red on main)

### Commits (branches, all pushed)
- `bef9cbb9` - head of PR #310 (5 commits over `main`)
- `46641760` - head of PR #311 (over #310)
- `73279502` - head of PR #312 (over #310; last commit is the §11 bounds note)

## Next Items

### Verified Open

1. **DONE 2026-09-17 — merges executed in this order** (kept for the record).
   Evidence: `gh pr list` shows #310 → `main`, #311 and #312 → `claude/pre-rp-brief-followups`;
   `git merge-tree --write-tree claude/pre-rp-brief-guarded-regen claude/pre-rp-brief-review-bundle`
   reports four content conflicts between the two siblings:
   `docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md`,
   `shared/components/workbench/PreSiteDistributionPanel.js`, `tests/unit/pre-site-distribution-panel.test.js`.
   Order: merge #310 into `main`; retarget #311 to `main` and merge; merge `main` into
   `claude/pre-rp-brief-review-bundle`, resolve the four files (plan: keep both §10 and §11;
   panel: keep both error-copy branches), rerun `npx jest tests/unit/pre-site-distribution*
   tests/unit/staff-deliberations* tests/unit/deliberation-briefing* --silent`, retarget
   #312 to `main`, merge. Each merge auto-deploys.
2. **DONE 2026-09-17 — migration 053 applied** (was: apply before #312 merges; prepare writes the
   `review_bundle_*` columns unconditionally).
   Evidence: `lib/db/migrations/053_pre_site_distribution_review_bundle.sql` on the #312
   branch; not in `schema_migrations`. Columns are nullable with CHECKs that accept the
   all-NULL legacy row, so applying early is harmless:
   `node scripts/apply-migrations.js`, then read back the ten `review_bundle_*` columns and
   the two CHECK constraints (`pre_site_distribution_review_bundle_shape`, `_coherence`) and
   update the `[PLANNED]` label in `docs/atlas/postgres-infra-tables.md` to VERIFIED LIVE.
3. **ZZTEST Production smoke after the merges**: generate, lock, share (bundle assembled),
   briefing page serves the brief and the review-bundle link, email link resolves, drift
   acknowledgement path, guarded regeneration by a superuser, bundle rebuild after a new
   review arrives.
4. **`docs/CURRENT_WORK_QUEUE.md` row 12** was updated this handoff to the shipped state;
   re-edit it after the merges and smoke.

### Owner Decision Needed

1. **Plan §11 "Open for owner" (PR #312):** (1) unconvertible review fails Share closed vs a
   placeholder page; (1b) Unicode reviewer names need `@pdf-lib/fontkit` + a bundled TTF,
   today replaced with `?`; (2) separator pages carry reviewer name and affiliation; (3) the
   three bundle bounds are code literals, kept as safety ceilings; move behind
   `wmkf_appsystemsettings` if staff must tune them (memory
   `feedback-mutable-parameters-not-in-code`).
2. **Plan §10.4 residual (PR #311):** sub-second window between a send and a guarded
   reopen claim; accepted as-is by the orchestrator, owner may want a stronger lock.
3. **Managed private-repository migration gates** (unchanged from S514).
   Evidence: `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md`.
4. **Ops-meeting decisions (2026-09-16 meeting).** Evidence: memory
   `project-ops-meeting-2026-09-16-agenda.md` still `status: active`.

### Parked

1. Plan §8 (vi): the panel defaults-seed-through-stale-reset case is structural (seed
   requires an untouched composer, prepare requires a recipient edit); no test, recorded.
2. Plan §8 remaining: received-state boolean vs raw `reviewReceivedAt` in
   `REVIEW_FINGERPRINT_FIELDS`; deprecating the Pre-Site prerequisite for Final Writeup.
3. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).
4. Memory router at 8239 B (over the 8192 B routine-audit trigger); diet per
   `docs/MEMORY_HYGIENE_RUNBOOK.md` §10 not run this session.

### Verify Before Acting

1. The #311/#312 conflict resolution (`dcc9c796`) and the fixture fix (`8f8cfc1b`) landed after
   the Codex approvals; both are test-verified (17 suites / 439 tests; full CI green) but not
   Codex-reviewed. Include them in the next adversarial pass if one is run.

### Do Not Reopen Without New Decision

1. Owner decisions B1–B14 in the plan; the review-bundle consistency contract
   (last-observed snapshot, plan §11 and the matrix row).
2. Email feedback: confirmed sends render only **Sent for delivery.**

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md` | §7 Codex rounds, §8 follow-ups, §10 guarded regeneration (#311), §11 review bundle (#312) |
| `lib/services/pre-rp-brief/artifact-service.js` | Generation key, activation fence, reopen option, regeneration-in-progress refusal |
| `lib/services/pre-rp-brief/reopen-service.js` | Guarded regeneration service (#311) |
| `lib/services/pre-site-visit/review-bundle-service.js` | Bundle assembly, fingerprint, bounds (#312) |
| `lib/services/pre-site-visit/distribution-service.js` | Prepare gate, bundle retention, actor names, email hrefs |
| `lib/services/deliberation-briefing/briefing-page-service.js` | `review-bundle` member, attributed rebuild with CAS |
| `lib/db/migrations/053_pre_site_distribution_review_bundle.sql` | Bundle pin columns (applied 2026-09-17, readback exact) |
| `shared/components/workbench/StaffDeliberationsTab.js` / `PreSiteDistributionPanel.js` | Tri-state share reasons, regeneration pending, error copy |

## Testing

```bash
npm test -- --runInBand --silent
npm run lint
npx jest tests/unit/pre-rp-brief* tests/unit/pre-site-distribution* tests/unit/deliberation-briefing* tests/unit/external-briefing* tests/unit/staff-deliberations* tests/unit/review-bundle* --silent
```

Session 516: full jest, lint, and all `check:*` gates green at each of the three PR heads.
`report:claim-evidence-pilot -- --current` recorded no eligible plan/design edit for this
session key; no observation row added.
