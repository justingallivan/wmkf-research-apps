# Session 584 Prompt: Proposal Ranking owner choice pending

## Session 583 Summary — ranking branch continuation, 2026-10-07

[VERIFIED via Git] Resumed the existing ranking worktree and merged the 23 incoming
commits through `origin/main` at `27ed1684d`, without rebasing or rebuilding the app.
Kept this branch's ranking handoff and accepted main's transcript-audit annotations.
Main's unrelated handoff remains available at `git show 27ed1684d:SESSION_PROMPT.md`.

[VERIFIED via local commands] Ranking/Explorer regression: 12 suites, 120 tests pass.
All 69 local startup check scripts/self-tests passed, with each gate and self-test
run sequentially; the missing per-worktree Claude memory symlink was repaired and
its gate rerun successfully. This includes API routes, Atlas, route lifecycle auth,
and types. The live factory-ledger check was excluded because Production reads
were not authorized for that run; the later narrow Production inventory is below. Claim-evidence report remains unavailable; no observation invented.

[VERIFIED via fresh GET-only sandbox readiness probe] All three entity identities,
fields/bounds and Active keys pass; application role assignment and isolation marker
schemas pass. The uncapped eligible ordinary Phase II Pending SE/MR scan still returns
zero proposals. No default facilitator setting exists. All four readiness switches
are off in this checkout's loaded configuration; hosted Preview settings were not
inspected. No environment settings, grants, source records or ranking rows changed.

Luna reconnoitered and Sol reviewed the merge without substantive blockers.
Review closure and retained evidence are recorded in the Atlas continuation section.
Production was unchanged; a later owner-approved read-only inventory is recorded below.
The app remains disabled. No production
milestone entry is required. Only `codex/proposal-ranking` is authorized for pushing.

### Follow-up: institution East-West metadata found

[VERIFIED via live sandbox metadata] Added and ran
`scripts/probe-proposal-ranking-geography.mjs`: request `akoya_applicantid` links to
`account`; `account.wmkf_eastwest` is the **East-West** Picklist, with
**East = 100000000**, **West = 100000001**. Only metadata GETs were performed.
No business records or Production metadata were read. The subsequent owner-approved
card change carries `institutionGeography` into new frozen snapshots and the preview
fingerprint and displays a prominent E/W at the card's upper right. Missing/unknown
values and older snapshots show no letter; there is no live refresh or backfill.
The implementation uses the same eligibility and ranking rules. Exact evidence and
remaining live-acceptance boundary are in the Atlas geography section. Geography
regression: 123 tests / 12 suites, lint, types and relevant gates/self-tests pass;
synthetic desktop/mobile component render confirms 24px E/W at upper right without
overflow. Luna built and Sol reviewed. The owner subsequently authorized Opus
reviews as needed, through subscription OAuth only (no API-key authentication).
A bounded Opus source review of `d2cc82fdf` returned APPROVE. Its nonblocking
accessibility note was corrected by giving the E/W symbol an explicitly named
image role; the page regression now checks that accessible role/name. No further
review loop was needed. No milestone entry is required.

### Follow-up: ten-color reviewer-rating circle

The owner chose ten approximate rating colors despite varying reviewer counts.
The shared card now adds a 24px solid lower-right circle: red low, yellow middle,
green high, gray unscored. It maps the frozen raw mean from 1–5 to the nearest of
ten steps; numeric score display and all ordering/calculations remain unchanged.
Matching colors do not imply exact ties. E/W remains at the upper right. No source,
configuration or live data changes are part of this UI-only addition. Validation:
126 ranking/Explorer tests, lint, types and relevant gates pass; desktop/mobile
component renders confirm all colors, gray fallback and no overflow. Luna built;
Sol and OAuth-only Opus approved. The hover label uses the same rounding as the
visible score after correcting Opus's nonblocking note. No milestone entry required.

### Follow-up: owner-approved read-only Production inventory

[VERIFIED via `scripts/probe-proposal-ranking-production-readiness.mjs`, GET-only,
2026-10-07] After the owner-approved December-only cutoff, Production has 24 matching
requests: D26 has 23 (11 SE, 12 MR), J26 has one SE. Five D26 SE requests were
excluded from the original 29-row scan. The shared trial cutoff excludes numeric
`akoya_requestnum >= 1003220` for D26 only before downstream reads/new snapshots;
malformed D26 numbers abort. Other cycles and existing frozen snapshots are unchanged.
Both readiness probes use the same rule; existing test-marker exclusion stays intact.
The scan completed without a cap or unmapped meeting dates. Request number,
meeting date and program were selected; no business rows printed.
All three ranking entity metadata lookups returned 404 (`0x80060888`). The exact
application-role query and assignment query returned 200 with no matching role.
No Production writes, provisioning, settings or activation occurred. Exit 2 denotes
missing readiness prerequisites. The Atlas records scope and limits.
Cutoff validation: 134 tests / 13 suites, types and relevant data/documentation gates
and sequential self-tests pass. Luna built; Sol and bounded OAuth-only Opus reviewed
without substantive findings. Production remains unchanged and disabled.

### Owner choice before further work

The sandbox's zero-proposal gap does not apply to Production's D26 source pool.
Production still needs the three dedicated ranking tables and application role;
provisioning requires separate explicit owner approval. Facilitator selection,
participant grants, environment readiness and activation remain separate open work.
Source proposals remain read-only; ranking lists, submissions and meeting order do
persist in dedicated ranking tables. The owner approved only the narrow Production
readiness inventory, not setup or activation. No source creation/copy is authorized.

Private ranking, submission, composite publication, meeting reordering and full-requested
budget totals still need a source-backed, multi-identity in-app walkthrough. Counts
alone do not verify review completeness or full snapshot eligibility. Do not relax
test exclusion or treat D99's retained synthetic snapshot as eligible proposals.
The Session 582 history below remains the implementation and prior live-proof record.

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
