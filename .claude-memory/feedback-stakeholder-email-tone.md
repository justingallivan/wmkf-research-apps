---
name: stakeholder-email-tone
description: Stakeholder-facing emails (Connor, Sarah, DFT, foundation staff) should drop insider jargon and codebase abstractions; match the recipient's frame, not the writer's.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S183 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: drafting an email or message to a non-engineer stakeholder (Connor, Sarah, DFT, foundation staff).

Do:
- Re-read assuming the recipient has zero codebase context; describe what the system does from their POV, not subsystem names.
- Replace abstract qualifiers with concrete consequences ("if this field is wrong the proposal goes to the wrong committee").
- Calibrate per recipient: Connor=PA flow specs at middle detail/zero-detail motivation; Sarah=applicant-experience frame; DFT=M365 admin-console frame.

Do not:
- Use insider jargon ("semantically load-bearing", "intake-portal drain", "source-of-truth picklist") as framing.
- Assume code paths/table names help unless they are the literal answer-target the recipient must act on.

Ground truth: historical-only (lesson, not live state).

Drafts of emails to non-engineers regularly fall into codebase-shape jargon
that doesn't help the reader. S183: the Connor Q1-Q4 draft used phrases
like "semantically load-bearing" (philosopher-jargon) and "intake-portal
drain" (an internal subsystem name Connor experiences as "the thing that
moves applications into AkoyaGO"). Both make the reader translate before
they can answer the actual question.

**Why:** Stakeholders are answering domain questions, not engineering
questions. Insider terms create friction without adding precision the
recipient can use. The writer feels more rigorous; the reader feels lost.

**How to apply:** When drafting a stakeholder email, before sending:
- Re-read assuming the recipient has zero codebase context.
- Replace internal subsystem names with what the system *does* from the
  recipient's POV ("when an applicant submits a portal application" not
  "intake-portal drain", "the field that decides which committee sees the
  proposal" not "the source-of-truth picklist").
- Replace abstract qualifiers ("semantically load-bearing", "structurally
  sound", "non-trivially coupled") with concrete consequences ("if this
  field is wrong the proposal goes to the wrong committee").
- Code paths and table names are fine when they're the *answer-target*
  (Connor needs to know which field to set) but not as framing for *why*
  the question matters.
- Connor: moderate PA experience, no codebase context — write flow specs
  at middle detail, write motivation at zero detail.
- Sarah: form-design lens, no system context — frame everything in
  applicant-experience terms.
- DFT: IT-ops lens, no app context — frame in M365 admin-console terms.
