---
target: production Review Panel Workbench tab
total_score: 35
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-09-15T04-31-14Z
slug: shared-components-workbench-reviewpaneltab-js
---
### Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Latest-run sentence, status labels, totals, and progress states are explicit. |
| 2 | Match with the real world | 4 | “Seats,” “chair,” “reservation bound,” editions, and retry language fit the staff workflow. |
| 3 | User control and freedom | 3 | Stop/retry/re-render controls are contextual; no obvious keyboard accelerator exists. |
| 4 | Consistency and standards | 4 | Uses the Workbench’s established cards, disclosures, buttons, and status patterns. |
| 5 | Error prevention | 4 | Server-gated Launch state, visible bound, idempotency, and confirmation on re-render are strong safeguards. |
| 6 | Recognition rather than recall | 4 | Word/PDF, Retry, Details, and Configuration are present where needed. |
| 7 | Flexibility and efficiency | 2 | Efficient for mouse users, but no evident shortcut or mobile quick-navigation path. |
| 8 | Aesthetic and minimalist design | 4 | The distillation works: completed and failed runs each occupy one restrained row. |
| 9 | Error recovery | 4 | The failed run names the specific refusal, preserves spend, and offers Retry. |
| 10 | Help and documentation | 2 | Helpful inline model note, but secondary actions and operational terms remain largely self-explanatory only. |
| **Total** |  | **35/40** | **Good** |

### Design specificity verdict

This feels authored for WMKF’s review workflow, not like a generic admin card. The proposal-specific state sentence, panel roles, reservation-bound language, edition actions, spend ledger, and preserved failure record all reinforce the actual operating model.

The automated source scan returned zero findings for `ReviewPanelTab.js`. Production browser inspection returned zero console warnings or errors. Live detector overlays were unavailable because the browser’s page-evaluation interface is read-only; screenshots, accessibility state, computed layout metrics, and console logs supplied the fallback evidence.

### Overall impression

The desktop result is successful and matches the accepted distillation contract. The biggest remaining opportunity is making the same state and actions comfortably discoverable and operable on a phone.

### What’s working

- The hierarchy is calm and decisive: current state and Launch first, history second, configuration disclosed only on demand.
- Completed and failed histories are meaningfully different without becoming visually noisy. Failure remains auditable but cannot overpower the successful edition.
- High-stakes facts are unusually clear: the launch bound is adjacent to Launch, the run total is visible, and the failed seat’s reason is specific.

### Priority issues

- **[P2] The active Workbench tab is initially off-screen on mobile.** At 390 px, the tab strip is 1,033 px wide and starts at scroll position 0; the active Review Panel tab begins at x=516. The content proves where the user is, but the navigation does not. Auto-scroll the active tab into view and add a subtle overflow cue.
- **[P2] Mobile interaction targets and secondary metadata are too delicate.** Measured heights were 36 px for Launch, 30 px for Word/PDF, and 16 px for Details, Re-render, and Retry. Increase touch hit areas to roughly 44 px without making the desktop rows heavier; raise the contrast of the faint 12 px “re-rendered” and configuration-note text.

### Persona red flags

- **Alex, power user:** The compact history is excellent, but there is no evident keyboard accelerator for moving among Workbench sections or invoking the primary action.
- **Sam, accessibility-dependent:** `aria-current="page"` and native disclosures are good. The smallest text actions and faint metadata are the weak points for motor and low-vision access.
- **Casey, distracted mobile user:** The active section is outside the initial tab-strip viewport, and the 16–30 px action targets require precision taps.

### Minor observations

- Configuration expansion is readable and correctly repeats the reservation bound without mislabeling it as typical cost.
- Word/PDF wrap naturally beneath run metadata on mobile; the rows remain understandable.
- The global Workbench tab strip presents ten peer choices, so mobile navigation bears more cognitive load than the Review Panel itself.

### Questions to consider

Questions skipped: 2 Priority Issues found; no clarification is needed before reporting.
