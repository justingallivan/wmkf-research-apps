---
title: Atlas — Dataverse wmkf_deliberationsession
domain: dataverse
kind: source-of-truth
status: canonical
owner: product-engineering
last_verified: 2026-09-10
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
  - lib/dataverse/schema/wave28-meeting-tracker/wmkf_deliberationsession.json
  - shared/config/meetingTracker.js
  - scripts/preflight-meeting-tracker-schema.mjs
---

# Dataverse `wmkf_deliberationsession`

## Current state

**[VERIFIED IN SOURCE 2026-09-09.]** Wave 28 declares the organization-owned
`wmkf_deliberationsession` entity and the read-only preflight validates its
complete metadata contract. The preflight self-test passes. **[VERIFIED IN
SANDBOX 2026-09-09 via owner-run apply and read-only Wave 28 readback.]** The
entity, its fields and relationship, and its no-alternate-key contract are
exact. The combined readback reported 22 exact, 0 absent, and 0 divergent.
The slice-2 runtime is source-built on `codex/meeting-tracker`; keep
`MEETING_TRACKER_SCHEMA_READY` unset until that branch is deliberately promoted.

Expected entity set after apply: `wmkf_deliberationsessions`.

## Identity and fields

- `wmkf_deliberationsessionid` — Dataverse primary key.
- `wmkf_name` — required synthetic primary name, String(200).
- `wmkf_scheduledstart` / `wmkf_scheduledend` — required UserLocal DateTime
  values persisted as UTC and round-tripped with the IANA zone.
- `wmkf_ianatimezone` — required String(100) IANA identifier.
- `wmkf_location` — optional String(2000) physical location or attendance
  instructions.
- `wmkf_meetinglink` — optional Url String(1000). Runtime accepts only an
  absolute `https:` URL and stores it verbatim.
- `wmkf_attendeerefsjson` — optional Memo(32000), a server-owned versioned
  reference map resolved through the Site Visit recipient directory. Email text
  is display output, not identity authority.
- `wmkf_notes` — optional Memo(10000) internal planning notes.
- `wmkf_status` — required local Choice mirrored by
  `shared/config/meetingTracker.js`: Planned=`100000000`, Held=`100000001`,
  Cancelled=`100000002`. Planned is the schema default.

## Relationships and keys

- `wmkf_UpdatedBy` / `_wmkf_updatedby_value` — required N:1 lookup to
  `systemuser`, supplied from the authenticated session on create and every
  edit. Dataverse `modifiedon` supplies the companion timestamp.
- Relationship schema name: `wmkf_deliberationsession_updatedby`.
- Delete uses `Restrict`; Assign, Merge, Reparent, Share, and Unshare use
  `NoCascade`.
- No alternate keys are allowed. Sessions are identified by their Dataverse
  primary key.

## Producers and consumers

**[VERIFIED IN SOURCE 2026-09-10 on `codex/meeting-tracker`.]**
`/api/meeting-tracker/sessions` and `/api/meeting-tracker/sessions/[id]` call
named session adapter/service operations. Create and edit require the
`meeting-tracker` grant, a session-derived enabled `systemuser`, and an ETag for
updates. Cancel changes `wmkf_status`; it does not delete the row.

**[VERIFIED IN SOURCE 2026-09-10 on `codex/meeting-tracker`.]** The tracker
session page reads and edits the row. `getDeliberationScheduleByRequests()`
joins slots to sessions, excludes Cancelled sessions, and returns the latest
session by scheduled start through the fixed all-null fail-open reader contract.
The Staff Deliberations tab and Share email consume that reader on their own
runtime track.

## Readiness and deployment gate

Only literal `MEETING_TRACKER_SCHEMA_READY=on` may enable runtime reads and
writes. Any other value leaves tracker routes at 503 and makes the shared
schedule reader return one `null` value per input request without touching
Dataverse. Set the flag only after an explicit owner-approved apply and this
readback:

```bash
node scripts/preflight-meeting-tracker-schema.mjs --target=sandbox
```

The verified post-apply sandbox result is 22 exact, 0 absent, and 0 divergent.
Production remains unverified.
