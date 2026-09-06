---
title: Reviewer Lifecycle Stage 6C — extract the modal and action components out of ReviewerManagePanel
kind: plan
domain: reviewer-workbench
status: active
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

## Docs (architect, after merge)

- `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`: replace file/line pointers into
  `ReviewerManagePanel.js` for the moved symbols with the new module names.
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
