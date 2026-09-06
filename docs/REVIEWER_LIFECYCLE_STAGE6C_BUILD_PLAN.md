---
title: Reviewer Lifecycle Stage 6C — extract the modal and action components out of ReviewerManagePanel
kind: plan
domain: reviewer-workbench
status: historical
canonical: false
owner: product-engineering
last_verified: 2026-09-05
summary: Pure move of the materials modal, token actions menu and reminder action out of ReviewerManagePanel; re-exports preserved; no behavior change; precedes 6D.
---

# Stage 6C — UI extraction

**Architect:** Claude (S489). **Builder:** Sonnet subagent. **Reviewer:** Opus subagent.
**Adversarial:** Codex, at most two rounds (a stopping rule, not a target). **Tier:** 1
(internal refactor, stable public contract) — branch `claude/reviewer-lifecycle-stage6c`, PR,
owner merge. **Sequencing:** before Stage 6D, so 6D's contract change lands in the extracted
modal file.

## Why now [VERIFIED via source on main `e3071fdd`]

`shared/components/reviewers/ReviewerManagePanel.js` is 2,941 lines. Stage 6B3 needed five
review rounds, all landing in this file. Its top-level composition:

| Lines | Symbol | Export | Notes |
|---|---|---|---|
| 53 | re-export of `STATUS_PIPELINE`, `MODE_STATUSES`, `MODE_WORK_REMAINING`, `filterByMode` from `./reviewer-modes` | named | no importer found under `shared/`, `pages/`, `tests/` — keep anyway (public surface) |
| 64 | `StatusBadge` | named | small; stays |
| 75–107 | `TOKEN_STATE_INFO`, `TokenStateBadge` | named | moves |
| 108–281 | `REVIEW_REMINDER_ERROR_MESSAGE`, `ReviewReminderAction` | named | moves |
| 282–513 | `MENU_WIDTH`, `TokenActionsMenu` | named | moves |
| 514–597 | storage keys, `PREVIEW_RENDER_TIMEOUT_MS` (named export), `fileKeyOf`, `emptyProposalDoc`, `MEMBERSHIP_KEY_*`, `membershipKeyFor`, `proposalKeyFor` | mixed | moves (see split below) |
| 598–1838 | `ReleaseMaterialsModal` | internal | moves — ~1,240 lines |
| 1839–2025 | referral helpers, `ReferralAction`, `ReferralConfirm` | internal | stays (panel-local) |
| 2026–2941 | `ReviewerManagePanel` default export | default | stays |

Named-export importers that must keep working unchanged:
`tests/unit/reviewer-manage-actions-menu.test.js` (`ReviewReminderAction`, `TokenActionsMenu`,
`TokenStateBadge`), `tests/unit/reviewer-manage-degraded.test.js` (`ReviewReminderAction`),
`tests/unit/manage-panel-preview-error-retry.test.js` (`PREVIEW_RENDER_TIMEOUT_MS`). Default
importers: `ReviewersTab.js`, `pages/workbench/reviewer-follow-up.js`, nine unit suites.
`tests/unit/reviewer-follow-up.test.js` mocks the module path
`shared/components/reviewers/ReviewerManagePanel` — the path must not change.

## Target layout

```
shared/components/reviewers/
  ReviewerManagePanel.js        default export + StatusBadge + referral pieces + re-exports (~1,450 lines)
  ReleaseMaterialsModal.js      ReleaseMaterialsModal (default) + PREVIEW_RENDER_TIMEOUT_MS,
                                storage keys, fileKeyOf, emptyProposalDoc (module-private unless exported today)
  reviewer-draft-keys.js        membershipKeyFor, proposalKeyFor, MEMBERSHIP_KEY_* separators
                                (imported by both the modal and the panel call site at ~2912)
  TokenActionsMenu.js           TokenActionsMenu (named), TokenStateBadge (named), TOKEN_STATE_INFO, MENU_WIDTH
  ReviewReminderAction.js       ReviewReminderAction (named), REVIEW_REMINDER_ERROR_MESSAGE
```

`ReviewerManagePanel.js` keeps every current named export by re-exporting:

```js
export { TokenActionsMenu, TokenStateBadge } from './TokenActionsMenu';
export { ReviewReminderAction } from './ReviewReminderAction';
export { PREVIEW_RENDER_TIMEOUT_MS } from './ReleaseMaterialsModal';
```

## Rules for the builder

1. **Move, don't edit.** Code moves verbatim except for import/export lines and the removal
   of now-unused imports in the panel. No renamed identifiers, no reordered hooks, no
   changed default props, no comment rewrites (comments carry stage provenance —
   "Stage 6B3c", "S406" — that reviews rely on). `git diff --color-moved=dimmed-zebra`
   should show the bodies as moved blocks.
2. **Shared imports.** Each new module imports only what its body uses (Button/Card/Layout
   pieces, `render-preview-failure`, `email-template-store`, `reviewer-invite` utils, etc.).
   The builder must grep each moved body for every free identifier and resolve it.
3. **Hook and ref ownership is unchanged.** `ReleaseMaterialsModal` keeps its own
   `modalSessionRef`, `renderTailRef`, `activeRenderAbortRef`, `renderingEpochRef`,
   `proposalLoadSeq`; the panel keeps `selectionCauseRef` and passes `membershipCause` by
   the same ref read (the `eslint-disable-next-line react-hooks/refs` at the call site stays).
4. **No behavior change means no test edits** except one new file (below). If a test needs
   a change to pass, stop and report — that is a behavior change.
5. **Mock seams.** Grep every `jest.mock(` target across the 14 retained suites. A suite that
   mocks a dependency by module path (e.g. `render-preview-failure`, `email-template-store`,
   `Layout`) keeps working only if the new module that now owns the code imports the identical
   path. Report the table: mocked path → which new file imports it.
6. **Report non-move lines per file.** Alongside `git diff --color-moved=dimmed-zebra`, give the
   count of added/removed lines per file that are NOT part of a moved block (imports/exports
   only, expected), so a stray edit cannot hide inside a 1,300-line move.
7. Do not touch `ReviewerCloseoutModal.js`, `ReviewersTab.js`, `reviewer-follow-up.js`, or
   anything under `pages/api` or `lib/`.

## Tests

- **Retained selection (must stay green, byte-identical test files):**
  `tests/unit/reviewer-action-lifetimes.test.js`, `reviewer-status-mutation-characterization`,
  `reviewer-manage-actions-menu`, `reviewer-closeout-modal`, `manage-panel-preview-error-retry`,
  `reviewer-manage-proposal-attachment`, `reviewers-tab-stale-request`,
  `reviewers-tab-post-send-refresh`, `reviewers-tab-proposal-binding`, `reviewers-tab-referral-add`,
  `reviewer-follow-up`, `reviewer-materials-modal-lifetimes`, `reviewer-manage-degraded`,
  `reviewer-manage-decline-referrals`.
- **One new pin:** `tests/unit/reviewer-manage-panel-exports.test.js` asserting the re-exported
  symbols from `ReviewerManagePanel` are reference-identical (`toBe`) to the exports of the new
  modules, and that `membershipKeyFor`/`proposalKeyFor` from `reviewer-draft-keys` produce the
  exact strings the 6B3 tests expect for a two-reviewer fixture (copy the fixture shape from
  `reviewer-materials-modal-lifetimes.test.js`). This is the only regression teeth a pure
  move can add; behavior teeth are the retained suites.
- **Full slice exit:** `npm test -- --runInBand --watch=false && npm run check:types && npm run lint
  && npm run build -- --webpack && git diff --check`, plus `check:dataverse-access-layer` and
  `check:doc-symbol-refs` (docs cite `ReviewerManagePanel.js:NNN` line numbers; the gate flags
  dangling symbol refs, not line drift — line drift is handled in Docs below).

## Review checkpoints

- **Opus review:** confirm via `git diff --color-moved` that every moved block is a pure move;
  list any non-move hunk and justify each; confirm the retained suites ran unchanged; confirm
  no new `eslint-disable`.
- **Codex budget:** both rounds on the build (there is little design to challenge in a pure
  move); no plan-stage round. **Codex adversarial round 1:** target the seams — import resolution, `PREVIEW_RENDER_TIMEOUT_MS`
  identity, the `membershipCause` ref read, SSR/`window` guards that may have relied on module
  order. Round 2 only for a confirmed defect. Stop at two.

## Build and review record

- **Build (Sonnet, 2026-09-05):** `f7ab967f` on `claude/reviewer-lifecycle-stage6c`, cut from main
  `dcecf972`. Six files: four new modules, the slimmed panel, one new exports test. Non-move lines
  are import/export only (panel 7−/8+; modal 7; menu 4; reminder 2; keys 2). Retained 14 suites +
  new pin: 15 suites / 1,037 tests; full suite 774 / 11,341; types, lint 0 errors, build,
  `check:dataverse-access-layer`, `check:doc-symbol-refs`, `git diff --check` all green. No existing
  test file changed.
- **Codex adversarial round 1 (`f7ab967f`, two-dot diff against a main that had since advanced):**
  "needs-attention" on one high — that the branch "deletes" the Stage 2/3/5 plans and the autonomy
  directive. **Invalid finding, diff artifact:** those files were added to `main` after the branch
  was cut; `git diff main...HEAD` (merge-base) shows exactly the six intended files and
  `git merge-base` is `dcecf972` [VERIFIED via command]. Codex evidenced no moved-component seam
  defect. Disposition: rebase the branch onto current main before the PR so the two-dot view matches.
  Round 2 reserved for a confirmed defect from the Opus review.
- **Opus review (`f7ab967f`): PASS WITH ADVISORIES, no required items.** Pure move confirmed with
  and without whitespace relaxation; non-move lines are imports/exports and `export` declarations
  only; base 14 suites / 1,027 tests vs head 15 / 1,037 (delta = the new pin); out-of-tree mutation
  of the `TokenActionsMenu` re-export turns the pin red; lint warning sets map 1:1 base→head; no
  circular import; `reviewer-draft-keys.js` has zero imports. Advisories: (A) two comment blocks
  referred to code "below" that moved — fixed in follow-up commit `5d92d5bc` on the branch;
  (B) docs to relocate after merge (see Docs below, extended with the reviewer's list).
- Rebased onto main `f8d35368` as `70babc04` + `5d92d5bc`; PR #153 merged as `3b2b34d5` (2026-09-05 PT, eight CI checks green); branch deleted. Docs relocated in the same session (this file, wiki lifecycle/portal topics, 6B plan, readiness audit, 6D plan, SESSION_PROMPT).

## Docs (architect, after merge)

- `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (`:522`, `:1414`) and
  `docs/agent-wiki/topics/external-reviewer-portal.md` (`:470`): "`ReviewerManagePanel`'s
  `ReleaseMaterialsModal`" phrasing → the modal's own module.
- `docs/REVIEWER_LIFECYCLE_STAGE6D_BUILD_PLAN.md` `:34`, `:105` (modal render/send/skipped lines);
  `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` `:198`, `:229`;
  `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` `:64`, `:77`, `:82`;
  `SESSION_PROMPT.md` key-files row for the panel. Historical receipts/reviews stay as dated
  evidence.
- `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` 6C row → complete.
- `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` status line: 6C done, 6D next.
- Receipt: `docs/audits/REVIEWER_LIFECYCLE_STAGE6C_RECEIPT_<date>.md` with the verification
  counts, review verdicts and the moved-block table.

## Preserve (inherited contracts)

Shipped status ownership (per-reviewer mutex, permanent invalidation, matching-token cleanup,
6A outcome parsing); materials-modal session identity by VALUE (isOpen + requestId +
`membershipKeyFor` + signature/reviewDueDate + `proposalKeyFor`) and the completion exemption;
preview single-flight and tail serialization; send transmits the previewed body verbatim;
`degraded` gating; `ReviewersTab` `degraded={Boolean(error)}` wiring.
