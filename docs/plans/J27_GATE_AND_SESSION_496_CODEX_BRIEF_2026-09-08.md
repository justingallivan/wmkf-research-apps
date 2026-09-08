# Session 496 Handoff to Codex — J27 register gate is now strict (2026-09-08)

## Where you are

You are Codex, in your own checkout. As of this brief the main checkout
(`/Users/gallivan/Code/WMKF_Apps`) is on your `codex/UI-audit`; your other worktrees are
`WMKF_Apps-codex` (`codex/reviewer-ui-surfacing`), `.claude/worktrees/compact-controls`, and
`.claude/worktrees/session-494-handoff`. Run `/start` first. `origin/main` is `d7b7cfd5`.
Claude has no worktree open and owns nothing in flight; Claude's session-496 work is fully
merged. Stay on your branches; never push `main` directly; open PRs for the reviewed path.

## What changed on `main` since your Session 494 handoff (`af196fc2`)

1. **`check:j27-register` is now strict and will flag your edits.** PR #186 (`999f4baf`)
   rebuilt the advisory gate and reconciled `docs/J27_TRANSITION_REGISTER.md` so every open row's
   cited files carry a **bound** verbatim fragment. Baseline on `main`: 59 ok / 0 stale /
   6 unverifiable / 11 closed, 0 unbound. It runs in the `/start` battery (not CI, not hooks).
   When you touch a file the register cites, the gate names the row. Your PR #183 already
   tripped it (J27-020, J27-037: the visibility predicate moved to
   `shared/config/workbenchVisibility.js`); Claude rebound those rows in #186.
2. **How to keep a row green when you move or rewrite a cited fact.** Rules are in
   `docs/plans/J27_REGISTER_PER_SITE_RECONCILIATION_PLAN_2026-09-08.md` §3 and the header
   docblock of `scripts/check-j27-register.js`. Short version: in the row's `excerpt` cell each
   cited file has `` `path` → `fragment` ``; the fragment must be a verbatim quote from that file
   (whitespace, backticks, and comment sigils are ignored; nothing else). If the fact moved to a
   new file, add the new file to `site` with its own binding and leave a dated `drift 2026-09-08:`
   note in the disposition cell. Never paraphrase a fragment, never remove a citation without a
   note, never put a bare `|` inside a cell (the gate exits 2). Run
   `npm run check:j27-register` before you commit; it prints exactly which file lost its match.
3. **`docs/onboarding/` is gone.** The two Workbench onboarding decks, their generator, and README
   were retired by the owner (PR #184 `52e16aa8`). Do not regenerate or reference them.
4. **`SESSION_PROMPT.md` structure.** Your Session 494 summary is preserved as "Previous handoff";
   the top is now Claude's Session 496 summary. Your four "Verified Open" dossier items (1–4) and
   your "Combined dossier retention policy" owner decision are unchanged and still yours. Claude's
   J27 items follow them (5–8) and are parked or owner-gated.
5. **Two doc lines you may have been citing changed:** `docs/REVIEWER_ENGAGEMENT_SPEC.md:110`
   (the manual "Send reminder" on Invite Reviewers is the sanctioned nudge and re-mints; the
   automatic scheduler is still held) and `docs/agent-wiki/topics/finance-honoraria.md` (the
   closeout honorarium decision is deployed, not pending).
6. **Owner answers recorded in the register §7:** Q3 — Initial Assessments stay hidden for D26,
   no read-only J27 preview. Q5 (J27 proposal SharePoint location) and slice G are parked until
   Connor returns; the remaining §8 questions are explicitly deferred by the owner.

## Your lane (unchanged from your own handoff)

1. Reconcile the Cycle Dossier pilot (`codex/cycle-dossier-pilot-build`, PR #179) with the
   production program-scope contract: merge current `main`, replace dossier-specific roster or
   program assumptions with `program-scope-service.js` and `shared/config/workbenchVisibility.js`.
   Note `workbenchVisibility.js` is now a **register site** (J27-020, J27-037): if you change its
   predicate text, rebind those rows per item 2 above in the same PR.
2. Re-run dossier verification after reconciliation (focused tests, security/DAL gates, full
   build, rollout preflight).
3. Controlled one-request dossier smoke with measured cost, only after 1–2 pass and with the
   existing staged rollout controls; preserve generated editions.
4. Deliberate release decision for PR #179 — owner call.

Not yours, do not touch: the J27 §8 owner questions, Connor's Q5/slice G, the S493 deferred
review follow-ups on `codex/reviewer-ui-surfacing` (count-script ergonomics, shared cycle-parser
reuse, aggregate-limit docs, stale acceptance comments) are yours but were left untouched by
Claude and are not urgent.

## Coordination rules that held this session and should keep holding

- One owner per surface. Claude worked only in fresh worktrees off `origin/main` and never read
  or edited your checkouts, including when the main checkout drifted to your branch mid-session.
- Merging `main` into a feature branch before opening the PR is worth it: it surfaced two real
  register drifts and two handoff conflicts early instead of at merge time.
- Reviews on this repo now run: Sonnet build → Opus read-only review → Codex adversarial
  (`--model gpt-5.6-sol`; the account refuses bare `gpt-5.6` and `gpt-5.4`, and the owner has
  excluded `gpt-6-astra`) → owner merge. If you want Claude to review a branch, say so in
  `SESSION_PROMPT.md` "Verify Before Acting" with the branch name and the file surface.

## Testing

```bash
npm run check:j27-register            # names any register row your edit broke
npm run check:j27-register:self-test  # 80 assertions; must stay green after gate edits
npm run check:fact-consistency && npm run check:doc-currency   # after any doc edit
```
