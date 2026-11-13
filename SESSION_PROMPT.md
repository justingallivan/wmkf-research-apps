# Session 676 Prompt: Await Connor — Summary offline work complete

## Session 675 Summary (Codex, November 13, 2026)

Owner and authorized documentation destination: Codex on
`codex/power-automate-integration-2026-11-11`.
Worktree: `/private/tmp/wmkf-pa-integration-20261111`; preserve it, but verify paths
on another machine. Session numbering is branch-local. Prior full handoff is
retrievable with `git show 29a61943a:SESSION_PROMPT.md` (verified at stop).
No promotion to main or deployment is authorized by this handoff.

### What Was Completed

[VERIFIED via branch source and offline tests]

1. Settled Summary source: project narrative in `Submission-Documents`; combined
   Narrative-Bibliography PDF is for reviewer matching. Exact candidate filename
   `Project-Narrative_{Request#}.pdf` still awaits Connor's producer confirmation.
   Existing output remains `akoya_request.wmkf_layabstract`, API `lay_abstract`.
2. Built disconnected narrative source adapter with pinned document/PI identity,
   revision checks, bounded PDF preparation and sealed snapshots. No runtime wiring.
3. Restricted initialization-reservation release to registered synthetic tasks in
   environment `test`. Real Summary reservations survive known failures and expiry;
   real Summary initialize admission and publication remain disabled.
4. Built offline staff-edit command helper using synthetic DTO names. Explicit
   save/clear sets a true marker with the original row version; baseline requires
   blank text and an explicit false marker. No actual marker schema or writer wiring.
5. Built composition and recovery rehearsal using real worker/store, isolated local
   PostgreSQL, existing synthetic Summary capability and fake external adapters.
   Covers staff edit/clear races, source drift, duplicate/replayed work, expiry,
   audit failure/uncertainty, response reuse, lease recovery and stale workers.
6. Owner sent Connor both the original test email and separate intake questions.
   Await his answers/results. No live calls, deployment, schema changes or Connor
   fixture changes during this session's offline work.

### Commits

- `18dc6778c` — Summary source decision and staff-edit protection plan.
- `ca32503be` — Offline narrative source adapter and synthetic tests.
- `e7416dd3e` — Permanent non-synthetic initialization reservations.
- `a1e0d36bf` — Offline staff-edit commands and race tests.
- `2d2732e2a` — Summary workflow rehearsal with isolated PostgreSQL.
- `cb83db7e1` — Interruption recovery and stale-worker fencing tests.

## Next Items

### Verified Open — Waiting for Connor

1. Review his completed-job POST/replay/poll results when received. Owner reports
   they are still pending. Evidence: conversation and exact test brief
   `docs/plans/CONNOR_POWER_AUTOMATE_SUBMIT_POLL_TEST_2026-11-12.md`.
   This is completed-job replay, not fresh queued/running transition proof.
2. Use his separate intake answers to prepare the remaining implementation contract.
   Evidence: Summary worker and field plans. Offline testing is complete for the
   agreed scope; do not automatically add more simulations while waiting.

### Owner Decision Needed / External Contract Pending

- Exact first-intake trigger/event identity, ready-flag ordering and reset/resubmission
  behavior. Existing readiness discovery is not an edit-permission gate.
- Narrative producer's exact filename convention.
- External Summary writers/editors and visibility; every manual path must participate
  in atomic text + monotonic-marker writes, including intentional blank clears.
- Actual marker logical name/security/provisioning, explicit-clear UI and eligible
  new cohort. Default false is not proof that historical records were never edited.
- Separate approval for deployment, bounded live trials and eventual scheduling.

Evidence: `docs/plans/PA_EXECUTIVE_SUMMARY_AND_WORKER_PLAN_2026-11-12.md` and
`docs/plans/PA_EXECUTIVE_SUMMARY_FIELD_CONTRACT_2026-11-13.md`; current `worker.js`
rejects proposal initialization and `store.js` keeps proposal admission draft-only.

### Parked

- Runtime Summary admission/source/marker/publication wiring until contracts above
  are settled; no generic mapper or duplicate provider implementation.
- Unattended scheduling, production rollout, Methodology initialization, multi-task
  dispatch and prompt optimization. Existing supervised driver is not a scheduler.
- Reviewer assignment: recommendations only until separately coordinated.

### Verify Before Acting

- Preserve Connor's immutable Preview `dpl_EPwhUcrNtffRY3X6u7bbDrqqobGS`, job
  `7e68cdfe-4dda-47f1-9163-7a3dc4b517f5`, Request 1000339. No fresh key, source edit,
  field clear, worker advancement or scope mutation. Read exact brief before work.
- Recheck branch/worktree, actual grants/expiry, deployment and credentials before
  any future authorized live action. Historic receipts are not current authority.
- Retention cleanup is not authorized here. Verify scope/deadlines against trial
  receipts and Atlas before any later cleanup; permanent receipts must survive.
- Main checkout had unrelated untracked
  `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md`; owner explicitly said
  leave untouched. No main edits or worktree disposal authorized by this stop.

### Do Not Reopen Without New Decision

- Summary source and destination are settled; combined PDF remains reviewer input.
- Preserve staff content and intentional clearing. No automatic regeneration on
  file/prompt replacement, field clearing or a new source-event key.
- Keep one shared Executor. Preserve current staff-draft semantics and Short Title
  pilot isolation. Real Summary initialization is not enabled by these tests.

## Concurrent Workstream Index

| Stream | Recorded owner / resume boundary | Owning reference |
| --- | --- | --- |
| PA / Summary | Codex, this branch, `cb83db7e1`; waiting for Connor | Summary worker plan and this handoff |
| Expertise roster / matching | Earlier branch ownership not freshly audited | `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`; shared task interfaces |
| Request narratives | Original branch cherry-picked/narrowed here; not deployed | `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md`; Summary field contract |
| J27 / other Claude work | Ownership not freshly audited; preserve other worktrees | Prior handoff at `29a61943a:SESSION_PROMPT.md` and owning branch plans |

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/plans/PA_EXECUTIVE_SUMMARY_AND_WORKER_PLAN_2026-11-12.md` | Source/marker decisions, remaining contracts, test evidence and limits |
| `docs/plans/PA_EXECUTIVE_SUMMARY_FIELD_CONTRACT_2026-11-13.md` | Existing output and staff editor contract |
| `docs/plans/CONNOR_POWER_AUTOMATE_SUBMIT_POLL_TEST_2026-11-12.md` | Exact unchanged Connor test |
| `lib/services/prompt-jobs/summary-source.js` | Disconnected narrative adapter |
| `lib/services/prompt-jobs/summary-edit-protection.js` | Pure synthetic-marker commands |
| `lib/services/prompt-jobs/store.js` | Durable reservations and lease fencing |
| `tests/integration/prompt-jobs-summary-rehearsal.pg.test.js` | Composition and recovery rehearsal |
| `tests/integration/prompt-jobs-summary-reservations.pg.test.js` | Real Summary retention via hypothetical SQL receipts |
| `docs/atlas/postgres-prompt-jobs.md` | Ledger ownership/retention |

## Testing and Close

[VERIFIED via local runs] Final four-suite run: 107 tests passed, including 38 real
local PostgreSQL cases (28 rehearsal + 10 reservation) and 69 source/edit-helper
unit cases. Earlier reservation build passed 76 PostgreSQL regressions, including
Short Title store/worker and staff draft paths. Evidence is in the Summary plan.
Scoped ESLint and relevant documentation gates with sequential self-tests passed.
Independent review found no remaining material issues after fixing a test startup
hang. Mutation checks caught removal of the staff marker and reservation guard.

Rehearsal uses synthetic capability/fake extraction, Executor, authorization, audit
and Dataverse. It does not prove real Summary admission, live external behavior,
provider checkpoint-binding validation or OS process-kill recovery. Synthetic known
failures may release slots; companion tests separately prove real Summary retention.
All session-created disposable databases/volumes were removed. The pre-existing
roster database container was untouched. No feature WIP remains.

Claim-evidence report was unavailable: local state could not be read; no observation
row invented. Memory router and CLAUDE.md unchanged. No milestone-log entry required:
this session delivered offline preparation/testing, not a production capability,
cutover or new architecture. Previous milestone history remains in DEVELOPMENT_LOG.md.
