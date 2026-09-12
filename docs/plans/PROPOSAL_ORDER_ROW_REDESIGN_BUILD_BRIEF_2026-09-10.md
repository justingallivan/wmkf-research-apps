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

**Branch/commits**: `claude/proposal-order-redesign`, on top of `790a1021`.
- `a17b5185` — row redesign (`SessionEditor.js` + test file).
- `de3fa7bc` — D27 doc bullet reconciliation.
- `9476a531` — initial handoff fill-in.
- `552ae82d` — post-advisor-review fixes (drop-edge visibility, Minutes width).

**Discrepancies from the brief** (all resolved by following the source per CLAUDE.md rule 1):
- The cited critique snapshot is not tracked in git (`.impeccable/critique/` has 6 tracked files,
  none matching) but is present, untracked, in the main checkout at
  `/Users/gallivan/Code/WMKF_Apps/.impeccable/critique/2026-09-11T04-19-30Z__ts-meeting-tracker-sessioneditor-js-proposal-order.md`
  (worktrees don't share untracked files). `[VERIFIED via ls /Users/gallivan/Code/WMKF_Apps/.impeccable/critique/
  | grep -i session, then reading the file]`. It scores 20/40, cites P0 "draggable region is a
  12×36 sliver with no hover state," P1 "arrow cluster overflows the column and outweighs the
  grip," P1 "Remove deletes with no confirm," P1 "arrow aria-labels fall back to 'proposal',"
  and ends by asking "are arrows needed once the grip is legible (position select
  alternative)?" — all fully covered by the brief's row spec; it added no requirement the brief
  didn't already carry.
- Item 1 ("the whole left gutter is the drag handle… `draggable={!busy}`") conflicts with item 2
  ("`draggable` lives on a sibling wrapper containing only the grip and number") and item 6
  (`aria-hidden="true"` on the handle wrapper — hiding the whole gutter would hide the position
  select from assistive tech) and with the existing test "the drag handle covers only the grip
  and index, not the row, arrows, or form controls" (asserts no `select` inside the draggable
  node). Followed items 2/6 and the existing test: `draggable`/`aria-hidden`/`title`/`min-h-[44px]`/
  `rounded-lg hover:bg-gray-100`/conditional `cursor-grab active:cursor-grabbing` are on the inner
  grip+number wrapper; the position `<select>` is its sibling in the `w-12` column, not a child, so
  no `onMouseDown` stopPropagation guard was needed ("if needed" in item 2 — it wasn't).
- The "visually hidden hint… the first time the list renders" (item 1) is contradictory (hidden +
  first-render-only don't compose observably). Implemented as an always-rendered `sr-only` `<p>`
  above the `<ol>`; noted here rather than guessing at session/localStorage state to fake
  "first time," which the brief doesn't ask for and would widen scope.
- `shiftSlot`/`onShift` were grepped repo-wide before removal: only referenced inside
  `SessionEditor.js` itself and passed as an unused `jest.fn()` in the old test file. `[VERIFIED
  via grep -rn "shiftSlot|onShift" shared tests pages]`. Removed both, per brief item 2 and rule 2
  (verify destructive carryover).
- `docs/plans/AGENDA_SLOT_DRAG_REORDER_BUILD_BRIEF_2026-09-10.md` (the original drag-and-drop
  brief, referenced by the D27 bullet) still describes arrow buttons; left as a historical build
  record per the brief's "No other docs" instruction and durable-docs' allowance for classified
  historical records, rather than edited.

**Tests**: `npx jest tests/unit/meeting-tracker` — 17 suites / 131 tests passed. Added: position
select renders 1..n options and calls `onReorder` with the full reordered array + moved slot;
no arrow buttons remain; overflow menu exposes exactly "Move to another session…" and "Remove…";
Remove is not called until the inline confirm's Remove is clicked; Escape during a drag clears
dragging state and a subsequent drop no-ops; busy disables the handle (`[title="Drag to
reorder"]` selector, since `.cursor-grab` is conditional now); savingSlotId drives per-row
opacity-70 vs. plain-disabled on other rows; position-select `aria-label` falls back to
`slot.wmkf_Request?.akoya_requestnum` when `proposal` is undefined. Kept `moveSlot` unit tests
and the reorder fetch payload test unchanged. Added a `Button` mock to the existing `Layout`
jest mock (it previously exported only `default`/`PageHeader`; `SlotRow` now renders `Button`).

**Gates** (run sequentially, per rule 4):
- `npx jest tests/unit/meeting-tracker` — pass, 131/131.
- `npm run check:types` — pass, no tsc errors.
- `npm run check:status-enum-parity` — pass, "8 producer↔consumer invariant(s) in sync."
- `npm run check:status-enum-parity:self-test` — pass, 17/17.
- `npx eslint shared/components/meeting-tracker/SessionEditor.js tests/unit/meeting-tracker-pages.test.js` — clean, no output.
- `node ~/.claude/skills/impeccable/scripts/detect.mjs --json shared/components/meeting-tracker/SessionEditor.js` — `[]`, exit 0. Baseline (run before any edit) was already `[]`/exit 0, so this build did not need to fix pre-existing detector findings — `[VERIFIED by running the detector before and after editing]`. All gates re-run clean after the post-advisor-review fixes below.

**Post-implementation review fixes** (caught by advisor, not by the automated gates — none of the
gates check rendered geometry or Tailwind class-string conflicts):
- The drop-edge indicator's 2px absolute rule was drawn at the same offset as `ring-2
  ring-inset`, so it sat exactly under the ring's edge and was visually indistinguishable —
  the target half of a drag was not legible, regressing against the brief's "legible drag" intent
  even though it matched the brief's literal token list. Fixed by offsetting the rule 2px outside
  the ring (`h-1`, `-top-0.5`/`-bottom-0.5`) so it protrudes as a visible band.
- `FIELD_CLASS` carried `w-full`; appending brief-specified `w-24` to the Minutes input's
  class string did not override it (Tailwind resolves by stylesheet order, not string order), so
  Minutes silently stayed full-width. Fixed by dropping `w-full` from the shared class and adding
  it per-site to Lead PD and the move-panel session select.

**Mutant run**: changed the "Remove…" menu item's `onSelect` from `() => setPanel('remove')` to
`() => onRemove(slot)` (bypassing the confirm panel). `npx jest tests/unit/meeting-tracker` then
failed exactly the new discriminating test ("Remove is not called until the inline confirm
panel's Remove is clicked…") with 130/131 passing. Reverted from a plain file copy (not a stash,
per the shared-stash-stack caution) and re-ran the suite: 131/131 passing again. The copy was
made under `/tmp` rather than the scratchpad directory and has since been deleted.

**Forbidden list**: not touched — no changes to any API route, `slot-service.js`,
`SessionAgendaPanel.js`, `OverflowMenu.js` (read-only, reused its `items` API as-is), `Layout.js`
(read-only), or `package.json`; no new dependencies.

**Open items**: none from the brief's scope. Not pushed, no PR opened, per instructions.
