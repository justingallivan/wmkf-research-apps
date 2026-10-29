# Session 648 Prompt: J27 — cycle calendar live; decide Dec 8 scope and wire date consumers

**Branch:** `main`. Both feature branches from this session are merged
(`claude/j27-ai-materials-names` → PR #541, `claude/cycle-calendar` → PR #542).
Prior handoff, exact: `git show ee9b60154:SESSION_PROMPT.md` (Session 646 J27
meeting answers D22–D42, grant-cycle lookup probe).

## Session 647 Summary (Claude, 2026-10-28)

Shipped two production changes and made one decision that shapes every app's
cycle handling.

### What Was Completed

1. **Startup.** Every `check:*` gate and self-test green; fast-forwarded the J27 branch.
2. **PR #541 merged and deployed** (`41e188eb9`): governed AI Materials reads
   accept either the D26 names or Connor's J27 names (`Project-Narrative_N.pdf`,
   `Bibliography_N.pdf`); both present fails closed. Codex review clean.
3. **Decision D43** (alignment log): Connor added eleven milestone date columns
   to the operations Grant Cycle table (`wmkf_grantcycle`). It is now the
   authoritative home for the cycle dates it carries, **edited from the apps**
   (owner chose app editing over Dynamics), with per-date who/when tracking.
   Supersedes the D10 split. Rows are created when the GOApply portal opens (no
   D27 row expected for a while).
4. **Production table auditing enabled** on `wmkf_grantcycle`
   (`scripts/enable-grant-cycle-audit.cjs`, owner-run; T14). Justin emailed
   Connor.
5. **Cycle calendar shipped — PR #542** (`e8fdcaa07`, deployed):
   - `/cycle-calendar` (Tools menu, any signed-in staff) and Admin → Workflows
     → Cycle calendar. Cycle dropdown (kept in `?cycle=`; default = nearest
     upcoming Board date, so **D26 until Dec 10** — owner kept this), Board date
     read-only, eleven dates, per-date Edit with the native date picker.
   - Edit: superuser or assigned Grants Manager / Program Coordinator (no
     Reviewer app access needed). Saves impersonate with no fallback and are
     refused unless `DYNAMICS_IMPERSONATION_ENABLED=true` (owner confirmed it in
     Vercel Production and made it non-sensitive).
   - "Changed by" from per-row `RetrieveRecordChangeHistory`, shown only when
     the newest audited value equals the shown value; "Recording who made this
     change…" re-checks after a save (audit entries lag the write by seconds).
   - Drafts are bound to the row ETag they were opened on; a conflict closes the
     editor, refreshes and asks to edit again.
6. **Evidence** (all under `docs/audits/`, structure/role-level only):
   table columns + audit settings; audit-history shape (`AuditRecord` present,
   `/audits` by object is 403 — `RetrieveRecordChangeHistory` is the only audit
   read open to the app); editors' privileges (app user, Grants Manager,
   Program Coordinator, owner all Global Read/Write).
7. **Controlled Production test** (owner chose this over the sandbox, which
   could not prove Production privileges/attribution): owner set and cleared
   J27 Proposal Due; both audit entries record Justin Gallivan. J27 is back to
   all null; its audit history keeps those two test entries.
8. **Sandbox schema parity:** the eleven columns were added to the sandbox
   (`orgd9e66399`) via wave0 spec; sandbox has no J/D rows and table auditing
   off (not needed after the venue change).
9. **Reviews:** Codex adversarial reviews ×4 (audit-contract claim refuted with
   evidence; value-match attribution guard; ETag draft binding; conflict
   recovery — the last fix written by Codex at owner request, reviewed and
   mutation-checked by Claude). Full gates (69) and full Jest (26,025) green.

### Commits

`main`: `e68d17d14` D43 docs + probe; `631bf23da` audit enable; `b277e327d`,
`daaf44015` plan review/layout; PR #542 merge `e8fdcaa07` (branch commits
`ea58e26db` … `9073f4ba8`); PR #541 merge `41e188eb9`. Session close: this
commit (handoff, dev log, pilot row).

## Next Items

### Verified Open

1. **Tell Sarah and Duncan the calendar is live.** Evidence: PR #542 deployed;
   page `/cycle-calendar`. Load it once on production first (no save needed).
   Sarah's first real save is the first proof that impersonation records a
   non-superuser (privileges verified; expect it to work).
2. **Decide what the apps build for Dec 8** (carried from S646; owner deferred).
   Evidence: alignment log D37, R-3, D13. Does the apps' Initial Assessment
   still run; how Connor's fitness flag relates to Flagged for concerns (D38,
   F1); who does expertise matching (T8). Sets the Nov 15 scope.
3. **Wire consumers of the calendar dates** (D29, D11, D40, D12; not built).
   Evidence: `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md` §3.6,
   `docs/audits/cycle-settings-audit-2026-10-27.md`. Default-cycle rule
   (lookup first, meeting date fallback; Sarah-controlled landing cycle),
   review filing window, Feb 3 Under-consideration warning, readiness digest.
   Read through `lib/dataverse/adapters/operations-grant-cycle.js`.
4. **Other Nov 15 builds, decided not built** (confirm scope/order first):
   Workbench list incl. Phase I Pending (R-1), J27 Proposal tab (D20/D22),
   triage list (D19/D40; Impeccable first), staff-state field (D41), Triaged →
   Phase I write (D31), Chairs writeup (D21/T11), central reviewer defaults
   (response period, quota — not dates).

### Owner Decision Needed

1. **Which timeline step each new date column represents** (TBD; Sarah, Beth,
   Duncan editing the timeline). Missing columns the apps use: reviewer
   invitation start (filing window), Feb 3 staff deadline, Jan triage
   meetings — add a column, derive, or keep app-side (Justin with Connor).
2. Whether the calendar should edit the Board date (now read-only).
3. Carried: triage-flag criteria (CSO; D38, F1), expertise roster (T8), intake
   prompts (T9/T7), MR/S&E assignment (CSO), Connor's program-at-submission
   field (D30) and files-ready flag (D25), Chairs-writeup review time (T12).

### Parked

1. Research request file corpus (owner-gated). Evidence:
   `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
2. Reviewer-save recovery follow-up; T6 prompts readable to all staff.

### Verify Before Acting

1. Retiring the grantee-title cron (T13): only after the D26 Board meeting and
   the destructive-carryover check.
2. Board archival: operational only; D26 ranking stays locked.
3. Decision-calendar artifact rows: republish only from a fresh `read`.

### Do Not Reopen Without New Decision

1. D1–D43 as recorded through 2026-10-28; calendar default stays nearest Board
   date; calendar venue proof done in Production (sandbox rehearsal
   superseded).
2. Accept-both J27 file naming; 001024 is the Research form; 1003373 is Connor's.

## Constraints

- Production Dataverse/Postgres reads are owner-run with `!`; Production
  writes need the owner plus a dated `DATAVERSE_PROD_WRITE_ACK` passed to the one
  process.
- Pass `DYNAMICS_SANDBOX_URL` inline only; setting it in `.env.local` repoints
  four runtime services to the sandbox.
- Plain item names, not log codes, with Justin and colleagues.
- Leave untracked `output/`, `.impeccable/critique/`, the
  `backup/local-main-slice2-plan-drafts-2026-10-25` branch, and the
  `.codex/hooks.json` / `.github/hooks/impeccable.json` modifications (owner
  unknown) alone.
- Codex rescue delegations whose brief mentions a review need
  `[INTENTIONAL-RESCUE: …]` plus the CODEX RESCUE HANDOFF preface (hook).

## Concurrent Workstreams

| Workstream | Resume boundary |
|---|---|
| J27 alignment / cycle calendar (Claude) | `main`; next: Dec 8 scope, date consumers |
| Ranking (Codex) | Done; PRs #536/#537 |
| Board archival (Codex) | Readiness done; rehearsal runtime only on `codex/board-archive-rehearsal` |
| Research request corpus (Claude) | Owner-gated |

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md` | Calendar plan, evidence, Production test, rollback |
| `docs/atlas/dataverse-wmkf-grantcycle.md` | Operations Grant Cycle table (Atlas) |
| `lib/services/cycle-calendar-service.js` | Calendar read/save, attribution rules |
| `lib/dataverse/adapters/operations-grant-cycle.js` | Adapter (list, PATCH with ETag, change history) |
| `shared/components/cycle-calendar/CycleCalendarPanel.js` | Calendar UI |
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Decisions D1–D43, tasks T1–T14 |
| `scripts/probe-grant-cycle-dates.cjs`, `probe-audit-history-shape.cjs`, `probe-grant-cycle-write-privileges.cjs`, `probe-grant-cycle-history-entries.cjs` | Read-only probes (owner-run) |

## Testing

```bash
npx jest tests/unit/cycle-calendar-service.test.js tests/unit/cycle-calendar-route.test.js tests/unit/cycle-calendar-ui.test.js tests/unit/admin-view-coverage.test.js
npm run check:api-routes && npm run check:atlas && npm run check:j27-register
```

## Verification and Closeout

Milestone determination: DEVELOPMENT_LOG entry added ("Cycle calendar:
grant-cycle milestone dates edited in Dataverse with per-date attribution",
Session 647). No CLAUDE.md change. Claim-evidence pilot: zero recorded events
for session key `9d3ce97f506403a1`; zero-advisory row added.
