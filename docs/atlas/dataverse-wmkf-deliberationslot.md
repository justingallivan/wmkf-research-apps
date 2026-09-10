---
title: Atlas — Dataverse wmkf_deliberationslot
domain: dataverse
kind: source-of-truth
status: canonical
owner: product-engineering
last_verified: 2026-09-09
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
  - lib/dataverse/schema/wave28-meeting-tracker/wmkf_deliberationslot.json
  - shared/config/meetingTracker.js
  - scripts/preflight-meeting-tracker-schema.mjs
---

# Dataverse `wmkf_deliberationslot`

## Current state

**[VERIFIED IN SOURCE 2026-09-09.]** Wave 28 declares the organization-owned
`wmkf_deliberationslot` entity and the read-only preflight validates its
complete metadata contract. The preflight self-test passes. **[VERIFIED IN
SANDBOX 2026-09-09 via owner-run apply and read-only Wave 28 readback.]** The
entity, its fields and relationships, and its no-alternate-key contract are
exact. The combined readback reported 22 exact, 0 absent, and 0 divergent.
Keep `MEETING_TRACKER_SCHEMA_READY` unset until the runtime implementation is
ready to use this schema.

Expected entity set after apply: `wmkf_deliberationslots`.

## Identity and fields

- `wmkf_deliberationslotid` — Dataverse primary key.
- `wmkf_name` — required synthetic primary name, String(200).
- `wmkf_order` — required Integer from 1 through 1000; one-based order within
  its session.
- `wmkf_minutes` — required Integer from 1 through 1440. The application default
  is 15 minutes, defined in `shared/config/meetingTracker.js`.
- `wmkf_notes` — optional Memo(10000) internal planning notes.

## Relationships and keys

- `wmkf_Session` / `_wmkf_session_value` — required N:1 lookup to
  `wmkf_deliberationsession`; relationship
  `wmkf_deliberationslot_session`.
- `wmkf_Request` / `_wmkf_request_value` — required N:1 lookup to
  `akoya_request`; relationship `wmkf_deliberationslot_request`.
- `wmkf_LeadPd` / `_wmkf_leadpd_value` — optional N:1 lookup to `systemuser`;
  relationship `wmkf_deliberationslot_leadpd`.
- `wmkf_UpdatedBy` / `_wmkf_updatedby_value` — required N:1 lookup to
  `systemuser`, supplied from the authenticated session on create and every
  edit; relationship `wmkf_deliberationslot_updatedby`. Dataverse `modifiedon`
  supplies the companion timestamp.
- Every relationship uses `Delete: Restrict`; Assign, Merge, Reparent, Share,
  and Unshare use `NoCascade`.
- No alternate keys are allowed. In particular, there is no uniqueness on the
  Request lookup: one request may appear in more than one session by design.

## Planned producers and consumers

**[PLANNED — Meeting Tracker slice 2.]** Authenticated tracker routes will call
named slot adapter/service operations. Add, remove, reorder, and move are
ETag-guarded writes; a move is one PATCH of the Session lookup and Order. Reorder
is a batch of individually fenced order PATCHes. An over-full session returns a
warning after the write and does not reject the operation.

**[PLANNED — Meeting Tracker slice 2.]** The session page will render the ordered
slot list. `getDeliberationScheduleByRequests()` will read at most 25 request IDs
per Dataverse query and choose each request's latest non-cancelled session by
scheduled start.

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
