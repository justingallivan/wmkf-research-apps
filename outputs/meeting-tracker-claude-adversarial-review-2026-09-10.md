
## Fixes applied (S503, same day, on `merge/meeting-tracker`)

| # | Fix |
|---|---|
| 1 | Reads use `parseMeetingAttendeeRefsLenient` + `resolveMeetingAttendeesLenient`: each reference resolves on its own, failures land in `attendeeIssues`, list/get/update never throw on a stale or damaged map; an update that omits `attendees` carries the stored map through verbatim. The editor shows the issues under Attendees. |
| 2 | Schedule reader resolves attendees per session in its own try, and a directory outage empties attendees without dropping schedule entries. |
| 3 | Dashboard picks the earliest-ending active Site Visit via the shared `selectActiveSiteVisit` and flags `siteVisitNeedsReconciliation`; an unresolvable request is listed with `requestUnresolved` plus a `notices` entry the list renders. |
| 4 | New superuser surface: `/api/admin/meeting-tracker-defaults` (GET/PUT) + `MeetingTrackerDefaultsSection` under Admin › Site visits, writing `meeting_tracker.default_attendees` as a staff-only reference map after resolving each reference. |
| 5 | Both adapters' `getById` return null on a Dataverse 404, so the services' not-found branches answer 404. |
| 6 | All seven tracker routes authenticate before the readiness check; an unauthenticated caller gets 401, never the flag state. |
| 7 | `actingUserSystemId` removed from every body allowlist (400 if sent). |
| 8 | `findByRequestIds` pages via `queryAllRecords`; the reader treats `capped` like truncation. |
| 9 | Move defaults to the end of the target session; the editor no longer forces order 1. |
| 10 | The session list reads the recipient directory once. |
| 11 | 14 new tests across session service, reader, dashboard, slot service, attendee service, route, and the admin route; adapter and route tests updated for the new ordering. |

Full unit suite after fixes: 813 suites, 11,557 tests, 0 failures. Gates green.
