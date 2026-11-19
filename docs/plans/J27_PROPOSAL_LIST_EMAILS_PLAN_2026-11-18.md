---
title: J27 proposal list emails to Program Chairs and Board experts
domain: workbench
kind: plan
status: active
summary: "Plan for emailing Program Chairs the full list of submitted J27 proposals grouped by main keyword, and curated personalized lists to Board members with domain expertise, with a personal no-login link to each proposal's staff version. Not built."
canonical: false
cataloged: 2026-11-18
last_verified: 2026-11-18
owner: product-engineering
related:
  - lib/services/deliberation-briefing/briefing-link-service.js
  - lib/services/workbench-proposal-documents.js
  - lib/services/workbench/dashboard-service.js
  - lib/services/review-manager/send-emails-service.js
---

# J27 proposal list emails to Program Chairs and Board experts

Nothing in this plan is built. State labels: `[VERIFIED via X]` was read in source this
session (2026-11-18), `[ASSUMED]` is unconfirmed (including findings from a read-only
search that were not re-read), `[PLANNED]` is this plan's intent.

## What the owner asked for (2026-11-18)

Soon after proposals arrive on December 7:

1. **Chairs email.** One email to the Program Chairs listing every submitted proposal:
   title, institution, PI name. Proposals are grouped into sections by main keyword
   (all neuroscience together, all physics together). Each title links, with no login,
   to the staff version of that proposal.
2. **Expert emails.** Optionally, separate personalized emails to Board members with
   domain expertise, each carrying a shorter list curated to that person. Who the
   experts are and which proposals they match is being worked out on another branch.

## Earlier decisions this builds on

From `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` [VERIFIED via lines 19, 70]:

- D34 (2026-10-28): Program Chairs and Board members get proposals through magic links;
  the mechanism was left to design. This plan is that design.
- Jan 14 "First Cut" packet: about 50 summaries to the Program Committee, personalized
  by expertise. That is a later, smaller list. This plan covers the full list right
  after submission; the same list mechanism could carry the First Cut packet later.

## Owner decisions (2026-11-18)

| # | Decision |
|---|---|
| 1 | Sections come from the keywords Connor's Power Automate flow writes at submission. |
| 2 | Title links open the staff version (`{AKA}_Staff-Version_{Request#}.pdf`), not the reviewer copy. |
| 3 | Chairs are marked on the existing Board roster; one roster serves both emails. |
| 4 | Each person gets their own links, and each proposal has its own link that opens it directly. |
| 5 | Volume: up to 300 proposals. Two chairs today, both Board members; whether both are on the roster is to be confirmed during the roster migration. |
| 6 | Links last until the Board meeting. |
| 7 | A proposal from the recipient's own institution stays on their list and is flagged. |
| 8 | Sender is a staff member, to be named. |
| 9 | Sections use Connor's keyword characterization as written. No staff control to move proposals between sections; chairs receive every proposal, so nothing is lost. |

Context for the Chairs email: one chair is a geologist interested in the physical
sciences; the other is a physician with broad interests.

## What exists today

- **Proposal list.** `lib/services/workbench/dashboard-service.js` selects title
  (`akoya_title`), applicant, project leader and program area for cycle rows
  [VERIFIED via `dashboard-service.js:70-87`]. J27 rows appear once Power Automate sets
  `wmkf_readyforreview` [VERIFIED via `shared/config/workbenchVisibility.js:74,106`].
- **Staff version.** The Workbench resolves it by the name suffix
  `_staff-version_{number}.pdf` at the root of the request's SharePoint folder and
  requires exactly one match [VERIFIED via `lib/services/workbench-proposal-documents.js:211-229`].
  Connor's flow builds the file. It was missing on an earlier test request
  [ASSUMED: from the alignment log, not re-read].
- **No-login Board links.** The deliberation briefing page gives Board members a
  no-login link. Each link is tied to one request, not to a person; the token digest
  and sealed token are stored in Postgres `deliberation_briefing_links` with one live
  link per request [VERIFIED via `lib/db/migrations/038*.sql`]. It serves the reviewer
  copy, `Reviewer Materials/Proposal_{Request#}.pdf`
  [VERIFIED via `lib/services/deliberation-briefing/briefing-page-service.js:365-369`],
  streamed through the app from SharePoint [ASSUMED].
- **Token helper.** `mintScopedToken({subject, audience, ops, expiresAt})` signs a JWT
  [VERIFIED via `lib/services/external-token.js:125`].
- **Email.** Sends go out as Dynamics email activities, as the staff member, after an
  exact preview. The reviewer invite send is the model for per-person emails with a
  per-recipient link minted at send time [ASSUMED: `lib/services/review-manager/send-emails-service.js`
  not re-read]. Sending as the staff member needs `DYNAMICS_IMPERSONATION_ENABLED` [ASSUMED].
- **Board roster.** Postgres `expertise_roster`, `role_type` 'Board'
  [VERIFIED via `lib/db/migrations/004_expertise_finder.sql:8`]. Codex is migrating it to
  Dataverse `wmkf_expertiseprofile` on `codex/expertise-roster-import-2026-11-10`; that
  table exists only in the sandbox [ASSUMED: from the branch handoff of 2026-11-18].
- **Matching.** The Expertise Finder already produces `board_interest[]` per proposal
  [VERIFIED via `shared/config/expertise-finder-output-schema.js:83`] and stores it in
  Postgres `expertise_matches` [ASSUMED].

## Gaps

1. **Keywords.** No flow writes keywords yet, the Keywords table `wmkf_programlevel3`
   is not seeded, no Keywords prompt exists, and nothing marks one keyword as the main
   one [ASSUMED: from `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md`, not re-read]. Decision 1 makes
   this feature depend on that work.
2. **Chairs.** No chair marker was found in code, migrations or schema [ASSUMED: search
   result]. Whether every Program Chair has a Board row on the roster is [ASSUMED].
3. **Links.** No Board-facing link is tied to a person (reviewer links are, but they
   are bound to reviewer records), and no no-login link serves the staff version.

## Design [PLANNED]

One mechanism serves both emails: a **proposal list**, which is one recipient plus a set
of proposals, each with a section label. The Chairs list holds every submitted proposal.
An expert list holds a staff-chosen subset.

### Links

- One stored link per recipient list. The email's per-proposal URL is that link plus the
  request number, for example `/external/proposal-list/{token}/{requestNumber}`. The
  server opens a proposal only if it is on that recipient's list.
- This meets decision 4: every person's links are their own, every title opens its
  proposal directly, one person's access can be revoked alone, and opens are recorded
  per person and proposal.
- New table (for example `proposal_list_links` and `proposal_list_items`): recipient,
  cycle, token digest, expiry, revoked-at, the frozen request set with section labels.
  New audience on the existing token helper. It does not reuse `deliberation_briefing_links`
  rows, so a later deliberation share cannot revoke these links and the briefing
  feature flag does not gate this feature.
- New public routes: verify token, rate limit, check membership, then stream the staff
  version from SharePoint through the app, as the briefing page does for the reviewer copy.
- **Email size.** A signed token is roughly 250 characters; hundreds of links in one
  email may pass the size at which mail clients clip messages. Measure with the real
  proposal count. If it clips, use a short random token for this audience (state is
  stored either way). Decide during contract review.

### Sections

- Read the keyword Connor's flow writes and group by the Keywords table's grouping column.
- **Needed from Connor before build:** which field holds the keywords, how the main
  keyword is marked, and the grouping column in `wmkf_programlevel3`.
- Proposals with no keyword are listed in an "Unassigned" section.
- No staff control to move proposals between sections (decision 9).

### Chairs marker

- A chair flag on the Board roster. The roster is on Codex's active surface (Red under
  the coordination rules). Agree with Codex which store carries the flag, Postgres
  `expertise_roster` or the Dataverse profile, before building. Until then the build
  reads chairs through one small function so the store can change.

### Compose and send

- Staff page in the Workbench cycle view: choose recipients, review sections, see which
  proposals lack a staff version, preview the exact email, send.
- Sending is blocked for any listed proposal with no staff version (or staff remove it).
- One email per recipient, sent as the staff member through the existing email-activity
  path, with the preview check and per-recipient failure reporting of the reviewer send.
- Email template in admin settings using the existing `{{token}}` syntax.

### Expert emails

- Same list mechanism. Staff pick the proposals for each Board member. The picker may
  be pre-filled from matching results once the other branch settles its output; this
  plan consumes that output and does not build matching. Its shape is [ASSUMED] until
  Codex's branch lands.

## Stages

| Stage | Scope | Depends on |
|---|---|---|
| 1 | List tables, per-person links, public route serving the staff version, staff compose/preview/send page, Chairs email with sections | Connor: keyword field and grouping; chair marker location |
| 2 | Curated expert lists and personalized email | Stage 1 |
| 3 | Pre-fill expert lists from matching | Codex's matching output |

**Smallest slice for December 7 (19 days from this plan):** list tables, per-person
links, the public route that serves the staff version, and a previewed send of the
Chairs email. Sections need Connor's keyword field; until it is known, the slice can be
tested on test requests with one unsectioned list. Expert emails (Stage 2) can follow.

## Dependencies and risks

- **Connor's keyword flow before Dec 7.** Without it there are no sections. Possible
  fallback: send one unsectioned list.
- **Staff version on every proposal.** Depends on Connor's flow; the compose page shows
  what is missing.
- **Staff version contents.** The owner chose this file for Board eyes. Confirm once on
  a real J27 folder that it holds nothing staff-only.
- **Roster store.** Shared with Codex's migration; coordinate before touching it.

## Before building

- Run `/contract-reconcile` on this plan (new table, new public routes, outbound email).
- Add the routes to `docs/API_ROUTE_SECURITY_MATRIX.md`; add an Atlas page for the tables.
- Claim the migration number at build time after checking all local and remote branches
  and the manifest. Do not use 097: it is missing on `main` and may be claimed on a branch.
- Test with a capture or test-recipient send before any Board address is used.
- Runtime work: build on a branch and promote deliberately.

## Open design points

1. **Link expiry date.** Which stored date is "the Board meeting" for the cycle (cycle
   calendar field to identify), and whether the link stops at the start or end of that day.
2. **Own-institution flag.** Needs each recipient's institution. Where that comes from
   (roster affiliation or the Board member's contact record) is unread [ASSUMED], and
   institution names must be matched reliably for the flag to be trusted.
3. **Email size at 300 links.** Measure; shorten the token if mail clients clip.
4. **Sender.** Staff member to be named; the send uses the pressing staff member's
   identity unless decided otherwise.
