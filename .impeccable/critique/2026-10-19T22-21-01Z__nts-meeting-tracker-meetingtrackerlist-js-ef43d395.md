---
target: Meeting Tracker main page — workflow overload, UX critique and technical audit
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/gallivan/.codex/worktrees/coordinated-session/WMKF_Apps/shared/components/meeting-tracker/MeetingTrackerList.js"
target_fingerprint: "sha256:d5784da2687046e8409c8ab311d12d739bbba3bb6e239a640688be447f79042a"
target_path: /Users/gallivan/.codex/worktrees/coordinated-session/WMKF_Apps/shared/components/meeting-tracker/MeetingTrackerList.js
timestamp: 2026-10-19T22-21-01Z
slug: nts-meeting-tracker-meetingtrackerlist-js-ef43d395
---
Method: dual-agent (A: meeting_tracker_design_a · B: meeting_tracker_evidence_b)

# Meeting Tracker: UX critique and technical audit

2026-10-19. Read-only production inspection at https://applications.wmkeck.org/meeting-tracker and corresponding source, commit 6de803226 (production merge 1120f95ec). Operate mode, desktop-first staff audience. Observations are specific to the inspected Research / December 2026 views; counts include visibly badged test requests. No application changes or live writes.

## Verdict

The page has accumulated several jobs without choosing a primary one: session management, proposal lookup, site-visit scheduling, materials triage, artifact status, and analysis navigation. The domain content is useful; the structure makes users process it all together. Reorganize the work before polishing its appearance. Implementation integrity fails the documented queue/header conventions, not product authenticity.

## Design health — 24/40, Acceptable

| Heuristic | Score | Main finding |
|---|---:|---|
| System status | 3 | States visible, next work unclear |
| Real-world match | 2 | Share-state terminology mixes workflows |
| User control | 3 | Real links, scope controls and recovery |
| Consistency | 2 | Navigation and filters compete as button rows |
| Error prevention | 3 | Constrained read-only landing controls |
| Recognition over recall | 2 | Date-only session identity |
| Efficiency | 2 | Scan large cards to locate known requests |
| Minimalist design | 1 | Every record expands supporting details |
| Error recovery | 3 | Retry and filter-empty recovery available |
| Help | 3 | Guide available; lifecycle terms unexplained |

## Technical audit — 13/20, Acceptable

| Dimension | Score | Evidence |
|---|---:|---|
| Accessibility | 2 | Labeled controls/pressed states; result announcements absent |
| Performance | 3 | Parallel reads and stale-response guard; no timed regression established |
| Theming | 3 | Coherent incumbent palette; shared badge font deviation |
| Responsive | 3 | No desktop document overflow; session strip scrolls internally |
| Implementation integrity | 2 | Expanded queue and centered hero contradict DESIGN.md |

These scores are bounded assessments, not WCAG certification or performance benchmarks. No dark-mode requirement inferred; phone, zoom and touch were not tested.

## Findings — 0 P0, 2 P1, 4 P2, 1 P3

1. **P1 — No clear primary task.** MeetingTrackerList.js:251–283,296–309. Session creation, analysis destinations, session navigation and materials triage share one landing composition. Choose the landing task, then separate session work, visits/materials and analysis into clear task views or destinations. Preserve capabilities. Suggested command: impeccable shape, followed by distill.
2. **P1 — A queue is rendered as a stack of detail pages.** MeetingTrackerList.js:45–102,251,309; Layout.js:425–440. At 1200px desktop width, first card y≈545–546; measured cards 229–263px tall. At 736px height the first card is only partly visible, at 792px one full card fits. DESIGN.md requires a compact left header, early queue content and roughly64px rows. Use compact request rows with identity, relevant date, actionable status and next action; disclose the other details. Suggested command: impeccable distill/layout.
3. **P2 — Session identity and scope are ambiguous.** MeetingTrackerList.js:143–158,276–283; sessions/index.js GET; session-service.js:388–400; deliberation-session.js:38–45. Eight date-only links, including two identical labels with different destinations. Source lists all noncancelled sessions; cycle/program context is appended to links but does not filter session membership. This does not prove any specific session is in the wrong cycle. Provide distinguishing labels and explicit scope, preferably in a dedicated session view. Suggested command: impeccable clarify/shape.
4. **P2 — Materials filters expose the state machine.** MeetingTrackerList.js:243–247,296–304; site-visit-materials-status.js:44–48. Ten options in the inspected view, four enabled with zero results. Selecting an empty filter works but creates avoidable dead ends. Hide/disable zeros and collapse infrequent states; choose task-oriented grouping without silently changing workflow meaning. Suggested command: impeccable distill.
5. **P2 — Supporting metadata overwhelms action.** MeetingTrackerList.js:74–100, especially93. Raw meeting URLs with query text expand cards, while completed share-state labels repeat. Use a human virtual-location/Join label, retain real in-person locations, and move full artifact/location details to the detail surface. Do not copy live URLs into the report. Suggested command: impeccable clarify.
6. **P2 — Result changes are not announced.** MeetingTrackerList.js:205–225,296–315. Pressed state is exposed, but results/loading lack a dedicated live status; a screen-reader user must discover that rows disappeared. Add polite result-count/loading feedback and an affected-region busy state. This is verified DOM/source evidence, not an exercised VoiceOver failure. Suggested command: impeccable harden.
7. **P3 — Shared TEST badge uses10px text outside the type ramp.** TestRequestBadge.js:5. Detector advisory verified in context. Preserve the test distinction and align type when touching that component. Suggested command: impeccable polish; do not make this the redesign priority.

## Cognitive load and user journey

Six of eight cognitive-load checks fail: focus, chunking, hierarchy, sequential decisions, minimal choices and progressive disclosure. Grouping and retained request identity work. The inspected view exposes7header inputs/actions,8session links and10materials choices in separate groups; these counts are not an assertion that users process their sum simultaneously. Entry is calm; the burden arrives in deciding which control family applies, then repeatedly scanning expanded cards. This is an inferred journey, not an observed usability study.

## Preserve

Request identity, PD/PI context where useful, explicit status words/icons, changing Open/Schedule labels, native labeled selectors, scope controls, real links, retry/empty-state recovery, parallel schedule reads and stale-response guards. Badged test records are a current behavior, not a recommendation to change their visibility policy.

## Persona red flags

Alex: known-request/imminent-visit lookup requires scanning. Jordan: Share state Final may look like overall completion even when other work is pending. Sam: repeated link names/date-only duplicates and unannounced result updates add navigation effort; no broad keyboard or screen-reader compliance claim.

## Detector and evidence

One CLI run across5markup components produced1advisory, design-system-font-size at TestRequestBadge.js:5 (10px);0verified false positives. No primary-component finding does not refute structural overload. Independent live Chrome tabs inspected1200px desktop widths (heights736 and792); source plus read-only DOM measurements support counts/layout. Overlay unavailable because browser evaluate is read-only; no injection or live server was attempted. No API credential, hidden-state or performance-profile inspection. Screenshots retained locally in /private/tmp/meeting-tracker-design-a.png and /private/tmp/meeting-tracker-evidence-b.png; they are not embedded in this repository snapshot.

## Questions for next scope

1. Which task should lead the landing page: preparing/running sessions, upcoming visits/materials, or a needs-action queue?
2. Should the next pass restructure task views and compact the rows, or keep one page and simplify its controls first?
