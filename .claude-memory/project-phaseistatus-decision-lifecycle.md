---
name: Phase I status lifecycle + title/abstract generation timing
description: wmkf_phaseistatus decision lifecycle (staff-rec→committee→board), the Invited flip as edited-title-gen trigger, and when edited titles vs abstract materials are generated (research grants)
type: project
status: active
scope: grant-lifecycle
last_verified: S269 (2026-06-19) via live probe — request 1002852 + wmkf_phaseistatus option-set metadata
---

## Recall Rule

Read this when deciding **WHEN** to generate the edited grant title or the house-style abstract
materials, when wiring any cron/trigger off the Phase I→II decision flip, or when disambiguating the
`akoya_request` status fields. This recurs — the `wmkf_phaseistatus` vs `wmkf_phaseiistatus` vs
`akoya_requeststatus` confusion bit S169 (Connor flagged it) and the title-vs-abstract timing came up
again S269.

## The decision flow (research grants)

Phase I in → staff winnow → slate goes to **committee chairs = the *de facto* decision** (their packet
keeps the **ORIGINAL** `akoya_title`; they usually agree with staff) → the **Phase I→II promotion flips
`wmkf_phaseistatus` → Invited** → a **Board Book** is prepared for the board meeting (this is where the
**EDITED** title is used) → the **board votes** on the Phase II projects → **award** → staff generate the
**abstract materials**.

Generation timing (decided S269, owner):
- **Edited title** — generated **ONCE at `wmkf_phaseistatus = 100000003 (Invited)`**, with a cheap model
  (**Haiku**), from `wmkf_abstract`, stored in the **EXISTING `wmkf_wmkfprojectdescription`** field
  (Memo 2000; staff curate it manually today — the cron writes it only when EMPTY, never overwriting
  manual curation; NO new schema wave. `wmkf_projecttitle1` is a different, unrelated field). **Reused
  twice**: the Board Book first,
  then the abstract assembly later. Cron-poll predicate: `wmkf_phaseistatus eq 100000003` **AND** the new
  title field is empty (idempotent — the slate can reshuffle, so it must be re-runnable). **Research
  grants only.** It is NOT needed for the committee-chair packet (that keeps the original title).
- **Abstract materials** (house-style body + image + caption) — generated **LATE**, post-board-vote /
  award, via the existing grantee-deliverables Awardee-tab flow (S268). The award amount only exists at
  this stage (`akoya_grant` / `akoya_originalgrantamount` are **null pre-award**).

So title-gen and abstract-gen are **separate moments** (Invited flip vs. post-award), not one step; the
title is the only piece generated early, and it is reused.

## Field disambiguation [VERIFIED 2026-06-19 via probe]

- **`wmkf_phaseistatus`** (Phase **I**, Picklist) — the whole staff-rec → board-decision lifecycle lives
  on this ONE field. Live option set: `100000000 Pending Committee Review` · `100000004 Scored` ·
  `100000005 Not Scored` · **`707510005 Recommended Invite`** (the **STAFF** recommendation — the at-risk
  "internal promotion" staff act on before the board) · `707510006 Recommended Do Not Invite` ·
  **`100000003 Invited`** (post-approval flip — the **title-gen trigger**) · `100000002 Not Invited` ·
  `100000001 Ineligible` · `707510004 Incomplete` · `707510001 Proposal Late` · `707510002 Rescinded
  Grant` · `707510003 Request Withdrawn` · `682090001 Deferred`. (Option-set codes are live state —
  re-probe before depending on exact values.) Staff-rec vs board-approval is simply `Recommended Invite`
  → `Invited` on the same field; **no separate signal field is needed**.
- **`wmkf_phaseiistatus`** (Phase **II**, Picklist) — a **SEPARATE** field; do not conflate with the
  Phase I field (this exact mix-up was the S169 confusion).
- **`akoya_requeststatus`** (String) — a separate lifecycle string (`Phase I Pending`, `Phase II
  Pending`, `Approved`, `Active`, …). The reviewer-finding gate keys on `'Phase II Pending'`, not on
  `wmkf_phaseistatus` — see [[project-grant-phasing-evolution]].
- **Award amount** = `akoya_grant` / `akoya_originalgrantamount` (populate on award); **never**
  `akoya_request` (that is the *requested* amount, migration-backfilled — the Atlas warns "never export
  as a real amount").

Related: [[project-grant-phasing-evolution]] (Phase I→II submission model), [[project-j27-doc-capture-evolution]]
(document capture evolution).
