# Session 499 Prompt: Reviewer closeout UI landed; dossier and Codex-branch decisions still owner-gated

## Session 498 Summary (Claude, 2026-09-08)

Owner-present orchestration session, continuing the Session 496 conversation after Codex handed
all branches to Claude (PR #194). Fable orchestrated, Sonnet built, Opus reviewed, Codex ran the
adversarial pass (`--model gpt-5.6-sol`). Six PRs merged to `main`, all Tier 0 UI/docs/cleanup,
all through the normal reviewed path; production auto-deployed each. CI on `main` was green after
every merge (verified via `gh run list`, five workflows each).

### What Was Completed

1. **Codex handover absorbed** (PR #194). Claude now owns every `codex/*` branch; the handover
   brief is `docs/plans/CODEX_HANDOVER_TO_CLAUDE_2026-09-08.md`.
2. **Closeout next-action rule** (PR #195 `2018d4b1`). Track Reviewers shows `Mark complete` for
   `review_received`, `Record closeout` for a Complete row with no eligibility, nothing otherwise;
   `Edit closeout` lives in the More menu for Complete rows only. Helper `closeoutNextAction`
   exported via `_managePanelInternals`.
3. **Duplicate "More" header removed** on the reviewer follow-up page (PR #196 `276b0254`).
4. **Closeout "failure" diagnosed as designed behavior.** The owner's "Failed to close reviewer
   engagement" came from a local `npm run start` on port 3000, not production: the Dataverse
   target interlock denies local→production writes and the closeout route's catch-all turns that
   throw into generic 500 copy. No production request existed in Vercel logs (filtered pulls,
   see memory `reference-vercel-logs-filtering`). The same closeout then succeeded in production.
5. **Honorarium-eligibility pill** (PR #197 `0db75856`, PR #198 `56c90462`, PR #199 `16a0a8b4`).
   Complete rows show a pill beside the status badge: `$ Eligible` / `$ None` / `$ N/A` (gray),
   amber `$ Undecided` for a legacy null, amber `$ Needs review` for the API's `unknown`
   sentinel. Full wording is in `title` and an `sr-only` span. Opus caught the `unknown`
   mis-map, an inert `aria-label` on a bare span, and missing render tests; Codex caught
   `role="img"` announcing a status as an image and a brief omission; all fixed. The dead
   `closeoutDispositionLabel` helper and map were then removed. The residual height mismatch was
   the page-level badge-geometry rule (`8ca77bdc`) matching only `span.rounded-full`; both the
   follow-up page and the Reviewers tab now also match `a`/`button` pills (measured in Chromium:
   20px vs 28px before, 28px/28px after).
6. **Owner-authorized read-only production probe** (owner ran it via `!` after the auto-mode
   classifier refused): 2 Complete reviewer rows in production, 1 with null eligibility
   (completed 2026-09-02, pre-contract, one request). The owner's colleague will record that
   closeout herself.
7. **Durable docs:** `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md` reconciled with the
   pill (and corrected: the modal never rendered "Closeout disposition not recorded");
   `docs/agent-wiki/topics/dev-environment.md` notes the interlock write symptom; memory
   `reference-vercel-logs-filtering` added.

### Commits (Claude, all merged to `main`)

PR #194 handover · PR #195 `2018d4b1` · PR #196 `276b0254` · PR #197 `0db75856` (`f97df047`,
`54101fc6`, `8f862bfa`, `954fbfa6`) · PR #198 `56c90462` (`e00d69a0`, `b99cd73b`) · PR #199
`16a0a8b4` (`45ba7306`).

Milestone determination: no `DEVELOPMENT_LOG.md` entry. UI polish, cleanup, and docs; no
production capability, cutover, or incident.

Process note: PR #198 was merged while its Jest/Playwright/claude-review checks were still
pending (branch protection allowed it); the post-merge `main` runs were watched and were green.
PR #199 waited for all checks. Wait for checks before merging.

## Next Items

### Verified Open

1. **Surface interlock and Dataverse write failures in the closeout route instead of a generic 500.**
   Evidence: `pages/api/review-manager/close-review.js:64-71` maps only `ServiceHttpError`;
   `lib/services/reviewer-engagement/close-review.js:70-84` `mapWriteError` maps only 412 and two
   guard messages. An interlock denial or a Dataverse 400/403 reads as "Failed to close reviewer
   engagement" with no status in the UI. Small, Tier 0; consider the sibling engagement routes.
2. **Reconcile Codex's three reviewer UI commits (`b5f353de`, `ab426be6`, `7f1ee13d`) from
   `codex/UI-audit` onto current `main`.** Evidence: `origin/codex/UI-audit` is 20 commits ahead
   of `origin/main`; PR #192 from it is CLOSED unmerged; `main` has since changed the same
   follow-up page (PR #196 removed the CSS "More" pseudo-header, PR #199 widened the badge rule).
   Inspect the diff first and cherry-pick only the three; never merge the branch wholesale.
3. **Cycle Dossier reconciliation** (carried from Session 496/497). Evidence: local branch
   `claude/cycle-dossier-reconcile` at `81675ccd` (11 ahead / 16 behind `origin/main`, not
   pushed) in worktree `.claude/worktrees/agent-abe4c30babd201d76`; PR #179 still OPEN from
   `codex/cycle-dossier-pilot-build`. Blocked on the roster-scope decision below; then re-verify,
   push, update PR #179, and only then the owner-authorized one-request smoke.
4. **`docs/J27_BUILD_AND_CHANGE_PLAN.md`** once Connor's Q5 lands (parked, see below).

### Owner Decision Needed

1. **Dossier roster scope.** `loadDossierRoster` (`lib/services/cycle-dossier-service.js:24-41`)
   applies `buildVisibilityFilter` but not `buildProgramScopeFilter`. Options: (a) Research-only
   via the program-scope filter, (b) cross-program, (c) authorize a read-only `--live-read`
   rollout check first.
2. **Codex branches to abandon or keep:** `codex/UI-audit` (after item 2 above),
   `codex/reviewer-ui-surfacing`, `codex/c0-4-action-policy-foundation`,
   `codex/ror-api-production-shadow`. Evidence: handover brief; all still on `origin`.
3. **`.impeccable/config.json`** is dirty in the main checkout (Codex's two design-exception
   entries, +18 lines, uncommitted since 2026-09-08 17:25). Commit or discard; not Claude's edit.
4. **Combined dossier retention policy beyond the pilot** (unchanged from Session 494).
5. **Colleague discussion:** PD front-end flip to `Phase II Pending` (J27 register Q8).
6. **Filed, not urgent** (register §7): Q1b, Q12, Q13, Q15, Q16, Q20, Q24; Dataverse attribute
   drops (`wmkf_summarybloburl`, `wmkf_summarypages`) Connor-applied Tier 0 when convenient;
   Final writeups header consistency; smaller shared select variant (S492 survey).

### Parked

1. **Connor items** (J27 Q5 proposal location/filename, back-end status changes, slice G).
   Re-open when Connor returns.
2. **Request Quick Find metadata repair.** Two HTTP 400 / `0x80040216` attempts; do not retry
   without a new owner decision.
3. **Legacy Complete row with null eligibility (1 row, request-scoped).** Owner's colleague will
   record it via `Record closeout`; the amber `$ Undecided` pill clears on save. Do not backfill.

### Verify Before Acting

1. **Worktrees.** Only `.claude/worktrees/agent-abe4c30babd201d76` (`claude/cycle-dossier-reconcile`)
   remains besides the main checkout; the Session 498 worktrees were removed after merge. Codex's
   checkouts are gone from this machine's worktree list; re-check `git worktree list` anyway.
2. **Dossier rollout configuration and candidate identity.** Earlier work referenced rollout
   profile 2 and Request `1002963`; re-read source and live read-only state before reuse.
3. **J27 register/site binding contract.** `check:j27-register` is strict;
   `shared/config/workbenchVisibility.js` is a register site (J27-020, J27-037). Any change to
   its predicate text must rebind those rows in the same PR.
4. **Auto-mode classifier refuses Node scripts that read production Dataverse** even with owner
   authorization. Write the probe to the scratchpad and hand the owner a `! node <path>` line.

### Do Not Reopen Without New Decision

1. **Pill wording.** Owner confirmed `$ None` / `$ N/A` over Codex's longer labels (2026-09-08).
2. **`$ Undecided` amber state kept** (owner, after the probe showed one legacy row).
3. **Set Aside in Reviewer follow-up** removed by owner decision (`8376fa56`).
4. **Hard-coded Research-only filtering** rejected; PR #183 program selector is live.
5. **Onboarding decks retired** (PR #184); J27-023 citation dropped (owner ruling, PR #186).
6. **Codex model:** `gpt-5.6-sol`; never `gpt-6-astra`; never edit `~/.codex/config.toml`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewerManagePanel.js` | Track table: StatusBadge, honorarium pill (`honorariumEligibilityPillInfo`), `closeoutNextAction` |
| `shared/components/reviewers/ReviewerCloseoutModal.js` | Closeout modal (helper/map removed in #198) |
| `pages/workbench/reviewer-follow-up.js`, `shared/components/reviewers/ReviewersTab.js` | Page-level badge geometry rules (span/a/button `.rounded-full`) |
| `pages/api/review-manager/close-review.js`, `lib/services/reviewer-engagement/close-review.js` | Closeout route and service; generic-500 catch-all (next item 1) |
| `lib/dataverse/core/interlock.js` | Local→production write denial (`evaluatePolicy`) |
| `lib/services/cycle-dossier-service.js` | Dossier roster (`loadDossierRoster`, scope decision pending) |
| `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md` | Closeout/honorarium contract, reconciled with the pill |
| `docs/plans/CODEX_HANDOVER_TO_CLAUDE_2026-09-08.md` | Codex branch handover |

## Testing

```bash
npx jest tests/unit/reviewer-closeout-next-action.test.js tests/unit/reviewer-closeout-modal.test.js
npm run check:docs-catalog && npm run check:doc-symbol-refs && npm run check:agent-invariants
npm run check:j27-register
```
