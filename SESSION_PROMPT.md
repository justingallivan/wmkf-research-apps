# Branch Handoff: Expertise roster Postgres → Dataverse migration (recovered)

Branch `codex/expertise-roster-import-2026-11-10`, worktree
`/Users/gallivan/Code/WMKF_Apps-codex-roster-import` (home Mac). This file is the
branch handoff. The `main` handoff it replaces here is
`git show ac2aacaa9:SESSION_PROMPT.md` (Session 682, Recommendation to Chairs); restore
`main`'s version when this branch merges.

## Recovery — 2026-11-18 (Claude, home Mac)

The work Mac could not find the roster work because this branch was never pushed; the
newest pushed roster ref was `e90babb2a` (November 10). [VERIFIED via `git branch -a`,
`git ls-remote`] The branch existed only in this worktree, with 41 commits past
`e90babb2a` ending at `0b4c88a79` (November 11), including `a29c30826` named by the
work-Mac handoff. Tracked files were clean.

Done in this session, on this branch:

1. **Merged current `main`** (`c8cd8bee3`). Conflicts kept both sides:
   `docs/SERVICE_AND_UTILITY_CATALOG.md` (usage-logger entry plus main's Workbench
   release gates) and `tests/unit/staff-deliberations-tab.test.js` (roster
   recipient-exclusion test plus main's J27 mode tests). No branch migrations exist;
   the lockfile is unchanged.
2. **Secret-scan green** (`f972ec899`): the synthetic `NEXTAUTH_SECRET` literal in three
   roster browser tests now carries the scanner's `test` placeholder marker.
3. **Work-Mac probe and evidence cherry-picked** from
   `origin/codex/session-start-2026-11-18` (`d04be4eec` → `c24fa9007`, `b86d02579` →
   `f47699637`): `scripts/probe-expertise-migration-status.cjs` and
   `docs/plans/evidence/expertise-migration-status{,-production}-2026-11-18.json`.
   That branch's handoff commit `0cb02f2d0` is folded into this file, not picked.

### Live evidence — November 18 (work Mac, read-only)

[VERIFIED via `scripts/probe-expertise-migration-status.cjs`, owner-authorized]

- Shared Neon `neondb`: 39 active roster rows (26 Consultant, 9 Board, 4 Research
  Program Staff), 10 Contact links. No `expertise_roster_identity` or
  `expertise_roster_binding` tables; all seven consultant-feedback records still
  reference `expertise_roster` (one references excluded placeholder ID 35).
- Sandbox `orgd9e66399`: 46 profiles (38 legacy-key imports, 5 app-key, 3 direct-key),
  40 active. All 38 imports match source names and preserved text; only ID 35 absent.
  Three active alternate keys, auditing and optimistic concurrency enabled. Latest
  modification November 11.
- Production `wmkf`: `wmkf_expertiseprofile` absent (metadata search empty, 404s). No
  Production schema or shared-Postgres cutover has been applied.

These reads do not prove full application integration, permissions, actor attribution
or rollback.

## What the branch contains (summary)

Full November 9–11 narrative, with evidence pointers and review dispositions:
`git show 0b4c88a79:SESSION_PROMPT.md` (section "Expertise roster migration planning").
Plan: `docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`; evidence
index: `docs/plans/data/expertise-roster/README.md`.

- Sandbox schema `wmkf_expertiseprofile`, editor role (John, Beth, Jean), file-only
  planner and sandbox-only import executor; full import (39 profiles) with stable replay.
- Numeric identity bridge (`identity-bridge.sql`, inert, unnumbered), allocator, write
  admission, disposable-schema prepare/activate/pause/resume/abort, rollback
  reconciliation. Public phase execution is refused.
- Consumers and matching on the rehearsal SQL seam; signed-in browser walkthrough,
  linked-Contact run, live attachment and single/batch matching runs, all cleaned up.
- Recommendations-only direction (owner, November 11): pure recommendations contract,
  roster freshness comparator, native output-schema builder. No production caller wired.

## Next Items

0. **Production cutover simplified (owner, 2026-11-18).** Plan:
   `docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md`:
   a read switch setting, a cutover marker on legacy writes, a simple bind path and a
   one-shot quiet-window script. Its "Remaining work" list replaces the release-gate parts
   of items 1–2 below. Contract-reconcile review done (READY WITH NAMED CHANGES, applied).
   Remaining-work items 1–3 (read switch, cutover marker, direct bind, migration 100) are
   built; Codex adversarial review approved items 1–2. Next is item 4, the Production-capable
   cutover and rollback scripts. Owner-run read needed: Production `schema_migrations`, to
   confirm 100 is free (and whether 096 is applied, per `main`'s handoff).

1. **Inventory before building.** Compare this branch with the work-Mac plan
   (`0cb02f2d0` handoff steps 2–3) and current `main`; list what is built/tested
   versus remaining release gates before choosing the next slice.
2. **Resume implementation and isolated end-to-end/rollback rehearsal.** Owner agreed
   to preparation; Production writes and release are a separate approval after a
   concrete reviewed result. Match-prompt/eligibility approval and deployment
   admission/drain remain prerequisites per the migration plan.
3. Plan/build reviews use OAuth Opus 5.5 (owner, November 10). No paid review product.

## Verify Before Acting

- Re-probe targets and source before any migration. Production and sandbox
  Contact/User GUIDs are target-specific; never copy sandbox bindings/allocations into
  shared Production Postgres. Never modify main `.env.local`.
- Preserve old roster/match history and placeholder feedback identity (ID 35). No
  deletion, table retirement, fixture cleanup or Production promotion is authorized.
- `expertise-finder.match.roster-v2` is in the static `shared/config/adminPromptCatalog.js`,
  so merging this branch would list a sandbox rehearsal prompt in Production Admin. Two
  tests exclude it via an unreleased-rehearsal list (`tests/unit/admin-prompt-catalog.test.js`,
  `tests/unit/prompt-templates-descriptions.test.js`); at cutover, add it to
  `docs/audits/prompt-descriptions-and-callers-2026-10-29.md` (or its successor) and
  remove the exclusion.
- Local rehearsal Postgres needs Docker: container/volume
  `wmkf-roster-full-import17-20261110`, loopback port 55439. Docker was not running on
  2026-11-18 at first; it is Colima here (`colima start`). The seven pg suites passed on the merged tip.

## Local-only artifacts (never commit; repo is public)

- `/Users/gallivan/.local/share/wmkf-roster/` (`canary-20261110`,
  `full-import-20261110`): real export, import reports, receipts. Home Mac only.
- `outputs/` in this worktree (gitignored): build/test logs and review transcripts.
- **Shuttle copy for the work Mac (2026-11-18):** WMKF OneDrive `Research/Shuttle/Justin/`
  holds `wmkf-roster-shuttle-20261118.tar.gz` (+ `.sha256`) and `RESTORE.md`. It has the private
  directory without its three `.env` files, the worktree `outputs/`, and a `pg_dump` of the
  rehearsal database. Recreate the `.env` files by hand per `RESTORE.md`.

## Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-codex-roster-import
npx jest tests/unit/expertise-roster-import-plan.test.js tests/unit/roster-browser-target.test.js
npm run check:secret-scan && npm run check:secret-scan:self-test
```
