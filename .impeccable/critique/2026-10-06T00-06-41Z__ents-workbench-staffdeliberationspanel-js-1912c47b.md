---
target: Staff Deliberations overview and request workflow
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/gallivan/.codex/worktrees/staff-deliberations-rework/WMKF_Apps-codex/shared/components/workbench/StaffDeliberationsPanel.js"
target_fingerprint: "sha256:e6b636a6fe47e309eb86087248236a39079b9f669a638af1cf221bc2025fdc1d"
target_path: /Users/gallivan/.codex/worktrees/staff-deliberations-rework/WMKF_Apps-codex/shared/components/workbench/StaffDeliberationsPanel.js
timestamp: 2026-10-06T00-06-41Z
slug: ents-workbench-staffdeliberationspanel-js-1912c47b
---
Method: dual-agent (A: /root/impeccable_design · B: /root/impeccable_evidence)

# Staff Deliberations UX review

The main problem is information hierarchy and workflow language. Preserve the existing calm visual style and document workflow; simplify how staff find and understand the next action.

## Evidence and limits

[VERIFIED via live browser and source] Reviewed the D26 overview, request 1002903, TEST request 1003313, and the user's screenshot of 1002872. Source review covered StaffDeliberationsPanel.js, StaffDeliberationsTab.js, FinalWriteupTab.js and the overview service's timing/preparation projection. No production writes or application edits were made. Mobile, keyboard-only, screen-reader use, and transitions were not exercised. Scores are design judgments, not measured usability outcomes.

## Design health

| Heuristic | Score /4 | Principal observation |
|---|---:|---|
| Status visibility | 2 | Paused describes automation but looks like request status. |
| Real-world language | 3 | Grant terms fit; preparation terminology is opaque. |
| User control | 2 | Explicit transitions exist; action consequences need clearer presentation. |
| Consistency | 2 | Similar-looking controls navigate or change workflow state. |
| Error prevention | 3 | Confirmation and document-preservation safeguards exist. |
| Recognition | 2 | Staff must infer relationships among status, documents and actions. |
| Efficiency | 2 | Repeated tall cards impede scanning a cycle. |
| Minimalism | 2 | Operational history competes with the primary task. |
| Error recovery | 3 | Recovery paths exist; generic attention labels need context. |
| Contextual help | 2 | Useful explanations sit deeper than confusing overview labels. |
| Total | 23/40 | Significant UX improvement warranted. |

## Design specificity and strengths

The content is specific to grant work, and the neutral visual style fits the product. The arrangement exposes internal state more strongly than the staff task. Preserve separate briefing and working-writeup documents, direct Word access, explicit human review transitions, mine/all-PD scope, and the eligible documentless cohort.

The mechanical detector reported zero findings in both overview and detail components. That does not establish usability or accessibility: the principal findings concern meaning and hierarchy, outside a static styling scan.

## Priority issues

### P1: Automation state masquerades as staff workflow state

[VERIFIED] StaffDeliberationsPanel.js:45-50 maps disabled automatic preparation to an amber Preparation paused task and Needs attention bucket. StaffDeliberationsTab.js:1259-1286 still exposes the existing Word draft and manual preparation. This combination implies a staff blockage where editing remains possible.

[PLANNED] Show the known document/task fact first, and explain automation availability in the relevant detail section. Distinguish existing draft, missing draft, queued work, running work, configuration/read failure and true block. Do not universally replace paused with ready, or use Post-visit review needed before group review actually starts. Use Impeccable clarify.

### P1: Overview cards carry the detail page's workload

[VERIFIED] StaffDeliberationsPanel.js:73-100 renders request identity, institution, PD, stage, presentation end, two document states, sharing history, session, materials and multiple actions on every card. The live mine view contains 10 ordinary and 3 TEST requests. Cognitive load is high from repeated facts, not simply the number of buttons.

[PLANNED] Keep request/title, institution/PD, a concise presentation date, the relevant document/review status, one primary action and a request-detail link. Put sharing history, secondary documents, session details and routine materials metadata in request details. Preserve actual actionable errors in the overview. Use Impeccable distill and layout. Compact cards versus rows is a design choice to validate, not a mandate for a new table.

### P1: Navigation and workflow commitments are hard to distinguish

[VERIFIED] StaffDeliberationsTab.js:1284-1300 places manual preparation and Review readiness in similarly styled secondary controls. The latter navigates; the former changes state. FinalWriteupTab.js:624-651 uses Ready for group review as both a state heading and a transition button label.

[PLANNED] Name navigation by destination and commitments by action: Open review details versus Start group review. Explain preparation's concrete consequence next to its control. Maintain confirmation and all existing authorization/readiness guards. Use Impeccable clarify and harden for the relevant states.

## Personas and smaller observations

- Experienced PD: scanning tall repeated cards obscures which request needs work; keep the next action in a stable location.
- Occasional staff user: paused sounds blocked; readiness sounds like an assessment rather than page navigation. State the consequence.
- Keyboard/screen-reader user: semantic headings and native controls are present, but repeated links increase traversal. Verify actual keyboard order and responsive layout during implementation; no conformance claim is made here.

The emotional low point is being told work is paused beside a viable draft. Existing Word access and preservation safeguards provide reassurance worth retaining.

Use readable local time labels rather than raw America/Los_Angeles. Keep presentation and internal deliberation session distinct; do not display an end time as a start time. Missing in-app sharing history is not proof of no email. Missing collection records are not proof of missing files. A passed scheduled end is not confirmation that a presentation occurred. Existing generated-document warnings may become stale after Word edits; defer changing their acknowledgement behavior until the underlying contract is checked.

## Bounded repair recommendation

Use clarify plus distill/layout for one coherent pass across the overview and corresponding detail controls. Check missing, existing, preparing, blocked, group-review and leadership-review states. Then perform one adapt/audit pass for narrow screens and keyboard use, followed by polish. Preserve backend workflow, automation activation, document generation and review gates. No broad visual redesign or new infrastructure is needed.

## Decisions for the user

1. Scope: overview plus matching detail/action language (recommended), or overview only first?
2. Where an editable document exists: direct Word access as primary with request details secondary (recommended), or request details as primary with Word secondary?
