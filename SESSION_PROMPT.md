# Session 495 Prompt: Reconcile the Cycle Dossier Grant Program design

## Session 494 Summary

Session 494 worked on `codex/compact-controls` in
`/Users/gallivan/Code/WMKF_Apps/.claude/worktrees/compact-controls`. It completed compact Request
Locator controls, corrected cycle derivation to use meeting dates, hardened aggregate completeness,
added bounded Workbench text-search support, and tested a temporary Research-only scope. The owner
subsequently clarified that the hard-coded Research scope is not the intended product design. Do not
promote this branch unchanged.

The next owner is the Cycle Dossier session. Its first task is design reconciliation, not immediate
implementation: the Request Workbench needs a live **Grant Program** dropdown that defaults to the
signed-in PD's program and allows selection of other programs. Keep the owner's existing direction
that off-cycle meetings do not appear in this Workbench cycle view unless the owner revises it.

### What Was Completed

1. **Compact shared Request Locator filters**
   - `58f0a191` adopted the compact `ToolbarSelect` treatment for cycle and status, retained native
     select keyboard behavior, added loading/disabled/error recovery, and versioned local cache
     handling.
   - The compact UI and error/retry behavior are complete and are candidates to retain.

2. **Meeting-date cycle correction and complete aggregation**
   - `9cab8c3e` changed Workbench cycle options from sparse `akoya_fiscalyear` values to UTC-grouped
     `wmkf_meetingdate` values.
   - `3472367c` raised the aggregate bound to 5,000 groups and rejects continuation metadata, a full
     page, malformed rows, or other incomplete results instead of presenting a partial timeline.
   - The branch currently offers June/December cycles and omits off-cycle/no-date groups.

3. **Temporary Research-only request discovery**
   - `9cab8c3e` first supplied the two canonical Research program IDs to cycle aggregation.
   - `889ddf2b` introduced `shared/config/researchPrograms.js` and extended hard-coded Research
     filtering across Request Locator options/search, dashboard visibility, canonical hydration,
     PI joins, cache behavior, copy, and tests.
   - This scope is **OWNER-SUPERSEDED as a final design**. Replace it with a live Grant Program
     selector only after verifying the program data source and defaulting contract.

4. **Guarded Dataverse Search transport and tooling**
   - `4fdd8217` classifies only exact normalized `POST /api/search/v1.0/query` as an interlocked
     semantic read. Every other POST path remains a write; local/Preview reads from production still
     require `DATAVERSE_ALLOW_PROD_READS=yes`.
   - The commit also adds guarded Quick Find view probe/apply tooling and tests. The apply tool is
     dry-run by default.

5. **Safe outside-program acknowledgement**
   - `903de6b9` makes an exact numeric search acknowledge a valid request outside the temporary
     scope with only its request number and program, then recommends AkoyaGO. It exposes no request
     GUID, title, institution, PI, status, cycle, or Workbench link.
   - Signed-in local smoke: `1003278` showed `Directors' Directed Grant Program` plus the AkoyaGO
     instruction; Research request `1002915` still navigated to Workbench detail.

6. **Impeccable documentation repair**
   - `9ecdab1b` refreshed `.impeccable/design.json` generation metadata. `DESIGN.md` was unchanged;
     schema v2 and the design contract remained consistent.

### Commits

The feature-work range before this stop handoff is `58f0a191^..9ecdab1b` (equivalently
`30ef052b..9ecdab1b`):

- `58f0a191` — Unify compact request filters and add load recovery
- `9cab8c3e` — Use meeting dates for workbench cycle options
- `3472367c` — Keep meeting-date cycle options complete and restriction-checked
- `889ddf2b` — Scope Workbench discovery to Research programs and regular meeting cycles
- `4fdd8217` — Allow guarded Dataverse Search reads
- `903de6b9` — Explain requests outside the Research suite
- `9ecdab1b` — Refresh Impeccable design sidecar

The stop-time documentation commit follows these commits at the branch tip.

## Next Items

### Owner-Directed Design Reconciliation

1. **Replace the hard-coded Research scope with a live Grant Program selector before release.**
   Evidence: owner direction 2026-09-08; `docs/REQUEST_WORKBENCH_SCOPING.md` §3.1;
   `docs/plans/REVIEWER_UI_SURFACING_HANDOFF_2026-09-er.md` Issue 2; temporary implementation in
   `shared/config/researchPrograms.js`, `lib/services/workbench/request-search-service.js`, and
   `lib/services/workbench/dashboard-service.js`.
   Required outcome: load Grant Program options live, default to the signed-in PD's program, and
   allow other-program selection. Reconcile option loading, cycle/status dependencies, dashboard
   and text-search predicates, exact-number behavior, UI copy, cache migration, and tests together.

### Verify Before Acting

1. **Signed-in PD → program default source.**
   The owner specified the behavior, but this session did not verify whether the canonical source is
   the PD resolver, system-user profile data, program-director assignments, or another Dataverse
   relationship. Trace the authenticated caller through the dashboard/search services before design.

2. **Live Grant Program option source and eligibility.**
   Do not treat `RESEARCH_PROGRAM_IDS` as the permanent list. Verify which Dataverse entity/query
   produces the selectable live programs, whether inactive programs are excluded, and whether all
   programs or only Workbench-compatible programs belong in the dropdown.

3. **Non-PD fallback and dependent filters.**
   The default for CSO, President, superusers, or staff without a PD program is unverified. Decide
   the fallback and whether changing Grant Program reloads cycle and status options before coding.

4. **Off-cycle behavior.**
   The owner said off-cycle meetings should not appear in this Workbench view. The branch removes
   off-cycle/no-date values from the cycle picker, while unrestricted text search may still find such
   records inside the temporary program scope. Reconcile whether the new program selector should
   exclude those requests entirely or only omit those cycle choices.

5. **Bounded Dataverse Search candidate window.**
   Text search hydrates at most the top 100 indexed candidates and filters canonically afterward. A
   broad query can therefore omit eligible matches below the candidate window. The UI warns when
   capped; no full-production completeness proof exists.

6. **Quick Find metadata update remains blocked.**
   The `akoya_request` Quick Find view lacks `akoya_programid`. Two authorized production PATCH
   attempts failed with HTTP 400 / Dataverse `0x80040216`; readback was unchanged and PublishXml was
   never called. Do not retry blindly. Ask the owner before opening or inspecting Power Apps or any
   similar admin interface; the owner does not believe they have credentials.

### Retain Unless Review Finds a Defect

1. Compact Request Locator select styling and load recovery from `58f0a191`.
2. Meeting-date rather than fiscal-year cycle derivation from `9cab8c3e`.
3. Complete-or-error aggregate behavior and restriction checks from `3472367c`.
4. Exact Dataverse Search semantic-read interlock classification from `4fdd8217`.
5. Minimal outside-program acknowledgement pattern from `903de6b9`, adapted to the selected-program
   model if still useful.
6. Impeccable sidecar refresh from `9ecdab1b`.

### Revise Before Promotion

1. Hard-coded program list and predicates introduced by `9cab8c3e` and `889ddf2b`.
2. Research-specific Request Locator heading/copy, cache key, option contract, and regression fixtures.
3. The outside-program definition in `903de6b9` so it follows the selected live program rather than a
   fixed Research suite, if that matches the approved design.

### Do Not Reopen Without New Authorization

1. Do not merge, promote, deploy, or change production from this handoff.
2. Do not retry the Quick Find metadata PATCH or publish Dataverse customization.
3. Do not inspect Power Apps or another admin interface without asking the owner first.

## Live External State

- Read-only production and sandbox Dataverse probes were run for Workbench search and Quick Find
  metadata.
- Two explicitly authorized production Quick Find PATCH attempts failed. Exact readback proved the
  view was unchanged; PublishXml was never called.
- Power Apps was viewed earlier in the session; nothing was changed.
- No branch deployment, merge, promotion, database migration, or successful production write occurred.
- A signed-in local dev server at `http://localhost:3000/workbench` was used for smoke testing; local
  browser observations are not production evidence.

## Key Files Reference

| File | Purpose / handoff note |
|------|-------------------------|
| `shared/components/ToolbarSelect.js` | Shared compact/native select primitive; retain. |
| `shared/components/workbench/RequestLocator.js` | Compact controls, cache, search UI, and temporary Research copy/scope behavior. |
| `shared/config/researchPrograms.js` | Temporary hard-coded Research IDs; revise as part of live program design. |
| `shared/config/granteeResearchPrograms.js` | Awardees compatibility re-export; do not casually broaden its separate eligibility contract. |
| `lib/dataverse/adapters/grant-request.js` | Meeting-date aggregate and caller-supplied canonical hydration filters. |
| `lib/services/workbench/request-search-service.js` | Search options/results, temporary Research predicates, candidate hydration, and outside-program lookup. |
| `lib/services/workbench/dashboard-service.js` | Temporary Research visibility predicate affecting Reviewer follow-up feed/cycles. |
| `pages/api/workbench/search-requests.js` | Read-only Request Locator API contract. |
| `lib/dataverse/core/interlock.js` | Exact Dataverse Search semantic-read classification. |
| `scripts/probe-request-search-index-config.mjs` | Read-only Quick Find inspection. |
| `scripts/add-akoya-request-programid-quick-find-column.mjs` | Guarded dry-run/apply tool; apply path is blocked pending diagnosis. |
| `docs/plans/REVIEWER_UI_SURFACING_HANDOFF_2026-09-er.md` | Detailed implementation, evidence, defects, and retain/revise guidance. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | Canonical Workbench design now records the live Grant Program selector direction. |

## Testing and Gates

During implementation, 235 focused regression tests passed across Request Locator, Workbench search
service/route, dashboard integration, meeting-date aggregation, adapter hydration, Awardees/export/cron
consumers, and reviewer-authorization/initial-assessment consumers. The final outside-program slice
reran 63 focused tests successfully. Focused ESLint passed. The relevant API-route, route-service,
Dataverse DAL, context-boundary, OData, GUID, Atlas, and interlock gates and their paired self-tests
passed. The Impeccable sidecar parsed as schema v2 and its drift detector returned no findings.

Stop-time checks passed: agent invariants, docs catalog, doc currency plus self-test, fact consistency
plus self-test, document-symbol references plus self-test, memory drift, memory health, and memory
router plus self-test. Memory health remained advisory-only with ten existing routed files flagged;
the edited reviewer-apps memory was already routed. The claim-evidence pilot report was attempted and
was unavailable because local state could not be read; no observation row was invented.

## Handoff and Milestone Determination

Owner: Cycle Dossier session after this handoff. Codex releases ownership of the compact-controls,
Workbench filter/search, and handoff-document surfaces when the branch is pushed. No repository lock
file or other coordination lock was found.

No `DEVELOPMENT_LOG.md` milestone entry is required: this branch was not merged or deployed and did
not create a production capability, cutover, architecture, incident outcome, or removal.
