# Keyword suggestions: staff ask, a superuser decides

Prepared November 27, 2026. Status: **plan, not built.** Owner decisions are
dated; everything else is a proposal for review.

## Why

The J27 Overview now lets any staff member change a request's primary discipline
(`akoya_request.wmkf_programareaserved`) from the Keywords table
(`wmkf_programlevel3`), branch `claude/ui-items-2026-11-27`
(`lib/services/workbench/primary-discipline-service.js`). The picker offers only
Discipline keywords that carry a discipline branch, the rule the proposal lists
use to place a proposal (`lib/services/proposal-lists/list-snapshot-service.js`
`buildKeywordIndex`). [VERIFIED via source, 2026-11-27]

Staff need a way to say "the right discipline isn't listed" without the term
being added on its own. Today the only path that grows the table is Power
Automate step 3: a term Claude coins becomes a row with `wmkf_needsreview` = Yes
[REPORTED by Connor 2026-11-20, `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`
§5]. No app screen lists those rows. [VERIFIED via code search, 2026-11-27]

## Owner decisions (2026-11-27)

1. Staff suggestions are stored, not added. Postgres is fine for storage.
2. Any superuser can see every suggestion.
3. All active superusers are emailed when a suggestion is made.
4. The email does not act by itself. It links to a signed-in decision page with
   Approve and Deny (owner accepted the more deliberate flow).
5. **Approve creates the Discipline keyword** in the Dynamics Keywords table. The
   superuser chooses its branch and group on the decision page.
6. The staff member who suggested it is **not** emailed the decision.

Not decided: whether Approve also sets the new keyword as that request's primary
discipline (proposed below: no, a separate deliberate step); whether Claude's
Needs Review rows join the same admin list (proposed: second pass).

## Scope

Disciplines only, because the primary-discipline picker is the only staff
keyword editor. Methods and objects of study are out of scope until staff can
edit them.

## Design

### Storage (new Postgres table, migration 114 or the next free number off `main`)

`keyword_suggestions`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `keyword_type` | `'discipline'` only for now; `CHECK` constraint |
| `term` | trimmed, 1-100 characters (Dataverse `wmkf_name` limit to be probed) |
| `note` | optional staff note, up to 1,000 characters |
| `request_id` | the akoya_request GUID the suggestion came from |
| `request_number` | for display and email; never trusted for authorization |
| `suggested_by_profile_id` | from the session, never from the body |
| `created_at` | |
| `status` | `pending` / `approved` / `denied`; `CHECK` constraint |
| `decided_by_profile_id`, `decided_at`, `decision_note` | set once |
| `created_keyword_id` | the new `wmkf_programlevel3id` on approve |
| `created_keyword_branch`, `created_keyword_group` | the choice labels used |

Uniqueness: one pending suggestion per normalized term
(`lower(btrim(term))`) via a partial unique index on `status = 'pending'`, so a
second staff member's identical suggestion links to the existing one instead of
emailing again.

Migration rules: numbered SQL file, manifest regenerated (`npm run prebuild`),
fresh-install shape in `scripts/setup-database.js`, Atlas page for the table,
`check:migrations-manifest`, `check:atlas`.

### Staff side

- Primary-discipline picker (`shared/components/workbench/PrimaryDiscipline.js`):
  a "Suggest a discipline that isn't listed" link opens a small form (term,
  optional note). Submitting does not change the request's discipline.
- `POST /api/workbench/keyword-suggestions`: `requireAppAccess('reviewers')`,
  `withDalContext`, session profile id, GUID-validated `requestId`, term/note
  length limits. Before inserting it checks the term against the live Keywords
  table (case-insensitive name match on any keyword type) and refuses an exact
  existing keyword with a message naming it. Returns the suggestion id and
  whether it joined an existing pending suggestion.

### Email to superusers

- Sent through `NotificationService.sendAdminEmail` with a new category
  `keyword-suggestions`. With no configured recipients for that category or
  `default`, it falls back to the active superuser roster
  (`lib/services/alert-recipients.js` `getSuperuserRoster`), which is the owner's
  "all superusers". [VERIFIED via source; the fallback order is in the module
  header] Admins can later narrow it in `/admin` → Alert Recipients.
- Content: the term, the request number and title, who suggested it, the note,
  and one link to `/admin/keyword-suggestions/<id>`. Applicant text is not in
  the email beyond the title.
- No action in the link. Microsoft 365 Safe Links and similar scanners open
  links automatically, so every state change needs a signed-in POST.
- Send failure does not lose the suggestion: the row is saved first, the email
  is best-effort, and the admin list shows every pending suggestion.

### Superuser side

- `/admin` gets a "Keyword suggestions" section: pending first, then decided,
  with term, request, who, when and status.
- `/admin/keyword-suggestions/[id]`: the suggestion, the request link, and:
  - **Approve**: the superuser picks a discipline branch and a discipline group
    from the Keywords table's choice options, may edit the term's spelling, and
    confirms. The server creates one `wmkf_programlevel3` row (fields below),
    then marks the suggestion approved with the new id.
  - **Deny**: optional note; marks it denied.
- `GET/POST /api/admin/keyword-suggestions[/id]`: `requireSuperuser`, fresh role
  check per request (`lib/utils/auth.js:461`).
- First decision wins: the decision `UPDATE ... WHERE id = $1 AND status =
  'pending'` must affect exactly one row; otherwise 409 "already decided".

### Approve: the Dataverse write

Order matters because the two stores cannot share a transaction:

1. Claim the row: `UPDATE keyword_suggestions SET status = 'approving',
   decided_by_profile_id = ..., decided_at = now() WHERE id = $1 AND status =
   'pending'` (one row or 409). Add `approving` to the status `CHECK`.
2. Re-check the Keywords table for an exact name match (another path may have
   added it since). If found, record that id, mark approved, create nothing.
3. Create the row with a deterministic id derived from the suggestion id, so a
   retry after a lost response cannot create a duplicate (a create that returns
   "already exists" for that id is treated as success).
4. Mark `approved` with `created_keyword_id`.
5. On a create failure, return the row to `pending` with the error recorded, so
   it can be retried; never leave it `approving` silently. A row found in
   `approving` older than a few minutes is shown to superusers as "approval
   interrupted, retry".

Fields to write (all **unverified until the metadata probe below**):
`wmkf_name`, `wmkf_keywordtype` = Discipline (682090000 [VERIFIED via owner-run
probe 2026-11-27]), `wmkf_keyworddisciplinebranch`, `wmkf_keyworddisciplinegroup`,
the parent grant program (Research) link, and `wmkf_needsreview` = No.

Required before building: an owner-run, read-only metadata probe of
`wmkf_programlevel3` for the choice options of branch and group, the type and
navigation property of `wmkf_parentgrantprogram`, the type of
`wmkf_needsreview`, `wmkf_name` maximum length, whether the app identity may
create rows in this table, and whether a caller-supplied primary key is
accepted.

This is a new production write: Tier 2
(`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §4, §10). The write is
attributed to the superuser by impersonation, like the other Workbench writes.

### Effects to tell Connor about

- New Discipline rows with a branch appear in the primary-discipline picker and
  can place proposals in the proposal lists immediately.
- Step 3's keyword prompt reads the Keywords table; new rows change what Claude
  can choose on later runs.
- Ask whether any Power Automate flow triggers on new `wmkf_programlevel3` rows.

## Tests

- Staff POST: session identity only, GUID and length validation, existing
  keyword refused, duplicate pending suggestion joins instead of emailing again.
- Email: category, fallback to superusers, link only, failure keeps the row.
- Admin routes: non-superuser refused; first decision wins (two racing
  decisions, exactly one succeeds).
- Approve: claim, re-check, deterministic create, mark approved; create failure
  returns to pending; a retry after a lost create response makes no duplicate;
  an exact existing name creates nothing.
- Deny: no Dataverse call.

## Gates

`check:migrations-manifest`, `check:atlas` (+ self-test), `check:api-routes`
(+ self-test), `check:fact-consistency` (route counts), `check:trust-boundary-guid`,
`check:dataverse-access-layer`, `check:route-service-boundary`,
`check:route-lifecycle-auth`, plus the full unit suite.

## Rollout

1. Build on a fresh branch from `main` after `claude/ui-items-2026-11-27` is
   settled.
2. Rehearse on a Production test request: suggest, receive the email, deny one,
   approve one into the Keywords table, then remove or retire the test keyword
   with Connor.
3. Record last-known-good deployment and rollback (§10), then the owner merges.

Rollback: hide the suggest link and admin section; approved keywords stay in
Dynamics and are removed by hand if wrong. Code rollback is not data rollback.

## Open questions

1. Should Approve also set the new keyword as the request's primary discipline?
2. Should Claude's Needs Review rows appear in the same admin list?
3. Who retires a mistaken keyword: superusers in the app, or Connor in Dynamics?
