---
target: Meeting Tracker session page, Proposal order list
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-09-11T04-19-30Z
slug: ts-meeting-tracker-sessioneditor-js-proposal-order
---
# Critique: Meeting Tracker session page, "Proposal order" list (SessionEditor.js)

Method: dual-agent, live page https://applications.wmkeck.org/meeting-tracker/sessions/<id> (desktop composition from owner screenshot; browser window would not resize; drag not exercised). Source on main at 50fb442b, 2026-09-10.

## Heuristics (20/40)
1 Visibility 2 · 2 Real world 3 · 3 Control 1 · 4 Consistency 2 · 5 Error prevention 1 · 6 Recognition 1 · 7 Flexibility 2 · 8 Minimalist 2 · 9 Recovery 2 · 10 Help 1.

## Deterministic scan
0 findings in shared/components/meeting-tracker/SessionEditor.js.

## Live measurements (first row)
Grip svg 12×12, rgb(156,163,175) = 2.54:1 on white, opacity 1. Index 14px/600 gray-900. Arrows 28×28 each, 1px gray-300 border, 14px icon gray-900; cluster 60px wide in a 48px (w-12) column. Draggable element cursor grab; contains only grip + digit (~12×36). Per row: 4 buttons, 1 link, 1 input, 2 selects. Card rounded 12px, padding 16px. Arrow aria-labels render as "Move proposal up/down" on every row (proposal lookup empty at runtime).

## Priority issues
- P0 Draggable region is a 12×36 sliver at 2.54:1 with no hover state (SessionEditor.js ~:96-105). Make the full w-12 column the handle; grip gray-500 at rest, darker on hover; hover plate; active:cursor-grabbing; no grab cursor when busy. → polish
- P1 Arrow cluster 60px overflows the 48px column and outweighs the grip ~11:1 (~:107-114). Borderless icon arrows stacked in the gutter, revealed on hover/focus-within. → layout
- P1 Remove deletes with no confirm (~:148); no focus rings on the four hand-rolled buttons. Route through Layout.Button; inline confirm naming the proposal. → harden
- P1 Arrow aria-labels fall back to "proposal"; use the slot's own request number. → harden
- P2 Permanent "Move to another session" widget; two controls named Move. Overflow menu; rename arrows earlier/later. → distill
- P2 Insertion indicator border-t-2 blue-500 grows the li by 1px per dragover (jitter) and is off-token. ring-2 ring-inset blue-600 + short translate. → animate

## Persona red flags
PD under time pressure: arrows = n−1 sequential PATCH+refetch with the list greyed. First-timer: nothing says drag. Keyboard-only: draggable has no tabIndex/role/keys; arrows have no visible focus and identical labels.

## Minor
space-y-3 dead canvas between drop targets; overEdge can flash on previous row; Add disabled with no reason; ol has no accessible name; unequal row heights from briefing copy wrap.

## Questions
Are arrows needed once the grip is legible (position select alternative)? Why 28 controls for 3 items? Was the problem discoverability or save latency?
