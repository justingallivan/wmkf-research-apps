---
target: PD Track Reviewers table
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-05T00-11-52Z
slug: shared-components-reviewers-reviewermanagepanel-js
---
Method: dual-agent (A: impeccable_assessment_a · B: impeccable_assessment_b)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Lifecycle facts are visible, but the required next action is not. |
| 2 | Match with the real world | 3 | WMKF language is strong; “Active opened” and generic “Actions” are not. |
| 3 | User control and freedom | 2 | Cancel/edit exist, but menu/dialog keyboard escape and focus restoration are incomplete. |
| 4 | Consistency and standards | 2 | Text buttons, dashes, download icon, and kebab do not share an alignment or disclosure pattern. |
| 5 | Error prevention | 3 | Closeout choices correctly prevent incompatible honorarium dispositions. |
| 6 | Recognition rather than recall | 1 | The PD must know that Close review is hidden in the kebab. |
| 7 | Flexibility and efficiency | 1 | Routine closeout requires lateral scanning and opening a mixed-purpose menu. |
| 8 | Aesthetic and minimalist design | 2 | Calm styling, but eight columns and an 80rem minimum width waste the canvas. |
| 9 | Error recovery | 2 | Closeout preserves errors, but success lacks an explicit confirmation. |
| 10 | Help and documentation | 2 | Helpful modal copy arrives only after the buried action is discovered. |
| **Total** |  | **21/40** | **Acceptable foundation; significant workflow hierarchy work needed.** |

## Design Specificity Verdict

Functionally specific, visually interchangeable. The content is unmistakably WMKF reviewer operations, but its structure is a generic CRM record table. It gives database fields equal visual weight rather than answering the PD’s operative question: **Who needs attention, and what should I do next?**

The deterministic detector found zero syntactic anti-patterns. Fresh authenticated browser inspection confirmed eight columns and that Close review is hidden one interaction deep behind an unlabeled kebab with five competing maintenance actions. A reliable live overlay was unavailable because the exposed browser JavaScript evaluation is read-only.

## Overall Impression

The request context and closeout modal are strong. The table between them is the weak link. A returned review currently shows **Review Received** and then a dash under **Follow Up**, visually suggesting there is nothing to do precisely when the new closeout action is required.

## What’s Working

- Strong request orientation from request number, proposal title, institution, and active navigation.
- Useful operational provenance from status, due date, latest activity, History, and reviewer identity.
- A well-guarded closeout modal with repeated context, honorarium linkage, opt-out state, explained choices, and invalid-choice prevention.

## Priority Issues

### [P1] Closeout is buried as a maintenance action

Replace **Follow Up** with a state-aware **Next step** column: Materials Sent / Under Review → **Send reminder**; Review Received → **Close review**; Complete → **Edit closeout**; no action → explanatory text. Keep the kebab for exceptional maintenance and destructive operations. Suggested command: `$impeccable shape`.

### [P1] The table models fields instead of workflow

The no-selection geometry allocates 20% to separate Status and Link columns, then 32% to Notes, Follow Up, and Actions. Its `min-w-[80rem]` creates horizontal overflow. Reduce it to Reviewer, Progress, Timing & activity, Next step, and a narrow More cell. Group status with subordinate link state; move notes under reviewer identity or into an inline drawer. Suggested command: `$impeccable distill`.

### [P1] Consequential controls need full keyboard behavior

Add menu semantics, Escape behavior, initial/modal focus, focus trapping and restoration, visible focus, and an accessible name for Download. Suggested command: `$impeccable audit`.

### [P2] Follow-up controls do not share a visual axis

The header is left-aligned while reminder buttons use `items-end`; dashes and icons follow other axes. Left-align the new Next step header and every state to one inset with a consistent compact control width. Suggested command: `$impeccable layout`.

### [P2] Configuration competes with routine tracking

Keep Find / Invite / Track as the lifecycle tabs. Consolidate Campaign settings, Email templates, and Manage in Profile into one subdued Reviewer settings menu. Suggested command: `$impeccable distill`.

## Cognitive Load

Six of eight checks fail: single focus, chunking, grouping, hierarchy, working memory, and progressive disclosure. The modal passes one-thing-at-a-time and minimal choices. The wider surface exposes nine Workbench tabs, six reviewer-strip destinations, eight table columns, and a five-plus-option overflow menu.

## Persona Red Flags

- **Alex, power user:** scans five factual columns and opens a menu for every closeout; there is no fast path.
- **Sam, keyboard/screen-reader user:** icon-only download, unmanaged menu/dialog focus, no Escape behavior, and an 80rem table at high zoom.
- **Dana, WMKF Program Director:** long affiliations receive more space than the next decision; a returned review shows a dash where the workflow needs to continue.

## Minor Observations

- Screenshot cropping matches a horizontally scrolled forced-width table.
- “Active opened” should become subordinate copy such as “Link opened.”
- Due dates should not wrap to three lines.
- Replace “4 reviewers” with an actionable stage summary.
- Complete and terminal rows should visually recede or collapse into history.
