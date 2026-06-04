---
name: wave-1-closeout
description: "Wave 1 Postgres → Dataverse migration CLOSED 2026-05-12. Tables dropped, dispatcher defaults flipped, docs updated. One deferred tail item: elevation revert on prod app user."
metadata: 
  node_type: memory
  type: project
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
  status: closed
  scope: dataverse
  last_verified: 2026-05-26 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: anything touches the Wave 1 Postgres→Dataverse migration, the `WAVE1_BACKEND_*` flags, or the prod app-user role elevations.

Do:
- Treat Wave 1 as DONE — don't re-litigate the flag flip, the drop, or the table list.
- Leave the temp role elevations (`WMKF AI Elevated TEMP` + `System Customizer`) on the prod app user through the pilot; revert only per `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` once the portal schema settles.
- Remember dispatcher Postgres branches were deleted; `WAVE1_BACKEND_*=postgres` now throws at cold-start by design.

Do not:
- Re-add a Postgres fallback for the three migrated tables (`system_settings`, `user_app_access`, `user_preferences`) — they were dropped 2026-05-12.
- Assume a long Neon PITR recovery window — it closed ~2026-05-19.

Ground truth: `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md`, `lib/db/migrations/007_drop_wave1_tables.sql`, `lib/services/{settings,app-access,database}-service.js`. Related: [[project-wave1-onboarding]].

Wave 1 closed out cleanly on **2026-05-12**.

**Sequence that actually happened:**

1. **Cutover 2026-04-24** — Schema deployed, role provisioned, 149 rows synced, read-path verified.
2. **Flag flip 2026-05-03** — Three `WAVE1_BACKEND_*` flags set to `dataverse` in prod Vercel env. Earlier 2026-04-27 attempt had a trailing-newline bug (silent fallback to Postgres for 6 days); corrected by deleting and re-adding via dashboard.
3. **Behavioral verification 2026-05-11** — Probed Postgres for any writes to the three tables since 2026-05-03: zero from prod. 10 dev writes from S145 (admin model picker on localhost) discovered and reconciled to Dataverse the same day. Dev `.env.local` updated to set the flags so future dev writes route to Dataverse.
4. **PITR bump 2026-05-11** — Neon project history retention raised from 6h → 7 days (Launch plan), making rollback viable.
5. **Drop migration 2026-05-12T01:30:41Z** — `lib/db/migrations/007_drop_wave1_tables.sql` executed against prod Postgres. All three tables dropped under transactional safety guards. Recovery window via Neon PITR until 2026-05-19T01:30Z.
6. **Codex review + follow-ups 2026-05-12** — Dispatcher defaults flipped from postgres to dataverse (the major footgun Codex flagged: missing/typo'd flag would route to a dead branch and silently degrade in `database-service.js`). Typo fixes. Atlas + CLAUDE.md updates.

**Single deferred item: revert temp role elevations on prod app user.**

- App user `# WMK: Research Review App Suite` (`systemuserid 53e97fb3-a006-f111-8406-000d3a352682`) still has `WMKF AI Elevated TEMP` + `System Customizer` attached.
- **Why deferred** (Justin's policy call 2026-05-11): keep elevations on through the intake-portal pilot iteration. We're actively creating new entities/fields under Connor's delegated authority (`project_dataverse_creator_privileges`, summary-after model). Reverting now and re-adding for every batch is more friction than the marginal security gain.
- **When to revert:** once the pilot's `wmkf_portal_*` schema settles (probably after the first real submission cycle, mid-to-late June 2026). At that point follow `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` and ask Connor about the `akoyaGO Team User (no accounting)` vs. `akoyaGO Read Only access` role-name discrepancy.

**How to apply:**
- Wave 1 is **done** — don't re-litigate the flag flip, the drop, or the table list in future sessions.
- Dispatcher Postgres branches in `lib/services/{settings,app-access,database}-service.js` were deleted (commits `cd735c0` + `5c366fc`, 2026-05-26). Each service now has an `assertWave1*Backend()` module-load guard: setting any `WAVE1_BACKEND_*=postgres` throws at cold-start with an actionable message (matching the `lib/services/grant-cycles-dataverse.js` W3 pattern).
- If a future Wave-2 or pilot-portal schema-apply script runs, it uses the *still-present* elevations on the app user. No action needed unless someone has reverted them in the meantime — verify with the role-check command in `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` § Verification.
- Recovery story: Neon PITR window is 7 days, so until ~2026-05-19, a snapshot restore is feasible if Dataverse fails catastrophically. After that, no recovery — but the prod system has been on Dataverse for 9+ days at that point.

**Related memories:** [[project-wave1-onboarding]] (next phase; not yet built).
