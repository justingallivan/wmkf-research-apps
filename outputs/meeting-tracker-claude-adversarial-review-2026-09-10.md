# Adversarial review — Meeting Tracker slices 1–2 (Codex, `codex/meeting-tracker`, PR #222)

Reviewer: Claude (S503, 2026-09-10). Target: `origin/merge/meeting-tracker` (Codex's 11 commits merged onto main). Method: contract-reconcile Mode A, every route traced auth → service → adapter → Dataverse, contracts 1–7 of `docs/plans/MEETING_TRACKER_CODEX_BRIEF_2026-09-09.md` checked against source. All line references are on the merge branch.

## Verdict

**Safe to merge inert; NOT ready for the flag flip.** Two findings would make the tracker and the surfaces that read it fail on ordinary data (one stale Board reference, one duplicate site visit). Both are small fixes. The security contract holds.

## What holds (verified)

- Every route: literal-on flag, `requireAppAccess('meeting-tracker')`, `withDalContext`, actor minted only from the session via `actorRefFromSession`, exact-body allowlists, GUID validation at the edge (`pages/api/meeting-tracker/*`).
- Writes: every session/slot write carries `wmkf_UpdatedBy@odata.bind` and the acting user; updates/deletes are If-Match fenced; reorder is one atomic changeset with per-op If-Match (`lib/services/dynamics/changeset.js:60-83`).
- Zoom link: absolute `https:` with hostname, ≤1000, stored verbatim; rendered with `rel="noopener noreferrer"` (`session-service.js:81-93`, `MeetingTrackerList.js:64`, `SessionEditor.js:295`).
- Schema matches contract 1 (`wave28-meeting-tracker/wmkf_deliberationsession.json`: Url/1000, Memo/32000, Memo/10000).
- Reader export and shape match plan §5.4; cancelled sessions excluded in the filter and again in memory; batch of 25.
- Fail-closed flag: 503 before any Dataverse call on all seven routes; adapters also refuse.

## Findings

| # | Sev | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| 1 | **High** | One stale attendee reference breaks every session read and blocks the fix. `projectSession` resolves attendees on every GET and list; `resolveMeetingAttendeeRefs` throws 409 when a roster ref is no longer a Board member and the directory service throws 400 for a ref it cannot resolve; `parseMeetingAttendeeRefs` throws 503 on malformed stored JSON. `listDeliberationSessions` awaits per row, so one bad session hides the whole list; session GET fails; PATCH re-resolves current refs when `attendees` is omitted, so the PC cannot even open the session to remove the stale attendee. A Board roster change between sessions is ordinary data. | `session-service.js:128-145, 242-252, 303-309`; `attendee-service.js:72-84, 98-117`; `recipient-directory-service.js:145` | Reads never throw on resolution: project `attendees: []` plus an `attendeeIssues` list naming the unresolved refs; let PATCH proceed when `attendees` is supplied; only `create`/`update` with explicit attendees validate strictly. Test: list with one session whose roster ref is not Board. |
| 2 | **High** | The same failure zeroes the schedule reader for every request. The reader's single `try` wraps attendee resolution for all sessions; one stale ref returns the all-null map, so the Staff Deliberations tab, the Share email, and the briefing page lose every session line in the cycle at once. Fail-open is right per contract 5, but the blast radius is the whole cycle, not the one session. | `schedule-reader.js:49-108` (one try; `resolveAttendees` at 82 throws) | Resolve attendees per session inside its own try; on failure emit the schedule with `attendees: []` rather than dropping the entry. Test: two sessions, one with a bad ref, the other must still resolve. |
| 3 | Medium | Dashboard fails for the whole cycle on one duplicate active site visit or one unresolved request. The Site Visit adapter returns up to three active rows with no uniqueness (`site-visit.js:46-58`); the dashboard throws 409 for the entire page. `findByIds` missing any request (deleted, or a read the app user cannot see) throws 500 for the page. | `dashboard-service.js:106-111, 126-138` | Reuse `lib/services/deliberation-briefing/site-visit-selection.js` (`selectActiveSiteVisit`, earliest end wins) and flag the row `needsReconciliation`; drop unresolved requests from the list with a notice instead of failing. |
| 4 | Medium | D10's fixed staff list is unreachable in the product. `meeting_tracker.default_attendees` is read but nothing writes it: the admin settings routes each write a fixed key (`email-defaults`, `honorarium-amount`, `reviewer-time-budget`, `models`, `secrets`), and no admin UI mentions the tracker. Every new session starts with no attendees and the notice "Default attendees are not configured." | `attendee-service.js:142-174`; `rg meeting_tracker.default_attendees` → reads only; `pages/api/admin/*.js` writers | Add the key to the admin editable-settings surface (the `email-defaults` entry pattern) with a staff-only picker, or document that D10 is unmet until then. |
| 5 | Medium | Unknown session/slot ids return 500, not 404. `DynamicsService.getRecord` throws on 404 (`read-ops.js:21`), so every `Session not found` / `Slot not found` branch is unreachable; the route's catch-all returns 500 "Failed to load or save". | `session-service.js:238-241, 294-296`; `slot-service.js:160-162, 189-191, 279-280` | Catch `status === 404` in the two adapters' `getById` and return null (the grantee verifier pattern). Test: GET a random GUID → 404. |
| 6 | Low | Flag check runs before authentication on all seven routes, so an unauthenticated probe learns whether the tracker is enabled (503 vs 401). Contract 6 only required "before any Dataverse call". | every `pages/api/meeting-tracker/*` handler | Authenticate first, then check the flag. |
| 7 | Low | `actingUserSystemId` is an allowed body key on every write route (stripped server-side). Harmless, but it invites clients to send identity; the repo rule is to reject it. | `sessions/index.js:11-14`, `slots/index.js:8-10`, etc. | Remove from the allowlists so it is a 400. |
| 8 | Low | Reader batch: `findByRequestIds` uses `top: 100` and the reader throws (→ all-null) when `hasMore`. 25 requests × 5 slots each trips it. | `deliberation-slot.js:68`; `schedule-reader.js:54` | Page the query or raise `top` to the 5000 cap via `queryAllRecords`. |
| 9 | Low | Move places the slot at order 1 in the target without renumbering its siblings, so two slots share order 1 until a reorder. | `SessionEditor.js:330` (`order: 1`); `slot-service.js:144-177` | Append at `slots.length + 1` on move, as `add` does. |
| 10 | Low | `listDeliberationSessions` fetches the recipient directory once per session row. | `session-service.js:140, 303-309` | Load the directory once and pass it through. |
| 11 | Low | Test gaps for the paths above: no test for a stale attendee ref on read/list, duplicate active visits, unknown id, or reader isolation across sessions. | `tests/unit/meeting-tracker-*.test.js` (40 tests) | Add with the fixes. |

## Recommended order

Fix 1, 2, 5 before `MEETING_TRACKER_SCHEMA_READY=on` anywhere (they decide whether the first stale Board ref takes the tracker down). 3 and 4 before the first real session is scheduled. 6–11 with the next pass. Merging #222 now is safe: nothing runs until the flag is on.
