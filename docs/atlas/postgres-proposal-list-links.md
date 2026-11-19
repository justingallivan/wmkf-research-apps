# Proposal list links

**[MERGED TO MAIN 2026-11-19; OFF]** Migration 101 defines `proposal_list_links` and
`proposal_list_items`. The owner applied it on 2026-11-19 to the app database the
main checkout's `POSTGRES_URL` names (`neondb`; [ASSUMED] the shared
Production/Preview database) [VERIFIED via the owner-run `node scripts/apply-migrations.js` and `node scripts/probe-proposal-list-schema.mjs` readback, 2026-11-19: tracker `applied_at` 2026-11-19 18:09:35 UTC, `applied_by` `owner-proposal-lists`; both tables, expected column counts and the live-link index present; 0 rows].
`PROPOSAL_LIST_SCHEMA_READY` was not set by the build session [ASSUMED: live
environment values unread; setting it is an owner step].
Nothing reads or writes these tables until that flag is the literal `on`. Plan:
`docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md`.

## What the tables hold

`proposal_list_links` is one expiring, revocable personal link per grant cycle,
list type, and recipient address. The link opens a no-login page listing that
cycle's submitted proposals. Columns: `id`, `cycle_code`, `list_kind`
(`ordinary` for real proposals, `test` for Factory test requests),
`recipient_name`, `recipient_email` (lower case), `recipient_source` (a display
reference such as `expertise_roster:7` or `staff:self`; deliberately not a
foreign key, because the roster is being re-keyed), `jti`, `token_digest`
(SHA-256 of the token, unique, checked on every external request),
`token_ciphertext` (the token sealed with `lib/utils/encryption.js` so staff can
copy the same link again; the raw token is never stored), `expires_at`,
`items_built_at`, `created_by`, `created_at`, `revoked_at`, `revoked_by`. A
partial unique index on `(cycle_code, list_kind, recipient_email) WHERE
revoked_at IS NULL` holds at most one live link per recipient.

`proposal_list_items` is the frozen proposal snapshot for one link: `link_id`
(cascade delete), `request_id`, `request_number`, `title`, `institution`,
`project_leader`, `section`, `subsection`, `highlighted`, `own_institution`. Primary key
`(link_id, request_id)`; `(link_id, request_number)` is unique. These rows are
the only requests a link may open.

`section` is the discipline branch and `subsection` the discipline group of the
request's keyword (`_wmkf_programareaserved_value`) in the Keywords table
`wmkf_programlevel3`, copied when the
list is built; a proposal with no Discipline keyword gets `Unassigned` and NULL.
`subsection` comes from migration 102, applied by the owner on 2026-11-19 before
the code that selects it was pushed [VERIFIED via the owner-run
`node scripts/apply-migrations.js` and `node scripts/probe-proposal-list-schema.mjs`
readback, 2026-11-19: 10 item columns, `subsection` present, 0 rows].
`PROPOSAL_LIST_SCHEMA_READY` gates only on migration 101, so any other database
needs 102 applied before this code runs against it.

## Write and read paths

Staff write through `POST /api/workbench/proposal-lists`
(`lib/services/proposal-lists/list-link-service.js` over `list-store.js`):

- `create` reads the cycle's Board Meeting Date from the grant cycle calendar,
  mints an audience-scoped token (`aud: 'proposal-list'`), and inserts the link
  and its items in one transaction. The items come from
  `list-snapshot-service.js`: every Research request linked to the cycle that
  passes the Workbench discovery predicate, with no Program Director or caller
  scope. An incomplete read fails the create.
- `rebuild` replaces a live link's items in one transaction and keeps the link,
  its URL, and the marks on requests that are still listed.
- `marks` sets `highlighted` and `own_institution`; only requests already on the
  link can be marked.
- `revoke` sets `revoked_at` once.

An `ordinary` list may be created only for an active Board member on the
expertise roster who has an email address. A `test` list is always addressed to
the signed-in staff member.

External reads: `lib/external/verify-proposal-list-token.js` reads the link by
digest on every call to `/api/external/proposal-list/[token]/context` and
`/document`, and refuses a revoked row or one past `expires_at`. The context
route reads only `proposal_list_items`. The document route looks up the item by
`(link_id, request_number)`, then resolves that request's staff version
(`{AKA}_Staff-Version_{Request#}.pdf`) from SharePoint through
`lib/services/workbench-proposal-documents.js`. It serves no other file.

## Expiry and cleanup

`expires_at` is 08:00 UTC on the day after the cycle's Board Meeting Date (the
end of that day Pacific time, never earlier). The token's own expiry is 30 days
later so the row decides. If the Board Meeting Date moves, existing rows keep
their expiry; there is no extend action yet. No cleanup is scheduled: revoked
and expired rows stay as history, bounded by one live link per recipient per
cycle.

## Not built

Email sending, a chair marker on the roster, and open tracking.
