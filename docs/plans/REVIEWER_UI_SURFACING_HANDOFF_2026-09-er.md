---
title: Reviewer UI surfacing handoff 2026-09-er
status: active
summary: "Reviewer extension history and meeting-date cycle work; compact-controls local review includes the cycle fix and corrects aggregate truncation. Production promotion remains separate."
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
- Root causes: the original service grouped and filtered on sparse legacy `akoya_fiscalyear`. The first meeting-date correction (`ffeafc47`) remained on `codex/reviewer-ui-surfacing`, so the compact-controls review branch did not include it. After that commit was cherry-picked as `9cab8c3e`, signed-in local review exposed a second defect: `buildHeaders` requested 100 aggregate rows and the adapter returned that incomplete page as successful options.
- Current fix on `codex/compact-controls`: aggregate from `wmkf_meetingdate` in UTC, sort by full year/month descending, and filter by matching month ranges. Request up to 5,000 month groups explicitly; reject continuation metadata, a full page, or a malformed response rather than silently truncating. Table/field restrictions, target interlock, and the shared request timeout remain enforced. This is a bounded complete-or-error query, not a general pager; Dataverse's underlying aggregate-record limit still fails through to the existing filter error/retry UI.
- Result labels also use the meeting date, even when fiscal year disagrees; missing dates remain `Unclassified (no meeting date)`. Non-June/December months retain `(off-cycle)`. Legacy unrecognized saved filter strings retain the prior escaped fiscal-year query fallback.
- Sibling surfaces checked: `RequestLocator` option rendering, search route, request projection, project-leader filter path, and sub-agent audit of other `akoya_fiscalyear` consumers. Other consumers are intentional historical/funding displays or separate grant-cycle APIs; none were changed.
- Local verification 2026-09-07: the signed-in browser at `localhost:3000/workbench` rendered 480 meeting-month groups plus All cycles and Unclassified; all June/December 2020–2026 entries were present. A December 2026 search completed with 618 matches and 25 displayed rows. The source also contains future-dated groups (December 2066 and March 2055); this change preserves their dates and does not alter source records. These observations verify the local branch, not a production deployment.
- Regression coverage: 81 tests across the grant-request adapter, meeting-date aggregation, search service/route, and compact controls. Cases include more than 100 month groups, incomplete responses, missing context/restricted fields, UTC grouping, and fiscal-year disagreement for regular/off-cycle/no-date results. API, DAL, context-boundary, OData, type, and focused lint checks passed.
- Release follow-up: the compact-controls branch must carry both `9cab8c3e` and its aggregate-completeness correction into the reviewed release. The reviewer-surfacing branch still needs that correction before promotion. Production smoke remains pending; verify the complete dropdown and regular/off-cycle/no-date searches on the promoted artifact.
