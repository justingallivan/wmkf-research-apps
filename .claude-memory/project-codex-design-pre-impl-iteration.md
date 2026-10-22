---
name: project-codex-design-pre-impl-iteration
description: Historical S184 design/implementation review lessons; use the owner's selected cadence for current work rather than treating the old per-chunk Codex loop as mandatory.
metadata:
  type: project
  status: active
  scope: global
  last_verified: S184 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read when using the S184 intake build as a review example or deciding how design
and implementation evidence differ.

Do:
- Follow the owner's current workstream-specific review contract. For staged
  orchestrated builds, read [[feedback-multi-model-review-pipeline]]; S596 selected
  Codex after the pilot and at the end, not every stage.
- Make open questions and implementation evidence explicit, and retain a searchable
  record of findings and their disposition. A design review does not prove the
  implementation follows the design.

Do not:
- Convert the S184 per-chunk review schedule, size heuristic, or follow-up-commit
  convention into a universal mandate. Preserve any explicit current review
  requirement, including a required post-implementation pass.
- Add a second reviewer when the owner explicitly assigned the builder/reviewer
  split without first resolving that scope choice.

Ground truth: historical-only (lesson from S184's 6-chunk intake build). Related: [[feedback-share-codex-verbatim]], [[feedback-real-fix-not-design-note]], [[project-codex-recurring-review]].

## Historical S184 method and results

The following records the six-chunk intake build's method and reported results,
not a forecast or the current mandatory cadence. Its iteration cycle was:

```
design doc → Codex pre-impl review → fold catches into design →
implement + tests → commit → Codex post-impl review → fold catches in
follow-up commit
```

**Why:** S184 shipped a 6-chunk applicant-intake build (13 commits)
using exactly this loop. Each pre-impl Codex pass caught 3-5 real
architectural issues that I'd have shipped without it (e.g., chunk 5's
SQL-level cardinality gate replaced a TOCTOU app-level check;
chunk 6's removePending-FIRST ordering replaced a del-first sweep that
would have raced against `/attach.promoteToClean` and wiped just-
promoted clean Blob bytes). Each post-impl Codex pass caught 3-9
additional issues that only showed up in the actual JS, not the design
(audit metadata-vs-payload field drift, null-safe-integer validation,
missing `sniffedType`, etc.). The post-impl pass is NOT redundant with
the pre-impl pass — different things surface in code vs. in design.

**Procedure used in S184:**
1. **A design doc per chunk** when the chunk had ≥3
   distinct surfaces (endpoint + SQL + helpers, or cron + service +
   wiring). Skip the design doc only for pure utility chunks (chunk 2
   went straight to implement; chunks 3-6 each got a design doc).
2. **Frame open questions explicitly** in the design doc (Q1, Q2, …).
   Pre-impl Codex review answers them with concrete reasoning;
   ambiguity left in the design doc gets resolved before the SQL/JS
   is written.
3. **Post-impl Codex review was required in that build.** Even when the design
   was reviewed pre-impl, the implementation can drift (chunk 5
   shipped with TOCTOU because the design's race-safety reasoning was
   wrong; post-impl review caught it and the SQL fix was applied as
   a follow-up commit).
4. **Apply Codex catches in a follow-up commit**, not by amending
   the original chunk commit. The follow-up commit body lists each
   catch verbatim with a brief response per item — searchable history.

The session used ≤ ~1100 lines net as a review-size heuristic, not a proven
general limit. S184's largest chunk was chunk 5 (the /attach
endpoint, ~410 lines + 51 tests = ~1500 lines net) and that was at
the edge of what's reviewable in one pass.

Related: [[feedback-share-codex-verbatim]], [[feedback-real-fix-not-design-note]],
[[project-codex-recurring-review]].
