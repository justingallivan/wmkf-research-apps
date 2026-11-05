---
target: Board writeups leadership design review
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/gallivan/Code/WMKF_Apps/shared/components/board-writeups/BoardWriteups.js"
target_fingerprint: "sha256:eb91435d6e9b868f0c80d8e2f507ee3852f6684c40834a5331d0ab998781ed6c"
target_path: /Users/gallivan/Code/WMKF_Apps/shared/components/board-writeups/BoardWriteups.js
timestamp: 2026-10-19T02-04-42Z
slug: shared-components-board-writeups-boardwriteups-js
---
Method: dual-agent (A: /root/board_design_a · B: /root/board_design_b)

The page is not ready for leadership as presented. Its calm visual style is appropriate, but it does not explain the cycle's current state or give the user a clear next step. This is primarily an information-design problem.

Evidence: supplied screenshot, independently inspected authenticated production D26 page, and current component source. The live page reproduced the empty table and zero-count summary. No application data was changed.

## Design health

| Heuristic | Score /4 | Key issue |
|---|---:|---|
| Visibility of system status | 1 | Inactive state buried; blank loading and unexplained 0/0 |
| Match to real world | 3 | Good institutional language; ambiguous Stage/Delivery |
| User control and freedom | 2 | Cycle edits clear content immediately |
| Consistency and standards | 2 | State ordering and controls diverge from suite conventions |
| Error prevention | 3 | Useful confirmations; weak cycle selection interaction |
| Recognition rather than recall | 2 | User must infer missing setup and where to find it |
| Flexibility and efficiency | 2 | Batch release exists; selection tools limited |
| Aesthetic and minimalist design | 2 | Non-actionable content receives too much prominence |
| Error recovery | 2 | Some useful safeguards; feedback needs contextual recovery |
| Help and documentation | 1 | No contextual next step in empty state |
| Total | 20/40 | Acceptable scoring band; significant improvements needed |

## Design specificity and strengths

Institutional terminology is specific, but composition remains a generic administrative form rather than expressing the Board workflow. Keep the restrained palette, readable typography, meaningful document labels, consequential-action safeguards, and collapsed approval history. No decorative branding is needed.

The deterministic detector reported zero findings. Both independent live reviews nevertheless found the same empty-state and hierarchy problems. The scan does not establish usability or accessibility approval.

## Priority issues

1. **P1 — Empty state resembles missing data.** “0 of 0 released” and bare table headings do not explain what is missing. Replace them with verified state-specific wording, such as “Cycle setup incomplete,” its outstanding requirements, and the authorized next action. Administrators get “Complete cycle setup”; other users get the responsible role/contact. Distinguish no roster, no filter matches, loading, and errors. Suggested command: impeccable clarify.
2. **P1 — Future work obscures the current task.** Inactive status appears inside the lower cleanup panel; archival controls appear before a useful proposal list. Put current status and next action first. Organize Setup → Release → Archive, with only the relevant phase expanded. Suggested command: impeccable layout.
3. **P2 — Visual emphasis is misplaced.** Refresh occupies a separate row; an oversized panel emphasizes a meaningless denominator. Compact the header and status strip; reserve the largest region for the current task. Retain neutral surfaces and use restrained status color with explicit text. Suggested command: impeccable polish.
4. **P2 — Loading and cycle switching look unreliable.** Live loading showed blank content. Source clears state on every character of the cycle field. Use authoritative cycle choices or a validated submitted field, with visible in-place loading and retry feedback. Suggested command: impeccable harden.
5. **P2 — The queue needs clearer action language.** Source-defined populated rows expose raw delivery states and separate Stage/Delivery, with release controls below the list. Use readable statuses, group request identity, and place selection count and release action in the queue toolbar. Explain that the President is emailed after the batch finishes. Suggested command: impeccable clarify/layout.

## Recommended arrangement

Header: Board writeups, cycle selector, compact cycle status.
Next: current task, responsible role, and one primary action.
When setup is incomplete: explain outstanding requirements; hide empty table/filter/progress.
When ready: show meaningful release progress and deadline, then queue toolbar and proposal list.
Below: after-meeting archive, cleanup and approval history, collapsed until relevant.

Examples are proposed design, not claims about the live cycle's configuration.

## Cognitive load and personas

Interpretation, rather than too many choices, causes the load. No observed initial decision point exceeded four options. Arrival currently moves from blank loading to unexplained zero counts to premature cleanup language. It should move from clear status to a confident next step and explicit completion/handoff.

New staff cannot identify a first action. The CSO/leadership reviewer cannot distinguish not configured from nothing to do. Experienced operators need outstanding work and bulk selection near the queue. Keyboard/screen-reader users have some labels and alert roles, but disappearing content and missing loading feedback remain risks. No full keyboard or screen-reader audit was performed.

## Minor observations

Use readable calendar dates. Explain whether missing deadlines block readiness. Keep technical recovery details available to authorized staff but outside the primary workflow. The observed page offered no setup panel; source gates it by permissions and loaded settings. The cause of its absence was not verified.

## Decisions for the next step

Recommended scope: all five issues, preserving current workflow rules and authorization. Alternatives: top two clarity issues first, or a visual mockup before implementation.
Recommended organization: one page adapted to role and cycle stage. Alternative: separate setup and operational views.
