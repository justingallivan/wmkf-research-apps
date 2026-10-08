# Session 584 Prompt: Proposal Ranking live; facilitator walkthrough next

## Current owner-only trial — restore a clean start before colleague use

[VERIFIED via conditional Admin-service PUT and readback, 2026-10-07] Owner approved
Justin Gallivan as temporary default facilitator (`29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`,
profile 2). Beth's previous default was `b6f1cd38-0973-f011-bec3-6045bd0510d4`.
Only this setting changed; no round was opened or rankings submitted by this action.

Owner explicitly requires a blank slate before colleagues start. This means trial
PD orders/submissions/composites must not carry into the real round; source external
reviewer scores remain intact. Keep the trial UNPUBLISHED: existing cancellation
refuses a round after either program is published. Before handoff, cancel any
unpublished trial round (retained read-only as history), restore Beth as default,
and open a fresh round from current source data. Verify the new round has only
initial seed orders and no submitted lists/composites/meeting edits. No reset has
been performed yet. Do not test publication in the live trial without first agreeing
a separate reset-safe rehearsal path. The app is already live with four grants;
this is not an isolated environment inaccessible to colleagues.

Next: Justin can inspect the facilitator preview without opening a round. Other
people's rankings must not be manufactured using their identities.

## Historical release checkpoint: Production deployed and enabled — 2026-10-07

[VERIFIED via GitHub, Vercel and signed-in Chrome] Owner approved release. PR #457
merged at `10c079c8652b4184404b4cb8ee8479f370a56c79`; privacy guards deployed while
disabled, then both ranking flags enabled and the same source rebuilt. Active
Production deployment: `dpl_F5ewaS8DRDhABRVyhrG5XHuSRvwf`. Justin's D26 view shows
“Round not open”; Beth must sign in to open it. No ranking rows or staff votes were
created. Full preview: 23 requests, 11 SE / 12 MR, four grants, all USD amounts present,
9 East / 14 West, all scored; 51 outstanding review assignments. Opening freezes
current scores. Full candidate CI passed (21,357 tests plus 129 PG tests); Sol and
OAuth Opus found no release blocker.

Current receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`.
Next: Beth's facilitator session and separate PD sessions for the full private-list,
submission, publication, meeting-reordering and budget walkthrough. Do not silently
change facilitator or submit other people's rankings to manufacture acceptance.
For rollback keep the deployed privacy guards: disable ranking or return to the
verified disabled deployment `dpl_8CVM7KUdKhPh2bTHDKdaqVcAA14J`.
Earlier sections below are historical checkpoints superseded by this release.

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
without substantive findings. The ranking app remains disabled; the later exact-record marker correction is below.

### Owner-approved legacy test flags — 2026-10-07

[VERIFIED via exact-row PATCH and GET readback] Requests 1003220, 1003221 and
1003222 now have `wmkf_istestrequest=true`; each successful conditional PATCH sent
only that field. Their `wmkf_testcreationrunid` values remain null. The owner
explicitly authorized these Production writes. No factory provenance was invented;
the existing classifier calls marker-only legacy rows anomalies and excludes them
from ordinary flows. Ranking activation/schema/roles remain untouched.
The new one-purpose local command is
`scripts/maintain-proposal-ranking-d26-test-markers.mjs` (dry-run default). Its
separate client method fixes the three request numbers, resolves IDs/ETags internally,
retains the target interlock and generic marker guard, and reads back uncertain
outcomes without retrying. All three returned `verified-marked`, confirmed PATCH
success, no transport error, and unchanged empty run ID.
Validation: 81 tests / four client/marker suites, types and data gates pass; Luna
built, Sol and OAuth Opus reviewed, and receipt/uncertainty corrections were included.
Fresh GET-only cohort scan: 26 ordinary-filter matches, two further D26 cutoff
exclusions, D26 still 23 (11 SE / 12 MR), J26 one SE. Keep the D26 cutoff.

### Production setup completed; access and privacy verified

[VERIFIED via live apply and GET metadata/security readback] Owner-approved step 1
is complete: three ranking tables, all expected attributes and Active keys; dedicated
application role with nine ranking Create/Read/Write privileges plus nine documented
Dataverse defaults. Exactly one assignment to the verified application system user,
no team assignments. That schema step did not change app activation, grants or settings.
Receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_SETUP_2026-10-07.md`.
The strengthened GET-only probe exits 0. Luna built verification; Sol and OAuth Opus
reviewed and substantive verification gaps were corrected. Production schema/role
setup must not be repeated as new work.

[VERIFIED via live configuration and independent readback] Beth is now the default
facilitator; Justin, John, Jean and Beth have additive Proposal Ranking grants.
Other grants are unchanged. All four effective staff identities lack ranking Read
privileges and all 12 collection reads returned 403. App controls returned 200/empty;
all three tables are excluded from the provisioned search index. Receipt:
`docs/audits/PROPOSAL_RANKING_PRODUCTION_ACCESS_PRIVACY_2026-10-07.md`.
The app stays disabled with no ranking business rows. Next: owner-directed promotion
and deployment of branch privacy guards (absent on origin/main), then approved
activation and multi-identity browser acceptance. Do not create live ranking rows
before the generic-reader guards are deployed.

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

## Historical Session 582 next items — superseded by Production follow-ups above

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

[VERIFIED via signed-in Chrome after the facilitator change] Justin now sees the
D26 facilitator preview: 23 proposals, four PDs, 51 outstanding reviews, zero
unscored. The Open round acknowledgement remains unchecked; no round was opened.
The institution-name display defect is corrected in source: use linked account.name,
not the sparse request wmkf_organizationname field. Live metadata and all23account
names were verified. Release/browser confirmation is recorded in the Atlas below.
---

## Owner reminder (set 2026-10-07, Session 584)

**November 1, 2026:** remind the owner to pick up the deliberations vocabulary options sheet,
`docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md`, before the after-D26 group decision.

---

# Restored main handoff (Session 584, Claude)

The PR #457 merge (`10c079c86`) replaced this file with the ranking branch's copy, dropping
the main-session handoff below. It is restored verbatim here; the ranking handoff above is current
for Proposal Ranking, and its older ranking sections below are superseded by it.

## Session 585 Prompt: resume Meeting Tracker recording workflow planning after Zoom admin meeting

## Session 584 transcript UX planning handoff — October 7, 2026 (Codex)

**[VERIFIED via remote Git refs]** Planning branch `codex/meeting-transcript-ux` is pushed at `3fa20089f389acfb59b000628df9831c8a1439d3`. The branch contains the implementation plan, two-slide Zoom admin brief and detailed handoff. This main handoff does not merge the branch or enable any new runtime behavior.

### Resume on the work computer

Fetch origin, then resume `origin/codex/meeting-transcript-ux` in a dedicated checkout, preserving unrelated local work. Do not rebuild from main or use `codex/meeting-transcript-fixes`. On the planning branch, read:

- [Implementation plan](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md)
- [Two-slide Zoom admin brief](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/briefs/WMKF-Zoom-Admin-Brief.pptx) — download and open in PowerPoint; exact permission names and official references are in speaker notes.
- The branch's `SESSION_PROMPT.md` for the detailed handoff.

### Decisions and next steps

**Owner-approved direction:** import the full WMKF Zoom recording and available audio/captions; reconcile speakers across the full transcript; review names and confirm the split; create presentation/discussion videos and transcripts; generate both summaries with one click; review and publish. Archive presentation-only products for Board sharing. Automatically delete discussion products and full originals at the Board meeting deadline, including Zoom originals if supported.

**Next:** the owner meets WMKF's Zoom administrator on October 8, 2026 in the morning (Pacific). Seek an internal Server-to-Server OAuth app with recording read access, approved hosts, a secure app-credential handoff and one test recording. Account setup and the import pilot have not been performed. The shared-account 2FA stays enabled; the integration uses its own server-side credentials after administrator authorization.

**Owner decisions still needed:** implementation stage/file scope, schema/auth/Production steps, exact deletion cutoff, reschedules/holds, archive-incomplete handling and permanent erasure versus Zoom/SharePoint recoverable deletion. No deletion or provider execution is authorized by this handoff. Recheck live callers and owned file identities before implementing retention.

**Critical source finding:** current Board transcript/summary binding depends on the full TRANSCRIPT manifest. Source deletion must wait for a reviewed content-free archive proof and tests that the presentation remains available afterward. Preserve the PR #459 speaker fix; the owner accepted it on 1003038.

### Verification and boundaries

Planning-only commit `3fa20089f`: documentation gates and self-tests passed sequentially; both slides passed package/layout checks and visual inspection. A fresh source review added no-discussion handling and content-free AI audit requirements. The checkout-specific memory symlink was repaired; agent invariants passed. The claim-evidence advisory report could not read local state; no observation was invented.

No runtime code, credentials, database/schema, Production data or account settings changed. No new production milestone shipped, so no DEVELOPMENT_LOG entry is required. UX and feature implementation must be separate commits. Push only the feature branch for future work; owner decides merge. The main handoff is the only main change authorized by tonight's stop request.

## Prior handoffs preserved below

The prior S584 notes retain unrelated Proposal Ranking and Final Writeup work. Earlier transcript acceptance TODOs below are historical; the owner acceptance recorded above supersedes them. Historical cleanup suggestions are not authorization to delete anything.

# Session 584 Prompt: transcript speaker fix released (PR #459), owner-accepted; UX follow-up with Codex; preserve Proposal Ranking handoff; group-review handoff email live (S581)

## Session 583 transcript handoff — 2026-10-07 PT (Codex)

**Update, Session 584 (Claude):** the owner said "merge", and the fix went out as
[PR #459](https://github.com/justingallivan/wmkf-research-apps/pull/459), merge
`f48fba1ab`. All CI passed after main was merged in. [VERIFIED via GitHub deployments +
`vercel inspect`] The Production deployment `wmkfresearchapps-bmhqc863s` was built from
`f48fba1ab` and serves the production domains. Steps 1–2 below are done. **Step 3: the owner
reported after regenerating that the fix "looks like it worked"** (owner report; Claude did
not read the job itself). Remaining transcript-page UI/UX issues and a new feature request
were handed to Codex on worktree `../WMKF_Apps-codex-transcript-ux`, branch
`codex/meeting-transcript-ux` (not merged).

Original S583 status: built and pushed on `codex/meeting-transcript-fixes`, tip `5ee323aaa`.
The existing Proposal Ranking handoff is preserved below.

### Completed on the feature branch

- `c7067f3df`: full-recording Zoom timing/wording reconciliation for reused audio speaker IDs.
- `5ee323aaa`: preserve valid global names and prior short-reply corrections; prune metadata
  for vanished IDs; retain recovery of unnamed IDs, including 3:1 evidence with a singleton.
- Names and per-turn corrections persist together in the existing bounded alignment JSON.
  The central content read applies them to preview, manual naming, download and publication.
  No schema migration or saved-job repair was performed.
- Claude Opus reviewed through subscription OAuth. Its three findings were fixed. The follow-up
  accepted those fixes and identified an unnamed-ID recovery regression; that and the singleton
  edge case were then fixed and independently reviewed with no remaining actionable findings.
- Verification: 30 suites / 725 tests passed before the last singleton regression; final focused
  rerun passed 69 tests including that new case. Types, scoped lint and documentation currency
  checks passed. This is mocked/local verification, not hosted end-to-end acceptance.
- Offline VTT replay retained four Allison corrections with zero existing names removed.
  It reconstructs IDs from display names, so it does NOT prove raw-provider generation behavior.

### Verified open and next-session sequence

1. ~~Done S584.~~ Fetch and resume `codex/meeting-transcript-fixes`; do not rebuild from main. Read the branch's
   generation-fix section in `docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md` and its tests.
2. ~~Done S584 (PR #459).~~ Review current-head integration/CI and arrange a deliberate release. **Owner decision needed:**
   runtime merge/promotion; stopping and pushing this handoff did not authorize that release.
3. After confirming the deployed revision includes the fix, regenerate and inspect request
   **1003038**, especially **01:02:04** and **01:02:12**, against Zoom's Allison captions.
   Verify the actual raw-provider output, saved alignment and displayed/downloaded transcript;
   do not substitute the offline VTT probe for acceptance of the real generation path.

**[VERIFIED via signed-in UI and fetched main source]** The owner tested production and still
saw evaan / jingli at those times. New draft job: `ac090b3e-dd49-4719-b3db-c81718865f46`,
ready Oct 7 at 4:23 PM. At inspection, main `afb99fee3` still returned the old verdict without
`reconcileZoomSpeakerTurns`; this run therefore did not test the branch fix. Do not describe
that production result as a failure of deployed new code. Conversely, the branch is not yet
proven by a real hosted generation run. Original earlier job: `adba2697-5c75-4847-bae4-c544ef7a3ca3`.

### Resume references and limits

- Branch source: `lib/services/transcription-pilot/zoom-vtt.js`,
  `lib/services/meeting-tracker-transcription/alignment-service.js`,
  `lib/services/transcription-pilot/runtime.js`, and `transcript-format.js` in that directory.
- Branch regressions: `tests/unit/transcription-zoom-speaker-turns.test.js` and alignment-service tests.
- Branch-only reproducible local probe: `scripts/probe-transcript-speaker-turns.mjs` (two local VTTs).
  Downloads and temporary review reports do not travel between machines; obtain authorized inputs
  afresh if needed. Transcript wording was not committed.
- Feature worktree retained; unrelated worktrees untouched. No new production milestone shipped,
  so no DEVELOPMENT_LOG entry is required. The current-session claim-evidence report was unavailable
  because its local state could not be read; no observation row was invented.

---

## Previous Session 583 Prompt: resume Proposal Ranking from its feature branch

## Proposal Ranking handoff — 2026-10-07 (Codex)

Owner requested this docs-only pointer on main so `/start` on the home machine can
find the unmerged work. The implementation remains on **`codex/proposal-ranking`**,
latest handoff commit **`283f02a19`**, in
[PR #457](https://github.com/justingallivan/wmkf-research-apps/pull/457).
This main commit does not merge or enable the app.

### Resume at home

1. Fetch origin and inspect the current checkout for unrelated changes.
2. Continue on the existing remote branch `codex/proposal-ranking` (create a local
   tracking branch if absent); do not rebuild the feature from main.
3. Read that branch's `SESSION_PROMPT.md` and its linked Atlas/audit receipts for
   the detailed handoff. Use the home machine's own credentials for live checks.

### Verified progress

- Separate ranking app built by Luna, reviewed by Sol and the orchestrator, with
  bounded Claude Opus subscription-OAuth reviews. No Fable or agent API-key use.
- Sandbox schema and role provisioned. Storage initialization, conditional save,
  stale-edit atomic rejection and duplicate-cycle rejection passed.
- GET-only privacy check verified direct-table denial for one enabled nonapp
  sandbox staff identity: effective-user query matched, all three retained records
  returned 403, and application control reads returned 200. This is impersonation
  evidence, not an all-staff or production claim.
- Existing proposal/review fields were unchanged. D99 synthetic cards exist only
  inside retained ranking snapshot data. Do not rerun fixture creation.
- Runtime app remains disabled; production ranking schema/activation is pending.

### Next items

**Verified open:** in-app walkthrough of private rankings, submission, composite
publication, meeting reordering and full-requested budget totals. Facilitator
configuration, participant grants and approved-environment readiness remain open.
The earlier sandbox source scan found zero eligible ordinary proposals; resolve
that acceptance-data limitation without silently copying/creating source proposals
or weakening test exclusion. See feature-branch evidence before acting.

**Owner decision needed:** deliberate production promotion after acceptance and
current-head CI review. No production activation is authorized by this pointer.

**Work constraints:** keep the solution simple; Luna builds/reconnoiters, Sol
reviews, orchestrator finishes, bounded Opus OAuth review. No review loops over
minor polish. Temporary local probe files do not travel between Macs; sanitized
results and retained IDs are committed on the feature branch.

### Commits and milestone determination

- `8d8b10872`: sandbox schema verification and source-field corrections.
- `8be9f57a1`: ETag fix and persistence rehearsal.
- `3f5c6cf10`: effective-user privacy verification.
- `283f02a19`: detailed feature-branch session handoff.

No new production milestone shipped; no DEVELOPMENT_LOG entry is required.

---

## Session 581 handoff (Claude, main) — 2026-10-07 PT

Final Writeup group-review handoff: **Stages 1–4 are live in Production.** Plan:
`docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`.

### What Was Completed

1. **Stage 3, lead-PD sign-off view: live** (PR #454, merge `b2bc23b95`; docs `1c06e0a52`).
   "Sign off" replaces "Mark reviewed"; the lead PD and superusers see which expected PDs have
   signed; Send to leadership names those who haven't.
2. **Stage 4, handoff email: live for Research** (PR #456, merge `8bc5b466b`; docs `3b582c9af`).
   - Ledger `final_writeup_handoff_emails` (migration 072). [VERIFIED via Production read
     2026-10-07] 19 columns, 4 indexes, 5 checks; 0 rows at session end.
   - Copy seeded by the owner (`email.final_writeup_handoff.subject`/`.body`; the same run also
     seeded the unseeded `email.deliberation_share.review_bundle_link_text` with its default).
   - [VERIFIED via `vercel env pull`] Production `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` =
     `["c247b11a-a7cb-ee11-9078-000d3a341e8f"]` (Research Grant Program, the same field as the
     auto-prepare list). Not the `RESEARCH_PROGRAM_IDS` Program GUIDs, which are a different field.
   - Owner rules: always deliver (rebuild, retry cron, alerts); internal staff only (exact
     `@wmkeck.org`); Kevin Moses removed from staffing by the owner; Beth Pruitt is PD and CSO by design.
3. **Lead-PD sender: live** (PR #458, merge `b14651597`; docs `81d87ddd9`). Owner: PD-to-PD mail
   comes from the lead PD, not the system. Impersonation with `noFallback`; a lead who can't send
   keeps the email pending and alerts ops. Owner verified that every PD can send from Dynamics.
4. **Stage 5 decision recorded:** the leadership digest is sent by the system mailbox.
5. **Fixes on main:** transcription pilot test fixture expiry (`b8a113513`); a race in
   `recording-and-transcript-card.test.js` that failed 2 of 3 main CI runs (`4a9817828`).
6. **Codex transcript/summary UX audit:** started in the `codex/transcript-summary-ux-audit`
   worktree; it shipped as PR #455 (`132eac566`). Follow-up is the Session 583 handoff above.
7. **SoCal parked** by the owner: `.claude-memory/project-socal-writeup-workflow-parked.md`.
8. Local `.env.local` Postgres lines refreshed from Vercel after the 2026-10-01 password rotation
   (backup in the S581 scratchpad, not tracked).

### Commits (main, first parent)
`b8a113513`, `b2bc23b95`, `1c06e0a52`, `fc56ca483`, `8bc5b466b`, `3b582c9af`, `4a9817828`,
`b14651597`, `81d87ddd9`; this handoff commit follows. Milestone entry added to DEVELOPMENT_LOG.md.

### Verified Open

1. **Confirm the first real handoff email.** After the next Research "Ready for group review",
   read its `final_writeup_handoff_emails` row: `state = sent`, `to_recipients` all
   `@wmkeck.org`, and the Dynamics activity's sender is the lead PD.
2. **Stage 5, leadership daily digest: LIVE S584** (PR #461, merge `ddeb1b401`; migration 073
   applied and copy seeded by the owner). Research only via `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`.
   Remaining: after the first writeup is sent to leadership, confirm the next night's
   `final_writeup_leadership_digests` rows have `accepted_at`. Seeding needed
   `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"` (plan Stage 5 rollout).
3. **Other Mac:** its `.env.local` Postgres lines likely still hold the pre-rotation password. Fix:
   `vercel env pull` to a temporary file and copy only the `POSTGRES_*`/`DATABASE_URL*` lines.

### Verify Before Acting

1. ~~**1003010 first scheduled preparation**~~ **Closed S584.** The owner ran the receipts
   report: all 14 D26 rows `prepared`, no errors; every scheduled row was last updated by one
   01:30 UTC (18:30 PDT) sweep. The owner saw 1003010's draft before 17:00 PDT (owner report).
   (Original note: expected ~15:45 PDT 2026-10-07; not checked in S581.) Owner-run:
   `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
2. **S580 deferred small items: live S584** via PR #460 (merge `ea1e09a0d`;
   owner-approved wording). The list's briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **J27: done S584.** The owner set Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]`
   and redeployed; the status list needs no change (register J27-084). Connor's Grant Cycle table note
   is recorded in the cycle rollover plan §2a; the rollover design is a to-do, not top priority.
4. Older S577 items: last state in `git show e6666ae68:SESSION_PROMPT.md`.

### Owner Decision Needed

1. Cycle rollover (`docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §9).
2. Deliberations vocabulary after D26 (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. SoCal Final Writeup workflow: wait for the owner to raise it.
2. ~~Merged branches still on origin~~ **Done S584:** 113 branches whose tips were already in main were
   deleted from origin (owner-approved). Kept: 8 merged branches checked out in local worktrees, and
   all 67 unmerged branches. Stale local worktrees are a separate cleanup.

### Do Not Reopen Without New Decision

1. Handoff email: Research only via the program list; PD-to-PD mail from the lead PD with no
   system fallback; internal `@wmkeck.org` staff only; always delivered (owner 2026-10-07).
2. Leadership digest is system-sent (owner 2026-10-07).
3. S580 decisions: sign-off not required; counts after edits; no pull-back; app-level hiding;
   digest at midnight Pacific.

### Process notes

- The owner says "merge" to authorize a PR merge; `gh pr merge` worked this session.
  `vercel redeploy` was blocked by the auto-mode classifier; the owner ran it with `!`.
- Codex adversarial reviews: Claude may launch them
  (`.claude-memory/feedback-codex-delegation-review-vs-rescue-routing.md`).

### Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/final-writeup/handoff-email-service.js` | Stage 4 staging, delivery, recovery, lead-PD sender |
| `lib/services/final-writeup/handoff-email-store.js` | Ledger SQL (lease-fenced) |
| `pages/api/cron/final-writeup-handoff-emails.js` | 15-minute retry |
| `lib/services/final-writeup/acknowledgement-service.js` | Sign-off records and the Stage 3 roster |
| `shared/components/workbench/FinalWriteupTab.js` | Sign off, Send to leadership, handoff copy |

### Testing

```bash
npx jest tests/unit/final-writeup tests/unit/workbench-final-writeup-route.test.js tests/unit/staff-deliberations-tab.test.js tests/unit/test-request-email-sender-census.test.js
```

(Session 580 and earlier main handoffs: `git show 444a2d8f0:SESSION_PROMPT.md`.)
