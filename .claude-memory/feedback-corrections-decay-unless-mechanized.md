---
name: feedback-corrections-decay-unless-mechanized
description: An owner correction mid-session is not absorbed until converted into a per-act mechanical step; acknowledged-but-unmechanized corrections recur within the same session.
status: active
metadata:
  type: feedback
---

## Recall Rule

Read this when the owner corrects an error class (miscounted value, missed
restatement, unexecuted prescribed command, edit from a stale read), or when
you notice yourself acknowledging a mistake and moving on.

Do:
- Immediately restate the correction as a mechanical step bound to each
  subsequent act, and run it visibly: derive every number with a command in
  the transcript; grep the exact old value repo-wide after every fact edit;
  execute any command before prescribing it; re-read the target section in
  the same turn as the edit.
- Prefer extending an existing deterministic gate (e.g. a
  `scripts/lib/canonical-facts.js` registry entry) over adding advisory
  reminder hooks — advisory text that fires everywhere gets normalized and
  ignored.

Do not:
- Treat "I'll be more careful" as a fix; a bare acknowledgement is an unfixed
  defect.
- Trust that having read a file earlier in the session makes a later edit
  safe — the mental model goes stale; re-read at edit time.

**Why:** 2026-08-21 (memory-hygiene workstream, branch
`codex/fable-memory-hygiene-runbook`): the same error classes recurred hours
after being acknowledged and "corrected" — a crossing date fixed in two
sections but not the executive summary, a 56-of-57 gate count written as
"all 57" while a scope-claim advisory hook was printing the verify-denominator
reminder directly above the Write, and an `npx jest` command prescribed for a
non-jest test file without execution. Four adversarial reviews (one Claude,
three Codex) caught 18 defects (6+4+5+3) pre-build; every one lived in fresh prose no
deterministic mechanism covered, while every mechanized check held.

**How to apply:** during long documentation/planning sessions, the correction
→ mechanism conversion happens at the moment of the correction, not at the
next milestone. The owner should expect to see the mechanical step executed
in the transcript; its absence means the correction has not landed.
