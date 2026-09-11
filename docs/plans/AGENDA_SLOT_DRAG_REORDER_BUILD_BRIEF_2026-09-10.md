---
title: "Build C — Drag-and-drop proposal reordering on the Meeting Tracker session page"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build C — Drag-and-drop proposal reordering on the Meeting Tracker session page

## Goal

The "Proposal order" list on `/meeting-tracker/sessions/[id]` reorders only through the
up/down arrow buttons (`SlotRow` in `shared/components/meeting-tracker/SessionEditor.js`).
Add drag-and-drop reordering. The arrows stay (keyboard and touch users). Persistence goes
through the existing `reorderSessionSlots` → `PATCH /api/meeting-tracker/slots/reorder`
path, which already sends every slot with its ETag and complete new order.

## Design constraints

- **Native HTML5 drag events. No new dependency.**
- **Drag handle only**: make the number column (the `w-12` div holding the index and arrows)
  the handle. Give it a grip affordance (a small six-dot SVG next to the number, `cursor-grab`,
  `aria-hidden` on the icon). Do not put `draggable` on the whole `<li>`: the row contains
  inputs, selects, and buttons whose own mouse behavior must keep working.
- **State, not dataTransfer**: track `draggingIndex` and `overIndex` in `SessionEditor` state
  (jsdom has no `dataTransfer.getData`). In `onDragStart` still call
  `event.dataTransfer?.setData('text/plain', String(index))` guarded, and set
  `effectAllowed = 'move'` guarded, because Firefox will not start a drag without data. Call
  `event.preventDefault()` in `onDragOver` on each `<li>` so drop fires.
- **Drop builds the full new order** with a pure helper, not the adjacent swap used by
  `shiftSlot`:
  ```js
  export function moveSlot(slots, from, to) // returns a new array; same array if from === to or out of range
  ```
  Then `runSlotChange(() => reorderSessionSlots({ sessionId, slots: next }))`, exactly like
  `shiftSlot`, so ETag conflicts and the post-change refetch behave identically. No optimistic
  reorder that survives a failed save: the list re-renders from the server response as today.
- **Gate on `busy`**: the handle is not draggable while `busy` is true; `onDrop` is a no-op if
  `draggingIndex` is null or equals the target.
- **Visual feedback**: the dragged row gets reduced opacity; the row under the pointer shows a
  top or bottom insertion edge (a 2px ring or border on the `<li>`) depending on whether the
  pointer is in the upper or lower half (`event.clientY` vs `getBoundingClientRect()`), so a
  drop lands before or after it. Clear both states on `onDragEnd` and after drop.
- **Announce the result** for assistive tech: after a successful drop, set the existing
  `notice` state to e.g. "Moved #1003222 to position 2." (the page already renders `notice`
  with `role="status"`). Only do this if the existing notice plumbing is a simple string
  state; otherwise skip and say so in the handoff.
- **Accessibility floor**: arrows keep their `aria-label`s and remain the keyboard path. Add
  `aria-roledescription="sortable"` on the `<ol>` is NOT required; keep it simple.

## Scope

1. `SessionEditor.js`: `moveSlot` helper (exported), drag state and handlers in
   `SessionEditor`, handle + props in `SlotRow`. Keep `shiftSlot` and the arrows unchanged.
2. `tests/unit/meeting-tracker-pages.test.js`:
   - `moveSlot` unit tests: forward move, backward move, same index, out-of-range, does not
     mutate input.
   - One RTL test that renders `SlotRow`-bearing markup and fires `dragStart` on row 3's
     handle, `dragOver` and `drop` on row 1, and asserts the reorder fetch payload lists the
     slots in the new order with `order` 1..n and each slot's ETag. If rendering the full
     `SessionEditor` needs too many fetch mocks, extract the list into a small
     `ProposalOrderList` component in the same file that takes `slots`, `busy`, and an
     `onReorder(nextSlots)` callback, and test that. Say which you did in the handoff.
3. `docs/PC_MEETING_TRACKER_PLAN.md`: add **D28** under the tracker decisions: "Proposal
   order supports drag-and-drop (native HTML5, handle on the number column) in addition to
   the arrow buttons; both persist through the same full-order reorder route." (Build A adds
   D27 in parallel; if D27 is not there yet when you write, still use D28 and note it.)

## Owned files

`shared/components/meeting-tracker/SessionEditor.js`,
`tests/unit/meeting-tracker-pages.test.js`, `docs/PC_MEETING_TRACKER_PLAN.md` (one bullet).

## Forbidden

Every API route, `slot-service.js`, `SessionAgendaPanel.js`, every admin file, `package.json`.
No new dependencies.

## Verification (sequentially, in the worktree)

```bash
npx jest tests/unit/meeting-tracker
npm run check:types
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npx eslint shared/components/meeting-tracker/SessionEditor.js tests/unit/meeting-tracker-pages.test.js
```

## Handoff (builder fills in)

State claims labeled [VERIFIED via …] or [ASSUMED]. List commits, tests run with counts,
gates run, which RTL approach was used, and anything left open.
