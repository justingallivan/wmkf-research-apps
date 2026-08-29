# Session 468 Prompt: Funding History Live; Codex Branch Awaiting Merge Decision

## Session 467 Summary

Session 467 (2026-08-28) shipped the deterministic Institutional Funding
History fill for the Pre-Site writeup, fixed a production max_tokens
failure, surfaced Executor output budgets in the Admin panel, and executed
the owner-approved cleanup of the 1002379 smoke vehicle. In parallel, a
Codex worktree delivered the Staff Deliberations history UX follow-ups on
`codex/staff-deliberations-history-ux` (unmerged — owner decision).

### What Was Completed

1. **Institutional Funding History filled from Dataverse (no LLM).**
   `lib/services/pre-site-visit/funding-history.js` renders the Power
   Automate sentence ("<AKA> has received N awards totaling $X million from
   WMKF. The most recent [research] grant was awarded in <FY> <description>.")
   from the account rollups `wmkf_countofprogramgrants` /
   `wmkf_sumofprogramgrants`, cross-checked fail-closed against the live
   `akoya_request` rows matching the rollups' own predicate
   (`wmkf_typeforrollup eq 'Program' and akoya_grant gt 0`). **Owner
   decision:** count/sum stay all-program; the cited award is the newest
   **Research**-program grant (`_wmkf_grantprogram_value_formatted ===
   'Research'`; recency `akoya_decisiondate ?? wmkf_meetingdate`; "research"
   qualifier inserted when it is not the newest overall). Snapshot
   schemaVersion 3; pre-S467 Ready docs carry a durable
   `funding_history_manual` edit-check warning. Two Codex review rounds
   fixed all findings. Production-proven on 1002379 (zero program grants →
   "…has not previously received a program grant from WMKF."). Read-only
   probe `scripts/probe-funding-history-rollups.js` validated 7/7 accounts.
2. **Pre-site output budget.** Run `f8bb1326` hit `max_tokens (16384)` —
   Sonnet 5 adaptive thinking counts against the prompt row's budget and the
   Admin editor does not expose `wmkf_ai_maxtokens`. Caller now sends
   `maxTokensOverride: 32 768` (retry succeeded).
3. **Admin "Output budget" line** on every Prompt templates card: effective
   max_tokens, prompt-row value, server override (with since/reason),
   resolved model, reviewed ceiling (red if exceeded), thinking mode, and an
   "Anthropic model docs ↗" link with the registry `reviewedAt`. Budgets
   live in `shared/config/executorBudgets.js`, imported by BOTH callers
   (pre-site standing; review-synthesis retry floor/ceiling) and the panel —
   display equals use by construction; `tests/unit/executor-budgets.test.js`
   pins the literals. **Owner directive:** "we can't be setting mutable
   parameters in code" → queued (see Verified Open 1).
4. **1002379 cleanup executed (owner-run script, untracked).** Inventory
   back to 2026-08-01 across Dataverse, Postgres, and the SharePoint tree;
   deleted the pointer, 7 registry rows, 7 generated files + 3 folders, 10
   distribution rows; kept AI-run rows, `AI Materials/`, cover-page copy,
   `Reviewer_*`. The 6 test emails + "Test Site Visit" stay (owner: unrelated
   to the proposal; cleanup is for future data mining). Record:
   `docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md` §6.
5. **Guarded reopen note minimum (10 chars)** explained to owner; inline
   validation copy offered, not built.

### Commits (main, all deployed Ready)

- `a7eb79be` merge funding history (`e40ad309`, `618b54f4`, `748b429e`,
  `4913705e`, `db19fb13`, `58ad5281`, `2fd361fc`)
- `730958d1` rollup probe · `c99d1fd8` research-recency merge
- `6313db3b` 32 768 budget · `6915c2c6` admin output-budget merge
  (`a42994ee`, `31a6f0da`)
- `ca0d6f26` mutable-parameters action item + memory
- `5fcdb899` / `a6058165` inventory probe + audit · `9b189271` / `aa548ed9`
  cleanup record + data-mining rationale memory

## Codex workstream handoff — branch `codex/staff-deliberations-history-ux` (ownership returned to owner 2026-08-28 evening)

**Branch state `[VERIFIED read-only at S467 close]`:** worktree
`../WMKF_Apps-codex` clean; HEAD `ef36a801` = origin (0 ahead / 0 behind);
11 files vs `main`, no shared primitives, routes, schema, or services touched.
- `1fde64f9` — Group distribution history and tag test sends
  (`shared/components/workbench/PreSiteDistributionPanel.js`,
  `tests/unit/pre-site-distribution-panel.test.js`): neutral "Test send" pill
  when every To/Cc equals From (case-insensitive); calendar-day grouping with
  Today/Yesterday/short-date headers, newest day first, API order within a
  day. 12/12 focused tests; ESLint 0 errors (one pre-existing
  `react-hooks/set-state-in-effect` warning outside the diff). **No build
  run. Not merged, not deployed.**
- `ef36a801` — closeout: `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md`,
  `docs/audits/final-writeup-review-fable-review-2026-08-28.md`,
  `outputs/final-writeup-review-2026-08-28/` (brief + 4 HTML mockups), and
  the branch copy of SESSION_PROMPT.md (its handoff section is superseded by
  this one — resolve in favour of `main` at merge).

**Merge path (owner's go, from the main checkout):** `git merge --no-ff
codex/staff-deliberations-history-ux` → `npm run lint` + `npm run build` on
the merged tree → push → `vercel inspect` → park the worktree
(`git -C ../WMKF_Apps-codex checkout -B codex/parked origin/main`).

**Final Writeup Review — PLAN ONLY, do not implement without owner's go.**
Claude Fable review: READY WITH NAMED PREREQUISITES (no P0; findings folded
in). Accepted architecture: one editable SharePoint document; keep
`wmkf_CurrentPreSiteVisit`; source row → lifecycle `FINAL`; a separate Final
lineage row pointing to the same item; explicit review acknowledgements.
Prerequisites: (1) owner approves the expanded file surface (services,
routes, schema, pages — the two-file authorization does not cover it);
(2) explicit transition actor/time storage before Slice 1 (do not rely on
Dataverse `modifiedby` — S466 attribution finding); (3) owner-authorized
read-only `systemuser` coverage probe before the Slice 2 acknowledgement
schema; (4) explicit PC/leadership persona contract before Slice 4;
(5) Slice 0 `/sweep` of the obsolete "copy to a new Final file" direction.
This resolves S466 Owner Decision 1 (Q4b) at design level, pending the go.

## Next Items

### Verified Open

1. **Persist Executor output budgets as admin-editable settings (owner
   directive S467).** Evidence: `docs/CURRENT_WORK_QUEUE.md` audit
   follow-ups; `feedback-mutable-parameters-not-in-code`. Target: Prompt
   templates panel edits budget/timeout; Executor reads durable state
   (`wmkf_appsystemsettings` pattern behind `/api/admin/models`, or the
   prompt row); registry becomes seed/fallback; keep the server-side ceiling
   bound and superuser-only writes. Tier 1 — feature branch.
2. **Merge decision on `codex/staff-deliberations-history-ux`** (section
   above). Owner's call; Tier 1 UI.
3. **Positive-path funding history has no production exercise yet.**
   Evidence: 1002379 hit the zero-count branch; positive path proven only by
   probe (Emory, UCLA…) and unit tests. First real institution with program
   grants will exercise it — check the sentence in that document.
4. **WAITING on Connor (~2026-09-10): `wmkf_requestdocument` staff-role
   privilege grant.** After the grant, owner re-runs
   `scripts/probe-write-attribution-census.js`.
   `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` §Status.
5. **PD onboarding / posture seeding — before the NEXT solicitation cycle.**
   Evidence: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist.
6. **Async PD approval for staff-triggered "sent as me" mail.** Evidence:
   plan doc Broader effort; `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`.
7. **Limited add-addressees control for the materials composer** (S466
   proposal Q5; owner: "not every board member"). Shape to discuss.

### Owner Decision Needed

1. **Final Writeup Review plan — go / file-surface approval** (prerequisite
   1 above). Until then the S466 Q4b item stays design-resolved only.
2. **Share→Wrap Up no-send fallback (proposal Q4a):** manual "Move to
   wrap-up" for visits whose materials go out off-app, or rail stays Share.
3. **Zero-program-grant wording:** currently "…has not previously received a
   program grant from WMKF." Discretionary history (St. Jude: 18 awards) is
   not mentioned; a variant is a small change in
   `formatInstitutionalFundingHistory` if wanted.

### Parked

1. **Reviewer cron-reminders ledger slice — BUILT, HELD on
   `feature/reviewer-cron-reminders-ledger` until the review cycle ends.**
   Migration 038 UNAPPLIED everywhere. Promotion sequence in
   `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10 (branch copy).
2. **Preference-matrix slice BUILD** — after Parked 1 merges.
3. **PD tutorial refresh + distribution** — re-open at Parked 1 step (e).
4. **Post-cycle invitation-link strictness.**
   `project-invitation-link-strictness-open-decision.md`.
5. **Public git history rewrite** — owner-gated
   (`docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`).
6. **Tier 2 send-path reorder** (`94012253` commit message).
7. **Effort override for the pre-site call.** Only if the 240s timeout is hit
   again now that the budget is 32 768; needs a product nod.

### Verify Before Acting

1. **Phantom co-PI residuals (CRM-side cleanups)**: local
   `outputs/phantom-copi-incident-2026-08-12.md` §Update 2026-08-27. Prod
   writes — owner confirmation + preflight re-probe first.
2. **Logistics PATCH route has no in-app UI caller since S466.** Re-grep
   callers before any retirement; service + validation intentionally live.
3. **1002379 as a future smoke vehicle:** it now has NO writeup state
   (pointer empty, 0 registry rows) but `AI Materials/ProposalNarrative_1002379.pdf`
   is still in place. Re-run `scripts/probe-request-1002379-test-inventory.js`
   before and after any new test; the app principal cannot delete Activity
   records (403 DeleteAccess) — by design, do not request the grant.

### Do Not Reopen Without New Decision

1. **Most-recent grant = newest Research program grant** (owner S467); count/
   sum remain all-program rollups matching the AkoyaGO Award History panel.
2. **Registry budgets as the long-term home** — owner S467: mutable
   parameters must not live in code (Verified Open 1 is the replacement).
3. **1002379 test emails / "Test Site Visit" activity** — owner S467: leave
   them; `wmkf_ai_run` rows retained; unregistered SharePoint files kept.
4. **Blanket per-PD review of all automated mail.** Plan doc decision 10.
5. **Reviewer flags keyed on contact.** S389 + Atlas.
6. **Write-permission asymmetry between flag stores.** Owner 2026-08-26.
7. **Merging the parked reminders slice mid-cycle.** Owner S463.
8. **Throwaway smoke-candidate cleanup on `1002788`** — owner removes.
9. **Third "always auto" preference level.** Owner S464.
10. **Re-running the 1002852 hard-failure smoke.** Owner S465.
11. **Optional Dataverse probe for S465 smoke soft spots.** Owner S466.
12. **Separate Pre Site Visit / Site Visit tabs; calendar (.ics) UI; in-app
    logistics editor.** Owner S466 removals/merge; legacy keys alias.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/pre-site-visit/funding-history.js` | Rollup predicate, fail-closed reconcile, research recency, sentence formatter |
| `lib/services/pre-site-visit/proposal-core-service.js` | Loader: account rollups + program grants; `PRE_SITE_BUDGET` overrides |
| `shared/config/executorBudgets.js` | Server-owned Executor budgets (pre-site standing; synthesis retry) — shown in Admin |
| `shared/components/admin/PromptTemplatesSection.js` | `OutputBudgetLine` (budget · model · ceiling · Anthropic docs link) |
| `lib/services/model-capabilities.js` | Reviewed per-model ceilings, `thinkingMode`, `source`, `reviewedAt` |
| `scripts/probe-funding-history-rollups.js` | Read-only rollup/recency validation across accounts |
| `scripts/probe-request-1002379-test-inventory.js` | Read-only test-residue inventory (registry, runs, pointers, SharePoint refs) |
| `docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md` | Inventory + executed cleanup record |
| `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` (Codex branch) | Final Writeup Review plan — prerequisites gated |
| `docs/EXECUTOR_CONTRACT.md` | `maxTokensOverride` / `timeoutMsOverride` rows → registry |

## Testing

```bash
npx jest tests/unit/pre-site-visit-funding-history.test.js \
  tests/unit/pre-site-visit-proposal-core-service.test.js \
  tests/unit/pre-site-visit-artifact-service.test.js \
  tests/unit/pre-site-visit-docx-renderer.test.js \
  tests/unit/executor-budgets.test.js \
  tests/unit/synthesize-reviews-service.test.js \
  tests/unit/admin-models.test.js
npm run lint   # PromptTemplatesSection is in the react-hooks-sensitive zone
node scripts/probe-funding-history-rollups.js            # read-only, owner-authorized
node scripts/probe-request-1002379-test-inventory.js     # read-only, owner-authorized
```
