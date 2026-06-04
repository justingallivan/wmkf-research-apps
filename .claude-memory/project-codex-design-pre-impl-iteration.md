---
name: project-codex-design-pre-impl-iteration
description: Multi-chunk build pattern that works — for each chunk, write a focused design doc, send to Codex BEFORE writing code, fold catches, implement, send to Codex AGAIN after committing, fold catches in a follow-up commit. Each cycle reliably catches 3-5 real correctness issues per chunk.
metadata:
  type: project
  status: active
  scope: global
  last_verified: S184 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: starting non-trivial multi-chunk build work and deciding how to sequence design, Codex review, and implementation.

Do:
- Run the loop: design doc → Codex pre-impl review → fold → implement + tests → commit → Codex post-impl review → fold in a follow-up commit.
- Write a design doc per chunk when the chunk has ≥3 distinct surfaces; frame open questions explicitly (Q1, Q2…).
- Keep chunks ≤ ~1100 lines net so the review isn't overwhelmed; apply Codex catches in a follow-up commit (not by amending).

Do not:
- Skip the post-impl Codex pass — it catches impl-drift the pre-impl pass cannot (different things surface in code vs. design).
- Amend the original chunk commit with the catches — that loses searchable history.

Ground truth: historical-only (lesson from S184's 6-chunk intake build). Related: [[feedback-share-codex-verbatim]], [[feedback-real-fix-not-design-note]], [[project-codex-recurring-review]].

For non-trivial multi-chunk work, the iteration cycle that converged
quickly and caught real bugs in S184:

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

**How to apply:**
1. **Always write a design doc per chunk** when the chunk has ≥3
   distinct surfaces (endpoint + SQL + helpers, or cron + service +
   wiring). Skip the design doc only for pure utility chunks (chunk 2
   went straight to implement; chunks 3-6 each got a design doc).
2. **Frame open questions explicitly** in the design doc (Q1, Q2, …).
   Pre-impl Codex review answers them with concrete reasoning;
   ambiguity left in the design doc gets resolved before the SQL/JS
   is written.
3. **Post-impl Codex review is not optional.** Even when the design
   was reviewed pre-impl, the implementation can drift (chunk 5
   shipped with TOCTOU because the design's race-safety reasoning was
   wrong; post-impl review caught it and the SQL fix was applied as
   a follow-up commit).
4. **Apply Codex catches in a follow-up commit**, not by amending
   the original chunk commit. The follow-up commit body lists each
   catch verbatim with a brief response per item — searchable history.

Pattern works best when each chunk is ≤ ~1100 lines net. Larger chunks
overwhelm the review. S184's largest chunk was chunk 5 (the /attach
endpoint, ~410 lines + 51 tests = ~1500 lines net) and that was at
the edge of what's reviewable in one pass.

Related: [[feedback-share-codex-verbatim]], [[feedback-real-fix-not-design-note]],
[[project-codex-recurring-review]].
