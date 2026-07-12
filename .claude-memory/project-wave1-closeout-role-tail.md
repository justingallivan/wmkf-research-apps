---
name: project-wave1-closeout-role-tail
description: "Wave 1 Postgres → Dataverse migration CLOSED 2026-05-12. Tables dropped, dispatcher defaults flipped, docs updated. Role tail RESOLVED by owner decision 2026-07-12: temp elevations stay for the rest of the project; Justin handles any eventual revert with Connor directly."
metadata: 
  node_type: memory
  type: project
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
  status: active
  scope: dataverse
  last_verified: 2026-07-12 — Wave1 tables-dropped stands; role tail RE-PROBED (elevations attached) and RESOLVED by owner decision the same day: elevations intentionally retained for the rest of the project
---

## Recall Rule

Read this when: anything touches the Wave 1 Postgres→Dataverse migration, the `WAVE1_BACKEND_*` flags, or the prod app-user role elevations.

Do:
- Treat Wave 1 as DONE — don't re-litigate the flag flip, the drop, or the table list.
- Treat the Wave 1 migration itself as closed.
- Treat the temp role elevations (`WMKF AI Elevated TEMP` + `System Customizer`) as INTENTIONALLY RETAINED (owner decision 2026-07-12) — do not propose or schedule a revert; Justin owns that conversation with Connor.
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

**Role tail RESOLVED by owner decision (2026-07-12): elevations stay.**

- **Owner decision 2026-07-12 (Justin, in-session):** the temp elevations are needed for the rest of the project and are intentionally retained. Any eventual revert is Justin's conversation with Connor, handled outside agent sessions. Do not re-surface this as an open item.
- **RE-PROBED 2026-07-12** (`scripts/probe-app-user-roles.js`): app user `systemuserid 53e97fb3-a006-f111-8406-000d3a352682` has BOTH elevations — `WMKF AI Elevated TEMP` + `System Customizer` — attached. Full current role set: `Delegate`, `System Customizer`, `WMKF AI Elevated TEMP`, `WMKF AI Tools`, `WMKF Custom Entities`, `WMKF Research Review App Suite - Staff`, `akoyaGO Team User (no accounting)`.
- **Naming clarification (probe-verified 2026-07-12):** `# WMK: Research Review App Suite` is the app USER's display name (systemuser `fullname`, created 2026-02-10 — confirmed via read-only systemusers GET). The suite security ROLE has been named `WMKF Research Review App Suite - Staff` since its creation on 2026-04-24 (role record createdon 2026-04-24T18:32Z, modifiedon 18:58Z same day; no role with the old string exists). Earlier memories that said "the `# WMK: Research Review App Suite` role" were conflating the user name with the role name — there was no tenant-side rename.
- **Why elevations were kept** (Justin's original policy call 2026-05-11, superseded by the 2026-07-12 decision above): active entity/field creation under Connor's delegated authority (`project_dataverse_creator_privileges`, summary-after model) makes revert-and-re-add churn worse than the marginal security gain.

**How to apply:**
- Wave 1 is **done** — don't re-litigate the flag flip, the drop, or the table list in future sessions.
- Dispatcher Postgres branches in `lib/services/{settings,app-access,database}-service.js` were deleted (commits `cd735c0` + `5c366fc`, 2026-05-26). Each service now has an `assertWave1*Backend()` module-load guard: setting any `WAVE1_BACKEND_*=postgres` throws at cold-start with an actionable message (matching the `lib/services/grant-cycles-dataverse.js` W3 pattern).
- If a future Wave-2 or pilot-portal schema-apply script runs, do not assume the elevations are still present from this memory. Verify with the role-check command in `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` § Verification.
- Recovery story: Neon PITR window is 7 days, so until ~2026-05-19, a snapshot restore is feasible if Dataverse fails catastrophically. After that, no recovery — but the prod system has been on Dataverse for 9+ days at that point.

**Related memories:** [[project-wave1-onboarding]] (next phase; not yet built).
