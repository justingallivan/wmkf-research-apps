# Session 684 Prompt: Await Connor’s expertise-plan review; Initial Assessment shipped

## Session 683 Summary — 2026-11-19 (Codex)

### What Was Completed

1. **Initial Assessment shipped to Production.** PR #644 (`2ab19cd5d`) added the
   existing Decline Reason choices and Invite/Decline Notes for Other. Owner-run
   probes identified the fields; the owner subsequently reported all eight options
   verified after provisioning the two overlap reasons and Other. Existing Limited
   impact and Continuation/incremental remain separate. No new memo field was added.
2. **Single Save assessment shipped.** PR #645 (`755e4a96d`) makes Scored/Not Scored
   selection local and immediate, then saves the decision and selected details in
   one staff-attributed, ETag-conditional Dataverse PATCH. Hidden notes and rationale
   are not overwritten. Drafts survive choice/tab switches and save conflicts.
   Changing the decision still requires lead PD or superuser; staff annotation
   permissions and advanced Phase I statuses are preserved.
3. **Redundant View proposal button removed.** PR #646 (`1882697dc`) removed the
   link from the current assessment form. Latest runtime deployment verified Ready:
   `dpl_E3LsnFC1BwUZFuXZA9Qo5HBKEoNA`, with `applications.wmkeck.org` aliased to it.
   Public sign-in returned 200. Authenticated Production save/readback was not run.
4. **Connor discussion plan saved on main.** `8f5c23fc8` added
   `docs/plans/EXPERTISE_ROSTER_POWER_AUTOMATE_PLAN_2026-11-19.md`.
   Proposed approach: read-only roster API feeding Connor’s existing Claude call,
   retaining Postgres as source of truth. No extra Claude call and no migration are
   proposed for that use case. This is a discussion draft, not approved architecture.
5. **Owner explicitly parked expertise integration pending Connor’s review.** No API,
   authentication setup, connector, migration, synchronization, or flow changes are
   authorized to proceed from this draft. The older roster migration branch is
   preserved; reconcile its direction with Connor’s feedback and the owner before
   resuming any expertise integration work.

### Commits

- `1320e432a`, `8cc840ad0`, `c09353afe`: owner-run read-only triage/notes probes.
- `691b3b1be`: scoring-specific rationale and decline reasons; `33a40063c`: main integration.
- `9525a8580`, `f6cd77f13`: navigation fixture corrections; released via `2ab19cd5d` (PR #644).
- `85dd02c57`: combined assessment form/service; released via `755e4a96d` (PR #645).
- `c1e755150`: remove redundant button; released via `1882697dc` (PR #646).
- `8f5c23fc8`: Connor’s expertise access discussion plan.
- This handoff is a docs-only update; runtime changes above were already promoted.

### Verification and Release Evidence

- PRs #644, #645 and #646 passed their complete GitHub checks before merge;
  their Production deployments were verified Ready through Vercel.
- Single-save local verification: 100 Workbench/J27 suites, 1,457 tests; TypeScript;
  relevant API/DAL/security/status/documentation gates and sequential self-tests.
- Independent review found a post-save conflict draft-loss edge case; it was fixed
  and regression-tested, then re-reviewed without remaining blockers.
- Synthetic browser fixture checked Scored and Not Scored/Other at desktop and
  390px width; no horizontal overflow. This is not authenticated Production UAT.
- Button-removal change: 31 affected tests passed, then complete PR CI passed.
- Initial deployment error scans for #644/#645 returned no errors. No claim of
  a long observation window or live Dataverse save rehearsal.
- Prior runtime rollback target for the button removal:
  `https://wmkfresearchapps-lyymk42dm-justin-gallivans-projects.vercel.app`.
  Code rollback does not undo saved assessment data or additive Dataverse options.

## Next Items

### Verified Open

- None assigned by the owner at stop. Await the next instruction.

### Parked — Owner Instruction

1. **Expertise integration until Connor reviews the plan.** Evidence: owner’s explicit
   stop request, 2026-11-19; discussion draft linked above. Reopen only after Connor’s
   feedback and owner direction. Confirm roster fields, lead-PD eligibility,
   identity mapping, connector/authentication, and existing caching arrangement then.
2. **Older roster migration/cutover stream.** Preserve
   `origin/codex/expertise-roster-import-2026-11-10` (fetched tip `754acf09a`). Its
   `SESSION_PROMPT.md` and cutover addendum remain the historical resume sources.
   Do not treat the old “item 4” carryover as an active task while expertise work is
   on hold. No migration, backend switch, or Production cutover authorization is implied.
3. **Backend prompt adoption/scheduling.** Prior owner-parked stream
   `codex/executive-summary-generation-2026-11-16`; no new authorization this session.

### Owner Decisions Preserved — Not Resolved This Session

- Recommendation to Chairs Production stages and paid automatic Integrity Screen:
  each needs its own owner go; do not enable `AUTOMATIC_INTEGRITY_SCREENING` from this handoff.
- Intake prompt choices: rationale versions, flags representation, keywords, and
  open questions in the J27 workbook field map. Connor notification about v2 prompts
  and missing-PI handling was not confirmed sent by this session.
- Feb 24 Grants Manager Phase II Status versus Request Status decision (D39).
- Prior minimatch alert #144 / dependency-upgrade decision and optional local
  Node-version pin: recheck current alerts/source before planning work.

### Verify Before Acting

- Prior Chairs Stage 1, trial batch-2 expiry, real-proposal prompt review, and
  Dependabot/branch-hygiene items are preserved at `8f5c23fc8:SESSION_PROMPT.md`.
  They were not advanced here; verify current source, owner direction, dates, and
  deployment state before treating them as actionable.
- Request 1003528’s status in older handoffs is stale: owner screenshots this session
  showed Scored. No live row probe was run at stop; do not infer its present status
  or run a reset. No Factory run or test-record status mutation was performed by this agent.
- Shared main checkout has unrelated untracked `commit-times-exact.txt` (verified at
  stop). Preserve it. Other agents may have independent worktrees; do not switch or
  clean those checkouts. No worktree or branch deletion is authorized.

### Do Not Reopen Without New Decision

- Do not replace Connor’s existing proposal-processing flow or add a second Claude
  matching call; the proposed integration supplies roster data to his current call.
- Do not migrate all Postgres data as a consequence of this discussion.
- Preserve the older owner decision simplifying roster cutover (no admission/drain,
  writer freeze, phase machine, or automated rollback machinery) if that separate
  direction is later resumed. The current draft does not silently supersede it.
- Factory auto-prepare target remains Invited plus Phase II Pending Committee Review;
  this session did not change that contract.

## Concurrent Workstreams and Preservation

The prior complete handoff is retrievable with
`git show 8f5c23fc8:SESSION_PROMPT.md` (verified at stop). Historical paths and
observations are not current permission or live-state evidence.

| Stream | Owning reference | Latest recorded boundary |
|---|---|---|
| Initial Assessment | PRs #644–#646; `assessment-service.js`, `AssessmentForm.js` | Production-live; authenticated save acceptance still unverified |
| Connor roster access | `docs/plans/EXPERTISE_ROSTER_POWER_AUTOMATE_PLAN_2026-11-19.md` | Parked pending Connor review and owner direction |
| Older roster cutover | `origin/codex/expertise-roster-import-2026-11-10:SESSION_PROMPT.md` | Preserve branch/private inputs; reconcile direction before resuming |
| Chairs Production stages | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Not changed here; owner approval per stage |
| Intake prompt delivery | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Owner-run flow/prompt work; backend adoption remains parked |
| Proposal lists / other agent | Current main and that agent’s owning plans | No ownership assumed; preserve concurrent changes |

Session-owned worktree: `/private/tmp/wmkf-coordinated-start-20261119`.
Documentation destination: main via an isolated docs branch/PR, without changing
another agent’s checkout. Feature branches and artifacts are preserved.

Never set `DATAVERSE_ALLOW_PROD_READS` yourself. Never read main `.env.local`.
Prior private roster inputs remain in owner-managed storage; do not commit them.
Local containers use Colima, not Docker Desktop.

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/components/workbench/AssessmentForm.js` | Local drafts and single Save assessment |
| `lib/services/workbench/assessment-service.js` | Selected-field atomic write, ETag and decision authorization |
| `pages/api/workbench/initial-assessment-rationale.js` | Assessment mode plus preserved legacy editor modes |
| `scripts/extend-request-decline-reasons.mjs` | Owner-run additive choice provisioning, already reported complete |
| `docs/plans/EXPERTISE_ROSTER_POWER_AUTOMATE_PLAN_2026-11-19.md` | Parked Connor review draft |

## Testing and Session Close

```bash
npx jest --runInBand --silent --testPathPatterns='tests/unit/(workbench|j27-)'
npm run check:types
```

Milestone determination: **entry required and added** to DEVELOPMENT_LOG.md,
“Initial Assessment saves decision and rationale together” (Session 683).
CLAUDE.md needs no change: no new root operating convention or API route was introduced.
Claim-evidence pilot report was attempted with `--current`; local observation state
was unavailable. No observation-table row was fabricated. No memory router edits
were made in this session.
