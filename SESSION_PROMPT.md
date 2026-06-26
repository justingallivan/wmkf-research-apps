# Session 292 Prompt: Nomenclature cleanup Phase 3/4 + parked domain discussion

## ⚠️ Top-of-session must-knows

1. **`scripts/probe-rabinowitz-conflict.js` is UNTRACKED on purpose and must STAY
   untracked** — it hardcodes a real reviewer's email (`joshr@princeton.edu`),
   names-stay-local norm. Never `git add -A` it in. Stage specific files only.
2. **Push posture:** S291's commits were pushed at end of session. No standing
   no-push instruction carries into S292 unless Justin sets one. Pushing `main`
   auto-deploys to Vercel prod — confirm before shipping anything new outward.
3. **Known-red test suites (unchanged):** `tests/unit/bill.test.js` and
   `tests/unit/discovery-verification-status.test.js` only. Confirm any red is ONLY
   these before chasing.
4. **Two new CI gates this session — keep them green:** `check:route-lifecycle-auth`
   (auth-parity for `ROUTE_NAMESPACE_LIFECYCLE` namespaces, fail-closed) and
   `check:scaffolding-tokens` (rejects leaked scaffolding tag lines in committed
   files; also a fail-closed Write/Edit hook). Both are in `.github/workflows/test.yml`
   and the `/start` gate list. If you add/rename a lifecycle route namespace or its
   guard, expect `check:route-lifecycle-auth` to enforce parity.

## Session 291 Summary

Executed the first phases of the nomenclature/app-lifecycle strategy and — after a
"that isn't enforcement if it doesn't happen" challenge — built **mechanical
enforcement** so the new nomenclature claims are gated against source instead of
relying on advisory safeguards. Then archived a true-orphan legacy surface and
renamed a live component, each Codex-reviewed before commit.

### What Was Completed

1. **Commit 1 — additive lifecycle registry + glossary** (`230e9bab`, `4bf6dcca`).
   New exports `APP_LIFECYCLE_REGISTRY` + `ROUTE_NAMESPACE_LIFECYCLE` in
   `shared/config/appRegistry.js` (non-active keys only — "active" derives from
   `APP_REGISTRY`, no duplication); `docs/NOMENCLATURE_GLOSSARY.md` created;
   de-overloaded `ownerAppKey` (semantic only, NOT auth) and added `guardAppKeys`
   (full accepted OR-logic set per namespace). Codex adversarial review folded
   (stray scaffolding, bare path, ownership/auth overload, "backed by" framing).

2. **Enforcement gates + fail-closed hook** (`33360fb7`).
   - `check:route-lifecycle-auth` (`scripts/check-route-lifecycle-auth.js` +
     self-test): AST-based, scoped to `ROUTE_NAMESPACE_LIFECYCLE`, verifies each
     namespace's live `requireAppAccess` accepted-key set equals `guardAppKeys`;
     **null-branch fail-closed** on any guardless route.
   - `check:scaffolding-tokens` (`scripts/check-scaffolding-tokens.js` + self-test)
     + `.claude/hooks/block-scaffolding-tokens.js`: rejects lines that are SOLELY
     scaffolding tags (outside fenced blocks); inline/backticked mentions allowed.
     Hook wired in `settings.json` fail-closed (exit 2, no `|| true`).
   - Both added to `.github/workflows/test.yml` and `/start`'s gate list;
     `feedback-enforcement-hierarchy.md` memory + MEMORY.md router line added.

3. **Phase 1 / Commit 2 — archive the legacy Phase II writeup surface** (`b00b43b6`).
   `git mv` of `phase-ii-writeup-legacy.js`, `/api/process-legacy.js`,
   `proposal-summarizer-legacy.js` into `_archived/` after the owner confirmed the
   page is invisible to all suite users and not in use (runtime-log retention ~1 day
   couldn't prove months of non-use). Removed the `/api/process-legacy` row from the
   API matrix, its prompt-injection-tagging entry, the payload-boundary test block,
   and the dead `LEGACY_BATCH_*` constants; dropped its `ROUTE_NAMESPACE_LIFECYCLE`
   entry (the gate forced this to be atomic); regenerated `CANONICAL_COUNTS.md`
   (requireAppAccess endpoints 79→78, route files 134→133).

4. **Phase 2 — rename `CandidatesPanel` → `ReviewerInvitePanel`** (`a1815859`).
   Component file + symbol + 2 unit tests renamed; `ReviewersTab.js` import/JSX
   updated. The route path, the `?sub=candidates` deep-link, and the `candidates`
   tab key are contracts and were left as-is. Codex caught a LIVE `npx jest` command
   in `REVIEWER_E2E_REHEARSAL_RUNBOOK.md` naming the deleted test file — fixed +
   fanned out to `REVIEWER_GENERATION_DATA_QUALITY_DESIGN.md`.

### Commits (all pushed at /stop)
- `230e9bab` - Add app lifecycle registry + nomenclature glossary
- `4bf6dcca` - Fold Codex review of nomenclature Commit 1
- `33360fb7` - Enforce nomenclature claims against source: auth-parity + scaffolding gates
- `b00b43b6` - Archive the legacy Phase II writeup surface (Phase 1 / Commit 2)
- `a1815859` - Rename CandidatesPanel → ReviewerInvitePanel (Phase 2)

## Potential Next Steps

### 1. Nomenclature strategy — Phase 3 + Phase 4 (the remaining work)
`docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` is the plan. Phases 1–2 shipped (S291).
**Remaining:**
- **Phase 3 — LEAVE+DOCUMENT** the borrowed `/api/reviewer-finder` + `/api/review-manager`
  namespaces. Largely already captured in `NOMENCLATURE_GLOSSARY.md` + the lifecycle
  registry; Phase 3 is confirming nothing else needs documenting and is now gated by
  `check:route-lifecycle-auth`. Verify scope before treating as open work.
- **Phase 4 — fact-level `/sweep`** to reconcile lingering `CandidatesPanel` mentions
  across `.claude-memory/` files, `docs/agent-wiki/` topic pages, and the ~20 historical
  `docs/` design docs. Many of those are historical records (classify, don't silently
  rewrite per `.claude/rules/durable-docs.md`); the live-runnable references were already
  fixed in S291. Honor the consolidated-grant + persisted-key inventory precondition in §3
  before any further rename/alias.

### 2. Parked — old `wmkfresearch.vercel.app` bookmarks (owner wants to talk)
Owner flagged that bookmarks to the legacy `wmkfresearch.vercel.app` domain (vs the
current `applications.wmkeck.org`) "may cause problems." This is a **discussion item**,
not a green-lit task — start by asking what behavior they're seeing / want. Cross-ref
`project-branded-domains.md` (staff auth cut over to `applications.wmkeck.org` 2026-06-23).

### 3. Contact-boundary gap — owner policy decision, then build
`docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` lists the open policy questions
(auto-link vs staff-confirm; who owns truth on conflicts). When decided, the
**lowest-policy-dependency increment** is the `ensureContact` ORCID-fallback fix
(stops the duplicate-contact-on-corrected-email bug). Blocked on Justin's policy answers.

### 4. Deferred Codex P2 merge hardening (optional, design-doc'd)
Not built; Justin's call: map mid-merge Dataverse 409/412 to a retryable 409
(currently 500); trim suggestion/request IDs from the plan response if unused; add
an audit breadcrumb on keeper+loser at deactivate.

### 5. Long-stale carryovers (VERIFY-FIRST or retire — do NOT assume open)
Ridden forward several sessions without re-verification; probe live state before acting:
- S288: record real-replay human sign-off in `docs/MODEL_CHANGE_STRATEGY.md`
  (reviewer-finder already pinned to `claude-opus-4-8` in prod); Admin Models visual smoke.
- S285/S286: request `1002788` test-data triage; E2E of Restore Removed Candidates
  + PD identity override; reviewer-portal review-upload design decision; optional
  auto-on-award abstract cron.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/appRegistry.js` | `APP_REGISTRY` (16 active) + `APP_LIFECYCLE_REGISTRY` + `ROUTE_NAMESPACE_LIFECYCLE` (non-active keys; `guardAppKeys` = full OR-logic set). |
| `docs/NOMENCLATURE_GLOSSARY.md` | Canonical glossary for overloaded names (Workbench, Reviewer Finder, candidates/ReviewerInvitePanel, etc.). |
| `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` | Cleanup strategy (Codex adversarially reviewed). Entry point for #1. |
| `scripts/check-route-lifecycle-auth.js` | Auth-parity gate for lifecycle namespaces (AST, fail-closed). |
| `scripts/check-scaffolding-tokens.js` | Scaffolding-leak gate; paired with `.claude/hooks/block-scaffolding-tokens.js`. |
| `shared/components/reviewers/ReviewerInvitePanel.js` | Invite Reviewers tab (renamed from `CandidatesPanel.js` S291). |
| `.claude-memory/feedback-enforcement-hierarchy.md` | The eliminate→gate→friction enforcement hierarchy lesson. |
| `scripts/probe-rabinowitz-conflict.js` | UNTRACKED, names-local. Never commit. |

## Testing

```bash
# The two new gates (+ self-tests), run sequentially:
npm run check:route-lifecycle-auth && npm run check:route-lifecycle-auth:self-test
npm run check:scaffolding-tokens && npm run check:scaffolding-tokens:self-test

# Drift gates touched by nomenclature work:
npm run check:fact-consistency && npm run check:doc-symbol-refs \
  && npm run check:build-claim-freshness && npm run check:agent-wiki
```

## Gotchas / Continuity

- Nomenclature cleanup is sequenced: dead-end UI removal → archive true orphans →
  rename live internals → `/sweep` docs. Phases 1–2 done; Phase 3 (document borrowed
  namespaces) + Phase 4 (`/sweep` historical docs) remain. Don't rename route paths
  (contracts) or bare-rename persisted keys (`model_override:reviewer-finder:model`,
  `reviewer-finder.*` preferences, the `candidates` tab key).
- The two new gates are fail-closed by design. If `check:route-lifecycle-auth` goes
  red after a route change, the live `requireAppAccess` accepted-key set drifted from
  `guardAppKeys` — fix the registry or the route, don't loosen the gate.
- The scaffolding-token hook blocks Write/Edit of files containing bare scaffolding
  tag lines. Inline/backticked mentions (e.g. in a doc explaining the gate) are fine.
- Archived legacy Phase II writeup surface is in `_archived/`; do not resurrect into
  `APP_REGISTRY` or the route tree.
```
