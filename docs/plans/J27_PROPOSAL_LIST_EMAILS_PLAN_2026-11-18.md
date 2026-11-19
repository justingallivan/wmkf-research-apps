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
session (2026-11-18), `[REPORTED]` came from a read-only search and was not re-read,
`[ASSUMED]` is unconfirmed, `[PLANNED]` is this plan's intent.

## What the owner asked for (2026-11-18)

Soon after proposals arrive on December 7:

1. **Chairs email.** One email to the Program Chairs listing every submitted proposal:
   title, institution, PI name. Proposals are grouped into sections by main keyword
   (all neuroscience together, all physics together). Each title links, with no login,
   to the staff version of that proposal.
2. **Expert emails.** Optionally, separate personalized emails to Board members with
   domain expertise, each carrying a shorter list curated to that person. Who the
   experts are and which proposals they match is being worked out on another branch.

## Owner decisions (2026-11-18)

| # | Decision |
|---|---|
| 1 | Sections come from the keywords Connor's Power Automate flow writes at submission. |
| 2 | Title links open the staff version (`{AKA}_Staff-Version_{Request#}.pdf`), not the reviewer copy. |
| 3 | Chairs are marked on the existing Board roster; one roster serves both emails. |
| 4 | Each person gets their own links, and each proposal has its own link that opens it directly. |

## What exists today

- **Proposal list.** `lib/services/workbench/dashboard-service.js` selects title
  (`akoya_title`), applicant, project leader and program area for cycle rows
  [VERIFIED via `dashboard-service.js:70-87`]. J27 rows appear once Power Automate sets
  `wmkf_readyforreview` [REPORTED: `shared/config/workbenchVisibility.js:69-107`].
- **Staff version.** The Workbench resolves it by the name suffix
  `_staff-version_{number}.pdf` at the root of the request's SharePoint folder and
  requires exactly one match [VERIFIED via `lib/services/workbench-proposal-documents.js:211-229`].
  Connor's flow builds the file. It was missing on an earlier test request
  [REPORTED: alignment log D58].
- **No-login Board links.** The deliberation briefing page gives Board members a
  no-login link. Each link is tied to one request, not to a person; the token digest
  and sealed token are stored in Postgres `deliberation_briefing_links` with one live
  link per request [VERIFIED via `lib/db/migrations/038*.sql`]. It serves the reviewer
  copy, streamed through the app from SharePoint [REPORTED: `briefing-page-service.js:365-388`].
- **Token helper.** `mintScopedToken({subject, audience, ops, expiresAt})` signs a JWT
  [VERIFIED via `lib/services/external-token.js:125`].
- **Email.** Sends go out as Dynamics email activities, as the staff member, after an
  exact preview. The reviewer invite send is the model for per-person emails with a
  per-recipient link minted at send time [REPORTED: `lib/services/review-manager/send-emails-service.js`].
- **Board roster.** Postgres `expertise_roster`, `role_type` 'Board'
  [VERIFIED via `lib/db/migrations/004_expertise_finder.sql:8`]. Codex is migrating it to
  Dataverse `wmkf_expertiseprofile` on `codex/expertise-roster-import-2026-11-10`; that
  table exists only in the sandbox [REPORTED: branch handoff 2026-11-18].
- **Matching.** The Expertise Finder already produces `board_interest[]` per proposal
  and stores it in Postgres `expertise_matches` [REPORTED: `shared/config/expertise-finder-output-schema.js`].

## Gaps

1. **Keywords.** No flow writes keywords yet, the Keywords table `wmkf_programlevel3`
   is not seeded, no Keywords prompt exists, and nothing marks one keyword as the main
   one [REPORTED: `docs/plans/J27_WORKBOOK_FIELD_MAP_2026-11-16.md`]. Decision 1 makes
   this feature depend on that work.
2. **Chairs.** No chair marker exists anywhere.
3. **Links.** No link is tied to a person, and no link serves the staff version.

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
- Staff can move a proposal to another section before sending. Proposals with no
  keyword go in an "Unassigned" section that staff must clear or accept.

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

Stage 1 can be built and tested with staff-assigned sections on test requests while the
keyword flow is finished; the keyword read is then a small swap.

## Dependencies and risks

- **Connor's keyword flow before Dec 7.** Without it there are no sections. Fallback:
  staff assign sections on the compose page.
- **Staff version on every proposal.** Depends on Connor's flow; the compose page shows
  what is missing.
- **Staff version contents.** The owner chose this file for Board eyes. Confirm once on
  a real J27 folder that it holds nothing staff-only.
- **Conflicts of interest.** Open: should a recipient's own institution's proposals be
  left off their list or flagged?
- **Roster store.** Shared with Codex's migration; coordinate before touching it.

## Before building

- Run `/contract-reconcile` on this plan (new table, new public routes, outbound email).
- Add the routes to `docs/API_ROUTE_SECURITY_MATRIX.md`; add an Atlas page for the tables.
- Claim the migration number off `main` at build time (097 is unused on `main`, 099 is
  the highest today; check other branches first).
- Test with a capture or test-recipient send before any Board address is used.
- Runtime work: build on a branch and promote deliberately.

## Open questions for the owner

1. How many proposals are expected, and how many chairs?
2. How long should links last, and should they be switched off at a set date?
3. Conflicts of interest, as above.
4. Should the email also be sent to the staff member as a copy?
5. Who sends: the CSO, or whichever staff member presses send?
