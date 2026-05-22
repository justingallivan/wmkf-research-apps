---
name: intake-meeting-agenda-cleanup
description: "After ~2026-05-27 (two weeks after the 2026-05-13 intake portal meeting), move docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md to docs/archive/ so the live docs/ listing doesn't accumulate meeting prep artifacts."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f66eb83-87a2-47a6-b4be-21f06cbadf1a
---

**Trigger:** any session that starts on or after **2026-05-27**, while `docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md` still exists in `docs/` (not yet in `docs/archive/`).

If the current date is past that threshold and the file is still in `docs/`, surface this as a routine housekeeping item near the end of `/start`. Do not bury it under "P0 blocker" framing — this is repo hygiene, not a regression.

**Why it's here:** the agenda was committed to git on 2026-05-12 so Justin could access it from another computer for the 2026-05-13 meeting. It lives in `docs/` rather than `/tmp/` precisely because it needed to travel with the repo. After the meeting decisions land elsewhere (resolved blockers in `docs/INTAKE_PORTAL_DESIGN.md`, schema changes in `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`), the agenda itself becomes historical and shouldn't clutter the live docs/ listing.

**Cleanup action:**

```bash
git mv docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md \
       docs/archive/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md
git commit -m "Archive 2026-05-13 intake portal meeting agenda

Decisions captured in INTAKE_PORTAL_DESIGN.md / INTAKE_PORTAL_SCHEMA_CHANGES.md;
moving the prep agenda to docs/archive/ per cleanup memory."
```

The `docs/archive/` precedent already exists (`docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md`, `docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`) — historical-but-keep-for-reference docs live there.

**Don't do this if:**
- The 2026-05-13 meeting was rescheduled and the agenda is still actively in use → wait for the rescheduled meeting + 2 weeks.
- Decisions from the meeting *haven't* landed in the design doc yet → archiving the agenda would lose the only structured capture of what was supposed to be decided. Hold until the design doc is up to date.

**Cancel condition:** if Justin already moved/archived/deleted the file in a prior session, this entry has done its job — surface that fact briefly and consider this memory entry stale (mark for removal).
