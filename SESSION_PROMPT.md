# Session 583 Prompt: Proposal Ranking walkthrough and activation pending

## Session 582 Summary — 2026-10-07 (Codex)

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

### Latest session commits

- `458d7248f`: merged main into the isolated feature branch.
- `8d8b10872`: sandbox schema/role evidence and live source-field corrections.
- `8be9f57a1`: ETag normalization fix and successful bounded persistence rehearsal.
- `3f5c6cf10`: reproducible GET-only staff privacy proof and documentation.
- Session-close documentation follows these commits; all work stays on
  `codex/proposal-ranking`, draft PR https://github.com/justingallivan/wmkf-research-apps/pull/457.

### Earlier implementation commits

- `042ec90b0`: reviewed product/design contract.
- `5279c92cc`: owner-approved transcript-doc gate annotations.
- `35052a7c0`: deterministic ranking calculations.
- `f1b812d86`: frozen source preview and persistence schema.
- `27c942c10`: ranking and meeting interface.
- `1d2a721cb`: direct/indirect generic-reader privacy.
- `a1f4e0f4e`: authorized lifecycle, recovery, Admin and reviewed corrections.
- Final receipt/message-tag and handoff documentation follow these commits.

## Next items — verified open

Source evidence and exact steps: `docs/atlas/dataverse-proposal-ranking.md`.
Sandbox schema/role provisioning is complete and readback passed: three tables,
expected fields/bounds, three Active alternate keys and app-only role assignment.
The complete eligible-source scan returned zero proposals. The owner chose a minimal
rehearsal restricted to the new ranking tables. D99 now retains two synthetic cards
in its snapshot only; no source proposals were created or changed. Initialization,
conditional save, stale ETag rollback and duplicate-key rollback passed. Search
status confirms the three entities absent from the sandbox search index. The follow-up
GET-only probe verified effective staff identity via EqualUserId and denied all
three exact fixture reads with 403 under both impersonation headers, with app-200
controls and absent effective Read privileges. WhoAmI returned the app identity
even under effective impersonation; do not use it as that identity assertion.
Bounded proof: `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`.
Actual Beth Pruitt identity selection and app grants, readiness configuration and
multi-identity browser rehearsal remain unperformed. Do not recreate the D99 fixture.
Evidence and retained IDs: `docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md`.
Luna corrected the processed ETag adapter contract; Sol and bounded OAuth Opus
approved. No new production milestone entry is required.
No production read, write, deployment or activation is authorized by this handoff.
### Next session: in-app walkthrough

[VERIFIED OPEN via Atlas and rehearsal receipts] Configure the verified facilitator
identity and participant app access in the approved environment, then walk through
private ranking, submit, composite generation/publication, meeting reordering and
budget totals. The sandbox has zero eligible ordinary source proposals; resolve
that acceptance-data limitation before claiming an end-to-end live meeting. Do not
silently create or copy source proposals, relax test exclusion, or reuse the D99
storage fixture as a valid source-backed round.

### Owner decision needed

Deliberate production promotion/activation remains pending after acceptance evidence
and current-head CI review. No production action is inferred from this handoff.

### Do not reopen without a new decision

No realtime infrastructure, ranking notes, combined SE/MR list, funding writeback,
or changes to existing proposal fields. Continue Luna build/recon → Sol review →
orchestrator final review → bounded Opus OAuth review when further builds are needed;
no Fable or API-key agent sessions. Avoid review churn over minor improvements.

### Key files

- `docs/atlas/dataverse-proposal-ranking.md`: current activation checklist.
- `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`: bounded privacy evidence.
- `scripts/probe-proposal-ranking-staff-privacy.js`: repeatable GET-only proof.
- `scripts/probe-proposal-ranking-persistence.js`: retained D99 storage rehearsal;
  do not repeat its write mode.

Local `/private/tmp` receipts are not portable between Macs. Retained record IDs
and sanitized results are checked into the audit receipts; if re-running a probe
on another machine, reconstruct only its required receipt input from that evidence,
then verify the target and rows by GET. Never copy credentials between machines.


## Testing and review evidence

`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md` records the
review text, accepted corrections, local build/tests and bounded evidence limits.
Canonical production build passed after the source corrections. The two live-source corrections passed 110 tests
in 10 suites plus lint/type/data gates and Sol/Opus review. The earlier full GitHub Jest run had an unrelated transcript-card failure. The later
run at `8d8b10872` passed (run `37698207467`); no transcript runtime changes were made
here. The ETag correction and rehearsal pass 116 tests in 12 suites, plus lint and
the DAL gate/self-test. Full GitHub Jest also passed at `8be9f57a1`.
The follow-up GET-only privacy probe passed live, with 9 focused safeguard tests
and relevant documentation gates/self-tests passing. New commit CI is separate.
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
