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

**Provenance note**: this brief file did not exist in this builder's worktree
(`.claude/worktrees/agent-afac79c4c68b46558`, branch `claude/slot-drag-reorder`, base
`57bf6d07`) or on `main`. It was found only as an uncommitted file in a sibling, locked
worktree (`.claude/worktrees/agent-aa0e877754623c694`) apparently used by a parallel
"Build A" agent [VERIFIED via `find`/`git worktree list`/`git log` across worktrees — the
file has no commit history under `docs/plans/` in either worktree]. Per the ground rules
("fill in the brief's Handoff section... committed on your branch"), the content was copied
verbatim into this worktree at the same path and is committed here.

**Source vs. brief discrepancies checked**:
- `shiftSlot`, `runSlotChange`, `notice`, `busy` all matched the brief's description
  [VERIFIED via reading `shared/components/meeting-tracker/SessionEditor.js` in full].
  `notice` is a plain `useState(null)` string, so the assistive-tech announcement was
  implemented as specified.
- The brief's RTL test description ("asserts the reorder fetch payload lists the slots...")
  assumes rendering triggers `reorderSessionSlots`/fetch directly. Because the extraction
  path was used (see below), the new RTL test asserts the `onReorder(nextSlots, movedSlot,
  targetIndex)` callback contract instead of a fetch payload; the fetch-payload contract for
  `reorderSessionSlots` (order 1..n, per-slot ETag) is already covered by the pre-existing
  test "session reorder posts every slot with its current ETag and complete new order" at
  `tests/unit/meeting-tracker-pages.test.js:79`, which is unchanged and still exercises the
  exact same `reorderSlots` → `runSlotChange` → `reorderSessionSlots` call used by drag drop.

**Implementation choices**:
- Extracted `ProposalOrderList` (exported) from the inline `<ol>{slots.map(...)}` block in
  `SessionEditor`, per the brief's sanctioned fallback, to avoid mocking the full
  `SessionEditor` fetch surface in tests. `ProposalOrderList` owns `draggingIndex`,
  `overIndex`, `overEdge` as local React state (not `dataTransfer`) and calls
  `onReorder(nextSlots, movedSlot, targetIndex)` on a real drop. `SessionEditor` supplies
  `onReorder={reorderSlots}`, which sets the `notice` string and then calls
  `runSlotChange(() => reorderSessionSlots({ sessionId, slots: next }))` — the same path
  `shiftSlot` uses, so ETag conflicts and the post-change refetch behave identically
  [VERIFIED by reading the edited file].
- `moveSlot(slots, from, to)` is a pure helper: returns the same array reference (no copy)
  when `from === to` or either index is out of range, otherwise returns a new spliced array.
- Drag handle is the number-column `div` (grip SVG + index + arrows), `draggable={!busy}`,
  with `onDragStart`/`onDragEnd`. `onDragOver`/`onDrop` are on the `<li>` so a drop anywhere
  on the row works. `event.preventDefault()` is called in `onDragOver`. `dataTransfer` calls
  are wrapped in `try/catch` and optional-chained since jsdom's `DragEvent.dataTransfer` is
  `null`.
- **Notice timing (corrected after a second pass)**: the notice is set only after the
  reorder PATCH succeeds, inside the `runSlotChange` operation passed to `reorderSlots`, not
  before it. [VERIFIED via reading `shiftSlot`/`runSlotChange` in `SessionEditor.js`:
  `shiftSlot` never calls `setSlots` itself — the row only reorders once `runSlotChange`'s
  `loadDetail` refetches — so there is no optimistic UI anywhere in this component today.]
  An earlier draft set `notice` synchronously before the network call; that was wrong because
  `runSlotChange` sets `error` on a failed PATCH but never clears `notice`, so a failed save
  would have left a stale "Moved #X…" announcement next to the error while the list (refetched
  unchanged from the server) didn't actually move — exactly the "optimistic state that
  survives a failed save" the brief forbids. Fixed by moving the `setNotice` call inside the
  `runSlotChange(async () => { ... })` operation, after `await reorderSessionSlots(...)`
  resolves.
- Visual feedback: dragged row gets `opacity-40`; the row under the pointer gets a 2px
  top/bottom border (`border-t-blue-500` / `border-b-blue-500`) depending on
  `event.clientY` vs. the row's `getBoundingClientRect()` midpoint. Both clear on drop and on
  `onDragEnd`.
- **`busy` guard fan-out fix**: `handleDragStart` and `handleDragOver` both bail on
  `busy`; `handleDrop` originally did not. Fixed to `if (busy || draggingIndex === null) {
  resetDrag(); return; }` so a `busy` transition mid-drag (e.g. a Minutes-input blur firing
  `onChange` → `runSlotChange` while a drag is in flight) cannot apply a stale drop.

**Commits**: `52b57271` (implementation: `moveSlot`, `ProposalOrderList`, drag handlers, D28
originally, this brief), `030355f8` (follow-up: notice-timing fix so the assistive
announcement only fires after the reorder PATCH succeeds, a `busy` guard added to
`handleDrop` to match `handleDragStart`/`handleDragOver`, an ETag assertion added to the RTL
reorder test, Handoff corrections), and a third commit (see the branch log for its SHA)
addressing an orchestrator-relayed Opus review: added five RTL tests covering downward and
upward moves onto the last row's lower/upper half, a self-adjacent no-op, the `busy` state
(no draggable handles, inert drag sequence), and that only the number-column handle is
draggable (never the `<li>`, arrows, or form controls); added `setNotice(null)` in
`runSlotChange` so a stale "Moved…"/"Session saved." notice can't survive a later slot
change or a failed save; restructured the number column so `draggable` wraps only the grip
icon and index (the up/down arrow buttons are now siblings outside the draggable wrapper, so
a mousedown-drag on an arrow can't be misread as starting a row drag); and skip-if-unchanged
guards in `handleDragOver` plus hiding the insertion-edge indicator on the row being dragged.
Renumbered the `docs/PC_MEETING_TRACKER_PLAN.md` decision from D28 to D27 per the
orchestrator (Build A took D26).

**Test-teeth check** [VERIFIED empirically]: reproduced the review's exact mutation —
replacing `rawTarget > draggingIndex ? rawTarget - 1 : rawTarget` with bare `rawTarget` in
`handleDrop` — and reran `npx jest tests/unit/meeting-tracker-pages.test.js`: 2 of the 5 new
tests failed (the last-row lower-half and upper-half move assertions), confirming the new
tests catch the mutation the review flagged as previously undetected. Reverted before
committing.

**Tests / gates** [VERIFIED by running each command in this worktree, sequentially, after
all three commits' changes]:
- `npx jest tests/unit/meeting-tracker` — 17 suites passed, 17 total; 117 tests passed, 117
  total (12 new overall: 5 `moveSlot` unit tests + 7 `ProposalOrderList` drag tests — the
  original 2 plus 5 added for this review pass). One pre-existing unrelated React key-prop
  console warning in `MeetingTrackerList` (not touched by this change).
- `npm run check:types` — clean, no output (0 errors).
- `npm run check:status-enum-parity` — "status-enum-parity OK — 8 producer↔consumer
  invariant(s) in sync."
- `npm run check:status-enum-parity:self-test` — "status-enum-parity self-test OK — 17/17".
- `npx eslint shared/components/meeting-tracker/SessionEditor.js
  tests/unit/meeting-tracker-pages.test.js` — clean, no output (0 errors/warnings).

**RTL approach used**: extraction (`ProposalOrderList`), per the brief's fallback — see
"Implementation choices" above.

**Debugging note left for the record**: `@testing-library/react`'s `fireEvent.dragOver` /
`fireEvent.drop` helpers did not reliably apply a passed `clientY` in this jsdom version
(the drop-edge math silently saw the wrong edge). Dispatching a real `new MouseEvent('dragover'
| 'drop', { clientY })` via `fireEvent(target, event)` instead was reliable and is what the
committed tests use; React's synthetic drag handlers only need the native event type to fire,
so a plain `MouseEvent` (not a jsdom `DragEvent`, which has the same `dataTransfer`-only issue
the brief anticipated) works for `onDragOver`/`onDrop`, but not for anything relying on
`dataTransfer`, which this implementation deliberately avoids.

**Anything left open**: none within scope. The decision was written as D28 at first (D27 was
not present in `docs/PC_MEETING_TRACKER_PLAN.md` at write time, per the brief's own
contingency note) and renumbered to D27 in the final commit per the orchestrator, since Build
A took D26.
