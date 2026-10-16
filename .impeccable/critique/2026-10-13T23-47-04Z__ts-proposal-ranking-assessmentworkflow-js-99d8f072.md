---
target: Built Proposal Ranking interface critique and audit
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/gallivan/Code/WMKF_Apps/shared/components/proposal-ranking/AssessmentWorkflow.js"
target_fingerprint: "sha256:a03a6628b7575baeddf9f99a4bacc29488bb0f317381ac1a40eaa92a07d7efa3"
target_path: /Users/gallivan/Code/WMKF_Apps/shared/components/proposal-ranking/AssessmentWorkflow.js
timestamp: 2026-10-13T23-47-04Z
slug: ts-proposal-ranking-assessmentworkflow-js-99d8f072
closed: true
---
Method: dual-agent (A: /root/critique_a · B: /root/critique_b)

The accepted visual direction is worth keeping. The main improvements are clearer preparation, persistent group decision context, and better control feedback. No app code or deployments changed.

## Prioritized findings

1. **P1 — Invalid divider positions fail silently.** [VERIFIED via browser + source] Entering position 4 for the first divider when the second is at 3 leaves the dialog open without any explanation. Constrain the permitted range and provide an inline error. This is an error-identification accessibility gap (WCAG 3.3.1). Source: AssessmentWorkflow.js:142, :591. Suggested command: impeccable harden.
2. **P1 — Selected program is not exposed to assistive technology.** [VERIFIED via source] MR/SE/Combined selection changes background color, with no machine-readable selected/current state. Add appropriate selection semantics and keyboard behavior (WCAG 4.1.2). Source: AssessmentWorkflow.js:1206. Suggested command: impeccable harden.
3. **P1 — Group decision context scrolls away.** [VERIFIED via desktop screenshots + source] The funding total, geography tally, saved state and refresh control disappear while discussing lower cards. Individual A/B/C badges remain, but current collective section is not identified on those cards. Keep a compact persistent discussion summary and make current collective section clear. Source: AssessmentWorkflow.js:988, :1304. Suggested command: impeccable layout.
4. **P2 — Preparation does not make the next step clear enough.** [VERIFIED via desktop screenshot + source] Program selectors, disabled combined creation and reset compete above the list. Counts describe only the active program; both programs must be complete. The first card begins around y600 at 1200x736. Add per-program progress, explain the exact prerequisite, emphasize one next action, and move reset into the program menu. Source: AssessmentWorkflow.js:1191, :1206, :1275. Suggested commands: impeccable clarify, layout.
5. **P2 — Find can do nothing without explanation.** [VERIFIED via browser + source] A no-match search produces no feedback. The code also searches proposals outside the active program, then attempts to scroll to an absent card. Successful matches receive no focus or highlight. Scope the search to rendered proposals or offer a clear program switch; announce results and highlight/focus the target. Source: AssessmentWorkflow.js:1357. Suggested command: impeccable harden.

## Secondary findings

- **P2 — PD comparisons need consistent alignment.** Twelve PDs wrap into uneven content-sized rows. Use stable cells across cards while retaining every name, grade, confidence and rank. Source: AssessmentWorkflow.js:324. Verified screenshot + source. Suggested command: impeccable layout.
- **P2 — Small touch targets.** Measured drag handles and action menus are 28x28px. Enlarge hit areas without enlarging visible symbols. This is a 44px comfort recommendation, not a claimed WCAG 24px minimum failure. Source: AssessmentWorkflow.js:279, :553. Suggested command: impeccable adapt.
- **P2 — Recovery wording is technical.** “Resolve saved operation” does not explain what will happen. Use outcome-based language consistent with the actual retry behavior, and distinguish saving from refreshing. Source: AssessmentWorkflow.js:988, :1007. Source review only; network failures not induced. Suggested command: impeccable clarify.

Count: 0 P0, 3 P1, 5 P2. No task-blocking defect established in this review.

## What works

- Purpose-built card anatomy: institution/title, separate peer and PD evidence, cumulative funding, and recommendation dividers.
- Grade letters, restrained color and confidence symbols make disagreement scannable without relying on color alone.
- Named assessments stay visible. Requested and cumulative amounts occupy a stable desktop column.
- Measured contrast samples pass 4.5:1; four-card group layout fits 390px without horizontal overflow. Native dialog Escape restores focus visibly.

## Design health

| Heuristic | /4 | Main consideration |
|---|---:|---|
| System status | 3 | Save/refresh status disappears on scroll |
| Real-world language | 3 | Mostly clear; technical recovery copy |
| User control | 3 | Movement alternatives and reset confirmation |
| Consistency | 3 | Coherent cards, mixed stage/program controls |
| Error prevention | 3 | Guardrails exist; invalid boundary unexplained |
| Recognition over recall | 2 | Offscreen group context |
| Efficiency | 2 | Silent Find and return trips |
| Minimalist design | 2 | Opening controls consume too much space |
| Error recovery | 2 | Missing validation feedback and opaque retry copy |
| Help | 2 | Prerequisites and starting-order explanation insufficient |
| **Total** | **25/40** | **Acceptable; substantial targeted improvements** |

## Technical audit

| Dimension | /4 | Evidence |
|---|---:|---|
| Accessibility | 2 | Validation and selected-state gaps |
| Performance | 3 | Provisional source review; no profiling |
| Theming | 4 | Coherent intended light theme |
| Responsive design | 3 | 390px fits; small hit areas |
| Implementation integrity | 3 | Product-specific structure, isolated gaps |
| **Total** | **15/20** | **Good; address weak dimensions** |

The deterministic detector scanned shared/components/proposal-ranking once and returned zero findings. That does not establish accessibility completeness; manual/browser review found the gaps above. No false positives to adjudicate. No visible detector overlay: browser evaluation is read-only, so screenshots and DOM measurements were used.

## User experience

The interface is calm and product-specific. Seeing named assessments is its strongest moment. The procedural valleys are unexplained disabled progression, offscreen save/funding context, and unexplained rejected input. Preparation presents five initial program/action choices, increasing to six in combined mode. Group discussion imposes memory load when the summary scrolls away. Required named evidence should be aligned, not hidden.

First-time PDs need clearer completion prerequisites. Keyboard/assistive-technology users need selected-state and validation feedback. A facilitator needs current recommendation totals while lower cards are on screen. Frequent users need Find to acknowledge results.

Minor observations: small supporting labels merit a real shared-screen-distance check; the reviewer numeric mean needs an explicit label. Preserve the approved semantic colors and smooth dragging.

Scope: fresh independent browser tabs; actual local UI components with four-card and 100-proposal/12-PD fictional fixtures; desktop1200x736 and narrow390x844. Hosted round untouched. No production deployment. No physical touch, screen-reader traversal, 200% text zoom, current sentiment expansion, network-error reproduction, or performance profiling. Private-state browser entry was blocked for B; A's earlier private capture plus source were used. Automatic review rejection was not retried.

Questions for the owner: Prioritize shared-screen layout, accessibility/feedback, or preparation clarity? Limit the first change set to the five priority findings, or include the three secondary findings?
