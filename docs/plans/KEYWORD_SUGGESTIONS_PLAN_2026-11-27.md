# Keyword suggestions: staff ask, a superuser decides

Prepared November 27, 2026; revised the same day after a Codex adversarial
review (gpt-6-astra, verdict needs-attention: approval recovery, term
reservation, existing-keyword compatibility, recipient policy) and a second
review (post-claim recheck; server-verified reconcile denial) and a third
(every create attempt timed and fenced; retired keywords not selectable;
duplicate conflicts must be resolved before approval), then a fourth local-source
review on November 28 (dispatch bounds, terminal verification, claim/result
identity, write prerequisites, bootstrap and rehearsal controls). Status: **plan,
not built.** Owner decisions are
dated; everything else is a proposal for review.

## Why

On this branch, the J27 Overview lets staff with Workbench access, a linked
Dynamics identity, and enabled impersonation change a request's primary discipline
(`akoya_request.wmkf_programareaserved`) from the Keywords table
(`wmkf_programlevel3`), branch `claude/ui-items-2026-11-27`
(`lib/services/workbench/primary-discipline-service.js`). The picker offers only
Discipline keywords that carry a discipline branch, the rule the proposal lists
use to place a proposal, with an additional active-state requirement for new
choices. [VERIFIED via pages/api/workbench/primary-discipline.js:14;
lib/services/workbench/primary-discipline-service.js:40;
lib/services/workbench/primary-discipline-service.js:54;
lib/services/proposal-lists/list-snapshot-service.js:88; deployment not checked]

Staff need a way to say "the right discipline isn't listed" without the term
being added on its own. Power Automate step 3 is a reported writer: a term
Claude coins becomes a row with `wmkf_needsreview` = Yes
[REPORTED by Connor 2026-11-20, `docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md`
§5]. [ASSUMED: other external writers and a dedicated Needs Review admin screen
have not been exhaustively inventoried; this is not an exclusivity claim.]

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

Disciplines only: this proposal extends the primary-discipline picker.
Methods and objects of study are out of scope.

## Design

### Storage (new Postgres table, migration 114 or the next free number off `main`)

`keyword_suggestions`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `keyword_type` | `'discipline'` only for now; `CHECK` constraint |
| `term` | the staff member's text, trimmed, 1-100 characters (Dataverse `wmkf_name` limit to be probed) |
| `term_key` | database-enforced `lower(btrim(COALESCE(approval_term, term)))`; the reservation follows the current approval spelling, while `term` preserves the submission |
| `note` | optional staff note, up to 1,000 characters |
| `request_id` | the akoya_request GUID the suggestion came from |
| `request_number` | for display and email; never trusted for authorization |
| `suggested_by_profile_id` | from the session, never from the body |
| `created_at` | |
| `status` | `pending` / `approving` / `approved` / `denied` / `reconcile`; `CHECK` constraint |
| `version` | integer; every transition, resume, send permit and attempt/error update requires the expected `status` and `version`, increments `version`, and uses the returned version for its next write |
| `claimed_by_profile_id`, `decided_by_profile_id`, `decided_at`, `decision_note` | claimant stored at claim; terminal decision actor/time stored only at finalization, including a different superuser who resumes/resolves; profile IDs are integer references to `user_profiles(id)` |
| `approval_term`, `approval_branch`, `approval_group`, `approval_parent_program_id`, `approval_keyword_id` | server-validated create payload and generated UUID; fixed within a claim and permanently frozen once any create permit is issued; a new claim from `pending` may replace an unsent payload |
| `resolved_keyword_id` | actual keyword on `approved`: the frozen create ID for `created`, or the existing row's ID for `linked_existing`; never overwrite `approval_keyword_id` with a linked ID |
| `outcome` | on `approved`: `created` or `linked_existing` |
| `create_sent_at` | first fenced create permit time; null means no create was authorized; non-null means a create **may** have been sent, including a crash before dispatch |
| `last_create_sent_at` | latest fenced create permit time, first or retry; the total dispatch-and-commit bound is measured from this |
| `last_error`, `attempted_at` | sanitized last error and latest claim/Resume/send time; for the recovery view |
| `resolution` | on a resolved `reconcile`: `verified_created`, `verified_absent`, `retired_in_dynamics` |

The state machine is the safety contract:

| From | To | Who / when |
|---|---|---|
| `pending` | `approving` | superuser Approve; writes the payload in the same statement |
| `pending` | `denied` | superuser Deny, only with `create_sent_at IS NULL`. Ordinary Deny is pending-only; Resolve has separate verified rules below. |
| `approving` | `approved` | the complete verification in Approve step 6 passes, or the no-send post-claim check links exactly one existing selectable discipline; persist `resolved_keyword_id` and `outcome` atomically |
| `approving` | `pending` | the post-claim check finds a conflict **and `create_sent_at` is null**; keep the unsent payload and its edited-term reservation until a new claim replaces them atomically |
| `approving` | `reconcile` | the read-back finds a mismatch or a same-name conflict after a send permit, or a superuser explicitly stops retries on an unresolved approval; unavailable evidence alone keeps the current state/reservation for retry |
| `approving` | `approving` (resume) | a superuser resumes an interrupted approval (below) |
| `reconcile` | `approved` | **server-verified**: the same full-payload and exactly-one-selectable verification as Approve step 6 passes (`resolution = verified_created`, `outcome = created`, `resolved_keyword_id = approval_keyword_id`); for example after Connor retires the other duplicate. A merge that removes the frozen ID needs a separate owner decision, not a silent relink. |
| `reconcile` | `denied` | **server-verified only**: (a) the frozen ID is confirmed absent, and either no permit was ever issued or the verified total in-flight bound has elapsed (`verified_absent`); or (b) that row is confirmed inactive (`statecode = 1`, `retired_in_dynamics`). Missing/unknown state and read failures never prove absence or retirement. |

**Reconcile stops new send permits.** A create is sent only by a request that has just
won the fenced "mark sent" update from `approving` (which bumps `version`). The
move to `reconcile` also bumps `version`, so a Resume that has not yet won its
send permit loses its update and sends nothing. A sender that already won can
still dispatch later: the Postgres fence cannot cancel it. Treat all such
permits as potentially in flight, measured from `last_create_sent_at`.

**The in-flight bound is a prerequisite, not a chosen delay.** The existing
client awaits token acquisition before dispatch and starts its 30-second abort
timer only at fetch. Neither that timer nor a Postgres version proves that an
already-authorized sender cannot dispatch later or that Dataverse has finished.
[VERIFIED via lib/services/dynamics/write-core.js:134;
lib/services/dynamics/http.js:60; lib/services/dynamics/constants.js:49]
Before enabling `verified_absent` after any permit, prove and record a hard
maximum from permit to last possible dispatch (including token waits, process
suspension/lifetime and any retry), **plus** upstream queuing/commit/visibility
time and a clock margin. A maximum of the two durations is insufficient.
[ASSUMED: no such end-to-end bound has been established; 15 minutes is not
verified.] Until it is established/enforced for every sender, absence-based
denial after a permit is disabled; keep the row reserved in `reconcile`.
Read the frozen ID again after the bound immediately before the fenced decision.
Never purge or reuse that ID while a permitted sender might still create it;
retire an existing row instead. Later external reactivation is outside this
workflow's guarantee and requires Connor's operational control.

Deny from `pending` is the only unverified denial, and it is allowed only while
`create_sent_at` is null. Once a create may have been sent, the suggestion can
end only in a state the server has checked against Dynamics, with the proven
sender bound required before absence can release the reservation. This prevents
an app-created keyword with a lost response from being left selectable under
a denied suggestion, subject to the external-reactivation limit above. The
term stays reserved throughout `reconcile`.

**Term reservation.** A partial unique index on `(keyword_type, term_key)` where
`status IN ('pending', 'approving', 'reconcile')`. The term stays reserved from
suggestion until the outcome is final, so a second suggestion for the same term
during an approval cannot be inserted: the staff POST catches the unique violation
and returns an already-submitted acknowledgement and its id (no second email
or another staff member's note/request details). The detail page is superuser-only;
ordinary staff must not be sent to its admin URL. When a
superuser edits the spelling at approval, the claim also rewrites `term_key` to
the edited term in the same statement; a unique violation there returns 409
("another suggestion already reserves that term"). Use the same database
`lower(btrim(...))` normalization for Dataverse names in every comparison; do
not mix database collation with a different JavaScript trim/lowercase rule.

Migration rules: numbered SQL file, manifest regenerated (`npm run prebuild`),
Atlas page and service-catalog entry, `check:migrations-manifest`, `check:atlas`.
Fresh setup already executes manifest migrations; put the new shape in that
SQL once and test fresh-bootstrap/upgrade parity, rather than adding a duplicate
CREATE to setup's base groups. [VERIFIED via scripts/setup-database.js:2119;
scripts/lib/fresh-database-bootstrap.js:128] Existing databases use
`scripts/apply-migrations.js` under a separate authorized rollout, never setup.
Require NOT NULL/defaults and CHECKs for valid status/payload/timestamp/outcome
combinations; `pending` cannot carry a send timestamp, both send timestamps
are null together or ordered, and `approved` requires its actual result ID.

### What counts as an existing keyword

One rule, used by the staff POST and by every approval step, and the same as the
picker's eligibility (`lib/services/workbench/primary-discipline-service.js`
`disciplineOptions`): a **selectable discipline** is an **active**
(`statecode` 0) `wmkf_programlevel3` row with `wmkf_keywordtype` = Discipline
(682090000), a valid id/non-empty name, and a non-empty formatted discipline
branch. [VERIFIED via lib/services/workbench/primary-discipline-service.js:54;
lib/services/workbench/primary-discipline-service.js:92;
lib/dataverse/adapters/keyword.js:21] Name
comparison is on `term_key`. `listAll` still returns retired rows, because the
proposal lists must place requests that already point at one; only new choices
use this rule. [VERIFIED via lib/dataverse/adapters/keyword.js:24;
lib/services/proposal-lists/list-snapshot-service.js:88]

| Same-name rows in the live Keywords table | Staff POST | Approval |
|---|---|---|
| none | accept | create (below) |
| exactly one selectable discipline | refuse, naming it ("choose it in the list") | before any send permit: `approved`, `outcome = linked_existing`, persist its id in `resolved_keyword_id`, nothing created; the superuser's taxonomy choice is not applied. After a permit, only the frozen-ID verification may approve; a different id means `reconcile`. |
| one or more rows but no selectable discipline (including Method/Object, branchless Discipline, retired or unknown-state rows) | accept, and note "a same-name keyword exists but is not a selectable discipline" | **conflict**: before any send permit, 409 and `pending`; after a permit, `reconcile`. The superuser denies a pending suggestion, or has the existing row classified/reactivated in Dynamics (with Connor) and approves again. Editing an existing row from the app is out of scope. |
| more than one selectable discipline | refuse, naming them | conflict as above (pending before any permit; reconcile after one) |

### Staff side

- Primary-discipline picker (`shared/components/workbench/PrimaryDiscipline.js`):
  a "Suggest a discipline that isn't listed" link opens a small form (term,
  optional note). Submitting does not change the request's discipline.
- `POST /api/workbench/keyword-suggestions`: `requireAppAccess('reviewers')`,
  `withDalContext`, non-null session profile id, GUID-validated `requestId`, term/note
  length limits, the existing-keyword rule above (a complete keyword list is
  required; an incomplete read refuses rather than guessing), then the insert
  (reservation conflict = join the existing suggestion). Before insertion read
  the request server-side, reject nonexistent requests, and derive its number/title
  and the submitter's display identity from trusted reads/session, not body fields.
  Returns only the suggestion id and whether it joined one. If the conflicting
  reservation finalizes before it can be read, repeat the keyword check/insert
  with a bounded retry; never claim a join to a missing row. Email only for a new
  suggestion. Guard all post-await UI updates against a changed request/unmount,
  as the existing card does [VERIFIED via shared/components/workbench/PrimaryDiscipline.js:30].

### Email to superusers

- Recipients: the active superuser roster, resolved explicitly with
  `NotificationService.getAdminRecipients()` (`lib/services/notification-service.js:162-164`,
  which returns `AlertRecipients.getSuperuserRoster()`), and passed as
  `explicitRecipients` to `sendAdminEmail` **with no `category`**. With no
  category, `sendAdminEmail` sends to the explicit list only
  (`notification-service.js:173-205`), so a configured `default` alert list can
  neither replace the superusers nor add non-superusers. [VERIFIED via
  lib/services/notification-service.js:162; lib/services/notification-service.js:192;
  lib/services/alert-recipients.js:93] The roster includes only valid email
  addresses; missing/invalid addresses cannot be delivered. Changing the
  audience later is a separate owner decision.
- If the roster lookup fails it returns an empty list
  (`lib/services/alert-recipients.js:112`) and `sendAdminEmail` skips
  the send with a log line; the suggestion is still saved and listed.
- Content: the term, the request number and title, who suggested it, the note,
  and one link to `/admin/keyword-suggestions/<id>`. Applicant text is not in
  the email beyond the title.
- No action in the link. Microsoft 365 Safe Links and similar scanners open
  links automatically, so every state change needs a signed-in POST.
- Save/commit first, then await the best-effort email in the trusted DAL context;
  catch thrown send errors and handle `false` (no sender/recipients) without
  changing the saved result. Direct `sendAdminEmail` does not swallow errors or
  escape caller-built HTML. Escape term/note/title/name and build the link from
  a trusted configured app origin and persisted id. [VERIFIED via
  lib/services/notification-service.js:173; lib/services/notification-service.js:213;
  lib/services/notification-service.js:263] The admin list remains the recovery
  surface; there is no guaranteed delivery or automatic retry in this proposal.

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
    older than 5 minutes; enforce this on the server too. This threshold is
    not evidence for an absence-based denial.
  - **Stop retries / reconcile**: a fenced `approving` → `reconcile` POST with
    a required note; no Dataverse write. Keep the reservation, payload and permit
    timestamps. This also handles a failed create with no row/conflict found;
    it prevents new permits but cannot cancel a sender that already won one.
  - **Resolve**: shown for `reconcile` rows, with a required note. The server
    repeats the full terminal verification at POST time (not trusting a prior
    GET or client verdict). Verified full match → approved; verified absence
    with no permit or after the proven total bound, or confirmed retirement →
    denied. Anything else stays `reconcile` with
    what was found, for Connor.
- `GET/POST /api/admin/keyword-suggestions[/id]`: `requireSuperuser`, fresh role
  check when auth is enabled [VERIFIED via lib/utils/auth.js:431;
  lib/utils/auth.js:461]. This helper returns only `{ profileId }` and bypasses
  checks with a null id when auth is disabled; reject bypass/null identity here.
  Obtain the authenticated session via `getSession`, require its profile id to
  match the gate, and derive the write actor with `actorRefFromSession`.
  Establish `withDalContext` after auth, and call a service which uses named
  keyword-adapter operations (not direct route-to-adapter calls). The current
  keyword adapter has only `listAll`; create and exact-id verification/projections
  must be added [VERIFIED via lib/dataverse/adapters/keyword.js:24].
  Before claim/Resume that can create, require a valid linked actor, enabled
  impersonation and writable target; pass `{ actingUserSystemId, noFallback: true }`
  for every create. The current primary-discipline service checks linked identity,
  impersonation and read-only Preview before its write; the shared HTTP interlock
  enforces the target [VERIFIED via lib/services/dynamics/http.js:60;
  lib/services/workbench/primary-discipline-service.js:40;
  lib/services/workbench/primary-discipline-service.js:98]; otherwise the shared
  client may omit impersonation or retry as the service principal [VERIFIED via
  lib/services/dynamics/write-core.js:77; lib/services/dynamics/write-core.js:101].
  Validate suggestion GUIDs, positive integer versions, allowlisted actions,
  term/note limits and metadata-backed numeric choice values server-side.
  Every transition must affect exactly one row; otherwise 409. GET never mutates;
  use `Cache-Control: no-store`, and refresh stale UI on 409.

### Approve: the Dataverse write

The two stores cannot share a transaction, so the design makes every step
re-runnable from what is already saved:

1. **Pre-check** the live Keywords table with the rule above for the (possibly
   edited) term, so an obvious match or conflict is reported before claiming.
   This check is advisory only.
2. **Claim and freeze**: one fenced statement moves `pending` → `approving`,
   writes the payload (`approval_term`, `approval_branch`, `approval_group`,
   server-resolved Research `approval_parent_program_id`) and
   `approval_keyword_id`, rewrites `term_key` (taking the edited term's
   reservation), sets `attempted_at`. The keyword id is a UUID chosen here and
   saved before any Dataverse create. A prior unsent claim may be replaced here;
   after any send permit the payload/id cannot change. Type = Discipline,
   active state and Needs Review = No are fixed create-contract constants.
3. **Authoritative check, with the reservation held**: repeat the complete
   existing-keyword check. A selectable match: `approving` → `approved`,
   `linked_existing`, storing the actual `resolved_keyword_id` (fenced, only
   with `create_sent_at IS NULL`). A conflict: `approving` → `pending`, keep
   the unsent payload/reservation (allowed because `create_sent_at` is still
   null), 409. This closes the race where a
   second approval's stale pre-check would create a second keyword after the
   first finalized and released the term.
4. **Mark sent on every attempt**: one update with expected `status = approving`
   and `version` sets `create_sent_at = COALESCE(create_sent_at, now())`,
   `last_create_sent_at = now()` and `attempted_at = now()`, and increments/
   returns `version`. Only its winner may call create, once. A failed fence
   sends nothing. From here the row can never return to `pending`.
5. **Create** the row with that id and the entire frozen payload, session actor
   and `noFallback: true`. If absence-based denial is enabled, every sender
   must honor the verified lifetime/dispatch bound, including hidden retries.
   Without that proof, creating/resuming is allowed but absence-based denial
   after any permit remains disabled.
6. **Verify before finalizing**, on first attempt, Resume and Resolve alike:
   read the frozen id and a complete same-name list. Approve/created only if the
   id is the sole selectable discipline and matches the normalized name,
   numeric type/branch/group, frozen parent lookup and Needs Review = No;
   persist `resolved_keyword_id = approval_keyword_id`. An existing frozen-id
   mismatch/inactive row, or a same-name conflict after a permit, goes to
   `reconcile`. If the id is absent and no permit exists, step 3 handles the
   match/conflict for an `approving` row; Resolve uses the state table. Only a confirmed
   record-not-found is absence; generic 404, timeout, 403 or capped/malformed
   list is unavailable evidence, never an empty table. Use the repo's exact
   not-found classifier [VERIFIED via lib/dataverse/core/errors.js:36]. Record
   errors with the current fence; a lost fence stops all further work. A
   confirmed absent id with no conflict leaves an `approving` row resumable
   (or the superuser can stop retries); Resolve follows the state table. A verification
   outage retains the current state and reservation for a later retry.
7. **Resume** (an interrupted process, a lost response, or a failed Postgres
   finalization): a superuser's Resume claims the row with a fenced
   `approving` → `approving` update whose WHERE also requires `attempted_at`
   older than five minutes (new `version`, new `attempted_at`), then runs step 6. If the id
   is confirmed absent and `create_sent_at` is null, continue from step 3.
   After a permit, only confirmed absence plus a complete conflict-free
   same-name check permits retry through **steps 4–6**, with the frozen id and
   payload; any same-name row now present means `reconcile`, never a relink or
   a return to pending. Failed/incomplete reads send nothing. A repeated fixed-id
   create error also goes through step 6, since the earlier attempt may have
   succeeded. Resume never changes spelling, taxonomy or parent.

Concurrent external writers: Power Automate step 3 can coin the same name at
any time, and nothing in the app can lock the Keywords table. The app therefore
detects rather than prevents: step 6 checks the complete same-name list before
every created finalization; more than one selectable discipline moves the suggestion
to `reconcile` and the admin view shows both ids for Connor to merge. The fixed
id only prevents the app from creating its own duplicate on a retry; it does not
make names unique. External changes after that read/finalization remain possible;
approval records the verified observation, not perpetual uniqueness.

Fields to write (all **unverified until the metadata probe below**):
the explicit primary key, `wmkf_name`, `wmkf_keywordtype` = Discipline
(682090000 [VERIFIED via lib/services/workbench/primary-discipline-service.js:21;
live metadata not re-probed]), `wmkf_keyworddisciplinebranch`,
`wmkf_keyworddisciplinegroup`, the frozen parent grant program (Research) link,
and `wmkf_needsreview` = No. Confirm active default or explicitly set the
metadata-supported active state, and verify `statecode = 0` on read-back.

Required before building: an owner-run, read-only metadata probe of
`wmkf_programlevel3` for the choice options of branch and group, the type and
navigation property of `wmkf_parentgrantprogram`, the unique authoritative
Research parent GUID for the target org, the type of
`wmkf_needsreview`, `wmkf_name` maximum length, and whether the table accepts a
caller-supplied primary key, active-state behavior, and the intended superuser's
create/lookup privileges. Validate choices/parent server-side; add the full
verification projection to the adapter, including parent and Needs Review.
**A read-only probe cannot prove the write.** Rehearse an impersonated create
and deliberately repeated create with the same id in Mode C if it can prove
the contract; use owner-authorized Mode D only for remaining production-specific
evidence, with the controls in Rollout below. Retire the test row with Connor.

This is a new production write: Tier 2
(`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §4, §10). The write
must be attributed to the acting superuser by impersonation with no fallback,
including a different superuser who resumes it. This is a build requirement,
not proof of live permissions or a built keyword-create operation.

### Effects to tell Connor about

- New active Discipline rows with a branch become picker choices on a fresh
  load. They place a proposal only after its primary-discipline lookup points
  to that keyword and a proposal-list snapshot is built/rebuilt; approval alone
  does not do either under the proposed no-auto-assignment behavior. [VERIFIED
  via lib/services/workbench/primary-discipline-service.js:54;
  lib/services/proposal-lists/list-snapshot-service.js:101]
- Step 3's keyword prompt reads the Keywords table; new rows change what Claude
  can choose on later runs.
- Ask whether any Power Automate flow triggers on new `wmkf_programlevel3` rows.

## Tests

- Staff POST: session identity only; GUID and length validation; every row of the
  existing-keyword table above (none, one selectable, Method, unclassified
  Discipline, retired/unknown-state row, several same-name rows); nonexistent
  request refuses; spoofed number/title/profile is ignored; incomplete keyword
  list refuses; a
  suggestion while another is `approving` for the same term joins it instead of
  inserting or emailing, without exposing its note or an admin-only link;
  reservation finalizing during conflict lookup retries safely; identical
  normalization for submission, edited spelling and Dataverse names (including
  case, whitespace and non-ASCII input); stale-request UI responses are ignored.
- Email: recipients are exactly the superuser roster even with a non-empty
  `default` alert list and a category list containing non-superusers; roster
  failure, missing sender and thrown send errors keep the committed row and
  successful submission response; untrusted email fields are HTML-escaped.
- Admin routes: non-superuser refused; every transition version-fenced; two
  racing decisions, exactly one succeeds; Deny refused for `approving` and
  `approved`; auth bypass/null identity refused; missing linked actor, disabled
  impersonation or non-writable target cannot claim/send; spoofed actor ignored;
  impersonated 403 has no service-principal retry; GET has no side effects.
- Approve: lost create response (row exists, response failed) ends `approved`
  after Resume, never `pending` or `denied`; process termination after the claim
  is resumable; a Resume cannot change the frozen payload; failed Postgres
  finalization after a successful create is finalized by Resume; read-back
  mismatch goes to `reconcile`; a same-name selectable discipline appearing
  before a retry goes to `reconcile` without a second create; edited spelling
  that collides with another reservation returns 409; two approvals converging
  on one term, with the first finalizing between the second's pre-check and
  claim, end with one keyword (the second links it); a conflict found after the
  claim returns to `pending` only while `create_sent_at` is null; re-claim may
  replace that unsent payload and reservation; linked-existing persists the
  actual result id separately; every retry updates both the latest permit time
  and version while preserving the first permit time; stale error writers fail
  their fence. First-attempt finalization, Resume and Resolve share full-payload,
  active-state and exactly-one-selectable checks; read failures/capped lists
  cannot authorize a create, relink or terminal decision.
- Reconcile: denial refused while the keyword id exists and is active, and
  refused while no row exists but `last_create_sent_at` is inside the in-flight
  bound; Stop retries can move a failed, conflict-free approval to reconcile
  without releasing its reservation; a Resume that loses its permit fence sends
  nothing. Pause a sender
  **after** winning its permit but **before** token acquisition/HTTP dispatch,
  then move to reconcile: denial remains blocked until that sender can no
  longer dispatch/commit under the proven total bound. An unproven bound always
  refuses absence-based denial after a permit. Confirmed absence with no permit
  can resolve; unknown state/generic 404 cannot. Approval refused while two
  selectable same-name disciplines remain;
  a retired keyword can be neither newly selected in the picker nor linked by
  approval; a create that lands late is then found and resolves to approved; a
  mismatched existing row cannot be denied until it is retired in Dynamics.
- Pending Deny: no Dataverse call. Resolve-to-denied: required fresh Dataverse
  reads, no Dataverse write; never trust an earlier GET or a client verdict.
- Schema: actual isolated-Postgres tests for partial-unique-index races,
  null/status/payload constraints, result IDs and fresh-bootstrap/upgrade parity;
  mocks alone do not prove the SQL concurrency contract.

## Gates

`check:migrations-manifest`, `check:atlas` (+ self-test), `check:api-routes`
(+ self-test), `check:fact-consistency` (route counts), `check:trust-boundary-guid`,
`check:dataverse-access-layer`, `check:route-service-boundary`,
`check:route-lifecycle-auth`, plus the full unit suite.

## Rollout

1. Build on a fresh branch from `main` after `claude/ui-items-2026-11-27` is
   settled.
2. Verify the additive migration/schema before enabling the routes; use isolated
   Postgres and mocked Dataverse/email (Mode A), then Mode C where it can prove
   the integration. Keep suggestion, approval, Resume and notification side
   effects server-disabled until their schema/target prerequisites are met.
3. Only if A–C cannot prove a production-specific behavior, prepare an explicitly
   owner-approved Mode D rehearsal: dedicated request and keyword UUID/name,
   server-side record/actor/recipient allowlists, exact expected Postgres,
   keyword and email-activity writes, cleanup owner and last-known-good
   deployment/rollback recorded **before** the test. Capture notification mail
   unless the owner specifically authorizes real delivery. The generic
   notification transport is a real Dynamics send, not a capture transport
   [VERIFIED via lib/services/notification-service.js:219]. A collection-create
   interlock grant checks the entity set, not the body UUID, so the rehearsal
   service must enforce the named keyword payload too [VERIFIED via
   lib/dataverse/core/interlock.js:310]. Do not bypass the interlock or assume
   an ordinary Preview can write production. Follow campaign strategy §5/§10
   [VERIFIED via docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:218;
   docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:341].
4. Exercise suggest, captured/authorized email, pending Deny, Approve, repeated
   fixed-id create and Resume/Resolve; reconcile all recorded writes. Retire
   the test keyword with Connor; no deletion while a sender might still run.
   Record evidence and cleanup failures, then obtain the owner's deliberate
   merge/promotion decision. This plan does not authorize that rehearsal now.

Rollback: disable the feature's mutation/email paths on the server, hide its UI
and roll back the deployment as needed. Inventory outstanding permits and keep
unresolved rows/reservations; stopped UI does not stop an in-flight sender.
Approved keywords stay in Dynamics; retire mistaken rows through the owner-
approved process. Code rollback is not data rollback.

## Open questions

1. Should Approve also set the new keyword as the request's primary discipline?
2. Should Claude's Needs Review rows appear in the same admin list?
3. Who retires a mistaken keyword: superusers in the app, or Connor in Dynamics?
4. If Connor merges away the frozen create ID into a different surviving keyword,
   should a separately reviewed server-verified relink be supported? Until decided,
   Resolve does not silently approve that survivor as this attempt's creation.

Unverified execution prerequisites (not owner decisions): live metadata/Research
parent and create privileges; fixed-id retry behavior; the end-to-end sender/
commit/visibility bound. These require future authorized probes/rehearsal, not
claims of verification from this local review. The actual delivery policy on
roster/send failure is best-effort as proposed above; the owner decision to email
all active superusers does not itself establish guaranteed-delivery semantics.
