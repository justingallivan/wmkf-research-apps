# Session 663 Prompt: Funding history released; resume owner-selected work

## Session 662 Summary — Codex, 2026-11-03 Pacific

Institutional Funding History in the initial Draft writeup now applies the
owner-approved award scope consistently to its count, dollar total and most
recent grant. **[VERIFIED via GitHub and Vercel]** PR #629 merged as `b16078551`;
Production deployment `dpl_2FHnvWzgb6W3svPkr2T8MNKvA3ux` reached Ready and served
the production aliases. Documentation follow-up `2cba25544` also reached Ready
with the same runtime at `wmkfresearchapps-9tt15znbc-justin-gallivans-projects.vercel.app`.

### What Was Completed

1. **Live field/value investigation.** [VERIFIED via read-only Production
   metadata and records] WMKF Request Type `wmkf_request_type = 100000001`
   means Request; it is distinct from vendor `akoya_requesttype`. Type is the
   actual `_wmkf_type_value` lookup. Research is a broad Grant Program;
   Undergraduate Education - Science & Engineering is an internal Program,
   distinct from Undergraduate Education - Liberal Arts.
2. **One qualifying population.** For the exact applicant account and positive
   grant amount, require WMKF Request Type Request, actual Type Program, and
   broad Grant Program Research OR internal Program Undergraduate Education -
   Science & Engineering. First reconcile the full positive Program population
   against account count/sum rollups; only then narrow all three sentence inputs.
   Most recent uses decision date, else a Month YYYY fiscal-year label; no
   meeting-date fallback. No schema, configuration or data migration was needed.
3. **Claude review recommendations implemented.** Positive and zero-history
   wording name the scoped programs; the second sentence says "most recent of
   these grants." Exclusions are logged as counts by reason, with no names,
   content or IDs. Missing classifications remain excluded, not newly blocked.
   Removed unused qualifier logic and stale comments. The read-only diagnostic
   shares runtime name/date formatting, continues after failures, and counts
   lookup misses/partial failures in its exit status. Claude verified its final
   actionable finding resolved; tests cover the missing-target cases.
4. **Production comparisons.** [VERIFIED via GET-only probe] Wake Forest:
   one qualifying $175,000 award, request 941398, June 1994. Emory: seven
   qualifying awards totaling $8.15 million; one of its eight broad Program
   awards is excluded because WMKF Request Type is missing. No records were
   repaired. These are dated observations, not hard-coded institution totals.
5. **Release and documentation.** PR #629 checks all passed: 27,280 tests
   (329 skipped), 183 Postgres integration tests, build and policy/security
   checks. Local focused coverage: 18 suites / 472 tests. Public homepage
   followed the expected sign-in redirect to HTTP 200; provider/session endpoints
   returned 200. The bounded deployment error scan returned zero records.
   **No Word generation/regeneration or business-data write was performed as a
   release smoke.** Existing Word files and frozen retry snapshots retain saved
   text until deliberate regeneration. Service catalog, lifecycle/schema docs
   and agent wiki record the release.

### Commits

- `3e0922583` — Scope writeup funding history to Research and undergraduate science awards.
- `ba3bd0130` — Address funding history review wording and diagnostics.
- `b16078551` — Merge PR #629 after all checks passed.
- `2cba25544` — Record production release and verification.
- This stop commit records Session 662 and creates the Session 663 prompt.

## Next Items

### Owner Decision Needed

1. **Broader J27 PD workflow.** [VERIFIED via existing owner decision and plan]
   Phase I dashboard/workflow remains deferred for discussion; do not implement
   the old draft presentation choices without settling the actual staff process.
   See `docs/plans/J27_STAFF_AND_REVIEWER_ELIGIBILITY_PLAN_2026-11-02.md`,
   especially Staff list presentation. Some branch-era status labels in that
   plan are stale; they do not establish that reviewer eligibility is unshipped.

### Verified Open — observation, not authorization for new writes

- Funding-history Word generation under the new scope remains unobserved in
  Production. Observe the next authorized natural generation; do not regenerate
  an existing staff-edited document merely to manufacture proof. Emory's missing
  Request Type is visible data-quality context, not permission to repair records.
- Per-reminder history's first natural Production reminder observation remains
  open per `docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md`. The owner deferred
  staged proof; no new sends or fixture mutations are authorized by this handoff.

### Done — do not carry forward as open

- `phase-i.checkin` is deprecated [VERIFIED via Justin's explicit decision,
  2026-11-04]. The shared-prompt plan records this decision; no Connor reply is
  needed to settle its disposition. No live Dataverse retirement or catalog
  edit was performed when recording the decision.
- PR #626 is merged (`626b1d681`) and PR #628 is merged (`3629a33af`), verified
  through GitHub. The previous handoff's merge discrepancies are resolved.
- The main checkout was fast-forwarded to `origin/main`; it is no longer behind
  as described in the earlier handoff. Recheck current branch/status next time.
- Funding-history PR #629 is merged and production-deployed; no promotion remains.

### Parked / Verify Before Acting

- Earlier intake-stage Factory fixtures, real Power Automate assembly/AI testing,
  synthesis, ordinary Contact/honorarium/BILL follow-up and live-record cleanup
  remain outside the prior completed no-payment rehearsal. Reopen only on owner
  direction; the historical source handoff below preserves the full boundaries.
- Other workstreams in the table below were not re-audited. Their resume pointers
  are not a new to-do list or authorization to send, mutate, clean up or dispose.

## Concurrent Streams and Preservation

The complete prior Session 661 / concurrent-Claude handoff is retrievable with
`git show 2cba25544:SESSION_PROMPT.md` (verified readable at this stop). Earlier
shared-prompt decisions remain at `git show a66e09091:SESSION_PROMPT.md`.
Do not append those full handoffs here or infer fresh permissions from them.

| Owner / stream | Resume boundary and authority |
|---|---|
| Codex / J27 Factory | `docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md` and `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md`; completed bounded rehearsal and owner-deferred broader workflow. Full historical evidence/ledger identities remain in the prior handoff and owning receipts. |
| Claude / Preview CSRF | PR #620 and closeout #621 merged; `docs/plans/PREVIEW_ALIAS_CSRF_ORIGIN_PLAN_2026-11-03.md`. No new test writes authorized. |
| Claude / per-reminder history | PR #625 runtime and #628 closeout merged; `docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md` and `docs/atlas/postgres-reviewer-reminder-events.md`. Staged proof owner-deferred; do not reuse or mutate preserved fixtures. |
| Claude / shared prompts | `docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md`; `phase-i.checkin` deprecation is resolved by owner decision 2026-11-04. Smoke/name-length uncertainty and parked catalog/group work need fresh verification before becoming tasks. |
| Codex / Integrity | Session 658 at `git show 9db614417:SESSION_PROMPT.md`; first Dec 1 monthly refresh is future at this stop. Preserve `.integrity-backups/2026-11-02-pre-refresh/`; no restore authorized. |
| Claude / reviewer outcomes and invitations | `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md` and `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; not re-audited here. |
| Codex / terminology | `docs/audits/terminology-completion-audit-2026-11-01.md`; preserve acceptance limits and local colleague brief. |
| Other worktrees/local artifacts | Prior handoff has dated locations; preserve unknown WIP and private rehearsal evidence. No worktree/artifact disposal authorized. |

**Unrelated local changes preserved, owner not established in this session:**
`.codex/hooks.json`, `.github/hooks/impeccable.json`,
`.impeccable/critique/2026-10-19T02-04-42Z__shared-components-board-writeups-boardwriteups-js.md`,
and `output/`. Do not stage, stash, reset or delete them to make the tree clean.
No memory router edits or growth advisories occurred. The claim-evidence pilot
report returned "local state could not be read"; no observation row was invented.

## Key Files and Validation

| File | Purpose |
|---|---|
| `lib/services/pre-site-visit/funding-history.js` | Scope, exclusion counts, identity/date formatting and sentence generation |
| `lib/services/pre-site-visit/proposal-core-service.js` | Full-rollup safeguard, qualifying count/total/latest and count-only logs |
| `scripts/probe-funding-history-rollups.js` | GET-only diagnostic; run with the extensionless Node resolver |
| `tests/unit/pre-site-visit-funding-history-probe.test.js` | Mocked CLI partial-failure and missing-target coverage |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Current funding-history policy, release and proof limits |

Focused tests: `npx jest --runInBand --silent --testPathPatterns='pre-site-visit|presite'`.
Read-only probe: `node --import ./scripts/lib/use-extensionless.mjs scripts/probe-funding-history-rollups.js 'Wake Forest University'`.
Scoped lint/types and sequential gates/self-tests passed; hosted PR CI was green.
CLAUDE.md needed no root-instruction change: no new app, endpoint, schema,
configuration convention or operational script was added.

Milestone determination: **entry added** to DEVELOPMENT_LOG.md for the shipped
scoped Institutional Funding History contract and Production release.
