# Expertise roster branch inventory — November 18, 2026

Branch `codex/expertise-roster-import-2026-11-10` after recovery, `main` merge and push.
Each row is labelled **[RE-VERIFIED 11-18]** (checked this session on the merged tip) or
**[RECORDED 11-09..11]** (Codex's dated evidence, not re-run since the 330-commit merge).
Plan: `docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md` (§6 acceptance,
§7 work packages).

## Branch hygiene

- **[RE-VERIFIED 11-18]** Pushed; local = `origin`. All gates and self-tests pass after the
  merge; full Jest passes (28,750); the Docker-backed suites pass separately (item 8 below).
- **[RE-VERIFIED 11-18]** Shared-backend commits the branch notes cite (`7d0cf0392`,
  `eb0010163`, `6fe01c88e`, `f9b3dd1b4`, `ef5507ab8`, `a756735fa`, `0c4b8d39c`) are on
  `origin` (`codex/power-automate-integration-2026-11-11`,
  `codex/executive-summary-generation-2026-11-16`). The local-only Nov 10–11
  `codex/executor-*` and `codex/staff-draft-*` branches have same-subject commits on those
  pushed branches (subject match, not patch identity).

## Behaviour with rehearsal off (merge-dark question)

**[RE-VERIFIED 11-18 by source reading]** Rehearsal requires `EXPERTISE_ROSTER_REHEARSAL=on`
(`roster-rehearsal-target.cjs`); it refuses Production, any target but sandbox
`orgd9e66399`, and any Postgres but loopback `127.0.0.1:55439/roster_rehearsal`. Browser
rehearsal additionally requires local non-Vercel `localhost:3000`.

- `roster-sql.cjs` delegates to `@vercel/postgres` when rehearsal is off. Core modules
  now import it: `lib/utils/auth.js`, `pages/api/auth/[...nextauth].js`,
  `lib/services/portal-upload-staging.js`, `pages/api/expertise-finder/history.js`. A
  malformed `EXPERTISE_ROSTER_REHEARSAL` value (not unset/empty/`off`/`on`) throws on every
  query through these paths, including sign-in, and in every consumer that calls
  `rehearsal.enabled()` (roster, match, batch match, consultant feedback, recipient
  directory). Release review item.
- Dataverse client/read-ops/changeset changes are opt-in options (`strictRead`,
  `strictPagination`, `noFallback`) or sandbox-only inactive create.
- Ungated: `expertise-finder.match.roster-v2` in the static Admin prompt catalog (tests
  exclude it; see handoff); `usage-logger.js` failure containment and Blob-missing
  detection in upload staging (bug fixes); recipient-warning props in Workbench/meeting
  components (render only when the API sends warnings).
- The roster tab's new deactivate/reactivate control sends `PATCH {id, etag, is_active}`
  (`pages/expertise-finder.js:360`); the legacy route's PATCH field list includes
  `is_active` (`pages/api/expertise-finder/roster.js:311`). Not exercised end to end.

## Work packages (plan §7)

| WP | Scope | Status |
|---|---|---|
| 1 | Schema spec + inventory | **[RECORDED]** spec `wmkf_expertiseprofile.json`; sandbox provisioned with three Active keys, audit, concurrency (**[RE-VERIFIED 11-18 via work-Mac probe]**). Production absent (**[RE-VERIFIED 11-18]**). |
| 2 | DAL/service + identity bridge + recovery | **[RECORDED]** adapter, roster/consumer services, allocator, write admission, disposable-schema phase commands, rollback reconciliation; Opus READY. `identity-bridge.sql` is unnumbered and outside migrations. |
| 3 | Editor + dependent read/write paths | **[RECORDED]** roster API, editor, matching, feedback, recipient directory on the rehearsal seam; signed-in browser walkthrough and linked-Contact run. **[RE-VERIFIED 11-18]** No non-rehearsal Dataverse path exists: each consumer branches on `rehearsal.enabled()` and then `assertTarget()` pins sandbox (`roster.js:107-108`, `match.js:57,85`, `batch-match-service.js:68,154`, `consultant-feedback-service.js:51`, `recipient-directory-service.js:30`, `roster-service.js:20`). |
| 4 | Sandbox import, E2E, rollback rehearsal | **[RECORDED]** full import 39 profiles, stable replay; rollback on disposable schemas only. Old-code writer freeze, admission/drain, interrupted-import and refresh scenarios: not recorded as run. |
| 5 | Production release | Not started. Needs owner go. |

## Remaining before any Production cutover

1. **Production runtime mode.** Decide how the app selects Dataverse outside rehearsal
   (today only the rehearsal flag routes to it), then build and test that path.
2. **Migration numbering** for `identity-bridge.sql` (inert DDL), manifest and
   fresh-install shape, against the live `schema_migrations` ledger.
3. **Operational cutover script against a real (non-disposable) target**: public phase
   execution is refused today.
4. **Admission/drain** across all old deployments (plan §5C); platform mechanism unverified.
5. **Direct-CRM writer control** and old-code Preview writer freeze rehearsal.
6. **Release review items** above (rehearsal-flag fail mode in auth; Admin catalog entry).
7. **Docs at implementation**: Atlas, route security matrix, service catalog.
8. ~~Re-run Docker-backed suites~~ **[RE-VERIFIED 11-18]** All seven
   `tests/integration/roster-*.pg.test.js` suites pass (65 tests) on the merged tip against
   container `wmkf-roster-full-import17-20261110` (Colima). Public fixture counts unchanged
   (39 roster, 40 identity, 39 binding, 9 feedback). One disposable schema
   `roster_rehearsal_6b3775c8…` exists; its origin (pre-existing or from this run) is unknown.
   Left in place.

## Recommendations-only direction (Power Automate plan slices 0–5)

Slice 1 (pure contract, freshness comparator, output-schema builder) is **[RECORDED]**
built with no production caller. Slices 2–5 depend on the shared Executor/PA backend on
`codex/executive-summary-generation-2026-11-16`, which `main`'s handoff parks pending an
**owner decision**. Treat it as an owner gate, not a next task.
