---
title: J27 proposal lists for Program Chairs and Board experts
domain: workbench
kind: plan
status: active
summary: "Personal no-login pages listing the scored J27 proposals for Program Chairs and Board members, with highlighted proposals on top and a link to each proposal's staff version. Production-live with keyword sections; the CSO pastes each link into their own email. Advisor picks during Scoring (which pre-fill highlights) and scored-only membership are branch-built on claude/session-2026-11-19b, awaiting migration 105."
canonical: false
cataloged: 2026-11-18
last_verified: 2026-11-19
owner: product-engineering
related:
  - lib/services/proposal-lists/list-link-service.js
  - lib/services/proposal-lists/list-snapshot-service.js
  - lib/services/proposal-lists/list-page-service.js
  - lib/external/verify-proposal-list-token.js
  - docs/atlas/postgres-proposal-list-links.md
---

# J27 proposal lists for Program Chairs and Board experts

State labels: `[VERIFIED via X]` was read or run in the build session (2026-11-18),
`[MERGED, OFF]` is in source on `main` (merged 2026-11-19 at the owner's direction) with
its flag unset, `[PLANNED]` is intent, `[ASSUMED]` is unconfirmed.

## What the owner asked for (2026-11-18)

Soon after proposals arrive on December 7, and once intake is complete:

1. **Program Chairs** receive one link to a page listing every submitted proposal:
   title, institution, PI. Proposals are grouped by major area (all neuroscience
   together, all physics together), each area behind a caret that starts closed. Each
   title opens the staff version of that proposal with no login.
2. **Board members with domain expertise** receive the same page, with the proposals
   staff want their view on highlighted at the top and every other proposal below as a
   courtesy.

This is the design for alignment-log decision D34 (2026-10-28), "Program Chairs and
Board members get proposals through magic links", whose mechanism was left open
[VERIFIED via `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md:70`]. It is earlier and larger
than the January 14 "First Cut" packet of about 50 summaries (same log, line 19); the
same list mechanism could carry that packet later.

## Owner decisions (2026-11-18)

| # | Decision |
|---|---|
| 1 | Sections come from the keyword characterization Connor's Power Automate flow writes at submission, as written. No staff control to move a proposal between sections. |
| 2 | Titles open the staff version (`{AKA}_Staff-Version_{Request#}.pdf`), not the reviewer copy. |
| 3 | Chairs are marked on the existing Board roster; one roster serves both audiences. |
| 4 | Each person gets their own link, and each proposal opens directly from it. |
| 5 | Delivery is one link to a page, not a long email of links. |
| 6 | Everyone with a link can open every proposal on their list (narrowed by decision 15 to the scored proposals; first stated as every submitted proposal). Chairs are responsible for all proposals in their area; other Board members get curation on top of full access. |
| 7 | Chairs' sections all start collapsed; no per-chair personalization. One chair is a geologist interested in the physical sciences, the other a physician with broad interests. |
| 8 | Highlighted proposals appear only at the top, not again in their section. |
| 9 | A proposal from the recipient's own institution stays listed and is flagged. |
| 10 | Links last until the Board meeting. |
| 11 | Late submissions are not allowed and lists are sent after Scoring (decision 15; first stated as after intake), so a list is a frozen snapshot. No update email. |
| 12 | Volume: up to 300 proposals; two chairs today, both Board members. |
| 13 | The CSO sends each link from their own email; the app sends nothing (settled by decision 17). |
| 14 | Tabled: a staff note beside a highlighted proposal. |

## Owner decisions (2026-11-19)

Decisions 6, 11 and 13 above are edited to match.

| # | Decision |
|---|---|
| 15 | A list holds only the scored proposals (about 50), not every submission. The Chairs get the titles of all submissions in advance by another route. Lists go out after Scoring and before finalists are selected. Everyone with a link can still open every proposal **on their list**. |
| 16 | During Scoring, any staff member with Workbench access ticks the Chairs and Board members who should see a scored proposal ("advisor picks"). Those ticks set the highlights on that person's list, so the CSO does not highlight by hand. PDs are unlikely to change ticks after lists go out, so a tick does not change a list already made, except that a refresh highlights newly listed ticked proposals. |
| 17 | The CSO sends each link by pasting it into their own email. The app sends nothing. |
| 18 | No roster chair marker; the list-type picker is not remembered. |
| — | Open: whether `/proposal-lists` should be narrowed to the CSO. Not changed. |

## Advisor picks and scored-only lists [BRANCH-BUILT]

Built on `claude/session-2026-11-19b` (2026-11-19); not merged.

- **Where:** the Initial Assessment form, below the Scoring decision, once the saved
  decision is Scored (`shared/components/workbench/AdvisorPicks.js`). One checkbox per
  Board-role roster member; each tick saves on its own. The section does not render
  where proposal lists are off.
- **Storage:** Postgres `proposal_list_advisor_picks` (migration 105): request id,
  numeric roster id, who ticked, when. An untick deletes the row.
- **Route:** `/api/workbench/proposal-lists`, `GET ?requestId=` and
  `POST { action: 'pick', requestId, rosterId, picked }`. The server refuses a tick on a
  request that is not Scored, not J27-or-later, or for someone who is not a Board-role
  roster member.
- **Membership:** the snapshot keeps only requests whose Scoring decision is Scored,
  including those that have since moved to a recommendation to Chairs or a Chairs
  outcome (`isScoredRow` in `list-snapshot-service.js`).
- **Highlights:** creating a Board member's list highlights the proposals ticked for
  them. A **test** list highlights a test proposal ticked for anyone, so the whole path
  can be checked on test requests without a real Board list. A refresh keeps the marks
  on proposals already listed and highlights newly listed ones from their ticks.
- **Release order:** the owner applies migration 105 to Production **before** the
  branch merges, because Production list creation reads the new table at once.
- **Rehearsal:** score a Production test request, tick an advisor on it, create a test
  list, and check the proposal is highlighted at the top.

## What is built [MERGED, OFF]

Merged to `main` on 2026-11-19 from `claude/proposal-list-pages`. The owner applied
migration 101 the same day and the read-only probe confirmed it
[VERIFIED via `node scripts/probe-proposal-list-schema.mjs`, 2026-11-19].
`PROPOSAL_LIST_SCHEMA_READY` was not set by the build session [ASSUMED: live
environment values unread]; with the flag unset
the staff route answers 503 and the public routes 404.

**Verification so far.** Unit tests cover the services, verifier and routes; all check
gates pass. A Codex adversarial review (2026-11-18) found two medium defects, both fixed
with regression tests.

First Production run, 2026-11-19, driven in the owner's browser on a J27 test list
[VERIFIED via the live site]: the staff page loads; creating a test list works (one
proposal, test request 1003518, which exercised the keyword-table read); the recipient
page opens and its data requests succeed without login cookies; saving a highlight moves
the proposal to the top; switching the link off makes the page say the link is no longer
active. The run found three defects, fixed and re-checked live the same day: a title
whose staff version is missing opened raw JSON (now a readable page), an empty "All
other proposals" heading, and a missing staff page title.

**Not yet proven in Production:** a staff-version PDF actually opening (1003518 has
none), the two-level discipline sections (no J27 test request has a keyword; only
"Unassigned" appeared), and a list for a real Board member.

### The recipient's page

`/external/proposal-list/{token}`. No login. Shows who it was prepared for, the cycle,
the proposal count and the date the link ends. Highlighted proposals, when there are
any, sit in an open group at the top. Every other proposal sits in a section that
starts collapsed, with its count. Each row has the title, institution and PI, and a
"From your institution" flag where marked. The page reads only the frozen list stored
for that link.

### Opening a proposal

A title links to `/api/external/proposal-list/{token}/document?request={number}`. The
server checks the request number is on that person's list, takes the request's identity
from the stored item, and resolves the staff version with the Workbench's existing rule
(exactly one `_Staff-Version_{number}.pdf` at the request folder root)
[VERIFIED via `lib/services/workbench-proposal-documents.js:211-229`]. A missing or
ambiguous staff version, or a file that is not a PDF, returns "not available"; no other
file is served. The caller never supplies a path, library, filename or request id.

### Links

One live link per cycle, list type and recipient address. A signed token
(`aud: 'proposal-list'`) from the shared helper
[VERIFIED via `lib/services/external-token.js:125`]; the row stores its digest and a
sealed copy so staff can copy the same link again. Every request re-reads the row, so
switching a link off takes effect at once. Other external verifiers reject this
audience [VERIFIED via `lib/external/verify-briefing-token.js:37`], and this verifier
rejects theirs.

The link ends at 08:00 UTC the day after the cycle's Board Meeting Date
(`wmkf_meetingdate` [VERIFIED via `shared/config/cycleCalendar.js:27`]): the end of that
day Pacific time, never earlier. A list cannot be created when the date is unset or
past. The end date is fixed at creation; if the Board Meeting Date moves, staff switch
the link off and create a new list.

### Which proposals are listed

Every Research request linked to the cycle that passes the Workbench discovery rule
(for 2027 and later cycles: Power Automate has marked it ready) and whose Scoring
decision is Scored (decision 15; branch-built, see above), read the same way for
every staff member, with no Program Director or "my proposals" scope. The read is
refused, never shortened, if it is incomplete, over 600 proposals, or the readiness
scope cannot be read.

### The staff page

`/proposal-lists` (staff with Request Workbench access). Choose a cycle; create a list
for a Board member; tick the proposals to highlight and any own-institution marks; copy
the link or open the page as the recipient will see it; refresh the proposals from the
cycle (keeps the link and saved marks); switch a link off.

A second list type, **test requests**, holds Factory test requests only and is always
addressed to the signed-in staff member, so the page can be checked without a Board
address and test data cannot reach one.
The staff page always opens on **Scored proposals** (labelled Submitted proposals
before the advisor-picks branch) and does not remember the
test-requests choice across reloads (owner decision, 2026-11-19).

### Stand-ins in this build

- **Sections** are no longer a stand-in: each proposal
  gets the discipline branch (the caret) and discipline group (a subheading
  inside it) of its keyword; only a Discipline keyword places a proposal, and anything
  else is listed under Unassigned. Keyword table facts: 259 rows, 5 branches, 11 discipline groups
  [VERIFIED via the owner-run `node scripts/probe-keyword-taxonomy.cjs --target=prod`, 2026-11-19].
- **Recipients** are active Board members on the expertise roster who have an email
  address; staff pick the chairs (Edward M. Stolper and James S. Economou) by name.
  There is no chair marker.
- **Own-institution marks** are suggested when the roster's institution text exactly
  matches the applicant institution; staff confirm or change them.
- **Delivery**: the CSO copies the link into their own email (decision 17). The app sends nothing.

## Not built [PLANNED]

| Item | Depends on |
|---|---|
| Keyword sections (decision 1): first real use | Built and merged to `main` 2026-11-19; migration 102 applied by the owner first [VERIFIED via `node scripts/probe-proposal-list-schema.mjs`, 2026-11-19]. Not yet run in a browser or against Dataverse; the keyword-table read first runs when a list is created or refreshed. Settled: which request field holds the main discipline keyword. A request has two lookups to the Keywords table, `wmkf_programlevel3` and `wmkf_programareaserved`, plus the `wmkf_ai_keywords` text list [VERIFIED via the owner-run `node scripts/probe-keyword-taxonomy.cjs --target=prod`, 2026-11-19]. The build reads `wmkf_programareaserved`; the choice is one constant, `SECTION_KEYWORD_LOOKUP`. Evidence for that field: [VERIFIED via the owner-run `node scripts/probe-request-keywords.cjs --target=prod`, 2026-11-19: one request in all of Production has any of the three fields filled, intake test 1003526, whose `wmkf_programareaserved` points at the Discipline keyword "Structural Biology" (Life Sciences / Molecular and Cellular Biology); `wmkf_programlevel3` and `wmkf_ai_keywords` are empty on every request]. The owner accepted that request as the guide on 2026-11-19, so the staff-page warning is removed. |
| Chair marker on the roster (decision 3) | Not needed to send: the two Program Chairs are Edward M. Stolper and James S. Economou (owner, 2026-11-19), and both appear in the staff page's Board member picker in Production alongside Board members Andrea M. Ghez and Kelsey C. Martin [VERIFIED via the live staff page, 2026-11-19], so staff create their lists by name. **Dropped by the owner 2026-11-19; not to be built.** |
| Sending the email from the app, with an exact preview | **Not to be built** (decision 17, owner 2026-11-19): the CSO pastes the link into their own email. |
| Pre-filling highlights from expert matching | Replaced by advisor picks (decision 16): PDs tick advisors during Scoring. |
| A link to the staff page from the Workbench navigation | Owner: where it should appear. |

Not planned: open tracking, an "extend link" action, per-chair personalization.

## Before this is turned on

Owner-only steps:

1. Done 2026-11-19: branch merged to `main` after a Codex adversarial review.
2. Done 2026-11-19: migration 101 applied with `node scripts/apply-migrations.js` and
   confirmed by the probe. For reference, the runner applies
   every migration file the database has not recorded, so first run the read-only
   `node scripts/probe-proposal-list-schema.mjs`, which lists what would be applied;
   run it again afterwards to confirm the tables and index exist.
3. Set `PROPOSAL_LIST_SCHEMA_READY=on` per environment, and confirm the public link
   origin (`DELIBERATION_BRIEFING_PUBLIC_BASE_URL`, falling back to `NEXTAUTH_URL`).
4. Check on a Production test request, using a test list, that the page opens and a
   title opens the staff version.
5. Confirm once, on a real J27 folder, that the staff version holds nothing that Board
   members should not see.

## Risks

- **Connor's keyword flow before December 7.** Without it the page shows the
  placeholder sections. Fallback: one unsectioned list.
- **Staff version on every proposal.** Connor's flow builds the file; it was missing on
  an earlier test request [ASSUMED: from the alignment log, not re-read]. A title whose
  file is missing shows "not available" rather than another document. The staff page
  does not yet show which proposals lack one.
- **A forwarded link** opens every listed proposal until it is switched off or the
  Board meeting date passes. There is no record of opens.
- **Own-institution matching** is by exact name and can miss; staff confirm it.
