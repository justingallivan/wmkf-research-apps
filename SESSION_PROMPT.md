# Session 461 Prompt: Choose the Next Site Visit Lifecycle Slice

## Session 460 Summary

Session 460 completed the first signed-in Production Site Visit logistics and
calendar/material distribution proof on Request `1002379`, then simplified the
UI in response to owner testing. All runtime changes are on `main` and Ready in
Production.

### What Was Completed

1. **The signed-in logistics flow is Production-proved.**
   - `[VERIFIED via Dataverse readback 2026-08-25]` Request `1002379` has one
     active `wmkf_sitevisit`, ID `11b41d73-02a0-f111-b8dc-6045bd018a07`, bound
     to the expected Request, with persisted `America/Chicago` zone, format,
     location, attendee-reference map, and five ActivityParty rows.
   - The saved organizer is enforced as a `To` recipient for every
     calendar-enabled preview/send.

2. **The first Production calendar/material send was accepted by Dynamics.**
   - `[VERIFIED via Postgres readback 2026-08-25]` operation
     `f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with
     `calendar_enabled=true`, one governed material, the saved Site Visit ID,
     no final error, and `sent_at=2026-08-25T15:51:00.440Z`.
   - This is transport acceptance, not independent inbox/calendar-client proof.

3. **Owner-reported UX defects were fixed and promoted.**
   - Date and time use separate controls; the end date defaults to the start
     date; time steps are 15 minutes; time clicks no longer open the date picker.
   - The repeated-time/daylight-saving panel is hidden. The server still rejects
     nonexistent wall times, while the simplified UI consistently chooses the
     earlier occurrence if a local time repeats.
   - Organizer/attendee roles and preview recovery were simplified.
   - JSONB object key ordering no longer makes a newly created material preview
     immediately stale.
   - Time zone is a dropdown that defaults new visits to US Pacific
     (`America/Los_Angeles`) and preserves a previously saved zone.

4. **Verification and releases completed.**
   - Organizer fix: commit `ef101aa1`.
   - False-stale fix: commit `f5b7efc2`, Production deployment
     `dpl_G797oPgs7cUNGFANhbiKY7k9r2Pb`; 36 related tests, ESLint, build, and
     bounded Production logs passed.
   - Time-zone dropdown: commit `f8037230`, Production deployment
     `dpl_28bcFzCpxbwSVf8z5apvNrt1apDV`; 39 related tests and webpack build
     passed. ESLint had zero errors and one pre-existing
     `react-hooks/set-state-in-effect` warning at
     `components/workbench/SiteVisitLogisticsPanel.js:144`.
   - Bounded Claude Opus plan/code review attempts repeatedly exhausted their
     turn limit without a verdict. Per owner direction, do not tail-chase a
     review absent a material new plan or code change.

## Primary Next Step

Choose and execute one bounded lifecycle slice:

1. **Recommended: Site Visit dossier.** Build governed supporting-file listing
   and upload for applicant slides, other applicant materials, recordings,
   transcripts, and transcript summaries. Keep applicant self-upload as its own
   security-reviewed sub-slice.
2. **Alternative: AkoyaGo publication discovery.** Run the signed-in and
   historical-convention probes before proposing paths, filenames,
   representations, permissions, triggers, or persistence.
3. **Alternative: Final Writeup copy/tab.** Freeze the exact Site Visit-stage
   source version/hash, create a new Final row/item, transition the pointer, and
   prove retry/regeneration semantics.

Invoke `/contract-reconcile` for any of these cross-layer slices and obtain one
bounded Claude Opus plan review before implementation plus one bounded code
review after implementation. Do not iterate on non-material nitpicks.

## Verified Open

1. Populate `expertise_roster.preferred_email` for active Board/Consultant rows
   that need external addresses; probe current rows before any update.
2. Independent inbox/calendar-client confirmation of operation
   `f497643a-2e9e-4032-a323-1e40874d16f1` remains distinct from the proved
   Dynamics transport receipt.
3. Site Visit dossier, AkoyaGo publication projection, and Final Writeup copy
   remain planned, not built.

## Owner Decision Needed

Select the next primary slice: Site Visit dossier, AkoyaGo publication
discovery, or Final Writeup. The dossier is the recommended continuation.

## Do Not Reopen Without a New Decision

1. Formal `METHOD:REQUEST` scheduling, RSVP, update, or cancellation semantics.
2. A parallel Site Visit status field, second orchestration ledger, or separate
   Site Visit Writeup.
3. Direct ActivityParty writes or caller-selected upsert identities.
4. Automatic email when Site Visit promotion/date changes.
5. The completed Production logistics/calendar proof, false-stale fix, or
   organizer-recipient enforcement.
6. Broad Opus/Codex review loops without a material new plan or code change.

## Key Files

| File | Purpose |
|---|---|
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Cross-tab lifecycle and remaining slices |
| `docs/atlas/dataverse-wmkf-sitevisit.md` | Live Site Visit persistence and proof |
| `docs/atlas/postgres-infra-tables.md` | Distribution ledger proof |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | Auth and data-boundary status |
| `lib/services/site-visit/logistics-service.js` | Save/read invariants |
| `lib/services/pre-site-visit/distribution-service.js` | Exact calendar/material send contract |

## Relevant Verification

```bash
rtk npm test -- --runInBand tests/unit/calendar-invite.test.js tests/unit/pre-site-distribution-service.test.js tests/unit/site-visit-logistics-panel.test.js tests/unit/site-visit-logistics-service.test.js tests/unit/zoned-date-time.test.js
rtk npm run check:atlas:self-test
rtk npm run check:atlas
rtk npm run check:api-routes:self-test
rtk npm run check:api-routes
rtk npm run check:agent-wiki:self-test
rtk npm run check:agent-wiki
rtk npm run check:memory-drift:no-write
rtk npm run check:agent-invariants
```
