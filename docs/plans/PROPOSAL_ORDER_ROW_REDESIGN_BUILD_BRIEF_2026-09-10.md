---
title: "Build F — Proposal order row redesign: legible drag, no arrows, quiet row"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build F — Proposal order row redesign

Source: the Impeccable critique of the Meeting Tracker session page "Proposal order" list
(snapshot `.impeccable/critique/2026-09-11T04-19-30Z__ts-meeting-tracker-sessioneditor-js-proposal-order.md`,
score 20/40). Owner direction (2026-09-10): "I don't think the arrows earn their keep.
Everything else is too busy so the user doesn't know what to do." Redesign the row; keep
the product truth, the persistence contract, and the design system (`DESIGN.md`, "The Clear
Workbench": neutral surfaces, Foundation Ink primaries, `rounded-lg` controls, semantic color
only for status, focus rings on every control). Operate mode: a PD arranging an agenda.

Only file in play besides tests and one plan bullet:
`shared/components/meeting-tracker/SessionEditor.js`. Reuse
`shared/components/workbench/OverflowMenu.js` (items `{ key, label, onSelect, disabled }`) and
`Button` from `shared/components/Layout.js`. Do not add dependencies.

## The row, after

Reading order: **handle → request → title (+ briefing) → Minutes → Lead PD → more.**

1. **Handle.** The whole left gutter is the drag handle: a `w-12` column, `min-h-[44px]`,
   `draggable={!busy}`, `cursor-grab` only when draggable, `active:cursor-grabbing`, grip icon
   (six dots, 16px, `text-gray-500`) above the index number (`text-sm font-semibold tabular-nums`).
   Hover/focus-within plate: `rounded-lg hover:bg-gray-100`. `title="Drag to reorder"` and a
   visually hidden hint the first time the list renders (one line under the section heading:
   "Drag a proposal by its handle to change the order."). Keep the existing drag handlers,
   `moveSlot`, `ProposalOrderList`, `reorderSessionSlots`, `runSlotChange`, ETag semantics, and
   the notice on success exactly as they are.
2. **No arrow buttons.** Remove them. Keyboard and assistive-tech users get a **position
   select** instead: a compact `<select aria-label="Position of #<requestNumber>">` with options
   1…n, rendered inside the handle column under the number (or to its right if height allows);
   changing it calls `moveSlot(slots, index, chosen - 1)` and persists through the same
   `onReorder` path. This moves any distance in one save, which is better than the arrows for
   everyone. The select must not be draggable-initiating: it sits inside the column but the
   `draggable` attribute lives on a sibling wrapper containing only the grip and number, as
   today; guard `onMouseDown` on the select with `stopPropagation` if needed.
3. **Insertion indicator without layout shift.** Replace `border-t-2/border-b-2 border-*-blue-500`
   with an inset ring in the system blue (`ring-2 ring-inset ring-blue-600` applied to the
   `<li>`, top or bottom half expressed with a 2px absolutely positioned rule inside the li, not
   a border). Dragged row `opacity-40` stays. Add `transition-transform duration-150` on rows.
   Escape during a drag cancels it (`onKeyDown` at the list level clears drag state).
4. **Quiet row.** Keep visible: request number (`font-semibold`), title, briefing link or the
   existing `slotBriefingText`, Minutes (number input, `w-24`), Lead Program Director (select).
   Move into an `OverflowMenu` labelled "More actions for #<requestNumber>" at the row's right:
   "Move to another session…" and "Remove…". Selecting either opens an inline panel below the
   row body (not a browser dialog): the move panel holds the session select and a Foundation
   Ink "Move" button plus outline "Cancel"; the remove panel reads "Remove #<num> from this
   session? Its minutes and lead assignment will be lost." with a danger "Remove" and outline
   "Cancel". Only the panel's primary button calls the existing handlers.
5. **Controls through the system.** Every button is `Button` (primary / outline / danger);
   inputs and selects share one class string with `rounded-lg`, `border-gray-300`, and a focus
   ring (`focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-500`). Card
   stays `rounded-xl border border-gray-200 bg-white shadow-sm p-4`. No `rounded` (0.25rem)
   controls remain in the file.
6. **Accessibility floor.** Arrow labels are gone; the position select carries the request
   number (fall back to `slot.wmkf_Request?.akoya_requestnum` when `proposal` is missing, which
   is the live case today). The `<ol>` gets `aria-label="Proposal order"`. The drag handle
   wrapper gets `aria-hidden="true"` (the select is the accessible path). Row heights should
   not depend on briefing copy wrap: put the briefing line on its own row below the title.
7. **Per-row saving state.** While `busy`, show which row is saving: the row that initiated the
   change gets a subtle `opacity-70` and its controls disabled; other rows only disable. Track
   `savingSlotId` in `SessionEditor` and pass it down. No spinner in the middle of content.

## Tests (`tests/unit/meeting-tracker-pages.test.js`)

Update the existing `ProposalOrderList` tests for the new markup. Add: position select renders
1…n and changing it calls `onReorder` with the full reordered array and the moved slot; no
arrow buttons exist; the overflow menu exposes exactly "Move to another session…" and
"Remove…"; Remove is not called until the inline confirm's Remove is clicked (mutant: calling
`onRemove` directly on menu select must fail); Escape during a drag clears the dragging state;
the handle wrapper is draggable only when `busy` is false; `aria-label` of the position select
contains the request number when `proposal` is undefined and the slot has an expanded request.
Keep the `moveSlot` unit tests and the reorder fetch payload test.

## Docs

`docs/PC_MEETING_TRACKER_PLAN.md`: amend the D27 bullet: arrows removed 2026-09-10 in favor of a
position select; move/remove behind an overflow menu with inline confirm. No other docs.

## Forbidden

Every API route, `slot-service.js`, `SessionAgendaPanel.js`, `OverflowMenu.js`, `Layout.js`,
`package.json`. No new dependencies.

## Verification (sequentially, in the worktree)

```bash
npx jest tests/unit/meeting-tracker
npm run check:types
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npx eslint shared/components/meeting-tracker/SessionEditor.js tests/unit/meeting-tracker-pages.test.js
node /Users/gallivan/.claude/skills/impeccable/scripts/detect.mjs --json shared/components/meeting-tracker/SessionEditor.js   # expect exit 0
```

## Handoff (builder fills in)

[VERIFIED via …]/[ASSUMED] labels, commits, test counts, gates, detector exit, the mutant you
ran, discrepancies, anything open.
