# Keyword suggestions: staff ask, a superuser decides

Prepared November 27, 2026; revised the same day after a Codex adversarial
review (gpt-6-astra, verdict needs-attention: approval recovery, term
reservation, existing-keyword compatibility, recipient policy). Status: **plan,
not built.** Owner decisions are
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
| `term` | the staff member's text, trimmed, 1-100 characters (Dataverse `wmkf_name` limit to be probed) |
| `term_key` | `lower(btrim(term))`; the reservation key (see below) |
| `note` | optional staff note, up to 1,000 characters |
| `request_id` | the akoya_request GUID the suggestion came from |
| `request_number` | for display and email; never trusted for authorization |
| `suggested_by_profile_id` | from the session, never from the body |
| `created_at` | |
| `status` | `pending` / `approving` / `approved` / `denied` / `reconcile`; `CHECK` constraint |
| `version` | integer, incremented by every status change; every transition is `WHERE id = $1 AND version = $2` |
| `decided_by_profile_id`, `decided_at`, `decision_note` | the superuser who claimed or decided |
| `approval_term`, `approval_branch`, `approval_group`, `approval_keyword_id` | the approval payload, written once at the claim and never changed afterwards |
| `outcome` | on `approved`: `created` or `linked_existing` |
| `last_error`, `attempted_at` | last create attempt; for the recovery view |

The state machine is the safety contract:

| From | To | Who / when |
|---|---|---|
| `pending` | `approving` | superuser Approve; writes the payload in the same statement |
| `pending` | `denied` | superuser Deny. **Deny is allowed only from `pending`.** |
| `approving` | `approved` | read-back confirms a keyword with this id matching the payload |
| `approving` | `reconcile` | the read-back finds a mismatch, or the outcome cannot be established |
| `approving` | `approving` (resume) | a superuser resumes an interrupted approval (below) |
| `reconcile` | `approved` / `denied` | a superuser resolves it after checking Dynamics, with a note |

Nothing returns to `pending` once a create may have been sent, so a keyword that
Dataverse created while its response was lost can never be denied afterwards.

**Term reservation.** A partial unique index on `(keyword_type, term_key)` where
`status IN ('pending', 'approving', 'reconcile')`. The term stays reserved from
suggestion until the outcome is final, so a second suggestion for the same term
during an approval cannot be inserted: the staff POST catches the unique violation
and links the staff member to the existing suggestion (no second email). When a
superuser edits the spelling at approval, the claim also rewrites `term_key` to
the edited term in the same statement; a unique violation there returns 409
("another suggestion already reserves that term").

Migration rules: numbered SQL file, manifest regenerated (`npm run prebuild`),
fresh-install shape in `scripts/setup-database.js`, Atlas page for the table,
`check:migrations-manifest`, `check:atlas`.

### What counts as an existing keyword

One rule, used by the staff POST and by every approval step, and the same as the
picker's eligibility (`lib/services/workbench/primary-discipline-service.js`
`disciplineOptions`): a **selectable discipline** is a `wmkf_programlevel3` row
with `wmkf_keywordtype` = Discipline (682090000) and a non-empty discipline
branch. [VERIFIED via source, 2026-11-27] Name comparison is on `term_key`.

| Same-name rows in the live Keywords table | Staff POST | Approval |
|---|---|---|
| none | accept | create (below) |
| exactly one selectable discipline | refuse, naming it ("choose it in the list") | `approved`, `outcome = linked_existing`, nothing created; the superuser's taxonomy choice is not applied |
| a Method or Object of Study, or a Discipline without a branch (for example a Claude-coined Needs Review row), and no selectable discipline | accept, and note "a same-name keyword exists but is not a selectable discipline" | **conflict**: 409 with what was found; the suggestion stays `pending`. The superuser denies it, or has the existing row classified in Dynamics (with Connor) and approves again. Reclassifying an existing row from the app is out of scope. |
| more than one selectable discipline | refuse, naming them | conflict as above |

### Staff side

- Primary-discipline picker (`shared/components/workbench/PrimaryDiscipline.js`):
  a "Suggest a discipline that isn't listed" link opens a small form (term,
  optional note). Submitting does not change the request's discipline.
- `POST /api/workbench/keyword-suggestions`: `requireAppAccess('reviewers')`,
  `withDalContext`, session profile id, GUID-validated `requestId`, term/note
  length limits, the existing-keyword rule above (a complete keyword list is
  required; an incomplete read refuses rather than guessing), then the insert
  (reservation conflict = join the existing suggestion). Returns the suggestion id
  and whether it joined one. Email only for a new suggestion.

### Email to superusers

- Recipients: the active superuser roster, resolved explicitly with
  `NotificationService.getAdminRecipients()` (`lib/services/notification-service.js:162-164`,
  which returns `AlertRecipients.getSuperuserRoster()`), and passed as
  `explicitRecipients` to `sendAdminEmail` **with no `category`**. With no
  category, `sendAdminEmail` sends to the explicit list only
  (`notification-service.js:173-205`), so a configured `default` alert list can
  neither replace the superusers nor add non-superusers. [VERIFIED via source,
  2026-11-27] Changing the audience later is a separate owner decision.
- If the roster lookup fails it returns an empty list
  (`alert-recipients.js` `getSuperuserRoster` catch) and `sendAdminEmail` skips
  the send with a log line; the suggestion is still saved and listed.
- Content: the term, the request number and title, who suggested it, the note,
  and one link to `/admin/keyword-suggestions/<id>`. Applicant text is not in
  the email beyond the title.
- No action in the link. Microsoft 365 Safe Links and similar scanners open
  links automatically, so every state change needs a signed-in POST.
- Send failure does not lose the suggestion: the row is saved first, the email
  is best-effort, and the admin list shows every pending suggestion.

### Superuser side

- `/admin` gets a "Keyword suggestions" section: `reconcile` and stalled
  `approving` first, then `pending`, then decided.
- `/admin/keyword-suggestions/[id]`: the suggestion, the request link, any
  same-name keywords found, and:
  - **Approve**: the superuser picks a discipline branch and a discipline group
    from the Keywords table's choice options, may edit the spelling, and
    confirms.
  - **Deny**: optional note. Pending only.
  - **Resume approval**: shown for `approving` rows whose `attempted_at` is
    older than 5 minutes.
  - **Resolve**: shown for `reconcile` rows; approve (link a keyword id that
    the server verifies) or deny, with a required note.
- `GET/POST /api/admin/keyword-suggestions[/id]`: `requireSuperuser`, fresh role
  check per request (`lib/utils/auth.js:461`). Every transition is version-fenced
  and must affect exactly one row; otherwise 409.

### Approve: the Dataverse write

The two stores cannot share a transaction, so the design makes every step
re-runnable from what is already saved:

1. **Check** the live Keywords table with the rule above for the (possibly
   edited) term. A selectable match: mark `approved`/`linked_existing` from
   `pending` (fenced) and stop. A conflict: 409, stays `pending`.
2. **Claim and freeze**: one fenced statement moves `pending` → `approving`,
   writes the payload (`approval_term`, `approval_branch`, `approval_group`) and
   `approval_keyword_id`, rewrites `term_key`, sets `attempted_at`. The keyword
   id is a UUID chosen here and saved before any Dataverse call.
3. **Create** the row with that id and the frozen payload.
4. **Read back** the id. If the row exists and its name, type, branch and group
   match the payload, mark `approved`/`created` (fenced). If it exists and does
   not match, mark `reconcile`. If it does not exist, record `last_error` and
   leave `approving`.
5. **Resume** (an interrupted process, a lost response, or a failed Postgres
   finalization): a superuser's Resume claims the row with a fenced
   `approving` → `approving` update (new `version`, new `attempted_at`), then
   runs step 4 first. Only if the read-back finds no row does it run step 3 again,
   **with the frozen payload; the retry cannot change spelling or taxonomy.**
   Before re-creating, it re-runs the name check; a newly appeared selectable
   discipline with that name moves the row to `reconcile` instead of creating a
   second one.

Concurrent external writers: Power Automate step 3 can coin the same name at
any time, and nothing in the app can lock the Keywords table. The app therefore
detects rather than prevents: after a successful create, it lists same-name rows
again; more than one selectable discipline with that name moves the suggestion
to `reconcile` and the admin view shows both ids for Connor to merge. The fixed
id only prevents the app from creating its own duplicate on a retry; it does not
make names unique.

Fields to write (all **unverified until the metadata probe below**):
`wmkf_name`, `wmkf_keywordtype` = Discipline (682090000 [VERIFIED via owner-run
probe 2026-11-27]), `wmkf_keyworddisciplinebranch`, `wmkf_keyworddisciplinegroup`,
the parent grant program (Research) link, and `wmkf_needsreview` = No.

Required before building: an owner-run, read-only metadata probe of
`wmkf_programlevel3` for the choice options of branch and group, the type and
navigation property of `wmkf_parentgrantprogram`, the type of
`wmkf_needsreview`, `wmkf_name` maximum length, and whether the table accepts a
caller-supplied primary key. **A read-only probe cannot prove the write.** Before
the build is considered done, rehearse one create under the impersonated
superuser identity on Production (Mode D, owner-run), including a deliberately
repeated create with the same id, and retire the test row with Connor.

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

- Staff POST: session identity only; GUID and length validation; every row of the
  existing-keyword table above (none, one selectable, Method, unclassified
  Discipline, several same-name rows); incomplete keyword list refuses; a
  suggestion while another is `approving` for the same term joins it instead of
  inserting or emailing.
- Email: recipients are exactly the superuser roster even with a non-empty
  `default` alert list and a category list containing non-superusers; roster
  failure skips the send and keeps the row.
- Admin routes: non-superuser refused; every transition version-fenced; two
  racing decisions, exactly one succeeds; Deny refused for `approving` and
  `approved`.
- Approve: lost create response (row exists, response failed) ends `approved`
  after Resume, never `pending` or `denied`; process termination after the claim
  is resumable; a Resume cannot change the frozen payload; failed Postgres
  finalization after a successful create is finalized by Resume; read-back
  mismatch goes to `reconcile`; a same-name selectable discipline appearing
  before a retry goes to `reconcile` without a second create; edited spelling
  that collides with another reservation returns 409.
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
