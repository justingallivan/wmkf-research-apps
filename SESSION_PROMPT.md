# Session 582 Prompt: Proposal Ranking sandbox schema ready; rehearsal data pending

## Session 581 Summary — 2026-10-07 (Codex)

Owner-approved Proposal Ranking was built on `codex/proposal-ranking` in the
isolated worktree. Luna performed reconnaissance/build work, Sol reviewed its
slices, and the orchestrator integrated and corrected the implementation. Claude
Opus reviewed through subscription OAuth only: R1 requested four concrete fixes;
R2 approved with a nonblocking validation-message note, which was corrected.
No Fable was used. Subsequent sandbox provisioning and live-field corrections are
recorded in `docs/audits/PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md`.
The app remains disabled; production is unchanged.

### Completed source

- Separate `/proposal-ranking` app with private SE/MR PD orders, external-review
  seed, explicit locked submissions, equal-average composites, named ranks and
  disagreement, facilitator publication, shared meeting edits and full-requested
  cumulative budgets.
- Frozen eligible ordinary Phase II Pending pool and roster, ETag changesets,
  operation receipts, filtered private responses, uncertainty recovery and scope
  guards. Exceptional excusal, unpublished cancellation and facilitator transfer.
- Three Wave 32 Dataverse table definitions, dedicated application role, exact-on
  readiness, Admin default-facilitator picker, generic-reader metadata privacy.
- Atlas, API matrix, service catalog, app/route registration, canonical counts,
  reviewed design/API contract, and full Opus source-review receipt.

### Commits

- `042ec90b0`: reviewed product/design contract.
- `5279c92cc`: owner-approved transcript-doc gate annotations.
- `35052a7c0`: deterministic ranking calculations.
- `f1b812d86`: frozen source preview and persistence schema.
- `27c942c10`: ranking and meeting interface.
- `1d2a721cb`: direct/indirect generic-reader privacy.
- `a1f4e0f4e`: authorized lifecycle, recovery, Admin and reviewed corrections.
- Final receipt/message-tag and handoff documentation follow these commits.

## Verified open — operator-controlled activation

Source evidence and exact steps: `docs/atlas/dataverse-proposal-ranking.md`.
Sandbox schema/role provisioning is complete and readback passed: three tables,
expected fields/bounds, three Active alternate keys and app-only role assignment.
The complete eligible-source scan returned zero proposals. Owner was asked whether
to prepare a sandbox-only rehearsal set or supply a cycle; no data was seeded.
Actual Beth Pruitt identity selection and app grants, readiness configuration,
relevance-search exclusion, ordinary-staff direct-table denial and multi-identity/
live-concurrency rehearsal remain unperformed.
No production read, write, deployment or activation is authorized by this handoff.
Owner performs deliberate promotion after the rehearsal evidence is reviewed.

## Testing and review evidence

`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md` records the
review text, accepted corrections, local build/tests and bounded evidence limits.
Canonical production build passed after the source corrections. The two live-source corrections passed 110 tests
in 10 suites plus lint/type/data gates and Sol/Opus review. Full GitHub Jest has one
unrelated transcript-card failure, reproduced locally; test/component are unchanged
from main. See sandbox receipt for the exact test and evidence boundary.
Feature/Explorer integration regression command:

```bash
./node_modules/.bin/jest --runInBand tests/unit/proposal-ranking-*.test.js tests/integration/dynamics-explorer-tool-serialization.test.js
```

The task worktree has its own local dependency copy because Turbopack rejects a
node_modules symlink outside its root. No package/lockfile changes were made.
The original checkout and its unrelated dirty lockfile were left alone.
Claim-evidence pilot report was unavailable (local observation state unreadable);
no invented observation row was added. No production milestone entry was required.

## Other workstreams

Prior transcript/summary UX and Final Writeup handoff context is preserved at
`git show fc56ca483:SESSION_PROMPT.md`. Those items were not reverified or advanced
by this ranking build; read current owner/source evidence before resuming them.
Do not carry forward destructive cleanup instructions without fresh verification.
