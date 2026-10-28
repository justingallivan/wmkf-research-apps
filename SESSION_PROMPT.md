# Session 646 Prompt: Codex ranking work complete; J27 remains with Claude

> **Latest Claude handoff (Session 647, 2026-10-28) is on branch
> `claude/j27-ai-materials-names`:** `git show origin/claude/j27-ai-materials-names:SESSION_PROMPT.md`.
> Session 646 recorded the Oct 28 J27 meeting (alignment log D22–D42) and added
> `scripts/probe-request-grant-cycle-lookup.cjs` here on `main`. The Codex
> handoff below remains current for ranking and Board archival.

## Session 645 Summary (Codex, 2026-10-27 Pacific)

[VERIFIED via merged PRs, successful Vercel production deployments and signed-in
production checks.] Ranking meeting locks and saved-cycle access are released.
The owner ended Codex work to avoid overlap with Claude: let Claude finish the
J27 planning and implementation. No J27 UI or state-model code was changed here.

### What Was Completed

1. **Ranking lock/unlock — DONE, production.** PR #536 merged as `379cf81485`.
   Captured facilitators and superusers with app access may lock/unlock after
   reveal. All other workflow mutations, including resets/restarts, are blocked
   while locked. Existing Dataverse workflow JSON, audit log, history and atomic
   receipts retain actor/time and final collective work; no schema change.
2. **D26 meeting locked — DONE, owner-authorized production action.** The signed-in
   UI records Justin Gallivan at **2026-10-27 17:20:08 Pacific**. Reload preserved
   the lock. Workbook download was a valid XLSX with 23 group rows and 92
   individual-assessment rows. It remains in the owner's Downloads folder; no
   workbook, private data or credentials were committed.
3. **Past-cycle loading incident — FIXED, production.** PR #537 merged as
   `0a4702cac`. The original coordinator read lacked the shared paginated
   reader's required filter; runtime logs proved that failure. Filtering on
   `wmkf_activeroundid ne null` fixes discovery without bypassing the guard.
   A real-reader/mocked-HTTP regression test fails without the fix and passes
   with it, including pagination and read-only behavior.
4. **Production verification — DONE.** Deployment
   `dpl_Hx4bL2cxJNMqisPVB75gWQ5wZT2d` is Ready on the production aliases at
   `0a4702cac`. Signed-in cycle discovery no longer shows the error; J27 loads
   its empty pool and switching back restores D26. The original D26 lock text,
   actor/time and all 23 proposal IDs in order match the pre-fix baseline.
   Export remains enabled; new-deployment ranking GET/POST requests returned 200.
5. **Independent reviews — DONE.** Claude Opus 5.5 reviewed both runtime changes
   through the owner's OAuth/subscription session. The first review required a
   non-roster actor-display fix; the follow-up approved. The cycle-filter fix
   was also approved. No agent API-key fallback or Ultrareview was used.

### Commits / Releases

- `1f34948ca` — ranking lock/unlock and past-cycle access.
- `0caaf9dd8` — duplicate test import found by full CI lint; fixed before merge.
- `379cf81485` — PR #536 merge and production release.
- `e91abaa16` — filter saved ranking cycles before the paginated Dataverse read.
- `0a4702cac` — PR #537 merge and production fix.

## Next Items

### Verified Open

No further Codex ranking build is queued. Resume only on a new owner request.

### Owner Decision / Handoff Needed

**J27 belongs to Claude.** Owner direction at stop: let Claude finish to avoid
parallel work on the same decisions. The latest inspected owner branch was
`claude/j27-ai-materials-names` at `f4f426c1a`; its alignment log includes D13–D17
and supersedes older September triage/advance assumptions. Recheck that branch
and get an explicit ownership handoff before Codex edits J27 plans or runtime.
Do not copy that branch's unmerged runtime merely to update documentation.

### Parked

- Research request corpus follow-up remains Claude-owned and requires its own
  owner authorization; see its plan and the preceding handoff snapshot.
- Reviewer-save recovery follow-up was unconfirmed in the preceding handoff;
  no new authorization was given here. Do not auto-resume it.

### Verify Before Acting

- Do not unlock, reset, restart, replace or archive D26 as a test. Its current
  production lock is deliberate. Real lock enforcement requires the released
  code; old code does not enforce the additive JSON flag after rollback.
- Board archival is separate from ranking finalization. Preserve its retained
  rehearsal receipts/output and prior safety constraints; no D26 archival,
  release, deletion or notification is authorized by this handoff.
- The older handoff is retrievable exactly with
  `git show 0a4702cac:SESSION_PROMPT.md`. It preserves the Board archival record,
  unresolved J27 owner decisions, corpus scope and previous safety constraints.
  Its proposed next steps must be rechecked against Claude's newer work.

### Do Not Reopen Without New Decision

Ranking locks, actor attribution, saved-cycle discovery and the D26 lock/export
checks are DONE. Do not carry them forward as unbuilt work.

## Concurrent Workstreams

| Owner / workstream | Resume boundary |
|---|---|
| Claude — J27 alignment, AI Materials and intake decisions | Owning branch `claude/j27-ai-materials-names`; `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`; latest inspected `f4f426c1a`; ongoing, Codex yielded |
| Codex — ranking locks / saved-cycle access | Runtime merged in #536/#537; no open runtime WIP |
| Codex — this handoff | Docs-only branch `codex/session-645-handoff`, based on released main `0a4702cac`; prepared as a separate PR, not permission to merge or deploy it |
| Claude — research request corpus | `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`; next scope owner-gated |
| Board archival readiness / rehearsal | Prior handoff snapshot and `docs/audits/BOARD_ARCHIVE_REHEARSAL_2026-10-27.md`; no new archival development or live action queued |

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/proposal-ranking/workflow-service.js` | Authorization, lock metadata/audit, round-fenced writes and privacy |
| `lib/services/proposal-ranking/workflow.js` | Pure lock/unlock transitions and mutation blocking |
| `lib/dataverse/adapters/proposal-ranking.js` | Filtered saved-cycle reads and conditional persistence |
| `shared/components/proposal-ranking/AssessmentWorkflow.js` | Lock status, confirmations and read-only view |
| `docs/guides/PROPOSAL_RANKING_LISTS.md` | Staff instructions and storage/retrieval limits |
| `docs/atlas/dataverse-proposal-ranking.md` | Production storage and release evidence |

## Testing and Closeout

- All PR checks passed before each merge, including canonical production builds.
  #536: 25,936 tests plus 152 Postgres integration tests passed (298 skipped in
  the main suite). The final focused ranking run for #537: 25 suites / 295 tests.
- Types, changed-file lint and sequential DAL/OData/GUID gate/self-tests passed
  for the filter fix; the earlier feature also passed the broader scoped gates.
- Production checks used the signed-in app. The only ranking mutation performed
  was the explicitly authorized D26 lock; no unlock or re-ranking occurred.
- Milestone determination: entry required and added to `DEVELOPMENT_LOG.md` for
  production ranking finalization and retained-cycle access.
- `CLAUDE.md` and memory files were unchanged. The claim-evidence pilot report
  was attempted normally and outside the sandbox; both reported local state
  unavailable. No observation row was added because eligibility could not be established.
- Claude's original checkout and its tracked/untracked WIP were left untouched.
