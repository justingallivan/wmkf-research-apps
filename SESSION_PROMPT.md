# Session 460 Prompt: Prove Site Visit Logistics with Real Event Details

## Session 459 Summary

Session 459 mapped, built, reviewed, provisioned, and deployed the first Site
Visit logistics slice. The code is on `main`; Production is Ready. The remaining
business proof requires real date/time/location and attendee choices. Do not
invent them.

### What Was Completed

1. **Live Dataverse shape was verified before design.**
   - `[VERIFIED via Production/sandbox probes]` the existing custom Activity
     `wmkf_sitevisit` already supplied Request binding, UTC schedule, notes,
     state/status, and organizer/required/optional ActivityParty roles; both
     targets had zero rows.
   - Wave 21 adds only format, IANA time zone, location/link, and the server-owned
     attendee-reference map. All four fields now read back exact in sandbox and
     Production.

2. **The full caller → persistence → consumer slice was implemented.**
   - Workbench Site Visit has a logistics editor for local date/time, named IANA
     zone and DST choice, format, location/link, organizer, staff/Board/
     Consultant attendees, manual applicant addresses, and notes.
   - WMKF staff resolves through active `user_profiles` plus enabled Dataverse
     `systemusers`; Board/Consultants resolve by immutable
     `expertise_roster.id` plus maintained `preferred_email`.
   - The existing frozen distribution preview/send/history path now supports
     governed material links and one deterministic informational
     `METHOD:PUBLISH` calendar attachment. It does not claim RSVP or reliable
     update/cancellation behavior.

3. **Persistence and failure contracts were proved.**
   - Migration 035 was applied at `2026-08-24T20:23:13.965Z`; the 11 additive
     distribution columns and constraints read back exact. The prior sent base
     proof row is unchanged; there are zero calendar attempts and zero populated
     roster preferred emails before staff population.
   - Direct ActivityParty create is unsupported (`0x80040800`). A reversible
     sandbox sentinel proved nested-party create, Wave 21 round trip, ETag-fenced
     field edit, atomic delete/recreate of the same Activity GUID when roles
     change, and exact cleanup/readback absence.
   - Focused tests pass: 8 suites, 60 tests. Types, relevant ESLint (0 errors),
     migration manifest, API route, route/service, GUID trust, Dataverse DAL, and
     Dynamics context gates pass. Webpack Production build passes with only the
     repository's known dynamic-dependency warnings.

4. **Bounded Opus reviews closed.**
   - The plan review returned `READY WITH NAMED CHANGES`; the first slice was
     narrowed to honest `METHOD:PUBLISH`, structured fields, immutable roster
     identity, and controlled proof.
   - The final code review returned `READY WITH NAMED CHANGES`. The material
     finding—unsupported direct ActivityParty writes—was confirmed live and
     fixed with the proved atomic same-ID replacement. The remaining findings
     were confirmed/refuted with source and regression tests. Do not restart a
     review loop without a material new change.

5. **Production release completed.**
   - Vercel Preview was Ready and protected by Vercel SSO.
   - `SITE_VISIT_LOGISTICS_SCHEMA_READY=on` is verified as non-sensitive in
     Preview and Production.
   - Commit `ffaa293b` fast-forwarded `main`; Production deployment
     `dpl_A3PED8cA22G88dAKL4jafBAro5tn` is Ready on the branded aliases.
   - Production `/api/auth/status` returned `{"enabled":true}`; both new routes
     redirected unauthenticated callers to sign-in; the bounded error-log scan
     was clean.
   - No Production Site Visit row or calendar/link distribution was created.

## Primary Next Step

1. **Run one signed-in business proof when the owner supplies real event
   details.**
   - Use Request `1002379` only after re-reading its current Pre-Site state.
   - Obtain actual local date, start/end time, IANA zone, format,
     location/link, organizer, attendee roles, and any selected governed
     material links. Do not infer or fabricate any of them.
   - Save once, independently read back the Activity/parties/UTC+zone fields,
     refresh and verify the UI round trip, then prepare an exact preview.
   - Before sending, show the final To/Cc, subject/body, links, and calendar
     facts. A calendar send is a new external communication and requires the
     user's explicit confirmation at the send step. The previously confirmed
     base PDF operation must not be reused or repeated.

## Verified Open

1. Signed-in Production recipient-directory read and logistics GET/PATCH.
2. Production calendar/material preview and one controlled send/readback.
3. Population of `expertise_roster.preferred_email` for Board/Consultant rows
   that use external addresses.
4. Recipient inbox confirmation for the earlier PDF-only send; Dynamics Sent is
   transport acceptance, not inbox proof.
5. AkoyaGo publication projection, supporting-file upload dossier, and Final
   Writeup copy remain separate later slices.

## Do Not Reopen Without a New Decision

1. Formal `METHOD:REQUEST` scheduling, RSVP, update, or cancellation semantics.
2. A parallel Site Visit status field, second orchestration ledger, or separate
   Site Visit Writeup.
3. Direct ActivityParty writes or caller-selected upsert identities.
4. Automatic email when Site Visit promotion/date changes.
5. Broad Opus/Codex review loops without a material new plan or code change.

## Key Files

| File | Purpose |
|---|---|
| `docs/atlas/dataverse-wmkf-sitevisit.md` | Live Site Visit source/persistence/consumer contract |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Cross-tab lifecycle and next slices |
| `docs/atlas/postgres-infra-tables.md` | Migration 035 ledger/roster state |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | Auth and data-boundary status |
| `lib/services/site-visit/logistics-service.js` | Save/read invariants |
| `lib/services/pre-site-visit/distribution-service.js` | Exact calendar/link preview and send |

## Release Verification

```bash
rtk npm test -- --runInBand tests/unit/calendar-invite.test.js tests/unit/pre-site-distribution-schema-parity.test.js tests/unit/pre-site-distribution-service.test.js tests/unit/site-visit-adapter.test.js tests/unit/site-visit-logistics-panel.test.js tests/unit/site-visit-logistics-service.test.js tests/unit/site-visit-tab.test.js tests/unit/zoned-date-time.test.js
rtk npm run check:types
rtk npm run check:api-routes:self-test
rtk npm run check:api-routes
rtk npm run check:route-service-boundary:self-test
rtk npm run check:route-service-boundary
rtk npm run check:atlas:self-test
rtk npm run check:atlas
rtk npm run check:agent-wiki:self-test
rtk npm run check:agent-wiki
rtk npm run check:memory-drift:no-write
rtk npm run check:agent-invariants
```
