# Session 682 Prompt: Recommendation to Chairs in Production (Stage 1), plus carried prompt items

## Session 681 Summary — 2026-11-18 (Claude)

Owner worked through admin-panel System Alerts, then the Factory and J27 status flow.
Everything below is on `main` and pushed (Production deploys on push).

### What Was Completed

1. **Fable 5.2 reviewed into the model registries** (canary alert "1 newer Claude
   model id need review"). Capability entry mirrors 5.1; pricing $8/$40, cache reads
   0.025x. Fable 5.1 cache-read price corrected to 0.025x (Fable 5 stays 0.1x, per the
   pricing page). The `fable` tier now resolves to 5.2 from the live list; fallback ids,
   the global discovery cutoff and the review-panel seat (pinned 5.1) unchanged.
   New `scripts/draft-model-registry-entry.js --model=<id>` drafts entries (never edits
   source; `reviewedAt: 'UNREVIEWED'` fails `check:model-registry`); runbook
   `docs/MODEL_CHANGE_STRATEGY.md` §5. The alert should auto-resolve at the 2:00 AM canary.
2. **Board-notice false alerts fixed** (alert "D26: board_calendar_unavailable"). The
   alerted notice had been sent Oct 31; sent president notices stay listed hourly and
   `deliverNotice` read the calendar before checking `acceptedAt`. Now it returns first;
   the worker auto-resolves calendar and notice alerts on success. Read-only probe
   `scripts/probe-board-notice-state.mjs [--cycle=D26]` (owner-run, app Postgres).
   Atlas `docs/atlas/postgres-board-writeup-runs.md` updated.
3. **Factory auto-prepare (D72).** When the admin page finishes a production run, Prepare
   for review starts on its own; the Start line warns beforehand (Invited may create a
   draft email and GoApply tracking row; readiness can't be undone). Older or begun runs
   still wait for the button; a Stop during the last step withholds it (Codex P2 fix).
   Codex review run (`/codex:review`, branch vs main). Owner: Connor doesn't need
   unprepared test requests for his flow testing. Runbook
   `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` step 5.
4. **Keywords list source recorded** (Connor via owner): the Keywords table
   `wmkf_programlevel3`, not seeded yet, with grouping columns for reporting. Field map,
   PA handoff and the decision list below.
5. **Plan written** `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md`:
   move the sandbox-only Recommendation to Chairs step, a test-request shortcut to Invited,
   and the automatic Integrity Screen to Production. Owner decisions recorded in it.

### Commits
- `da9eb5492`, `272c3e866`, `6d46ee32b` Fable 5.2 registry review, draft script, pricing fix
- `cb18f4570` keyword list source
- `5e37d9284` board-notice alert fix and probe
- `c843fe0ea`, `cb336d9fa`, `54296ee43`, `1b4519319` Factory auto-prepare (D72), Codex fix
- `281ef706b` Recommendation to Chairs Production plan
- Session close commit (this handoff, pilot observation row)

No DEVELOPMENT_LOG entry: maintenance fixes and a small Factory feature, no milestone.

## Expertise roster migration planning — November 9, 2026

Justin and Codex recovered the earlier roster migration design and settled the
schema decisions with Connor supporting the direction. The implementation plan
is `docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`.
Sandbox schema and foundation rehearsal are now complete; Production runtime
remains unchanged. One profile
per person, no program partition or Short ID, separate lead-PD eligibility,
optional external Contact links, Active/Inactive only, optional preserved
expertise fields, and unchanged editor access are settled. Expertise wording,
scoring and recommendation policy remain deferred. Confirmed mappings: Justin/Jean/John lead eligible, Beth off, Kevin inactive,
Amy staged inactive without a User. See
`docs/plans/data/expertise-roster/OWNER_MAPPING_DECISIONS_2026-11-09.md`. Claude Fable 5.2 reviewed the plan via approved OAuth and returned READY WITH
NAMED CHANGES. The repairs are incorporated; the original review and disposition
are in `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_2026-11-09.md`. Third Fable OAuth review confirmed B1–B5 and all six rehearsal gates resolved.
Its two new cutover findings were addressed in the plan by requiring inert automatic
migrations, a gated operational cutover script, and isolated v2 prompt/admission
controls. Those November 9 reviews were design evidence, not implementation evidence.
The November 10 continuation now builds the allocator and disposable-schema phase
commands; see the bounded implementation status below.
See `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_3_2026-11-09.md`. The final Fable plan check returned READY with no named repairs; see
`docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md`.
Roster continuation is on `codex/expertise-roster-import-2026-11-10` in
`/Users/gallivan/Code/WMKF_Apps-codex-roster-import`, based on repair commit
`e90babb2a`. The temporary worktree disappeared; the pushed checkpoint was preserved.
The branch now includes the file-only planner and a separate sandbox-only import
executor with explicit overrides/exclusions/new-person staging and replay recovery.
The inactive-create repair `83cf6c93c` and owner-approved empty-text normalization
`ab0e0e7e3` passed Fable review. The normalization canary bound the retained inactive
synthetic profile to local roster ID 5; COMMIT and replay passed, sequence stable at 5,
no Dataverse writes. Raw input content hashes are preserved; plans canonicalize only
exact empty optional text. New evidence is private at
`/Users/gallivan/.local/share/wmkf-roster/canary-20261110`. Temporary synthetic inputs
were reconstructed against original receipt hashes after their directory disappeared;
the original real export/UUID could not be recovered. Justin authorized a fresh lineage
only after a complete sandbox census found zero prior real-import keys. The fresh
read-only export and full import now pass: 39 sandbox profiles, 40 local identities,
39 bindings and seven preserved feedback references. Amy is local ID 40; excluded
ID 35 remains identity-only. Four User links and five Contact links are verified;
five unmatched Contacts are null in sandbox with explicit owner approval. Replay
attempted zero Dataverse writes and preserved GUIDs/ETags/SQL state and sequence 40.
Evidence: `docs/plans/data/expertise-roster/FULL_IMPORT_REHEARSAL_2026-11-10.md`;
private files: `/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`.
New fixture/probe commits: `04ec9148f`, `5f33594ac`. The old canary container/volume
is backed up, stopped and preserved. Separate container/volume
`wmkf-roster-full-import17-20261110` owns loopback port 55439. Never run the canary
against the full fixture or copy its sandbox allocations into shared Postgres.
The approved sandbox editor role is now assigned to John, Beth and Jean, with
exactly five roster privileges verified after removing nine platform-added defaults.
Existing roles and Production were unchanged. Evidence and limits:
`docs/plans/data/expertise-roster/SANDBOX_PERMISSIONS_2026-11-10.md`.
The branch consumer/matching implementation now uses an owner-approved minimal
rehearsal SQL seam with the installed `pg` driver and existing target guard;
normal mode delegates unchanged to Vercel. Live read-only consumer checks passed
39 mapped profiles, 37 active, 33 Board/Consultant selections, seven historical
feedback references (one excluded placeholder explicitly unavailable), and three
eligible leads. The adapter's missing lifecycle filter and transaction-client
retention during hydration were repaired and regression-tested; independent review
confirmed the bounded repairs. See
`docs/plans/data/expertise-roster/CONSUMER_TRANSPORT_2026-11-10.md`.
The next bounded write rehearsal passed feedback create/replay/edit/one-off/shared
reads, native audit attribution for John/Beth/Jean via actual impersonated services,
live v2 prompt publication/exact-byte readback and controlled fallback, and raw
formatter parity. The editor inactive-create gap and HTTP-200 error propagation were
repaired, Fable-cleared and live-canary verified (two 204 operations, stable replay,
conflicting payload 409). See
`docs/plans/data/expertise-roster/CONSUMER_WRITE_REHEARSAL_2026-11-10.md`.
Autonomous follow-up repaired dropped recipient-exclusion warnings through the
Workbench hook into the actual composer dialog. A stale-response regression and
attachment roster-outage/retry regression pass; 213 tests across six suites and
independent review pass. These close bounded failure-path checks, not live uploads.
Further engineering checks found and repaired history using the wrong rehearsal SQL
transport and blank editor optional text causing a post-create conflict. Real local
SQL tests now cover matching persistence/history with controlled provider/auth inputs
and maintenance lock/release with unchanged fixture state. Fable cleared the
empty-form repair and its inactive live canary passed creation/replay/null readback
with original input preserved. History failures now show Retry rather than false
empty history, with request cancellation. Evidence and the explicit
operational implementation gaps are in
`docs/plans/data/expertise-roster/ENGINEERING_CHECKS_2026-11-10.md`.
[VERIFIED via branch source and isolated PostgreSQL tests] Slice A now includes
dedicated-client write admission, durable write intents, numeric binding allocation,
and disposable-schema prepare/activate/pause/resume/abort commands. Ten allocator and
eight phase tests passed with unchanged public fingerprints. The combined 97-test run
and production build passed at the implementation checkpoint. Historically, both
Fable build reviews exited with "out of usage credits" and did not complete.
The owner switched this continuation's future plan/build reviews to OAuth Opus 5.5;
its source review returned READY for Slice A with no material blockers. Four low-severity
findings and its receipt-fsync nit are fixed. The final 109-test/five-suite run,
including isolated SQL/public-fingerprint checks, types and scoped lint passed;
the coordinating session reviewed the diffs and closed the review loop. The reviewer
did not rerun tests or the build. [VERIFIED via `outputs/roster-opus-fixes-build.log`] A fresh full build passed after the Slice A fixes at checkpoint `3a58a32e5`. Full transcript and disposition:
`docs/plans/data/expertise-roster/SLICE_A_OPUS_5_5_REVIEW_2026-11-11.md`.
Rollback reconciliation is source-built for disposable schemas and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. Public phase execution is refused.
Latest local checkpoints: Slice A fixes `3a58a32e5`, accepted Slice B plan
`b28507035`, and rollback source `6b2c2704e`.
The coordinating session accepted Slice B plan revision 2 after source verification;
rollback is source-built and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. Continue
its plan/build reviews using OAuth Opus 5.5. Do not substitute a paid review product. No push/deployment was authorized for this continuation. The worktree
is preserved; no milestone log entry is required for this unreleased rehearsal.
The accepted design and remaining boundaries are in
`docs/plans/data/expertise-roster/ALLOCATOR_CUTOVER_DESIGN_2026-11-10.md`.
[VERIFIED via the real November 11 Chrome walkthrough and private cleanup receipt]
Normal Microsoft SSO, protected roster/filtering, own synthetic history, inactive
canary edit/reload/restore and signed-in actor attribution passed. The 46-profile
census preserved every other profile; owned-schema cleanup preserved public SQL.
Display guards for NaN latency/blank roster footer passed three UI tests, an Opus
READY review, rebuild and a second real OAuth read-only browser check; its 46-profile
census and public SQL were unchanged and its fixture was removed. See
`docs/plans/data/expertise-roster/ENGINEERING_CHECKS_2026-11-10.md`.
[VERIFIED via the real linked-Contact browser run and cleanup receipts] Link/save/
reload, linked email restriction, canary reactivation/deactivation and unlink/restore
passed. Exact Contact fields/ETag and all 45 other profiles remained unchanged;
46 profiles retained, signed-in canary attribution verified and public SQL preserved.
Strict attachment destination resolution is source-built, Opus READY and build/gate
verified. See `docs/plans/data/expertise-roster/LINKED_CONTACT_REHEARSAL_2026-11-11.md`.
The subsequent minimal attachment/matching venue is source-built and Opus READY;
194 tests/12 suites, build, scoped lint, types and relevant gates/self-tests passed.
A zero-write real OAuth Workbench Reviews/Add Feedback preflight loaded and canceled
without upload/save; all 46 profiles/public SQL were unchanged and fixture removed.
Known direct-Vercel shell/synthesis limitations remain bounded in
`docs/plans/data/expertise-roster/LIVE_VENUE_PREFLIGHT_2026-11-11.md`.
[VERIFIED via final live receipts] Authorized attachment save/download/replay/delete
and batch route/service matching passed, including actor-owned persistence/History.
The first paid single call failed before save; normalized-text repair `102f19332`
passed 40 focused tests/build, but no successful live single rerun occurred within
the two-call limit. PDF/Blob repair `27fd99574` passed its separate 245-test/16-suite
checkpoint; these overlapping runs are not summed. Exact Graph/Blob cleanup, owned
schema drop, server/temporary-file removal and unchanged public SQL/all 46 profiles
passed. The Superseded registry audit row remains. See
`docs/plans/data/expertise-roster/LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md`.
The owner later separately approved one additional paid single run and temporary
storage. Normal upload/Find Matches succeeded with the same 2,339-byte PDF, one
Sonnet 5.5 submission, 40 active profiles and actor-owned exact persistence/History.
Exact Blob cleanup, unchanged all 46 profiles/public SQL, fixture removal and server stop
passed with the prior reviewed build; no Graph/attachment writes or runtime changes.
See `docs/plans/data/expertise-roster/SINGLE_MATCH_RERUN_2026-11-11.md`.
The bounded single/batch/attachment rehearsals do not establish full-app or
Production readiness. Legacy batch-picker proof remains separate from the new
automation direction.

[PLANNED; owner decisions, November 11] The next expertise direction is
recommendations-only through the shared Executor/Power Automate backend, not staff
assignment. Future assignment requires a separate contract with Connor. No future
Phase I staff-version document is assumed. Justin selected the initial policy: AI Materials combined narrative–bibliography.
General future document placement and cache compatibility remain unsettled; this
does not select Submission-Documents as a fallback. Existing runtime callers and dated
rehearsals are preserved; this decision does not remove them.

[VERIFIED via `lib/services/expertise-finder/recommendations-contract.js`]
The pure domain contract is now source-built: it builds a frozen roster snapshot,
canonical all-profile manifest/fingerprint and exact candidate-User state set;
rebuilds the visible roster block and checks its association; and validates closed
structured recommendations before legacy GUID/category/lead canonicalization.
The focused suite passed 60/60 and four existing matching/consumer suites passed
38 tests separately; scoped ESLint passed. Opus focused closure returned READY; named tests and the pure validation extraction are accepted. Only
the unit suite imports this module; no production caller is wired. This module does not fetch, authorize,
persist or establish currentness. `complete: true` is a trusted future adapter's
assertion, not pagination proof. Its 4 MiB cap bounds the roster extension only;
the shared full sealed-snapshot/prompt budget still requires integration checks.
No live calls or assignment writes were added. The initial source policy is AI Materials combined narrative–bibliography; broader future placement remains open.

The shared offline typed fixture is built at runtime `7d0cf0392`, checkpoint
`eb0010163` (coordinating-session source verification; reported 380 tests/25 suites,
Opus READY). The agreed earlier interface is `a756735fa`; `0c4b8d39c` remains its
historical runtime baseline. The shared staff endpoint is branch-built and default-off at runtime `6fe01c88e`,
docs `f9b3dd1b4` (superseding `de67742db`) (clean checkpoint verified by the coordinating session). Shared
verification reports 527 tests/32 suites including three PostgreSQL suites, types,
lint, applicable gates/secret-scan self-test and an environment-free guarded build
passing, with four DOCX warnings. No activation, provider call, provisioning,
deployment or positive live compatible-job proof occurred; a live producer/PA
generation path is not established. The owner approved the exact previously blocked Opus payload and the review ran.
Its qualified verdict cleared items 1, 2, 4 and origin alignment; item 3b identified
one PG inverse-proof gap. Test-only commit `ef5507ab8` restored a valid Sandbox
binding and positive read before both fixture-reader refusals; its real PG suite
passed 33/33, with lint/diff checks. The coordinating session independently reviewed
that diff. Runtime remains `6fe01c88e`; no second external review or unqualified
Opus READY verdict is claimed.
The roster-only freshness comparator is source-built with 21 new passing tests
(final combined 120 tests across seven suites); Opus source review returned READY with no concrete defects. It compares a
retained hash to a trusted complete fresh projection, returning only current/stale/
unknown. Auth, contract version, expiry and document/source proof remain caller
obligations. See `docs/plans/data/expertise-roster/ROSTER_FRESHNESS_CONTRACT_BUILD_2026-11-11.md`.
Machine audit attribution, revocation-safe cleanup, PA operations and roster cutover
remain release gates; the initial source is selected but broader future placement remains open.

The pure compiler-2 native output-schema builder and shared integration passed
bounded offline checks; domain Opus PASS and shared execution-evidence condition
locally resolved. The domain validator is unchanged, local size guards are not
provider guarantees, and no fourth trial/publication/admission extension occurred.
See `docs/plans/data/expertise-roster/RECOMMENDATIONS_OUTPUT_SCHEMA_BUILD_2026-11-11.md`.

The shared infrastructure owner confirmed clean runtime baseline `0c4b8d39c` and retains
common source/cache contracts, PA authentication, typed storage/results, worker,
recovery and operations. The roster stream owns expertise semantics/validation and
recommendation presentation. Shared interface/typed-result admission, source/cache
selection, PA authorization/operations and deliberate roster cutover remain
integration/release dependencies; the shared offline typed fixture is separately built. See
`docs/plans/data/expertise-roster/POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md`.
The local import fixture is not a full application schema; do not claim full app UAT.
Justin approved the minimal matching contract: active explicitly lead-eligible staff
with enabled User links only for lead; other active staff may be consulted; validated
profile GUIDs; no lead when none qualify; expertise wording/scoring unchanged.
The historical November 9 inventory reported
39 roster rows, 10 healthy Contact links, 7 feedback references. Slot attendee maps are inherited from parent sessions; the reported missing-field
issue was an inventory interpretation error, now resolved. TBD profile is excluded from migration while its numeric identity is retained for
one verified historical feedback reference. Sandbox schema/keys and synthetic SQL
cutover/rollback tests passed; see
`docs/plans/data/expertise-roster/SANDBOX_REHEARSAL_2026-11-09.md`. No Production writes. The minimal matching contract is owner-approved; platform rehearsal
gates remain prerequisites; no Production schema or runtime has been deployed. The existing J27 stream below is
preserved and has not been resumed by this planning task.

## Next Items

### Verified Open

1. **Recommendation to Chairs in Production, Stage 1** (owner wants it; PDs record
   recommendations Dec 9 to Feb 3). Start from the plan above: run `/contract-reconcile`
   on it, then build Stage 1 on a branch. Key facts in the plan: the step is gated by the
   sandbox-only `initialAssessmentRationaleEnabled()`; the save accepts only sandbox Factory
   requests; Production Factory runs live in the separate ledger (`TEST_REQUEST_LEDGER_URL`).
   Stage 2's shortcut must run as a background workflow (status steps wait up to 10 min).
2. **Migration 096 on the Production app database** (needed for Stage 3, the automatic
   screen): owner-run read-only check of `schema_migrations`. Unknown today.
3. **Note to Connor (owner to send):** prompts are v2 (8192 tokens); the flow should skip
   `intake.personnel` or stop intake when there is no PI row. Evidence:
   `docs/plans/INTAKE_PROMPT_ADMIN_ENTRIES_2026-11-17.md` decision 4. Not confirmed sent.
4. **Review Connor's first real-proposal run** (owner-run):
   `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-intake-prompt-outputs.cjs --target=prod --request=<n>`.
   Check Personnel quality and the Methodology sentence count.
5. **Trial cleanup batch 2** after 2026-11-23 18:31:58 UTC: refresh the Preview OIDC token,
   run the parked runner's `expire` mode once; expect `disabled`. Commands:
   `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` (batch 2). Receipts stay.
6. **Test request 1003528** is at Phase I Invited / Phase II Pending Committee Review (Peer
   Review). To test Initial Assessment, the owner can set Phase I back to Pending Committee
   Review under More options on Admin → Test Requests; untried whether Dynamics accepts it
   with Phase II set. Factory runs are in `managed-ledger/ledger_prod` [ASSUMED from the
   Production form's ledger; not re-read this session].

### Owner Decision Needed

1. Intake prompts (Beth meeting 2026-11-17): rationale versions (field map decision 1);
   flags JSON vs child table (decision 2); open-questions list. Keywords now come from
   `wmkf_programlevel3` (not seeded; columns unread). Then draft Rationale, Flags,
   Keywords and Open questions prompts.
2. Stage 3 go: the automatic Integrity Screen makes paid search and model calls per
   recommended request; owner authorizes before `AUTOMATIC_INTEGRITY_SCREENING=on`.
3. Open with Connor/Sarah: on Feb 24 does the Grants Manager set Phase II Status or only
   Request Status (D39 vs `lib/services/workbench/j27-read-model.js:239-241`).

### Parked

1. Backend prompt adoption/scheduling (parked branch
   `codex/executive-summary-generation-2026-11-16`). Re-open only on owner decision.

### Verify Before Acting

1. Local branches `claude/fable-5-2-registry-review`, `claude/board-notice-alert-hygiene`,
   `claude/factory-auto-prepare` are merged into `main`; deleting them needs the owner's
   go (list and confirm first).
2. Current prompt versions/consumers before any new intake prompt version.

### Do Not Reopen Without New Decision

1. Replacing Connor's runner, requiring staff-edit flags, merging the backend branch.
2. Factory auto-prepare target pair (Invited + Phase II Pending Committee Review) stays;
   the owner chose the Workbench shortcut route over changing it (2026-11-18).

## Preservation and other streams

Prior handoffs: `git show 281ef706b:SESSION_PROMPT.md` (Session 681),
`git show b8b2cb7a1:SESSION_PROMPT.md` (679), `git show 57eb7c40f:SESSION_PROMPT.md`
(multi-stream). Historical observations are not fresh permission or live state.

| Stream | Owner / resume source | Boundary |
|---|---|---|
| J27 Workbench | This handoff + `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md`; `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Each Production stage needs owner go; intake checks ~Dec 5 and post-intake cleanup need current verification |
| Intake prompts (Connor PA) | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Owner publishes prompts; backend stays parked |
| Expertise roster | Codex; branch's own latest notes | Production release not authorized |
| J27 Factory / reports | Prior multi-stream handoff | Preserve worktrees, fixtures, exports and branches |

Never set `DATAVERSE_ALLOW_PROD_READS` yourself; hand Production reads to the owner.
Never read main `.env.local`. `/private/tmp` paths are volatile.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Next build: Recommendation to Chairs, shortcut, screen |
| `lib/services/workbench/scoring-service.js` | Chairs recommendation save (sandbox gate) |
| `lib/services/workbench/j27-integrity-jobs.js` | Automatic screen queue (sandbox gate) |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Factory form, auto-prepare (step 5) |
| `scripts/draft-model-registry-entry.js` | Draft registry entries for a new Claude model |
| `scripts/probe-board-notice-state.mjs` | Read-only board notice/alert probe |
| `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md` | Workbook → Dynamics fields, keywords source |

## Testing

```bash
npx jest --testPathPatterns "(board|test-request|model|pricing)"
npm run check:model-registry && npm run check:model-registry:self-test
```
