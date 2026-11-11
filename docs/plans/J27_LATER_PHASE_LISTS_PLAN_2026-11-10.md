---
title: J27 Deliberations and Final Assessment lists plan
domain: workbench
kind: plan
status: implemented
summary: Plan for the two cycle-page lists the J27 build plan split off (its section 3a) — one server rule for the later-phase facts, shared by the cycle list and the request page, then the two lists. Draft for owner and Codex review; nothing is built.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md
---

# J27 Deliberations and Final Assessment lists plan

Author: Claude for Justin Gallivan, 2026-11-10 (Session 673). **Built on
`claude/j27-cycle-page`, 2026-11-10 to 2026-11-11; not promoted and not
exercised live (section 6).** The owner answered its four decisions on
2026-11-10. Codex reviewed it the same day and returned "needs attention"
with three findings, all confirmed against the source and worked into
finding 4, step 1 and section 5. Its second review, of that amended text,
returned "needs attention" again with four findings, also confirmed; three
are worked in below (marked "second Codex review") and the fourth, offramp
enforcement on the review transitions, became a separate change. Both guards (no group review before a
presentation in 2027 and later cycles; no review transition for an
offramped request) were then written by Codex, reviewed by Claude and
committed on `claude/j27-cycle-page` at `91fc83581`. **The owner approved
building this plan on 2026-11-10**, with Codex adversarial review of the
plan and of each piece, and accepted the one remaining list-and-page
difference (review-summary freshness, step 3). Step 1 below is the settled
design, with citations at `91fc83581`. Codex's third pass on it found one
problem (the schema gate, step 1) and passed the rest; plan review stops
there and each built piece is reviewed instead. Section 2's citations are at
`c6292bbf1`, and the three transition files have since moved by a few
lines. The build
plan's section 3a requires this plan, a whole-flow review of it, and a Codex
review before any code.

This plan amends step C7 of the read-model plan
(`J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` on the J27 line), which
makes the four later-phase keys "tier 2 (request page only; the dashboard
passes not-loaded)" and accepts that a viewer who never opens the Final
Writeup tab stays "partial" `[VERIFIED via that plan, lines 46 and 244]`.
That plan was Codex-reviewed, so the amendment needs the same.

All code was read on branch `claude/j27-cycle-page` at `c6292bbf1` (worktree
`WMKF_Apps-claude-j27-read-model`), which is not on `main`. State claims
carry `[VERIFIED via …]` or `[ASSUMED]`.

## 1. What the owner is asked to decide

1. **The request page changes too.** Today the page works out a request's
   phase from whatever tabs have been opened, and its tasks and waiting
   lines differ by viewer (finding 1). The list cannot "agree with the request page" until the page
   has one answer. This plan moves the later-phase facts to the server, for
   both. **Decided (owner, 2026-11-10): yes.**
2. **What a Deliberations row shows before its presentation.** Decision 3 of
   the build plan says no next-step line; rule 11 of the redesign plan says
   keep the scheduling cue. This plan reads those together: a timing chip
   ("Not scheduled", "Before presentation", "After presentation") and no
   line under it until the presentation has ended. **Decided (owner,
   2026-11-10): yes.** The row says nothing about the proposal discussion
   brief. Owner's context: in D26 the Chairs approved the slate on the
   shorter Phase I proposal; months later, with the Phase II proposals and
   the reviews in hand, the Program Directors met as a group (sometimes with
   a Program Chair), formed an initial opinion and wrote questions to send
   the applicant before the presentation. J27 is compressed, people have
   more information earlier, and an applicant can be offramped before a
   presentation. What is prepared and shared before a J27 presentation will
   change and is not yet decided, so no pre-presentation step is built into
   the row.
3. **Where today's Staff deliberations list goes.** It carries the brief and
   draft cues the stage model does not (build plan, finding 6). Recommended:
   a second section under Deliberations, the way Reviewers sits under Peer
   Review, and Final writeups under Final Assessment as "Writeup review".
   **Decided (owner, 2026-11-10): yes.** The Final Assessment section is
   meant to stay. The Deliberations one is temporary: that list assumes the
   D26 order of work and is revisited when the J27 pre-presentation step is
   decided (decision 2).
4. **Cycles after J27.** Twelve places test for the literal J27
   (finding 6), so a D27 request would get the phase cycle page and the
   older request page. **Decided (owner, 2026-11-10):** a separate small
   change, done soon, not part of this plan. "We don't want things like
   that as hard coded." The owner expects the JXX / DXX cadence to continue
   and no wholesale change to the flow for D27, so each test becomes "2027
   or later". Each of the twelve is checked first, in case one is
   deliberately J27-only. The same change renames the seven settings that
   carry the cycle in their name (`J27_CHAIRS_RECOMMENDATION_ENABLED`,
   `J27_INITIAL_RATIONALE_SCHEMA_READY`, `J27_MEETING_ROSTER_SCHEMA_READY`,
   `J27_AUTOMATIC_INTEGRITY` and the three rehearsal and simulation ones)
   and records which are deleted after go-live. None of the seven is set in
   any Vercel environment `[VERIFIED via vercel env ls, 2026-11-10: 154
   setting names, none beginning J27_]`.

## 2. What reading the code showed

**1. The request page's phase is not one fixed answer.**
- The Final Writeup tab is mounted only while it is the active tab, and it
  is the page's source of the Board draft and review state for the strip
  `[VERIFIED via pages/workbench/[requestId].js:467-472 and shared/utils/j27PageStage.js:7-9,50-73]`.
  Until someone opens that tab, the strip has no Board draft fact.
- Whether a presentation has ended is checked only for a viewer allowed to
  start group review, and only once an eligible draft exists
  `[VERIFIED via lib/services/final-writeup/transition-state.js:62-91: the schedule check sits inside "if (canStart)", after resolveSource and assertEligibleSource]`.
  For anyone else the end stays unknown, which the model reports as
  "presentation-end-unverified" `[VERIFIED via lib/services/workbench/j27-read-model.js:246]`.
- This confirms the first of the four unverified points from Codex's second
  review (build plan, section 3a).

**2. On the list, a request never reaches Final Assessment, and reaches
Deliberations only through a saved memo.** The four later-phase keys are
set to "not loaded" where list rows are composed
`[VERIFIED via lib/services/workbench/j27-read-model-inputs.js:144-147; git grep for the four keys being assigned a status across lib, pages and shared returned that place and the page-side shared/utils/j27PageStage.js only; the list's one caller is dashboard-service.js:359]`,
so the Deliberations matches left are a saved presentation assessment or a
saved attendance memo `[VERIFIED via j27-read-model.js:197,205-210]`. A
request with a scheduled presentation and no memo is listed under Peer
Review.

**3. The batched reads already exist.** Request documents for a list of
requests (`findByRequests`) and presentation records for a list of requests
(`findSummariesByRequests`), both chunked and both reporting `capped`
`[VERIFIED via lib/dataverse/adapters/request-document.js:216-228 and lib/dataverse/adapters/site-visit.js:166-193]`.
The Staff deliberations list uses both for a whole cycle
`[VERIFIED via lib/services/pre-site-visit/cycle-list-service.js:343-358]`.

**4. The slim document read is missing two fields the review-state rule
needs.** `committedFinal` requires the Final row's source version and source
content hash `[VERIFIED via lib/services/final-writeup/transition-model.js:194-213]`;
the slim field list has neither
`[VERIFIED via request-document.js:184-209]`. A Final row in leadership
review must also pass the leadership checkpoint, which requires the row's
SharePoint eTag and content hash
`[VERIFIED via lib/services/final-writeup/leadership-checkpoint.js:30-41,49-51]`;
the slim list lacks those two as well (Codex review, 2026-11-10). So four
fields are missing, not two. All four are short identifiers, not document
text. This confirms Codex's second point.

**5. Two services decide "there is a presentation" differently.**
- The attendance service accepts three fixed state and status pairs and
  requires exactly one matching record
  `[VERIFIED via lib/services/workbench/meeting-roster-service.js:47-59]`.
- The schedule check uses the configured pairs from
  `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS`, requires every record
  to classify and exactly one to be eligible, and has an exception for
  earlier-cycle drafts
  `[VERIFIED via lib/services/final-writeup/transition-schedule.js:19-47]`.
- It then re-reads the one record to confirm it has not changed
  `[VERIFIED via transition-schedule.js:48-55]`: one extra read per ended
  presentation. This confirms Codex's third and fourth points.
- The Staff deliberations list has its own timing source
  (`getDeliberationScheduleByRequestsWithAvailability`); how it classifies
  was not read `[ASSUMED to differ]`.

**6. The literal J27.** Twelve sites matched one pattern
`[VERIFIED via git grep -E "(===|!==) 'J27'" -- lib shared pages; a second grep for double-quoted, includes, array and startsWith spellings returned nothing]`:
the four memo services (rationale, review summary, presentation assessment,
attendance), the scoring service, two places in the integrity jobs, the
request resolver, three places on the request page including the choice of
phase layout (`pages/workbench/[requestId].js:126`), and the earlier request
list. The cycle page uses "2027 or later" instead
`[VERIFIED via shared/components/workbench/workbench-location.js:75-82]`.

**7. Draft visibility is not a blocker.** Before group review everyone keeps
the draft's status; only the file is hidden
`[VERIFIED via the header of lib/services/pre-site-visit/writeup-visibility.js, lines 1-12; its callers were not enumerated]`.
A list row that says "Board draft" and carries no file link discloses
no more than that status. The rows in this plan carry no file link.

## 3. Proposal

### Step 1: one server rule for the later-phase facts

**Design as settled after two Codex reviews and a reading of how the page
owns its facts (read-model plan, step E).** One server module works out the
four keys the stage model expects, `presentation`, `roster`, `boardDraft`
and `transition`, from rows it is given. It does not look at who is asking.
Every server read that reports one of these keys uses it, and each read
supplies a **whole key from one snapshot**. Nothing merges half a key from
one read into half from another.

| Key | Rule | Reuses |
|---|---|---|
| `transition.phase` | Worked out first. The current Final row passes the committed check; its stage is group review or leadership review. No Final pointer is `null`. A pointer to a missing or wrong-type row, or a Final row that fails the check, is `unavailable`. | `findCurrentFinal`, `committedFinal`, `stageOf` |
| `boardDraft.exists` | `true` when a committed Final row exists (starting group review moves the draft row to the Final lifecycle `[VERIFIED via lib/services/final-writeup/transition-claims.js:195-201]`). Otherwise the request's current draft resolves and is eligible: `true`. No current draft (`final_writeup_source_missing`) and a draft not yet shared for review (`final_writeup_source_ineligible`) are `false`, as the Final Writeup tab treats them. A draft row in the Final lifecycle with no Final pointer, a broken pointer, an unknown registry state or a missing SharePoint identity is `unavailable`. | `resolveSource`, `assertEligibleSource` |
| `presentation.exists` | At least one presentation record in one of the three state and status pairs the attendance service accepts (open, completed, scheduled), so the phase agrees with the attendance panel. | The pairs in `meeting-roster-service.js`, moved to the shared module |
| `presentation.ended` | The start guard's classification: every record classifies under the configured pairs, exactly one is eligible, and its scheduled end has passed. Scheduled end in the future is `false`. Anything else, including no configured pairs, is `null` (unknown), so the task and the guard cannot disagree. No per-record re-read. | The classification in `assertScheduledEnd`, moved to the shared module and called by the guard too |
| `presentation.legacyException` | Always `false` for 2027 and later cycles (D63, built). | — |
| `roster` | The stored attendance for the one accepted presentation: present, stale when its binding no longer matches, absent. | `storedRosters` and the binding from the attendance service |

- **Who calls it.**
  - The request list feed, once for the in-scope rows it returns (batched).
  - Request resolution, for one request, so the page's first render has the
    same facts as the list.
  - The Final Writeup status read, which today checks the schedule only for
    a viewer who can start group review; it reports the schedule for every
    viewer. Starting group review keeps its own authorization and its
    per-record re-read.
  - The attendance read, which reports the presentation's timing with it.
- **The page keeps its tab reports** (step E: facts owned by the current
  route, every status write published through one effect). What changes is
  that each report now carries a whole key worked out by the same rule, so
  the latest read simply replaces the key. The Overview's meeting read no
  longer writes a presentation with an unknown end over a known one,
  because it no longer writes half a presentation at all.
  This replaces both earlier drafts of this step ("never downgrade", then
  "server is the only source with re-fetch"): it needs no new read route and
  loses none of today's synchronization.
- **Schema not set up is not a failure, and does not hide a draft.** The
  review stage needs the Final Writeup transition schema (wave 22); where
  that is off, `transition` reads `not-provisioned`. The Board draft does
  not need it: both request pointers and the draft rows belong to the
  pre-site draft schema (wave 19), which the Staff deliberations list
  already reads unconditionally
  `[VERIFIED via lib/services/pre-site-visit/cycle-list-service.js:81-83]`,
  so `boardDraft` is worked out regardless. Gating the draft on wave 22, as
  an earlier draft of this step did, would have left a request with an
  eligible draft in Deliberations (Codex plan review 3, the one finding of
  that pass). Attendance reads `not-provisioned` where its field is off.
- **Request columns.** The feed and the resolver gain the two
  current-document pointers `[VERIFIED via transition-model.js:108,189,210-211]`,
  ungated for the reason above.
- **Slim document read.** Gains the four fields of finding 4.
- **Failure.** A failed or capped batch read makes that key `unavailable` on
  every row, which the list already reports once (`degradedEverywhere`). A
  later-phase read failure is not to fail the feed.
- **Cost.** Three added batched reads per feed load (draft documents, Final
  documents, presentation records), each chunked by the adapter, for
  in-scope rows only; no read per row. Timed on the sandbox fixtures in the
  slice and again with December's requests.
- **Preview.** The configured pairs
  (`STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS`) are set for
  Production only `[VERIFIED via vercel env ls, 2026-11-10]`. On the Preview
  every presentation's end reads unknown, and since D63 nobody can start
  group review there, until the owner adds that setting for the Preview
  branch.

**Build order** (each piece reviewed by Codex after it is committed):

1. The shared module and its tests. Nothing calls it yet.
2. The feed and the two lists together, so no request leaves Peer Review
   for a tab that cannot list it. The row rule is checked for every task and
   waiting line that becomes reachable once rows stop being "partial".
3. The request page: resolution, the status read for every viewer, the
   attendance read, and whole-key replacement in the page's composer.

### Step 2: the two lists

Both become the shared request list, as Initial Assessment and Peer Review
are, with a tab count from the same row rules.

- **Deliberations.** A timing chip: "Not scheduled", "Before presentation",
  "After presentation". No line under it before the presentation ends
  (decision 2). After it ends: confirm attendance, then write the
  presentation assessment, as the model already orders them. A request past
  Peer Review with a review still owed says "1 review outstanding", as on
  the other lists.
- **Final Assessment.** A standing chip: "Board draft", "Group review",
  "Leadership review". Next step from the model: start group review when
  the model allows it, otherwise the quiet waiting line.
- **Second sections** (decision 3). Deliberations: today's Staff
  deliberations panel. Final Assessment: today's Final writeups panel, as
  "Writeup review". Neither panel changes.

### Step 3: tests and checks

- The stage model's tests gain the later-phase cases from a server-shaped
  input: draft without presentation, presentation without invitation
  (Codex's first review), two presentation records, a Final row failing the
  committed check, each batch read failing in turn.
- Parity is tested on more than the phase: the task list, the leading
  task, the waiting lines and the rendered next-step text are the same on
  the list and the page, for a lead Program Director and for another
  viewer, before and after tab reads (second Codex review).
- One fact outside the four keys still differs: whether the saved review
  summary is out of date is known only to the page
  `[VERIFIED via shared/utils/j27PageStage.js:83-85 and lib/services/workbench/j27-read-model-inputs.js:77-85]`,
  so the page can say "read the reports" where the list says nothing is
  waiting. **Accepted by the owner, 2026-11-10**, to be revisited in the
  polish pass; the parity test excludes this one fact and says so.
- A negative test for each "unavailable" mapping, with the failing fact
  present in the setup.
- Gates for the surfaces touched: route matrix, Atlas (request document and
  site visit pages), status-and-label parity, the J27 register.
- From the Codex review: a valid leadership-review row passes through the
  real slim projection and the committed check, with a negative case for
  each missing checkpoint field; a replaced presentation, a rescheduled
  one and a newly ambiguous schedule each change the page's facts after a
  refresh; a J27 draft with a complete review milestone and no presentation
  record is not offered "start group review" to anyone.

## 4. Not in this plan

No new route, table, status or Dataverse field. No write from any list. No
change to starting group review beyond closing the exception for 2027 and
later cycles (step 1), and none to the Staff deliberations or Final
writeups panels, or to what is shared before a presentation (still
undecided). No change to the J27 literals (decision 4). Program Coordinator
support stays later.

## 5. Open before review

- **Decided (owner, 2026-11-10): J27 does not enter group review until a
  presentation has been seen, and an offramped request does not go to the
  Board.** The schedule check's exception was not limited to earlier
  cycles: nothing in it tests the cycle, and a draft with a complete review
  milestone and no presentation record qualifies even with the schedule map
  configured `[VERIFIED via transition-schedule.js:24-38]` (Codex review,
  2026-11-10; this draft had assumed otherwise). The exception is therefore
  closed for 2027 and later cycles; earlier cycles keep it.
- **Offramp on the review transitions: built** (second Codex review; `91fc83581`
  on the J27 line). Both transitions refuse an offramped request, at their
  commit-time re-reads too, and the status read withdraws the action.
- **Which classifier decides "a presentation exists": settled** in step 1
  (the attendance service's pairs for "exists", the start guard's
  classification for "ended").
- How the Staff deliberations list classifies timing (finding 5, last
  point).
- Codex's second and fourth points are confirmed only in part: the Final
  writeup's readiness check and the claim that batched reads fail as a
  whole were not traced.
- `docs/CLAUDE_REMEDIATION_PLAN.md` and the request-document Atlas page were
  not re-read for this draft; CLAUDE.md requires both before data-layer
  planning is final.
- The chips in step 2 are the design brief's (its standing-chip table and
  tab descriptions). The brief's interim row, "Until the later phases are
  derived … Some details could not be read", ends when this plan is built.

## 6. What was built (2026-11-10 to 2026-11-11)

On branch `claude/j27-cycle-page`, pushed; not promoted, not deployed to the
Preview, not exercised in a browser or against live data. Every piece was
reviewed adversarially by Codex after it was committed; each finding below
was reproduced or checked against the source before it was fixed.

| Piece | Commits | Codex review |
|---|---|---|
| Guards: no group review before a presentation for 2027 and later cycles; no review transition for an offramped request | `91fc83581` (written by Codex, reviewed by Claude: removing either guard fails 9 and 6 tests) | Written by Codex |
| 1. Shared facts module `lib/services/workbench/j27-later-facts.js`; schedule classification shared with the start guard; four fields added to the slim document read | `75b73897f` | Three findings (malformed stored roster read as confirmed; two pending Final rows read as ready; a presentation only the configured pairs recognise asked for attendance nobody could confirm), fixed in `3d9e71363` and confirmed closed |
| 2. Feed and the Deliberations and Final Assessment lists; old panels as second sections | `3d9e71363` | One finding (Final Assessment dropped the All-in-program scope), fixed in `562717d42` |
| 3. Request page uses the same facts for every viewer | `562717d42` | Two findings (an older report overwrote a newer one; a reopened draft was ignored), fixed in `4a2f9c82e`; the confirmation round found the strip lacked timing, so no Deliberations request page showed a next step, fixed in `ffdeedb43` with a rendered test. Review of this piece stopped there (two rounds) |

Plan review stopped after three passes; the third found one problem (the
schema gate on the draft), fixed before build.

**Known and accepted.** Only the request page knows when a saved review
summary is out of date (owner, 2026-11-10). The stage model still raises
"presentation end not verified" when no presentation exists; existing
reviewed tests require it and the list does not display it.

**Not measured.** The feed's added cost: three batched reads per load, at
least 36 queries at 300 rows by Codex's count. Time it on the sandbox
fixtures when the Preview is moved, and with December's requests.

**Before promotion**, in addition to the rollout plan: the Preview needs
`STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS` for group review to be
rehearsable there, and the D26 Grant Cycle link check (rollout plan).
