---
title: J27 Deliberations and Final Assessment lists plan
domain: workbench
kind: plan
status: draft
summary: Plan for the two cycle-page lists the J27 build plan split off (its section 3a) — one server rule for the later-phase facts, shared by the cycle list and the request page, then the two lists. Draft for owner and Codex review; nothing is built.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md
  - docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md
---

# J27 Deliberations and Final Assessment lists plan

Author: Claude for Justin Gallivan, 2026-11-10 (Session 673). **Draft. Not
reviewed by the owner or by Codex, and nothing here is built.** The build
plan's section 3a requires this plan, a whole-flow review of it, and a Codex
review before any code.

All code was read on branch `claude/j27-cycle-page` at `c6292bbf1` (worktree
`WMKF_Apps-claude-j27-read-model`), which is not on `main`. State claims
carry `[VERIFIED via …]` or `[ASSUMED]`.

## 1. What the owner is asked to decide

1. **The request page changes too.** Today the page works out a request's
   phase from whatever its tabs have loaded, and the answer differs by viewer
   (finding 1). The list cannot "agree with the request page" until the page
   has one answer. This plan moves the later-phase facts to the server, for
   both. Recommended.
2. **What a Deliberations row shows before its presentation.** Decision 3 of
   the build plan says no next-step line; rule 11 of the redesign plan says
   keep the scheduling cue. This plan reads those together: a timing chip
   ("Not scheduled", "Before presentation", "After presentation") and no
   line under it until the presentation has ended. Confirm.
3. **Where today's Staff deliberations list goes.** It carries the brief and
   draft cues the stage model does not (build plan, finding 6). Recommended:
   a second section under Deliberations, the way Reviewers sits under Peer
   Review, and Final writeups under Final Assessment as "Writeup review".
4. **Cycles after J27.** Twelve places test for the literal J27
   (finding 6), so a D27 request would get the phase cycle page and the
   older request page. Recommended: a separate small change before D27
   proposals arrive (June 2027), not part of this plan.

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
`[VERIFIED via request-document.js:184-209]`. Both are short identifiers,
not document text. This confirms Codex's second point.

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

A new server function takes a list of request ids and returns, per request,
the four keys the stage model already expects: `presentation`, `roster`,
`boardDraft`, `transition`. It does not look at who is asking.

| Key | Rule | Reuses |
|---|---|---|
| `boardDraft.exists` | The request's current draft resolves and is eligible. No current draft is `exists: false`; any other failure is `unavailable`. | `resolveSource`, `assertEligibleSource` |
| `transition.phase` | The current Final row passes the committed check; its stage is group review or leadership review. No Final row is `null`; a Final row that fails the check is `unavailable`. | `findCurrentFinal`, `committedFinal`, `stageOf` |
| `presentation.exists` | At least one presentation record in an accepted state. | To be settled in review: which of the two classifiers (finding 5) |
| `presentation.ended` | Exactly one eligible record whose scheduled end has passed. More than one, or an unclassified record, is `null` (unknown). | The schedule check's classification, without its per-record re-read |
| `roster` | The stored attendance for that presentation: present, stale when its binding no longer matches, absent. | `storedRosters` and the binding from the attendance service |

- **Both callers use it.** The request list feed calls it once for the rows
  it returns; request resolution calls it for one request. The page's first
  render then has the same facts as the list, for every viewer.
- **The page's tabs still report.** After a save on a tab, the tab's fresh
  read replaces the server's value, as now.
- **Starting group review is unchanged.** The start action keeps its own
  authorization, its per-record re-read and its error handling. The list
  only reads.
- **Failure.** A failed or capped batch read makes that key `unavailable` on
  every row, which the list already reports once
  (`degradedEverywhere`). A later-phase read failure is not to fail the
  feed.
- **Cost.** Three added batched reads per feed load (draft documents, Final
  documents, presentation records), each chunked by the adapter; no read
  per row. Measured on the 20 sandbox fixtures in the slice, and again with
  December's requests.

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
- One test proves the list and the request page derive the same phase from
  the same server facts for a lead Program Director and for another viewer.
- A negative test for each "unavailable" mapping, with the failing fact
  present in the setup.
- Gates for the surfaces touched: route matrix, Atlas (request document and
  site visit pages), status-and-label parity, the J27 register.

## 4. Not in this plan

No new route, table, status or Dataverse field. No write from any list. No
change to starting group review, to the Staff deliberations or Final
writeups panels, or to what is shared before a presentation (still
undecided). No change to the J27 literals (decision 4). Program Coordinator
support stays later.

## 5. Open before review

- Which classifier decides "a presentation exists" (finding 5). The two can
  disagree about one request.
- Whether the earlier-cycle exception in the schedule check can apply to a
  J27 request `[ASSUMED not, because J27 drafts are created under the
  configured schedule map]`.
- How the Staff deliberations list classifies timing (finding 5, last
  point).
- `docs/CLAUDE_REMEDIATION_PLAN.md` and the request-document Atlas page were
  not re-read for this draft; CLAUDE.md requires both before data-layer
  planning is final.
- The design brief's Deliberations and Final Assessment wording was read
  only in outline (its lines 92-93, 140-141 and 181).
