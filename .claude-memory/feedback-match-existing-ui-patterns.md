---
name: feedback-match-existing-ui-patterns
description: Before shipping or surfacing a staff UI control, check it against controls the app already uses; the owner notices novel patterns (S609 Cmd-click multi-select).
status: active
metadata:
  type: feedback
---

## Recall Rule
Read before adding, reviving or making visible any staff-facing form control or interaction pattern.

On 2026-10-15 (Session 609) a fix made the hidden Proposal Ranking facilitators Admin panel render. It used a native
`<select multiple>` that needs Cmd-click, which no other app surface uses. The owner asked why a UI design not used in
the app had shipped. Making a previously invisible component visible counts as shipping its design.

**Why:** consistency across the suite matters to the owner; an unfamiliar control reads as a regression even when it works.

**How to apply:** grep for the nearest existing control that does the same job (e.g. multi-person selection) and reuse its
pattern, or flag the mismatch to the owner before merge. Related: [[feedback-ui-gates-must-mirror-server-guards]],
[[feedback-staff-ui-desktop-first]].
