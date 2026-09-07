---
title: Reviewer UI surfacing handoff 2026-09-er
status: active
summary: "Due-date extensions now persist a granted-at event and surface in reviewer history."
---

# Reviewer UI surfacing handoff

## Issue 1 — due-date extension missing from Last Action

- Screenshot: Reviewer Follow-up Request `1003046`; Liang Huang showed an extended due date of Sep 13, 2026, while Last Action remained the Sep 6 reminder.
- Root cause: `wmkf_reviewduedateoverride` stored only the new DateOnly deadline; the extension writer emitted no event timestamp.
- Fix: add `wmkf_reviewduedateextensiongrantedat`, write/clear it atomically with the override, project it through reviewer reads, and render a dated “Review due date extended” history event.
- Sibling surfaces checked: main FIELD_SELECT, token-status, token-regeneration, acceptance-drain, merge predicate, engagement reset, reviewer DTO, Last Action, and History drawer.
- Owner smoke: on signed-in Request `1003046`, confirm Liang’s Last Action is “Review due date extended” dated Sep 7, 2026 and History includes the new due date.
- Historical backfill: owner-authorized, owner-run exact-row backfill is required for Liang because the pre-field write has no durable grant timestamp.
