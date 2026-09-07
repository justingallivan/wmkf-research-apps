---
title: Reviewer UI surfacing handoff 2026-09-er
status: active
summary: "Reviewer history now surfaces extensions; Request Workbench cycles use meeting dates and retain explicit off-cycle/no-date buckets."
---

# Reviewer UI surfacing handoff

## Issue 1 — due-date extension missing from Last Action

- Screenshot: Reviewer Follow-up Request `1003046`; Liang Huang showed an extended due date of Sep 13, 2026, while Last Action remained the Sep 6 reminder.
- Root cause: `wmkf_reviewduedateoverride` stored only the new DateOnly deadline; the extension writer emitted no event timestamp.
- Fix: add `wmkf_reviewduedateextensiongrantedat`, write/clear it atomically with the override, project it through reviewer reads, and render a dated “Review due date extended” history event.
- Sibling surfaces checked: main FIELD_SELECT, token-status, token-regeneration, acceptance-drain, merge predicate, engagement reset, reviewer DTO, Last Action, and History drawer.
- Owner smoke: on signed-in Request `1003046`, confirm Liang’s Last Action is “Review due date extended” dated Sep 7, 2026 and History includes the new due date.
- Historical backfill: owner-authorized, owner-run exact-row backfill is required for Liang because the pre-field write has no durable grant timestamp.

## Issue 2 — Request Workbench cycle dropdown has irregular gaps/order

- Screenshot: Request Workbench → Request list → Cycle dropdown showed scattered fiscal-year labels (December 2026, June 2020, December 2017, etc.) instead of a recent-first timeline.
- Root cause: `/api/workbench/search-requests` delegated options to `request-search-service`, which grouped and filtered on sparse legacy `akoya_fiscalyear`; production meeting-date data is continuous for June/December 2020–2026 [VERIFIED via production aggregate probe 2026-09-07].
- Fix: aggregate cycle options from `wmkf_meetingdate`, sort by year/month descending, filter by month ranges, and retain explicit `(off-cycle)` and `Unclassified (no meeting date)` buckets.
- Sibling surfaces checked: `RequestLocator` option rendering, search route, request projection, project-leader filter path, and sub-agent audit of other `akoya_fiscalyear` consumers. Other consumers are intentional historical/funding displays or separate grant-cycle APIs; none were changed.
- Owner smoke: signed-in Request Workbench → Request list, confirm cycles are recent-first with no missing June/December 2020–2026 entries; selecting a cycle returns only requests whose `wmkf_meetingdate` is in that month, and off-cycle/no-date buckets remain usable.

## Issue 3 — grant-cycle proposal counts lose requests when fiscal-year joins miss

- Diagnosis: `pages/api/reviewer-finder/grant-cycles.js` joined proposal counts on `akoya_fiscalyear`, while production has 100 distinct request fiscal-year values but only 10 active cycle rows [VERIFIED via production probe 2026-09-07]. Historical cycles without a catalogue row therefore returned zero.
- Fix: proposal counts are scoped to `wmkf_request_type = 100000001`, grouped by persisted `wmkf_meetingdate`, joined through strict display-name/fiscal-year parsing, and conserved against an independent proposal total in `unassigned.proposalCount`; duplicate cycle rows receive the count once. Honorarium rows are excluded.
- Claude review: blocking findings B1–B8 were incorporated into `docs/plans/REVIEWER_UI_SURFACING_LOAD_BEARING_PLAN_2026-09-07.md` before implementation.
- Follow-up review fixes: valid `wmkf_fiscalyearcode` now falls back when the display name is malformed; duplicate cycle IDs are assigned once; null/off-cycle groups are covered by the independent total-count reconciliation.
- Owner smoke: signed-in Reviewer Finder → grant cycles, compare active-only and `includeArchived=true` results; confirm duplicate month rows do not inflate the proposal total and the unassigned bucket absorbs unmatched/null-date proposals.
