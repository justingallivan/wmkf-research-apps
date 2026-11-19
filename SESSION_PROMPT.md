# Session 683 Prompt: Expertise roster cutover item 4, or Recommendation to Chairs Stage 1

> **Expertise roster work lives on branch `codex/expertise-roster-import-2026-11-10`**
> (pushed; tip `754acf09a`). Its own handoff is that branch's `SESSION_PROMPT.md`. Private
> materials for the work Mac: WMKF OneDrive `Research/Shuttle/Justin/` (`RESTORE.md`).

## Session 682 Summary — 2026-11-18 (Claude, home Mac)

### What Was Completed

1. **Expertise roster work recovered and pushed.** The Postgres→Dataverse roster branch
   `codex/expertise-roster-import-2026-11-10` had never been pushed, which is why the work
   Mac could not find it (newest pushed roster ref was `e90babb2a`). It held 41 commits past
   that point, including `a29c30826`. Merged current `main`, fixed the secret-scan
   placeholder and two prompt-catalog tests, cherry-picked the work Mac's probe and evidence
   (from `origin/codex/session-start-2026-11-18`), and pushed. Branch inventory:
   `docs/plans/data/expertise-roster/BRANCH_INVENTORY_2026-11-18.md` (on the branch).
2. **Production cutover simplified (owner decision).** The roster runs about twice a year,
   by one person or flow, and race protection is not wanted. The addendum
   `docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md`
   replaces admission/drain, the writer freeze, the phase machine and automated rollback
   reconciliation with a read switch, a cutover marker, a direct bind and a one-shot
   quiet-window script. `/contract-reconcile`: READY WITH NAMED CHANGES (applied). Codex
   adversarial review of the build: approve, no findings. Memory:
   `feedback-scale-safety-machinery-to-usage`.
3. **Roster items 1–3 built on the branch (not deployed, not applied):**
   `EXPERTISE_ROSTER_BACKEND` read switch (`roster-mode.js`, Production host only),
   legacy cutover marker (`roster-cutover-marker.cjs`), direct bind through
   `expertise_roster_id_seq` (`roster-binding.js`, app-key-only allocation), and inert
   migration `100_expertise_roster_identity_bridge.sql`. Full Jest, all gates and the eight
   roster pg suites pass on the branch.
4. **Dependabot security fixes shipped to Production.** PR #642 (merge `8f8202223`):
   in-range bumps (next 16.4.6 and others), scoped undici/postcss-selector-parser
   overrides, global zod 4.6.7 override (owner-approved), and an npm 10–compatible
   lockfile regeneration (CI uses Node 22/npm 10; this Mac has npm 11). Production
   deployment succeeded; sign-in pages return 200. 21 of 22 alerts closed.
5. **Owner-run tracker read:** app database `schema_migrations` ends at 099. **096 is
   applied** (closes Session 682 item 2). `097_shared_prompt_jobs.sql` is applied although
   that file exists only on the parked backend branch.

### Commits
- `main`: PR #642 merge `8f8202223` (`85f611a43`, `7d1caa7b0`, `dd145e152`, `7d3991744`); this handoff.
- Roster branch: `c8cd8bee3` merge, `f972ec899`, `c24fa9007`, `f47699637`, `b19d11527`,
  `0e14f8fc5`, `e25a8244a`, `4e72a73d2`, `03602cb23`, `21a920c3d`, `97a4bc8c6`,
  `644c3f42b`, `85ccd0e75`, `7e39d87cd`, `754acf09a`.

No DEVELOPMENT_LOG entry: dependency maintenance and unreleased branch work; no milestone.

## Next Items

### Verified Open

1. **Roster item 4: Production-capable cutover and rollback scripts.** Evidence: the
   addendum's "Remaining work" list (on the branch). Includes extending the import tool to
   the Production target and the shared database, the feedback FK retarget, rollback, and
   Production schema and editor-role setup tools. Then items 5–7 (release items, docs,
   end-to-end rehearsal) and the owner's go. Resume in
   `/Users/gallivan/Code/WMKF_Apps-codex-roster-import` (home Mac); on the work Mac, fetch
   the branch and restore private files per OneDrive `RESTORE.md`.
2. **Recommendation to Chairs in Production, Stage 1** (PDs record recommendations Dec 9
   to Feb 3). Evidence: `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md`.
   Run `/contract-reconcile` on it, then build Stage 1 on a branch. Untouched this session.
3. **Trial cleanup batch 2** after 2026-11-23 18:31:58 UTC: refresh the Preview OIDC token,
   run the parked runner's `expire` mode once; expect `disabled`. Commands:
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` (batch 2).
4. **Review Connor's first real-proposal run** (owner-run):
   `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-intake-prompt-outputs.cjs --target=prod --request=<n>`.
5. **Dependabot leftovers:** superseded PRs #567, #566, #515 still open (Dependabot may
   close them); #639 was replaced by grouped PR #643 (22 updates, needs its own review).

### Owner Decision Needed

1. **Minimatch alert #144** (medium, opened after the #642 merge): fix is 11.0.1, a major
   jump for 10.x consumers. Override, or wait for upstream.
2. Optional: add `.nvmrc` = `22` so local Node/npm match CI (prevents npm 11 lockfiles CI
   rejects).
3. Intake prompts (Beth meeting 2026-11-17): rationale versions, flags JSON vs child
   table, open questions; keywords from `wmkf_programlevel3` (not seeded). Evidence:
   `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md`.
4. Stage 3 go: automatic Integrity Screen makes paid search and model calls; owner
   authorizes before `AUTOMATIC_INTEGRITY_SCREENING=on`.
5. With Connor/Sarah: on Feb 24 does the Grants Manager set Phase II Status or only
   Request Status (D39 vs `lib/services/workbench/j27-read-model.js:239-241`).
6. Note to Connor (owner to send): prompts are v2 (8192 tokens); skip `intake.personnel` or
   stop intake when there is no PI row. Not confirmed sent.

### Parked

1. Backend prompt adoption/scheduling (`codex/executive-summary-generation-2026-11-16`).
   The roster's Power Automate recommendations slices 2–5 depend on it. Re-open only on
   owner decision.

### Verify Before Acting

1. Branch hygiene: `claude/dependabot-security-2026-11-18` (merged, still on origin) and
   `origin/codex/session-start-2026-11-18` (work-Mac handoff; its two content commits are
   cherry-picked onto the roster branch, its prompt folded into the roster handoff). The
   Session 681 local branches (`claude/fable-5-2-registry-review`,
   `claude/board-notice-alert-hygiene`, `claude/factory-auto-prepare`) are not on this Mac;
   check the work Mac. Deleting any needs the owner's go (list and confirm first).
2. Test request 1003528 is at Phase I Invited / Phase II Pending Committee Review; moving
   Phase I back is untried with Phase II set. Factory runs in `managed-ledger/ledger_prod`
   [ASSUMED from the Production form's ledger; not re-read].
3. 43 local-only branches exist on the home Mac; the Nov 10–11 `codex/executor-*` and
   `codex/staff-draft-*` ones match pushed backend commits by subject. The rest are older
   and unreviewed. Preserve.
4. `commit-times-exact.txt` is untracked in the main checkout; not from this session.

### Do Not Reopen Without New Decision

1. Roster Production cutover is simplified (owner, 2026-11-18): no admission/drain, writer
   freeze, phase machine or automated rollback reconciliation in Production.
2. Factory auto-prepare target pair (Invited + Phase II Pending Committee Review) stays.
3. Replacing Connor's runner, requiring staff-edit flags, merging the backend branch.

## Preservation and other streams

Prior handoffs: `git show ac2aacaa9:SESSION_PROMPT.md` (Session 682 prompt, Claude),
`git show 0cb02f2d0:SESSION_PROMPT.md` (work-Mac Codex roster parking note),
`git show 281ef706b:SESSION_PROMPT.md` (681). Historical observations are not fresh
permission or live state.

| Stream | Resume source | Boundary |
|---|---|---|
| Expertise roster | Roster branch `SESSION_PROMPT.md` + cutover addendum | Production writes, migration apply and the switch each need owner go |
| J27 Workbench | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Each Production stage needs owner go |
| Intake prompts (Connor PA) | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Owner publishes prompts; backend parked |
| J27 Factory / reports | Prior multi-stream handoff | Preserve worktrees, fixtures, exports, branches |

Never set `DATAVERSE_ALLOW_PROD_READS` yourself. Never read main `.env.local`. Local
containers here run on Colima (`colima start`), not Docker Desktop.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md` (branch) | Simplified roster cutover plan and remaining work |
| `lib/services/expertise-finder/roster-mode.js` (branch) | `EXPERTISE_ROSTER_BACKEND` read switch |
| `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Recommendation to Chairs Production plan |
| `scripts/probe-meeting-migration-filenames.cjs` | Owner-run read-only migration tracker probe |

## Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-codex-roster-import
npx jest tests/unit/roster-mode.test.js tests/unit/roster-binding.test.js tests/unit/roster-cutover-marker.test.js
ROSTER_LIVE_SQL_TEST_ENV=~/.local/share/wmkf-roster/full-import-20261110/full.env npx jest --runInBand tests/integration/roster-*.pg.test.js
```
