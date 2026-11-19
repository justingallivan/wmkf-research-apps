---
title: J27 proposal lists for Program Chairs and Board experts
domain: workbench
kind: plan
status: active
summary: "Personal no-login pages listing every submitted J27 proposal for Program Chairs and Board members, with staff-highlighted proposals on top and a link to each proposal's staff version. The page and staff compose surface are merged to main behind a flag that is off; the email, chair marker, and keyword sections are not built."
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
| 6 | Everyone with a link can open every submitted proposal. Chairs are responsible for all proposals in their area; other Board members get curation on top of full access. |
| 7 | Chairs' sections all start collapsed; no per-chair personalization. One chair is a geologist interested in the physical sciences, the other a physician with broad interests. |
| 8 | Highlighted proposals appear only at the top, not again in their section. |
| 9 | A proposal from the recipient's own institution stays listed and is flagged. |
| 10 | Links last until the Board meeting. |
| 11 | Late submissions are not allowed and lists are sent after intake completes, so a list is a frozen snapshot. No update email. |
| 12 | Volume: up to 300 proposals; two chairs today, both Board members. |
| 13 | Sender is a staff member, to be named. Whether Production allows sending as a staff member is for the owner to determine. |
| 14 | Tabled: a staff note beside a highlighted proposal. |

## What is built [MERGED, OFF]

Merged to `main` on 2026-11-19 from `claude/proposal-list-pages`. Migration 101 was not
applied to any database by the build session and `PROPOSAL_LIST_SCHEMA_READY` was not
set anywhere [ASSUMED: live database and environment state unread]; with the flag unset
the staff route answers 503 and the public routes 404.

**Verification so far.** Unit tests cover the services, verifier and routes; all check
gates pass. A Codex adversarial review (2026-11-18) found two medium defects, both fixed
with regression tests. Migration 101 and the store's SQL statements were run by hand against a
throwaway local Postgres container [VERIFIED via psql, 2026-11-18]. The feature has
**not** been run in a browser, through the app's database driver, or against SharePoint
or Dynamics.

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
(for 2027 and later cycles: Power Automate has marked it ready), read the same way for
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

### Stand-ins in this build

- **Sections** use the request's program area, labeled on the staff page as a
  placeholder. Decision 1 replaces it once Connor's field is known.
- **Recipients** are active Board members on the expertise roster who have an email
  address; staff pick the chairs by name. There is no chair marker yet.
- **Own-institution marks** are suggested when the roster's institution text exactly
  matches the applicant institution; staff confirm or change them.
- **Delivery**: staff copy the link into their own email. The app sends nothing.

## Not built [PLANNED]

| Item | Depends on |
|---|---|
| Keyword sections (decision 1) | Connor: which field holds keywords, how the main keyword is marked, and the grouping column in the Keywords table `wmkf_programlevel3`. Asked by the owner 2026-11-18. |
| Chair marker on the roster (decision 3) | Agreement with the roster migration on `codex/expertise-roster-import-2026-11-10` about which store carries it; confirmation that both chairs are on the roster. |
| Sending the email from the app, with an exact preview | Owner: the sender, and whether `DYNAMICS_IMPERSONATION_ENABLED` is `true` in Production (the Board share path refuses to send without it [VERIFIED via `lib/services/pre-site-visit/distribution/send.js:45`]). |
| Pre-filling highlights from expert matching | The matching output on the other branch; its shape is [ASSUMED]. |
| A link to the staff page from the Workbench navigation | Owner: where it should appear. |

Not planned: open tracking, an "extend link" action, per-chair personalization.

## Before this is turned on

Owner-only steps:

1. Done 2026-11-19: branch merged to `main` after a Codex adversarial review.
2. Apply migration 101 with `node scripts/apply-migrations.js`. The runner applies
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
