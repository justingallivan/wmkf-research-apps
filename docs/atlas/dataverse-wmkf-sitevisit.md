---
title: Atlas — Dataverse wmkf_sitevisit
domain: dataverse
kind: source-of-truth
status: canonical
owner: product-engineering
last_verified: 2026-08-25
related:
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - lib/dataverse/adapters/site-visit.js
  - lib/services/site-visit/logistics-service.js
  - lib/dataverse/schema/wave21-site-visit-logistics/wmkf_sitevisit_logistics.json
---

# Dataverse `wmkf_sitevisit`

## Current state

**[VERIFIED LIVE 2026-08-24.]** `wmkf_sitevisit` is an existing custom Activity
entity with entity set `wmkf_sitevisits`. Production and the tracked sandbox
each had zero rows before the logistics release. The standard Activity surface
already supplies Request `regardingobjectid`, `subject`, `description`, UTC
`scheduledstart`/`scheduledend`, state/status, and the
`wmkf_SiteVisit_activity_parties` organizer/required/optional party collection.

Wave 21 is exact in sandbox and Production and adds only:

| Field | Shape | Authority |
|---|---|---|
| `wmkf_visitformat` | local Choice | In person / Virtual / Hybrid |
| `wmkf_ianatimezone` | String(100) | IANA zone used to interpret local wall time |
| `wmkf_locationorlink` | String(2000) | Physical location, meeting URL, or hybrid instructions |
| `wmkf_attendeerefsjson` | Memo(32000) | Server-owned versioned map from ActivityParty rows to immutable recipient references |

The non-sensitive readiness flag is literal `on` in Vercel Preview and
Production. **[VERIFIED LIVE 2026-08-25.]** Request `1002379` now has one active
Production Site Visit, `11b41d73-02a0-f111-b8dc-6045bd018a07`. Read-only
adapter readback confirmed its Request binding, active state, `America/Chicago`
zone, populated format/location/reference-map fields, five ActivityParty rows,
and ETag `W/"95328121"`.

## Producer and persistence contract

`pages/api/workbench/site-visit/logistics.js` establishes app access and the
Dataverse restriction context, then delegates to
`lib/services/site-visit/logistics-service.js`. The service independently
requires the Request's current Pre-Site artifact to be Ready/Review, permits at
most one active Site Visit, resolves every organizer/attendee server-side, and
binds the Activity to the Request.

First save creates the Activity with nested ActivityParty rows. Field-only edits
use `If-Match` parent PATCH. Dataverse rejects direct ActivityParty create/update/
delete with `0x80040800`; when attendee roles change, the adapter submits one
ETag-fenced changeset that deletes and recreates the same Activity GUID with the
new nested parties. The operation is atomic and is not an upsert or a stale-write
fallback.

## Consumers

- `useSiteVisitContext` (`shared/components/workbench/useSiteVisitContext.js`)
  is the Workbench's READ-ONLY consumer since S466: the logistics editor
  (`SiteVisitLogisticsPanel`) was removed 2026-08-28 by owner decision —
  visits are scheduled outside the Workbench, directly on this Activity. The
  hook reads logistics + the recipient directory headlessly and derives the
  composer's calendar/materials/suggested-recipient context. The write
  routes (`/api/workbench/site-visit/logistics` POST) and their server-side
  local-time validation remain live but currently have no in-app UI caller.
- `recipient-directory-service.js` joins active WMKF profiles to enabled
  `systemusers` and reads Board/Consultant suggestions by immutable
  `expertise_roster.id` plus maintained `preferred_email`.
- `pre-site-visit/distribution-service.js` can bind the Activity ID/ETag and a
  bounded event snapshot into an informational `METHOD:PUBLISH` calendar
  attachment. For a calendar-enabled preview it requires the ActivityParty
  organizer email, forces that address into the exact persisted `To` set, and
  removes it from `Cc` before hashing. It rechecks the ETag before transport.

## Verification and limits

- Metadata/capability probes verified entity, relationship, standard party
  masks, field limits, and zero-row pre-release state in both targets.
- A reversible sandbox sentinel proved nested organizer create, all Wave 21
  field round trips, field PATCH, atomic same-ID party replacement, and exact
  cleanup/readback absence.
- Focused tests cover DST ambiguity/nonexistence, one-active-row enforcement,
  ETag behavior, exact identity mapping, adapter changeset shape, and calendar/
  material preview identity.
- **[PRODUCTION-PROVED 2026-08-25.]** The signed-in directory/logistics flow
  created and round-tripped the Request `1002379` row above. Calendar/material
  operation `f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with this Site
  Visit ID, one governed material, and no final error. `sent` proves Dynamics
  transport acceptance, not independent inbox or calendar-client delivery.
