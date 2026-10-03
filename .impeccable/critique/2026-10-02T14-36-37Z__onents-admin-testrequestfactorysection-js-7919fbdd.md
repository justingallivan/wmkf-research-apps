---
target: the Create a test Request admin panel
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/gallivan/Code/WMKF_Apps-factory-form/shared/components/admin/TestRequestFactorySection.js"
target_fingerprint: "sha256:0b2f7569c96b46dcadba67c4acc03e1cd7c03f230f336a716989b6d5a81f0f15"
target_path: /Users/gallivan/Code/WMKF_Apps-factory-form/shared/components/admin/TestRequestFactorySection.js
timestamp: 2026-10-02T14-36-37Z
slug: onents-admin-testrequestfactorysection-js-7919fbdd
---
Method: dual-agent (A: Opus design review · B: detector scan), source-only; no browser inspection (the app needs authentication and live systems).

## Design health score: 23/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Step list and live line are good; the minutes-long lookup shows one static sentence |
| 2 | Match with the real world | 2 | Raw resource kinds, outcomes, codes, camelCase document kinds; "Foundation" unexplained |
| 3 | User control and freedom | 2 | Lookup cannot be cancelled; a new lookup silently deselects the open run |
| 4 | Consistency and standards | 2 | Up to three dark primary buttons at once; five near-synonym verbs |
| 5 | Error prevention | 3 | Strong gates; the status warning is the same sentence for every transition |
| 6 | Recognition over recall | 2 | Blocked status options say only "(not available now)" |
| 7 | Flexibility and efficiency | 2 | No default test label; no link to the created Request |
| 8 | Aesthetic and minimalist design | 2 | Four tables and three tool regions always open |
| 9 | Error recovery | 3 | Copy map is very good; the needs-attention stop is the weak point |
| 10 | Help and documentation | 2 | Nothing explains the Foundation recheck or the abandon command |

## Design specificity verdict

The copy is specific to this product; the composition is generic. Detector: 0 findings on the five component files and 0 on the sibling baseline.

## Priority issues

1. [P1] The committing moments do not name the target or the consequence: Start says only "Start" (TestRequestFactoryRunPanel.js:100); the Confirm summary identifies the production source by number only (TestRequestFactoryIntake.js:202-206); the status confirmation uses one generic warning (TestRequestStatusControl.js:10). Fix: a line beside Start/Resume naming the environment and what is written; title and applicant in the source summary (needs a server field); allowlist sentence in the status confirmation. Command: /impeccable clarify.
2. [P1] The needs-attention stop contradicts itself and the run record is in engineer vocabulary: raw errorMessage beside a primary Resume (TestRequestFactorySection.js:25, RunPanel.js:94-110); resources table prints resourceKind, outcome and bare codes (RunPanel.js:127-130); document kinds are camelCase (Intake.js:221). Fix: plain copy with the raw text under "Technical detail"; outline "Retry step: {label}"; label maps in shared/config/testRequestFactory.js. Command: /impeccable clarify.
3. [P1] Focus and orientation are lost after every async transition: after Confirm, run select, the status confirmation opening, and a completed lookup. Fix: tabIndex -1 plus focus and scrollIntoView on the run heading, the summary heading and the confirmation question; return focus on Cancel. Command: /impeccable harden.
4. [P2] More than one decisive action and no progressive disclosure: up to three PRIMARY_BUTTONs visible; diagnostics always open; intake stays expanded after reserve. Fix: demote "Look up source" once a draft or run exists; collapse the intake after reserve; diagnostics in closed details, auto-open resources on needs_attention. Command: /impeccable distill.
5. [P2] Blocked status options hide their reason and healthy progress uses amber: "(not available now)" with no reason (TestRequestStatusControl.js:263-266); creating / In progress are amber (shared/config/testRequestFactory.js:25, RunPanel.js:31). Fix: list unavailable options with reasons; add a blue StatusChip tone. Command: /impeccable colorize.

## Persona red flags

- Alex: no default test label; no link to the created Request; lookup cannot be cancelled; selected run lost on reload.
- Sam: focus lost after Confirm, row select, Set status; aria-pressed on the run-row button; step "Done" not announced; confirmation group not announced.
- The owner on a consequential day: no title or applicant on the source; Start does not say production; "Recheck Foundation" unexplained; the stuck-change CLI precondition cannot be checked in the UI and the no-retry state is lost on reload; field selector defaults to Phase II.

## Minor observations

Long labels not wrapped or truncated; selected-row tint nearly invisible; form-off sentence can appear four times; a ready sandbox run shows no status control and no reason; fiscal-year input has no format hint.

## Questions

Should the typed re-entry move to Start, the step that writes? Should Resume exist only when the server says a retry is safe? Would one linear view serve an occasional expert better than four concurrent regions?
