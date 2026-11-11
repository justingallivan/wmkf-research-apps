# Session 669 Prompt: Plan the J27 cycle page and audit the staff flows

## Session 668 Summary — Codex then Claude, 2026-11-06 to 2026-11-09 Pacific

Codex opened the session with the J27 Workbench development brief and the
reports line; Claude carried the J27 read model from plan to a reviewed branch.
Nothing merged to `main`. Session 667 is preserved at
`git show 53066edc1:SESSION_PROMPT.md`.

### What Was Completed

1. **J27 read model and discovery on `claude/j27-read-model`** (based on
   `codex/j27-workbench-reports` at `97f696faf`; tip `680252fe5`, pushed).
   Steps C to F, E and I of the read-model plan
   (`docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md`, on the branch,
   not yet on main) are built,
   Codex-reviewed to READY and recorded in `docs/plans/J27_*_REVIEW_2026-11-09.md`.
   Pure stage derivation; Research-only program gate (D8); discovery admits every
   ready J27 Research request (step F); request-page recomputation with a
   read-only stage strip (step E); the offramp read as Phase II status
   `682090001` "Phase II Offramped" with server refusals on every presentation,
   materials and invitation write (step I; D7 closed, D51 logged). Full Jest,
   unit and integration, is green on the branch; two integration suites and
   four unit suites that the reports line had turned red were repinned.
2. **J27 Factory batch on `codex/j27-factory-scenarios`** (tip `9070030c7`,
   pushed). Owner-authorized GoVerify bypass created synthetic requests
   1000380 to 1000387 in sandbox `orgd9e66399`; scenario 7 (1000386) completed
   with the derived request status observed, not asserted. Sandbox request
   status rules are stale 2024 copies and differ from production; see memory
   `project-sandbox-request-status-business-rules`.
3. **Preview smoke and walkthrough deck.** The stage strip, the dashboard and
   five request states were captured on a sandbox-backed Preview and assembled
   into a fifteen-slide deck for colleagues:
   https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj (private until shared).
   A branch-scoped Preview `DYNAMICS_URL` (sandbox) exists for
   `claude/j27-read-model`.
4. **Branch hygiene.** `codex/j27-semi-finalist` is superseded by the reports
   line, pushed and parked; its route test was ported (`4358a08ab`). Merge
   rehearsal recorded in plan §10: reports → read-model → factory merge cleanly.
5. **Stopgap tab reorder** (`680252fe5`): Initial assessments now leads the
   cycle-page tab row. The owner called this insufficient; see Next Items 1.

### Commits

Read-model branch, 2026-11-09 (oldest first): `ff1a978cf`, `470cd3f76`,
`e1b24f6a7`, `fec2c7228`, `f75704137`, `62855a91b`, `881aad5bd`, `406727a74`,
`9469c47b5`, `af82d6b91`, `65ae8d088`, `e814aed1e`, `446acf4cb`, `4da4947ae`,
`9d7f6aee1`, `b43dfe68f`, `00bc221ea`, `4358a08ab`, `90142b22b`, `806c446c4`,
`1556da9e9`, `806e7bc6c`, `52fc7a6b6`, `b0b4f21d9`, `591f33267`, `74f6b8111`,
`480464177`, `680252fe5`. Factory branch: `e0ad4ade7` to `9070030c7`.

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
docs `de67742db` (clean checkpoint verified by the coordinating session). Shared
verification reports 527 tests/32 suites including three PostgreSQL suites, types,
lint, applicable gates/secret-scan self-test and an environment-free guarded build
passing, with four DOCX warnings. No activation, provider call, provisioning,
deployment or positive live compatible-job proof occurred; a live producer/PA
generation path is not established. Initial Opus review was READY WITH NAMED CHANGES;
fixes were locally verified, but final Opus closure was blocked by automatic approval
review and awaits explicit payload authorization. It is not a final READY verdict.
The roster-only freshness comparator is source-built with 21 new passing tests
(final combined 120 tests across seven suites); Opus source review returned READY with no concrete defects. It compares a
retained hash to a trusted complete fresh projection, returning only current/stale/
unknown. Auth, contract version, expiry and document/source proof remain caller
obligations. See `docs/plans/data/expertise-roster/ROSTER_FRESHNESS_CONTRACT_BUILD_2026-11-11.md`.
Machine audit attribution, revocation-safe cleanup, PA operations and roster cutover
remain release gates; the initial source is selected but broader future placement remains open.

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

1. **Cycle-page redesign plan (owner, 2026-11-09): first thing.** The request
   page was rebuilt for J27 (Overview plus four phases) but the cycle-level
   Workbench page still carries six tabs accumulated since September: Request
   list, Reviewer follow-up, Staff deliberations, Initial assessments, Final
   writeups, Awardees. Write a plan, for owner review before any build, that
   reorganizes the cycle page by the request page's phases (Initial
   Assessment, Peer Review, Deliberations, Final Assessment, then Awardees),
   Research-only like the strip. State which tabs become phases, which become
   content inside a phase (Reviewer follow-up is Peer Review's cycle view, not
   a tab; it is the old Review Manager lifted into the shell on 2026-09-01),
   and which go away. Each phase view can list the cycle's requests with the
   stage model's next task and blockers, already computed per dashboard row.
   Log the decision in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`.
   Evidence: `shared/components/workbench/WorkbenchViewsNav.js`; memory
   `project-j27-cycle-page-redesign-pending`.
2. **Staff flow audit (owner, 2026-11-09).** Alongside item 1, audit whether
   the J27 flows make sense to the people using them: walk each phase as a
   Program Director, a Program Coordinator and the Grants Manager, note where a
   step, label or tab does not match how they work, and bring findings to the
   owner before the cycle-page plan is final. Start from the deck above and
   sandbox requests 1000380 to 1000387.
3. **Promotion of the J27 line is an owner decision, not yet taken.** The owner
   wants a hands-on look first. Path when taken: Tier 2 per the rollout plan
   (`docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md`, on the branch); merge order
   reports → read-model → factory (plan §10). Do not merge without the go.
4. **Deferred UI mirroring of the Offramped refusals** (plan §9 I6(a)):
   `SiteVisitEditor`, `SiteVisitMaterialsCard`, `PresentationInvitationPanel`,
   `RecordingAndTranscriptCard` still show their controls; the server refusal
   sentence reaches them through existing error paths.
5. **Intake display and staff field contract** (carried from Session 667).
   Connor owns intake AI Summary, Fit Flag, Fit Rationale and draft staff
   rationale; Justin owns the app. Agree fields and draft-to-edit handoff before
   staff saves.

### Owner Decision Needed

1. Where the written offramp justification lives (D50(2)): Dynamics note,
   Workbench field or meeting record.
2. Who sets Phase II status to Offramped: Program Director or Grants Manager.
3. Whether staff retain the original First Cut answer after a Semi-finalist
   recommendation replaces the status (carried from Session 667).
4. Whether the AI fit flag affects Flagged for concerns, remaining intake output
   formats and owners, staff queues, Chairs materials and calendar changes; the
   November 15 target needs reconfirmation (carried).

### Parked

1. Southern California as a separate app suite sharing code (D8; memory
   `project-workbench-is-research-only`). Re-open when the owner asks.
2. Research readiness readback after the December 8 readiness date: confirm the
   real J27 Research requests look right in the Workbench before anyone relies
   on it.
3. Phase II, bulk edits, queues and packet exports; see the cycle plan.
4. Lockfile drift in the read-model and factory worktrees (uncommitted
   `package-lock.json`); hygiene only.

### Verify Before Acting

1. **Preview alias.** `wmkfresearchapps-preview.vercel.app` was left on branch
   deployment `wmkfresearchapps-ng7nius87` (sandbox-backed, `680252fe5`) at the
   owner's request on 2026-11-09. Recorded prior target:
   `https://wmkfresearchapps-f8n44w5wh-justin-gallivans-projects.vercel.app`.
   The owner runs the restore; check `vercel inspect` before assuming either.
   Remove the branch-scoped Preview `DYNAMICS_URL` when `claude/j27-read-model`
   retires.
2. **Codex's untracked brief.** `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md`
   sits uncommitted in the main checkout (`/Users/gallivan/Code/WMKF_Apps`, on
   parked `codex/j27-semi-finalist`); the owner chose not to commit it in this
   handoff. Preserve it.
3. **Memory on the branch.** `.claude-memory/project-vercel-cli-deploy-preview-auth.md`
   gained the sandbox-backed Preview venue on `claude/j27-read-model`
   (`52fc7a6b6`, `480464177`), not on `main`; it arrives with the merge.
4. Sandbox fixtures 1000368 to 1000387 stay; no deletion authorized. Historical
   retirement items require live caller checks.

### Do Not Reopen Without New Decision

1. D7: the offramp is `wmkf_phaseiistatus = 682090001`; confirmed in production
   metadata 2026-11-09 (owner-authorized read).
2. D8: the Workbench read model is Research-only.
3. Scenario 7's sandbox derived status is observed, never asserted; production
   rules define the gate strings.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` (branch) | Read model, discovery, strip, offramp: decisions, build records, merge rehearsal |
| `docs/plans/J27_STEP_I_REVIEW_2026-11-09.md` (branch) | Three Codex rounds on the offramp step |
| `lib/services/workbench/j27-read-model.js` | Pure stage derivation |
| `shared/components/workbench/J27StageStrip.js` | Request-page strip and label maps |
| `shared/config/workbenchVisibility.js` | Discovery predicate and OData superset |
| `shared/components/workbench/WorkbenchViewsNav.js` | Cycle-page tab registry (redesign pending) |
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Owner decisions D1 to D51 |

## Concurrent Streams and Preservation

Dated inherited resume boundaries, not fresh audits or permissions. Preserve
fixtures, artifacts and other worktrees.

| Owner / stream | Resume boundary and authority |
|---|---|
| Claude / J27 read model | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, `claude/j27-read-model` at `680252fe5`; plan above |
| Codex / J27 Factory | `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory`, `codex/j27-factory-scenarios` at `9070030c7`; `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` |
| Codex / J27 reports line | `/private/tmp/wmkf-j27-workbench-reports`, `codex/j27-workbench-reports` at `97f696faf`; `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` (untracked, see above) |
| Earlier streams | Preview CSRF (#620/#621), per-reminder history (#625/#628), shared prompts, Integrity (Session 658), reviewer outcomes, terminology: boundaries unchanged from `git show 53066edc1:SESSION_PROMPT.md` |

## Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest tests/unit/j27-read-model.test.js tests/unit/workbench-views-nav.test.js
npx jest   # full run was green at 680252fe5
```
